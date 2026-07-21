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
      postGeneratorService,
      aiService
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
   * Processa requisições do Chatwoot e Meta respondendo HTTP 200 OK IMEDIATAMENTE (<10ms)
   */
  receiveMessage = async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    const body = request.body as any;

    request.log.info({ event: body.event, message_type: body.message_type }, "Requisição recebida no /webhook");

    try {
      // -------------------------------------------------------------
      // FLUXO 1: WEBHOOK DO CHATWOOT (message_created)
      // -------------------------------------------------------------
      const isChatwootPayload = Boolean(
        body.event || body.conversation || body.account || body.message_type !== undefined || body.message
      );

      if (isChatwootPayload) {
        const eventName = body.event || "message_created";
        const isMessageCreated = eventName === "message_created" || !body.event;

        const rawMsgType = body.message_type ?? body.message?.message_type ?? body.conversation?.messages?.[0]?.message_type;
        const isOutgoing = rawMsgType === "outgoing" || rawMsgType === 1 || rawMsgType === "1";
        const isPrivate = Boolean(body.private || body.message?.private);

        // Um evento do Chatwoot só cria processamento de IA se for a CRIAÇÃO de uma mensagem recebida do cliente
        const isIncoming = isMessageCreated && !isOutgoing && !isPrivate;

        if (isIncoming) {
          const userMessage = (
            body.content ||
            body.message?.content ||
            body.conversation?.messages?.[0]?.content ||
            ""
          ).trim();

          const attachments =
            body.attachments ||
            body.message?.attachments ||
            body.conversation?.messages?.[0]?.attachments ||
            body.messages?.[0]?.attachments ||
            [];

          let msgType: "text" | "image" | "document" | "audio" | "video" | "other" = "text";
          let mediaUrl: string | undefined = undefined;
          let caption: string | undefined = undefined;

          if (attachments && attachments.length > 0) {
            const attachment = attachments[0];
            const isImgType = attachment.file_type === "image" || attachment.file_type === "image/png" || attachment.file_type === "image/jpeg" || attachment.file_type === "file";
            const isImgUrl = Boolean(attachment.data_url?.match(/\.(jpg|jpeg|png|webp)/i)) || Boolean(attachment.thumb_url);

            if (isImgType || isImgUrl) {
              msgType = "image";
              mediaUrl = attachment.data_url || attachment.thumb_url;
              caption = userMessage && userMessage !== "[Imagem]" ? userMessage : "";
            }
          }

          const conversationId = body.conversation?.id || body.message?.conversation_id;
          const accountId = body.account?.id || body.message?.account_id;
          const rawPhone =
            body.conversation?.meta?.sender?.phone_number ||
            body.conversation?.contact_inbox?.source_id ||
            body.conversation?.contact?.phone_number ||
            body.contact_inbox?.source_id ||
            body.meta?.sender?.phone_number ||
            body.sender?.phone_number ||
            body.source_id ||
            body.message?.sender?.phone_number ||
            "";

          const senderPhone = String(rawPhone).replace(/[^\d]/g, "");

          if (!senderPhone || senderPhone.length < 8) {
            request.log.warn({ event: body.event }, "[WebhookController] Ignorando evento do Chatwoot sem número de telefone válido");
            return reply.status(200).send({ status: "EVENT_RECEIVED_NO_PHONE" });
          }

          // Identificador ÚNICO da mensagem real (evita usar apenas o ID da conversa)
          const msgId = body.id || body.message?.id || body.conversation?.messages?.[0]?.id;
          let realMsgId = String(msgId || Date.now());

          // Se o ID retornado for igual ao ID da conversa, adiciona timestamp para garantir unicidade por mensagem
          if (conversationId && (realMsgId === String(conversationId) || !msgId)) {
            realMsgId = `${conversationId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          }

          const uniqueMessageId = `cw_msg_${realMsgId}`;

          request.log.info(
            { conversationId, senderPhone, userMessage, uniqueMessageId, event: body.event },
            "Mensagem de cliente no Chatwoot identificada para processamento"
          );

          // Cria objeto DTO normalizado
          const normalizedMsg = {
            senderPhone,
            senderName: body.conversation?.meta?.sender?.name || body.sender?.name || "Cliente",
            messageId: uniqueMessageId,
            timestamp: new Date(),
            type: msgType,
            body: userMessage || (msgType === "image" ? "[Imagem]" : ""),
            phoneNumberId: env.phoneNumberId,
            chatwootAccountId: accountId,
            chatwootConversationId: conversationId,
            mediaUrl,
            caption,
          };

          // Dispara o processamento em background (MessageService tratará deduplicação via uniqueMessageId)
          this.messageService.handleIncomingMessage(normalizedMsg as any).catch((err) => {
            request.log.error({ err, senderPhone }, "Erro no processamento assíncrono do Chatwoot");
          });
        }

        // Retorna HTTP 200 OK em <10ms
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
            this.messageService.handleIncomingMessage(incomingMsg).catch((err) => {
              request.log.error({ err }, "Erro no processamento assíncrono do WhatsApp Direct");
            });
          }
        }

        return reply.status(200).send("EVENT_RECEIVED");
      }

      return reply.status(400).send("Formato de payload não reconhecido");

    } catch (error) {
      request.log.error(error, "Erro no processamento do webhook");
      return reply.status(200).send({ status: "EVENT_RECEIVED_WITH_ERRORS" });
    }
  };
}

/**
 * Função utilitária exportada para enviar mensagens de resposta de texto de volta ao Chatwoot
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
      if (res.status === 401) {
        console.error(`[Chatwoot] 💡 DICA: O CHATWOOT_ACCESS_TOKEN no arquivo .env precisa ser o seu Access Token de Usuário/Agente do Chatwoot (em Configurações do Perfil -> Access Token).`);
      }
    } else {
      console.log(`[Chatwoot] Mensagem despachada com SUCESSO para conversa ${conversationId} no Chatwoot.`);
    }
  } catch (err: any) {
    console.error(`[Chatwoot] Exceção ao conectar no Chatwoot:`, err.message || err);
  }
}

/**
 * Função utilitária exportada para enviar anexos de imagem de volta ao Chatwoot via multipart/form-data
 */
export async function sendChatwootImageMessage(
  accountId: number | string,
  conversationId: number | string,
  base64ImageUrl: string,
  caption?: string
) {
  const chatwootUrl = env.chatwootUrl;
  const chatwootToken = env.chatwootToken;

  if (!chatwootUrl || !chatwootToken) {
    console.warn("[Chatwoot] CHATWOOT_URL ou CHATWOOT_ACCESS_TOKEN não configurado.");
    return;
  }

  try {
    // Se não for Base64 Data URL (ex: link HTTP), envia como texto normal com o link
    if (!base64ImageUrl.startsWith("data:image/")) {
      const text = caption ? `${caption}\n\n${base64ImageUrl}` : base64ImageUrl;
      return sendChatwootMessage(accountId, conversationId, text);
    }

    const match = base64ImageUrl.match(/^data:image\/([a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (!match) {
      return sendChatwootMessage(accountId, conversationId, caption || "Imagem gerada");
    }

    const ext = match[1];
    const base64Data = match[2] || "";
    const mimeType = `image/${ext}`;
    const buffer = Buffer.from(base64Data, "base64");

    const formData = new FormData();
    formData.append("content", caption || "");
    formData.append("message_type", "outgoing");
    formData.append("private", "false");

    const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const blob = new Blob([uint8Array], { type: mimeType });
    formData.append("attachments[]", blob, `arte_gerada.${ext}`);

    const res = await fetch(`${chatwootUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        "api_access_token": chatwootToken,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Chatwoot] Erro ao enviar imagem anexa para Chatwoot (${res.status}): ${errText}`);
    } else {
      console.log(`[Chatwoot] Imagem anexada e despachada com SUCESSO para conversa ${conversationId} no Chatwoot.`);
    }
  } catch (err: any) {
    console.error(`[Chatwoot] Exceção ao enviar imagem para o Chatwoot:`, err.message || err);
  }
}
