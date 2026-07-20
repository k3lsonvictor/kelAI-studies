import type { ContactService } from "./contact.service.js";
import type { ConversationService } from "./conversation.service.js";
import type { MessageRepository } from "../repositories/message.repository.js";
import type { WhatsAppService } from "./whatsapp.service.js";
import type { AIService } from "./ai.service.js";
import type { PostFlowService } from "./post-flow.service.js";
import type { IncomingMessageDTO } from "../dto/incoming-message.dto.js";

export class MessageService {
  constructor(
    private readonly contactService: ContactService,
    private readonly conversationService: ConversationService,
    private readonly messageRepository: MessageRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly aiService: AIService,
    private readonly postFlowService?: PostFlowService
  ) {}

  /**
   * Orquestra o fluxo de processamento e resposta inteligente das mensagens:
   * 1. Localiza ou cria o contato
   * 2. Localiza ou cria uma conversa ativa
   * 3. Salva a mensagem de entrada recebida
   * 4. Verifica se faz parte do fluxo de geração de post em etapas
   * 5. Busca o histórico de mensagens recente da conversa (se não for fluxo de post)
   * 6. Envia o contexto conversacional para a OpenAI gerar a resposta
   * 7. Trata falhas de API de IA entregando mensagem amigável de fallback
   * 8. Envia a resposta via WhatsApp Cloud API
   * 9. Salva a resposta enviada no banco de dados
   */
  async handleIncomingMessage(incomingDto: IncomingMessageDTO): Promise<void> {
    console.log(`[MessageService] Mensagem recebida de ${incomingDto.senderPhone} | Conteúdo: "${incomingDto.body}"`);

    // 1. Localizar ou criar o contato no banco de dados
    const contact = await this.contactService.getOrCreateContact(
      incomingDto.senderPhone,
      incomingDto.senderName
    );

    // 2. Localizar ou criar uma conversa aberta
    const conversation = await this.conversationService.getOrCreateOpenConversation(
      contact.id
    );

    // 3. Salvar a mensagem recebida no banco de dados
    const savedIncoming = await this.messageRepository.create({
      conversationId: conversation.id,
      direction: "INCOMING",
      body: incomingDto.body,
      externalId: incomingDto.messageId ?? null,
      type: incomingDto.type,
      status: "received",
    });
    console.log(`[MessageService] Mensagem de entrada salva no banco. ID: ${savedIncoming.id}`);

    // 4. Verificar se a mensagem pertence ou inicia o fluxo interativo de criação de posts
    if (this.postFlowService) {
      const handledByPostFlow = await this.postFlowService.handlePostFlow(
        contact.id,
        incomingDto
      );

      if (handledByPostFlow) {
        console.log(`[MessageService] Mensagem processada pelo fluxo interativo de posts.`);
        return;
      }
    }

    // 5. Buscar histórico de conversação recente (últimas 10 mensagens para contexto de conversa)
    console.log(`[MessageService] Buscando histórico conversacional para a conversa ${conversation.id}`);
    const history = await this.conversationService.getHistory(conversation.id, 10);

    // 5. Gerar resposta pela IA
    let replyText = "";
    try {
      console.log(`[MessageService] Solicitando resposta inteligente ao AIService...`);
      replyText = await this.aiService.generateResponse(history);
      console.log(`[MessageService] Resposta da IA gerada com sucesso.`);
    } catch (error) {
      console.error(`[MessageService] Falha ao gerar resposta com a OpenAI. Aplicando fallback amigável.`, error);
      
      // Resposta amigável em caso de indisponibilidade ou erro na API da OpenAI
      replyText = "Desculpe, estou temporariamente indisponível. Tente novamente em alguns minutos.";
    }

    // 6. Enviar a resposta gerada para o WhatsApp do usuário
    let externalResponseId: string | undefined;
    try {
      const sendResult = await this.whatsappService.sendText(
        incomingDto.senderPhone,
        replyText
      );
      externalResponseId = sendResult.messages?.[0]?.id;
      console.log(`[MessageService] Resposta despachada via WhatsApp. wamid: ${externalResponseId}`);
    } catch (error) {
      console.error(`[MessageService] Falha ao enviar resposta para o WhatsApp`, error);
    }

    // 7. Salvar a resposta enviada no banco de dados
    const savedOutgoing = await this.messageRepository.create({
      conversationId: conversation.id,
      direction: "OUTGOING",
      body: replyText,
      externalId: externalResponseId ?? null,
      type: "text",
      status: externalResponseId ? "sent" : "failed",
    });
    console.log(`[MessageService] Resposta de saída salva no banco. ID: ${savedOutgoing.id}`);
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
