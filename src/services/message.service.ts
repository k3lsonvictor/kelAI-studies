import type { ContactService } from "./contact.service.js";
import type { ConversationService } from "./conversation.service.js";
import type { MessageRepository } from "../repositories/message.repository.js";
import type { WhatsAppService } from "./whatsapp.service.js";
import type { AIService } from "./ai.service.js";
import type { PostFlowService } from "./post-flow.service.js";
import type { SupabaseProfileService, UserProfileInfo } from "./supabase-profile.service.js";
import type { IncomingMessageDTO } from "../dto/incoming-message.dto.js";

/**
 * Gerenciador de filas de processamento assíncrono por telefone.
 * Garante que mensagens enviadas rapidamente pelo mesmo usuário sejam processadas estritamente em ordem FIFO (sequencial).
 */
class MessageQueueManager {
  private queues: Map<string, Promise<void>> = new Map();

  async enqueue(phone: string, task: () => Promise<void>): Promise<void> {
    const currentPromise = this.queues.get(phone) || Promise.resolve();

    const nextPromise = currentPromise
      .then(() => task())
      .catch((err) => {
        console.error(`[MessageQueueManager] Erro no processamento sequencial para ${phone}:`, err);
      });

    this.queues.set(phone, nextPromise);

    nextPromise.finally(() => {
      if (this.queues.get(phone) === nextPromise) {
        this.queues.delete(phone);
      }
    });

    return nextPromise;
  }
}

export class MessageService {
  private readonly queueManager = new MessageQueueManager();
  private readonly processedMessageIds = new Set<string>();

  constructor(
    private readonly contactService: ContactService,
    private readonly conversationService: ConversationService,
    private readonly messageRepository: MessageRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly aiService: AIService,
    private readonly postFlowService?: PostFlowService,
    private readonly supabaseProfileService?: SupabaseProfileService
  ) {}

  /**
   * Ponto de entrada do processamento de mensagens.
   * Adiciona a mensagem em uma fila sequencial exclusiva por número de telefone.
   */
  async handleIncomingMessage(incomingDto: IncomingMessageDTO): Promise<void> {
    // 0. Deduplicação em memória para retentativas de webhooks da Meta/Chatwoot
    if (incomingDto.messageId && this.processedMessageIds.has(incomingDto.messageId)) {
      console.log(`[MessageService] Mensagem duplicada ${incomingDto.messageId} ignorada.`);
      return;
    }
    if (incomingDto.messageId) {
      this.processedMessageIds.add(incomingDto.messageId);
      setTimeout(() => this.processedMessageIds.delete(incomingDto.messageId), 120000);
    }

    // Encaminha para a fila sequencial por telefone
    return this.queueManager.enqueue(incomingDto.senderPhone, async () => {
      await this.processMessage(incomingDto);
    });
  }

  /**
   * Processa a mensagem individual de forma isolada e sequencial
   */
  private async processMessage(incomingDto: IncomingMessageDTO): Promise<void> {
    console.log(`[MessageService] Processando mensagem de ${incomingDto.senderPhone} | Conteúdo: "${incomingDto.body}"`);

    // 1. Validação de Autorização via Supabase Profiles
    let userProfile: UserProfileInfo | null = null;

    if (this.supabaseProfileService) {
      const authResult = await this.supabaseProfileService.getProfileByPhone(incomingDto.senderPhone);

      if (!authResult.isAuthorized || !authResult.profile) {
        console.warn(`[MessageService] Acesso NEGADO para ${incomingDto.senderPhone}. Número não cadastrado no Supabase.`);
        await this.whatsappService.sendText(
          incomingDto.senderPhone,
          `⚠️ *Acesso Não Autorizado*\n\nOlá! O número *${incomingDto.senderPhone}* não possui um cadastro ativo no nosso sistema.\n\nPor favor, cadastre-se na nossa plataforma para utilizar a IA do gerador de posts!`
        );
        return;
      }

      userProfile = authResult.profile;
      console.log(`[MessageService] Remetente ${incomingDto.senderPhone} AUTORIZADO no Supabase. Instagram: "${userProfile.instagramProfile}"`);
    }

    // 2. Localizar ou criar o contato no banco de dados
    const contact = await this.contactService.getOrCreateContact(
      incomingDto.senderPhone,
      incomingDto.senderName
    );

    // 3. Localizar ou criar uma conversa aberta
    const conversation = await this.conversationService.getOrCreateOpenConversation(
      contact.id
    );

    // 4. Salvar a mensagem recebida no banco de dados (ignorando erros se for duplicada)
    try {
      const savedIncoming = await this.messageRepository.create({
        conversationId: conversation.id,
        direction: "INCOMING",
        body: incomingDto.body,
        externalId: incomingDto.messageId ?? null,
        type: incomingDto.type,
        status: "received",
      });
      console.log(`[MessageService] Mensagem de entrada salva no banco. ID: ${savedIncoming.id}`);
    } catch (dbErr: any) {
      console.warn(`[MessageService] Aviso ao salvar mensagem de entrada no banco: ${dbErr.message || dbErr}`);
    }

    const cwCtx = (incomingDto.chatwootAccountId && incomingDto.chatwootConversationId)
      ? { accountId: incomingDto.chatwootAccountId, conversationId: incomingDto.chatwootConversationId }
      : undefined;

    // Ativa o indicador de "typing..." no início do processamento
    if (cwCtx) {
      await this.whatsappService.sendTypingIndicator(incomingDto.senderPhone, cwCtx);
    }

    try {
      // 5. Verificar se a mensagem pertence ou inicia o fluxo interativo de criação de posts
      if (this.postFlowService) {
        const handledByPostFlow = await this.postFlowService.handlePostFlow(
          contact.id,
          incomingDto,
          userProfile
        );

        if (handledByPostFlow) {
          console.log(`[MessageService] Mensagem processada pelo fluxo interativo de posts.`);
          return;
        }
      }

      // 6. Buscar histórico de conversação recente
      console.log(`[MessageService] Buscando histórico conversacional para a conversa ${conversation.id}`);
      const history = await this.conversationService.getHistory(conversation.id, 10);

      // 7. Gerar resposta pela IA
      let replyText = "";
      try {
        console.log(`[MessageService] Solicitando resposta inteligente ao AIService...`);
        replyText = await this.aiService.generateResponse(history);
        console.log(`[MessageService] Resposta da IA gerada com sucesso.`);
      } catch (error) {
        console.error(`[MessageService] Falha ao gerar resposta com a OpenAI. Aplicando fallback amigável.`, error);
        replyText = "Desculpe, estou temporariamente indisponível. Tente novamente em alguns minutos.";
      }

      // 8. Enviar a resposta gerada para o WhatsApp / Chatwoot
      let externalResponseId: string | undefined;
      try {
        const sendResult = await this.whatsappService.sendText(
          incomingDto.senderPhone,
          replyText,
          cwCtx
        );
        externalResponseId = sendResult?.messages?.[0]?.id;
        console.log(`[MessageService] Resposta despachada via WhatsApp. wamid: ${externalResponseId}`);
      } catch (error) {
        console.error(`[MessageService] Falha ao enviar resposta para o WhatsApp`, error);
      }

      // 9. Salvar a resposta enviada no banco de dados
      try {
        const savedOutgoing = await this.messageRepository.create({
          conversationId: conversation.id,
          direction: "OUTGOING",
          body: replyText,
          externalId: externalResponseId ?? null,
          type: "text",
          status: externalResponseId ? "sent" : "failed",
        });
        console.log(`[MessageService] Resposta de saída salva no banco. ID: ${savedOutgoing.id}`);
      } catch (dbErr: any) {
        console.warn(`[MessageService] Aviso ao salvar mensagem de saída no banco: ${dbErr.message || dbErr}`);
      }
    } finally {
      // Desativa o indicador de "typing..." ao final do envio
      if (cwCtx) {
        await this.whatsappService.stopTypingIndicator(incomingDto.senderPhone, cwCtx);
      }
    }
  }

  /**
   * Processa atualizações de status de entrega de mensagens enviadas
   */
  async handleStatusUpdate(externalId: string, status: string): Promise<void> {
    console.log(`[MessageService] Atualizando status da mensagem ${externalId} para "${status}"`);
    const updatedMessage = await this.messageRepository.updateStatus(externalId, status);

    if (updatedMessage) {
      console.log(`[MessageService] Status da mensagem ${updatedMessage.id} atualizado no banco.`);
    } else {
      console.log(`[MessageService] Nenhuma mensagem correspondente ao wamid ${externalId} encontrada para atualizar status.`);
    }
  }
}
