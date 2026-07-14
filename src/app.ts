import Fastify from "fastify";
import { webhookRoutes } from "./routes/webhook.routes.js";
import { WhatsAppService } from "./services/whatsapp.service.js";
import { AppError } from "./errors/app-error.js";

export const app = Fastify({
  logger: true,
});

// Registra o Handler de Erro Global do Fastify
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    // Erros previstos da aplicação (regra de negócio, validação, etc)
    request.log.warn({ err: error }, `Erro de aplicação previsto: ${error.message}`);
    return reply.status(error.statusCode).send({
      error: error.name,
      message: error.message,
    });
  }

  // Erros inesperados ou internos do servidor (ex: quebra de conexão, NullPointer, etc)
  request.log.error(error, "Erro inesperado do servidor");
  return reply.status(500).send({
    error: "InternalServerError",
    message: "Ocorreu um erro interno inesperado no servidor.",
  });
});

// Inicializa o serviço do WhatsApp para uso em rotas de teste locais
const whatsappService = new WhatsAppService();

// Rota raiz para verificação rápida do status da API
app.get("/", async () => {
  return {
    status: "online",
    message: "Servidor do atendimento WhatsApp funcionando perfeitamente! 🚀",
  };
});

// Registra as rotas modulares de webhook da API do WhatsApp Cloud
app.register(webhookRoutes);

/**
 * Rota de teste POST /send
 * Permite disparar mensagens manualmente usando a arquitetura modular
 */
app.post("/send", async (request, reply) => {
  const body = request.body as { to?: string; message?: string };

  const to = body.to || "5586981296314";
  const text = body.message || "Olá! Esta mensagem foi enviada pelo backend modular 🚀";

  try {
    const result = await whatsappService.sendText(to, text);
    return reply.status(200).send(result);
  } catch (error: any) {
    const errorResponse = error.response?.data || error.message || error;
    return reply.status(500).send({
      error: "Falha ao enviar mensagem de teste",
      details: errorResponse,
    });
  }
});