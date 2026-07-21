import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { ConversationRepository } from "../repositories/conversation.repository.js";
import { MessageRepository } from "../repositories/message.repository.js";
import { PostSessionRepository } from "../repositories/post-session.repository.js";
import { ContactService } from "../services/contact.service.js";
import { ConversationService } from "../services/conversation.service.js";
import { WhatsAppService } from "../services/whatsapp.service.js";
import { AIService } from "../services/ai.service.js";
import { MessageService } from "../services/message.service.js";
import { PostGeneratorService } from "../services/post-generator.service.js";
import { PostFlowService } from "../services/post-flow.service.js";
import { SupabaseProfileService } from "../services/supabase-profile.service.js";
import { OpenAIProvider } from "../integrations/openai/openai.client.js";
import { parseIncomingMessage } from "../dto/incoming-message.dto.js";

export class WebhookController {
  private readonly messageService: MessageService;

  constructor() {
    // 1. Inicialização dos Repositories
    const contactRepository = new ContactRepository();
    const conversationRepository = new ConversationRepository();
    const messageRepository = new MessageRepository();
    const postSessionRepository = new PostSessionRepository();

    // 2. Inicialização dos Services de domínio e Supabase
    const contactService = new ContactService(contactRepository);
    const conversationService = new ConversationService(conversationRepository, messageRepository);
    const whatsappService = new WhatsAppService();
    const supabaseProfileService = new SupabaseProfileService();

    // 3. Inicialização da Integração de IA e Gerador de Posts
    const openAIProvider = new OpenAIProvider();
    const aiService = new AIService(openAIProvider);

    const postGeneratorService = new PostGeneratorService();
    const postFlowService = new PostFlowService(
      postSessionRepository,
      whatsappService,
      postGeneratorService
    );

    // 4. Injeção no orquestrador MessageService
    this.messageService = new MessageService(
      contactService,
      conversationService,
      messageRepository,
      whatsappService,
      aiService,
      postFlowService,
      supabaseProfileService
    );
  }

  /**
   * GET /webhook
   * Handshake oficial Meta / Validação simples de status
   */
  verifyWebhook = async (
    request: FastifyRequest<{ Querystring: Record<string, string> }>,
    reply: FastifyReply
  ) => {
    const query = request.query;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    request.log.info({ mode, tokenReceived: token }, "Recebida tentativa de handshake do webhook");

    if (mode === "subscribe" && token === env.verifyToken) {
      request.log.info("Webhook validado com sucesso!");
      return reply.status(200).type("text/plain").send(challenge);
    }

    return reply.status(403).send("Token de validação inválido");
  };

  /**
   * POST /webhook
   * Processa tanto requisições diretas da Meta quanto os Webhooks do Chatwoot
   */
  receiveMessage = async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const body = request.body as any;

    request.log.debug({ body }, "Evento recebido no webhook");

    try {
      // -------------------------------------------------------------
      // FLUXO 1: WEBHOOK DO CHATWOOT
      // -------------------------------------------------------------
      if (body.event === "message_created" || body.event === "conversation_updated") {
        // Processa apenas mensagens vindas do cliente (incoming) e não privadas
        if (body.message_type === "incoming" && !body.private) {
          const userMessage = body.content || "";
          const conversationId = body.conversation?.id;
          const accountId = body.account?.id;
          const senderPhone = body.sender?.phone_number || body.conversation?.meta?.sender?.phone_number || "";

          request.log.info(
            { conversationId, senderPhone, userMessage },
            "Mensagem do Chatwoot identificada para processamento"
          );

          let msgType: "text" | "image" | "document" | "audio" | "video" | "other" = "text";
          let mediaUrl: string | undefined = undefined;
          let caption: string | undefined = undefined;

          if (body.attachments && body.attachments.length > 0) {
            const attachment = body.attachments[0];
            if (attachment.file_type === "image" || attachment.data_url?.match(/\.(jpg|jpeg|png|webp)/i)) {
              msgType = "image";
              mediaUrl = attachment.data_url;
              caption = userMessage;
            }
          }

          // Cria um objeto DTO normalizado para o MessageService
          const normalizedMsg = {
            senderPhone: senderPhone.replace(/^\+/, ""),
            senderName: body.sender?.name || "Cliente",
            messageId: body.id ? String(body.id) : `cw_${Date.now()}`,
            timestamp: new Date(),
            type: msgType,
            body: userMessage || (msgType === "image" ? "[Imagem]" : ""),
            phoneNumberId: env.phoneNumberId,
            chatwootAccountId: accountId,
            chatwootConversationId: conversationId,
            mediaUrl,
            caption,
          };

          // Encaminha para o serviço que irá consultar o Supabase e a OpenAI
          await this.messageService.handleIncomingMessage(normalizedMsg as any);
        }

        return reply.status(200).send({ status: "EVENT_RECEIVED" });
      }

      // -------------------------------------------------------------
      // FLUXO 2: WEBHOOK DIRETO DA META (Legado / Backup)
      // -------------------------------------------------------------
      if (body.object === "whatsapp_business_account" && body.entry) {
        const changeValue = body.entry?.[0]?.changes?.[0]?.value;

        if (changeValue?.messages && changeValue.messages.length > 0) {
          const incomingMessages = parseIncomingMessage(body);

          for (const incomingMsg of incomingMessages) {
            if (incomingMsg.phoneNumberId !== env.phoneNumberId) {
              continue;
            }
            await this.messageService.handleIncomingMessage(incomingMsg);
          }
        }

        return reply.status(200).send("EVENT_RECEIVED");
      }

      // Se não for nem Chatwoot nem Meta oficial
      return reply.status(400).send("Formato de payload não reconhecido");

    } catch (error) {
      request.log.error(error, "Erro no processamento do webhook");
      return reply.status(200).send({ status: "EVENT_RECEIVED_WITH_ERRORS" });
    }
  };
}

/**
 * Função utilitária exportada para enviar mensagens de resposta de volta ao Chatwoot
 */
export async function sendChatwootMessage(
  accountId: number | string,
  conversationId: number | string,
  text: string
) {
  const chatwootUrl = env.chatwootUrl;
  const chatwootToken = env.chatwootToken;

  if (!chatwootUrl || !chatwootToken) {
    console.warn("[Chatwoot] CHATWOOT_URL ou CHATWOOT_ACCESS_TOKEN não configurado.");
    return;
  }

  try {
    const res = await fetch(`${chatwootUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": chatwootToken,
      },
      body: JSON.stringify({
        content: text,
        message_type: "outgoing",
        private: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Chatwoot] Erro ao enviar mensagem para Chatwoot (${res.status}): ${errText}`);
    } else {
      console.log(`[Chatwoot] Mensagem despachada com SUCESSO para conversa ${conversationId} no Chatwoot.`);
    }
  } catch (err: any) {
    console.error(`[Chatwoot] Exceção ao conectar no Chatwoot:`, err.message || err);
  }
}
