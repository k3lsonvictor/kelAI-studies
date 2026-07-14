import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { WebhookController } from "../controllers/webhook.controller.js";

export const webhookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const controller = new WebhookController();

  // GET /webhook - Validação inicial do webhook da API do WhatsApp Cloud
  fastify.get("/webhook", controller.verifyWebhook);

  // POST /webhook - Recebimento de mensagens, atualizações de status e eventos da API do WhatsApp Cloud
  fastify.post("/webhook", controller.receiveMessage);
};
