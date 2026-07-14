import { OpenAI } from "openai";
import { env } from "../../config/env.js";
import type { AIProvider, ChatMessage } from "../../types/ai.types.js";

/**
 * Responsável unicamente por inicializar, autenticar e expor o cliente da SDK da OpenAI.
 * Não possui regras de negócio.
 */
export class OpenAIClient {
  public readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: env.openaiApiKey,
    });
  }
}

/**
 * Provedor específico para OpenAI que implementa a interface desacoplada AIProvider.
 */
export class OpenAIProvider implements AIProvider {
  private readonly openaiClient: OpenAIClient;
  private readonly model: string;

  constructor() {
    this.openaiClient = new OpenAIClient();
    this.model = env.openaiModel;
  }

  /**
   * Envia o histórico de mensagens conversacionais formatado para a OpenAI.
   */
  async generateResponse(messages: ChatMessage[]): Promise<string> {
    try {
      console.log(`[OpenAIProvider] Enviando contexto para OpenAI (Modelo: ${this.model}, Mensagens: ${messages.length})`);
      
      const response = await this.openaiClient.client.chat.completions.create({
        model: this.model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: 0.7,
      });

      const responseText = response.choices?.[0]?.message?.content;

      if (!responseText) {
        throw new Error("A API da OpenAI retornou uma escolha vazia (no choices content).");
      }

      return responseText;
    } catch (error: any) {
      // Registra detalhes do erro no log sem expor a API Key
      console.error("[OpenAIProvider] Erro ao consumir API da OpenAI:", error.message || error);
      throw error;
    }
  }
}
