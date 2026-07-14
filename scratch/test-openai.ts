import "dotenv/config";
import { OpenAIProvider } from "../src/integrations/openai/openai.client.js";
import { AIService } from "../src/services/ai.service.js";
import type { Message } from "@prisma/client";
import { MessageDirection } from "@prisma/client";

async function testOpenAIIntegration() {
  console.log("=== INICIANDO TESTE DE INTEGRAÇÃO COM OPENAI ===");
  console.log(`Modelo configurado: ${process.env.OPENAI_MODEL}`);
  console.log(`API Key presente: ${process.env.OPENAI_API_KEY ? "Sim" : "Não"}`);

  if (process.env.OPENAI_API_KEY === "sk-placeholder-openai-api-key-will-be-replaced-by-user") {
    console.warn("\n⚠️ AVISO: A chave da OpenAI configurada é fictícia. O teste de API provavelmente falhará.");
  }

  // 1. Instanciar o Provider e o AIService
  const provider = new OpenAIProvider();
  const aiService = new AIService(provider);

  // 2. Simular um histórico de mensagens retornado do banco de dados (Prisma)
  const mockHistory: Message[] = [
    {
      id: "msg-1",
      conversationId: "conv-123",
      direction: MessageDirection.INCOMING,
      type: "text",
      body: "Olá, bom dia! Gostaria de saber qual o preço para desenvolver um site.",
      status: "received",
      externalId: "wamid.1",
      createdAt: new Date(Date.now() - 3600000 * 2), // 2 horas atrás
    },
    {
      id: "msg-2",
      conversationId: "conv-123",
      direction: MessageDirection.OUTGOING,
      type: "text",
      body: "Olá! Bom dia. O preço para criar um site depende dos recursos necessários (e-commerce, portfólio, integrações). Você já tem um escopo do projeto?",
      status: "sent",
      externalId: "wamid.2",
      createdAt: new Date(Date.now() - 3600000), // 1 hora atrás
    },
    {
      id: "msg-3",
      conversationId: "conv-123",
      direction: MessageDirection.INCOMING,
      type: "text",
      body: "Sim, preciso apenas de um site institucional de 3 páginas para minha clínica médica.",
      status: "received",
      externalId: "wamid.3",
      createdAt: new Date(), // agora
    },
  ];

  console.log("\n=== HISTÓRICO SIMULADO DO BANCO DE DADOS (PRISMA) ===");
  mockHistory.forEach((msg) => {
    console.log(`[${msg.direction}] ${msg.body}`);
  });

  try {
    console.log("\n=== PROCESSANDO E FORMATANDO HISTÓRICO COM O AIService ===");
    // O AIService converte o histórico, insere o System Prompt e chama o provedor
    const response = await aiService.generateResponse(mockHistory);
    
    console.log("\n=== RESPOSTA RECEBIDA DA OPENAI ===");
    console.log(response);
    console.log("\n✅ Teste de integração finalizado com sucesso!");
  } catch (error: any) {
    console.error("\n❌ Falha ao rodar o teste de integração:", error.message || error);
  }
}

testOpenAIIntegration();
