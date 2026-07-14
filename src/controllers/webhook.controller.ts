import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { ContactRepository } from "../repositories/contact.repository.js";
import { ConversationRepository } from "../repositories/conversation.repository.js";
import { MessageRepository } from "../repositories/message.repository.js";
import { ContactService } from "../services/contact.service.js";
import { ConversationService } from "../services/conversation.service.js";
import { WhatsAppService } from "../services/whatsapp.service.js";
import { AIService } from "../services/ai.service.js";
import { MessageService } from "../services/message.service.js";
import { OpenAIProvider } from "../integrations/openai/openai.client.js";
import { parseIncomingMessage } from "../dto/incoming-message.dto.js";
import type { WhatsAppWebhookPayload } from "../types/whatsapp.types.js";

export class WebhookController {
  private readonly messageService: MessageService;

  constructor() {
    // 1. Inicialização dos Repositories
    const contactRepository = new ContactRepository();
    const conversationRepository = new ConversationRepository();
    const messageRepository = new MessageRepository();

    // 2. Inicialização dos Services de domínio
    const contactService = new ContactService(contactRepository);
    const conversationService = new ConversationService(conversationRepository, messageRepository);
    const whatsappService = new WhatsAppService();

    // 3. Inicialização da Integração de IA de forma desacoplada (implementa AIProvider)
    const openAIProvider = new OpenAIProvider();
    const aiService = new AIService(openAIProvider);

    // 4. Injeção no orquestrador MessageService
    this.messageService = new MessageService(
      contactService,
      conversationService,
      messageRepository,
      whatsappService,
      aiService
    );
  }

  /**
   * GET /webhook
   * Realiza a validação do webhook exigida pela Meta (handshake inicial)
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
      return reply
        .status(200)
        .type("text/plain")
        .send(challenge);
    }

    request.log.warn("Falha na validação do webhook: Token ou Mode inválido");
    return reply.status(403).send("Token de validação inválido");
  };

  /**
   * POST /webhook
   * Recebe e processa as mensagens e eventos enviados pela Meta
   */
  receiveMessage = async (
    request: FastifyRequest<{ Body: WhatsAppWebhookPayload }>,
    reply: FastifyReply
  ) => {
    const body = request.body;

    request.log.debug({ body }, "Evento recebido no webhook");

    if (body.object !== "whatsapp_business_account" || !body.entry) {
      return reply.status(400).send("Payload inválido para webhook WhatsApp");
    }

    try {
      const changeValue = body.entry?.[0]?.changes?.[0]?.value;
      const incomingPhoneNumberId = changeValue?.metadata?.phone_number_id;

      // 1. Processar novas mensagens de entrada usando os DTOs
      if (changeValue?.messages && changeValue.messages.length > 0) {
        const incomingMessages = parseIncomingMessage(body);
        
        for (const incomingMsg of incomingMessages) {
          // Validar se o phone_number_id da mensagem corresponde ao configurado
          if (incomingMsg.phoneNumberId !== env.phoneNumberId) {
            request.log.info(
              `Mensagem ignorada: phone_number_id recebido (${incomingMsg.phoneNumberId}) não corresponde ao configurado (${env.phoneNumberId})`
            );
            continue;
          }
          await this.messageService.handleIncomingMessage(incomingMsg);
        }
      }

      // 2. Processar atualizações de status de entrega de mensagens enviadas
      if (changeValue?.statuses && changeValue.statuses.length > 0) {
        if (incomingPhoneNumberId && incomingPhoneNumberId !== env.phoneNumberId) {
          request.log.info(
            `Atualização de status ignorada: phone_number_id recebido (${incomingPhoneNumberId}) não corresponde ao configurado (${env.phoneNumberId})`
          );
        } else {
          for (const statusUpdate of changeValue.statuses) {
            await this.messageService.handleStatusUpdate(statusUpdate.id, statusUpdate.status);
          }
        }
      }

      return reply.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      request.log.error(error, "Erro no fluxo principal do webhook controller");
      
      // Retorna 200 para evitar retentativas infinitas da API da Meta que travam o processamento
      return reply.status(200).send("EVENT_RECEIVED_WITH_ERRORS");
    }
  };
}
