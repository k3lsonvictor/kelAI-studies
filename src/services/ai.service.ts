import { SYSTEM_PROMPT } from "../prompts/system.prompt.js";
import type { AIProvider, ChatMessage } from "../types/ai.types.js";
import type { Message } from "@prisma/client";

/**
 * Fallback regex para extração de título e preço caso a IA falhe
 */
export function parseTitleAndPriceRegex(text: string): { title: string; price: string; extraContext?: string } {
  const clean = text.trim();
  if (!clean || clean === "[Imagem]") {
    return { title: "Produto Especial", price: "Consulte" };
  }

  // Regex para encontrar preços e suas condições/unidades
  const priceRegex = /(?:R\$\s*)?\b\d+(?:[,.]\d{2})?\b(?:\s*(?:\/\s*kg|\/\s*un|\/\s*pct|o\s+kg|o\s+kilo|o\s+quilo|a\s+unidade|unid|un|cada|o\s+pacote|a\s+dúzia|a\s+duzia|no\s+pix|à\s+vista|a\s+vista|no\s+cartão|no\s+cartao|no\s+dinheiro))?/gi;

  const matches = Array.from(clean.matchAll(priceRegex));

  if (matches.length > 0) {
    const formattedPrices: string[] = [];
    let title = clean;

    for (const match of matches) {
      const matchedStr = match[0].trim();
      title = title.replace(match[0], "");

      const formatted = matchedStr.toLowerCase().startsWith("r$")
        ? matchedStr.replace(/^r\$\s*/i, "R$ ")
        : `R$ ${matchedStr}`;

      if (!formattedPrices.includes(formatted)) {
        formattedPrices.push(formatted);
      }
    }

    // Limpa conectivos e caracteres residuais no título (ex: "por", "e", "-", ":")
    title = title
      .replace(/\b(?:por|no\s+valor\s+de|e|com|a)\b/gi, "")
      .replace(/[-|:;,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!title) {
      title = "Produto Especial";
    } else {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    const price = formattedPrices.join(" | ");
    return { title, price };
  }

  const extraContext = clean.length > 15 ? clean : undefined;
  return {
    title: clean.charAt(0).toUpperCase() + clean.slice(1),
    price: "Consulte",
    ...(extraContext ? { extraContext } : {}),
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
   * Utiliza a IA da OpenAI para extrair com máxima precisão o título do produto, o preço
   * e o contexto comercial fornecido na legenda da foto enviada pelo usuário.
   */
  async extractTitleAndPrice(rawText: string): Promise<{ title: string; price: string; extraContext?: string }> {
    const clean = rawText.trim();
    if (!clean || clean === "[Imagem]") {
      return { title: "Produto Especial", price: "Consulte" };
    }

    try {
      console.log(`[AIService] Extraindo título, preço e contexto via IA para o texto: "${clean}"`);

      const prompt = `
Você é um assistente especialista em e-commerce, padarias, supermercados e redes sociais.
Analise a legenda enviada pelo cliente em um chat de WhatsApp e extraia com máxima precisão:
1. "title": O nome/título exato do produto (ex: "Pão Francês", "Bolo de Cenoura", "Pudim", "Camisa Oversized"). Remova palavras conectivas residuais como "por", "no valor de", "e". Capitalize as palavras de forma elegante.
2. "price": O valor ou TODOS os valores monetários informados com suas respectivas unidades/condições (ex: se o cliente digitou "pão frances por 18,00 o kg e 0,80 a unidade", retorne "R$ 18,00 o kg | R$ 0,80 a unidade").
   - Se houver múltiplos preços (ex: por kg e por unidade, atacado e varejo, ou no pix e no cartão), inclua TODOS na mesma string de preço separados por " | ".
   - Certifique-se de incluir o símbolo "R$" em cada valor numérico se não estiver presente.
   - Se nenhum preço foi mencionado no texto, retorne "Consulte".
3. "extraContext": Qualquer contexto comercial ou informação adicional relevante contida na legenda que ajude a compor a descrição/copy comercial do post (ex: nome do estabelecimento ou padaria como "Panificadora Pão Nosso", instrução de encomendas como "Venha encomendar o seu pudim", detalhes de sabor, promoção ou avisos). Se a legenda contiver apenas o nome do produto e preço, retorne null.

Responda ESTRITAMENTE um objeto JSON válido no formato:
{"title": "...", "price": "...", "extraContext": "..."}

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
          const rawCtx = parsed.extraContext ? String(parsed.extraContext).trim() : "";
          const titleStr = String(parsed.title).trim();
          const titleLower = titleStr.toLowerCase();
          const rawCtxLower = rawCtx.toLowerCase();

          let extraContext: string | undefined = undefined;
          if (
            rawCtx &&
            rawCtxLower !== "null" &&
            rawCtxLower !== "undefined" &&
            rawCtxLower !== titleLower &&
            !rawCtxLower.startsWith(titleLower) &&
            rawCtx.length > 3
          ) {
            extraContext = rawCtx;
          }

          console.log(`[AIService] Dados extraídos com SUCESSO pela IA -> Título: "${titleStr}", Preço: "${parsed.price}", Contexto: "${extraContext || "Nenhum"}"`);

          return {
            title: titleStr,
            price: parsed.price ? String(parsed.price).trim() : "Consulte",
            ...(extraContext ? { extraContext } : {}),
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
