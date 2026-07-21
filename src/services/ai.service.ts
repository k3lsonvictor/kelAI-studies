import { SYSTEM_PROMPT } from "../prompts/system.prompt.js";
import type { AIProvider, ChatMessage } from "../types/ai.types.js";
import type { Message } from "@prisma/client";

/**
 * Fallback regex para extração de título e preço caso a IA falhe
 */
export function parseTitleAndPriceRegex(text: string): { title: string; price: string } {
  const clean = text.trim();
  if (!clean || clean === "[Imagem]") {
    return { title: "Produto Especial", price: "Consulte" };
  }

  const priceWithSuffixRegex = /(?:R\$\s*)?\b\d+(?:[,.]\d{2})?\b(?:\s*(?:\/\s*kg|\/\s*un|\/\s*pct|o\s+kg|o\s+kilo|o\s+quilo|a\s+unidade|unid|un|cada|o\s+pacote|a\s+dúzia|a\s+duzia|no\s+pix|à\s+vista|a\s+vista|no\s+cartão|no\s+cartao|no\s+dinheiro))?/i;
  let match = clean.match(priceWithSuffixRegex);

  if (!match) {
    const fallbackRegex = /(?:R\$\s*)?[\d.,]+(?:\s*(?:reais|real))?/i;
    match = clean.match(fallbackRegex);
  }

  if (match) {
    const matchedStr = match[0].trim();
    let title = clean.replace(match[0], "").replace(/[-|:;]/g, "").replace(/\s+/g, " ").trim();
    if (!title) title = "Produto Especial";

    const formattedPrice = matchedStr.toLowerCase().startsWith("r$")
      ? matchedStr.replace(/^r\$\s*/i, "R$ ")
      : `R$ ${matchedStr}`;

    return { title, price: formattedPrice };
  }

  return {
    title: clean,
    price: "Consulte",
  };
}

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
    return this.aiProvider.generateResponse(messagesPayload);
  }

  /**
   * Utiliza a IA da OpenAI para extrair com máxima precisão o título do produto e o preço
   * a partir da legenda enviada na foto pelo usuário.
   */
  async extractTitleAndPrice(rawText: string): Promise<{ title: string; price: string }> {
    const clean = rawText.trim();
    if (!clean || clean === "[Imagem]") {
      return { title: "Produto Especial", price: "Consulte" };
    }

    try {
      console.log(`[AIService] Extraindo título e preço via IA para o texto: "${clean}"`);

      const prompt = `
Você é um assistente especialista em e-commerce e redes sociais.
Analise a legenda enviada pelo cliente em um chat de WhatsApp e extraia com máxima precisão:
1. "title": O nome/título exato do produto (ex: "Pão Francês", "Bolo de Cenoura", "Camisa Oversized"). Capitalize de forma elegante.
2. "price": O valor monetário e eventual unidade/condição de medida (ex: "R$ 10,00 o kg", "R$ 6,50", "R$ 129,90 à vista", "R$ 5,00 a unidade"). Se nenhum preço foi mencionado no texto, retorne "Consulte".

Responda ESTRITAMENTE um objeto JSON válido no formato:
{"title": "...", "price": "..."}

Legenda do cliente:
"${clean}"
`;

      const responseText = await this.aiProvider.generateResponse([
        { role: "system", content: "Você é um extrator de dados em formato JSON estrito." },
        { role: "user", content: prompt },
      ]);

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.title) {
          console.log(`[AIService] Dados extraídos com SUCESSO pela IA -> Título: "${parsed.title}", Preço: "${parsed.price}"`);
          return {
            title: String(parsed.title).trim(),
            price: parsed.price ? String(parsed.price).trim() : "Consulte",
          };
        }
      }
    } catch (error) {
      console.warn(`[AIService] Falha na extração via IA. Aplicando fallback...`, error);
    }

    // Fallback via regex se a IA falhar
    return parseTitleAndPriceRegex(clean);
  }
}
