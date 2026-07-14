import { SYSTEM_PROMPT } from "../prompts/system.prompt.js";
import type { AIProvider, ChatMessage } from "../types/ai.types.js";
import type { Message } from "@prisma/client";

export class AIService {
  constructor(private readonly aiProvider: AIProvider) {}

  /**
   * Recebe o histórico de mensagens bruto do banco de dados,
   * converte para o formato genérico ChatMessage, injeta o system prompt,
   * e chama o provedor de IA para gerar uma resposta.
   */
  async generateResponse(history: Message[]): Promise<string> {
    console.log(`[AIService] Montando contexto conversacional a partir de ${history.length} mensagens históricas`);

    // 1. Mapeia mensagens do Prisma (direções INCOMING/OUTGOING) para papéis de Chat (user/assistant)
    const chatMessages: ChatMessage[] = history.map((msg) => ({
      role: msg.direction === "INCOMING" ? "user" : "assistant",
      content: msg.body,
    }));

    // 2. Insere a instrução comportamental (System Prompt) no topo do histórico
    const messagesPayload: ChatMessage[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...chatMessages,
    ];

    console.log("[AIService] Enviando contexto completo ao provedor de IA...");
    
    // 3. Executa a chamada no provedor injetado de forma desacoplada
    return this.aiProvider.generateResponse(messagesPayload);
  }
}
