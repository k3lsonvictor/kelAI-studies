export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIProvider {
  /**
   * Envia o histórico de mensagens formatado e o prompt de sistema para o modelo
   * e retorna a resposta textual gerada.
   * @param messages Lista de mensagens em formato de chat conversacional
   * @returns Resposta em texto limpo gerada pelo LLM
   */
  generateResponse(messages: ChatMessage[]): Promise<string>;
}
