import axios from "axios";
import { toFile } from "openai";
import { OpenAIClient } from "../integrations/openai/openai.client.js";
import { getCategoryOrDefault, getTemplateOrDefault } from "../config/templates.config.js";
import { env } from "../config/env.js";

const DEFAULT_CANVAS_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SYSTEM_PROMPT_TEMPLATE = `
Você é um diretor de arte especializado em branding, publicidade e design para redes sociais.

Sua função é criar posts comerciais para Instagram que pareçam desenvolvidos manualmente por um designer gráfico experiente.

--------------------------------------------------
ESTILO VISUAL
--------------------------------------------------

{{template_prompt}}

--------------------------------------------------
DADOS DO PRODUTO
--------------------------------------------------

Nome:
{{product_name}}

Descrição:
{{description}}

Preço:
{{price}}

CTA:
{{cta}}

--------------------------------------------------
IDENTIDADE DA MARCA E CONTATO
--------------------------------------------------

Cor Principal:
{{primary_color}}

Cor Secundária:
{{secondary_color}}

Logotipo da Marca:
{{logo_url}}

WhatsApp / Telefone de Contato:
{{contact_number}}

Perfil do Instagram:
{{instagram_profile}}

--------------------------------------------------
PRODUTO
--------------------------------------------------

{{product_description}}

{{human_model_prompt}}

--------------------------------------------------
REGRAS OBRIGATÓRIAS
--------------------------------------------------

• Formato quadrado 1080x1080.
• O produto deve permanecer exatamente igual ao original.
• O produto é sempre o protagonista absoluto.
• NUNCA invente novos produtos.
• NUNCA desenhe, invente, simule ou adicione textos fictícios como "sua logo aqui", "sua marca", "logo", "logo da empresa", ou crie logotipos fictícios/ícones na imagem se o Logotipo da Marca for "Não fornecido". Se o Logotipo da Marca for "Não fornecido", a imagem deve ficar 100% livre e limpa de qualquer logotipo ou marca d'água corporativa fictícia.
• Insira o contato do Instagram ({{instagram_profile}}) e o WhatsApp/Telefone de contato ({{contact_number}}) de forma elegante, discreta e minimalista nas margens ou rodapé da arte, preferencialmente acompanhados de ícones correspondentes.
`;

function buildExactGeradorPostsPrompt(
  basePrompt: string,
  productName: string,
  price: string,
  userProfile?: { contactNumber?: string; instagramProfile?: string; logoUrl?: string; primaryColor?: string; secondaryColor?: string } | null,
  colors?: string | null,
  hasHumanModel?: boolean | null,
  humanModelGender?: string | null,
  extraContext?: string | null
): string {
  let prompt = SYSTEM_PROMPT_TEMPLATE;
  prompt = prompt.replace("{{template_prompt}}", basePrompt);
  prompt = prompt.replace("{{product_name}}", productName);
  const descriptionText = extraContext && extraContext.trim()
    ? `Legenda e contexto comercial fornecidos pelo cliente: "${extraContext.trim()}". Considere estas informações para compor o post e destacar os diferenciais do produto ou do estabelecimento.`
    : `Crie e inclua uma pequena descrição comercial curta, persuasiva e atraente para o produto "${productName}".`;
  prompt = prompt.replace("{{description}}", descriptionText);
  const isWishPost = !price ||
    price.trim().toLowerCase() === "consulte" ||
    price.trim().toLowerCase().includes("desejo") ||
    price.trim().toLowerCase().includes("sem preço") ||
    price.trim().toLowerCase().includes("sem preco");

  const priceText = isWishPost
    ? "POST DE DESEJO (SEM PREÇO NUMÉRICO): NUNCA exiba nenhum valor numérico de preço (como R$ 0,00) nem badge/card de preço na imagem. Em vez do preço numérico, inclua uma chamada de desejo discreta, magnética e elegante como 'Peça o Seu', 'Edição Limitada', 'Consulte Disponibilidade' ou 'Peça pelo WhatsApp', ou mantenha o foco puramente no produto e no desejo visual."
    : price;

  prompt = prompt.replace("{{price}}", priceText);
  prompt = prompt.replace("{{cta}}", "Não fornecido (NÃO inclua nenhum botão de CTA)");

  const primaryColor = (colors && colors.trim())
    ? `Use preferencialmente estas cores especificadas pelo usuário: ${colors.trim()}`
    : (userProfile?.primaryColor && userProfile.primaryColor.trim())
    ? userProfile.primaryColor.trim()
    : "Não especificada (ATUE COMO UM DIRETOR DE ARTE / DESIGNER SÊNIOR: escolha autonomamente uma paleta de cores altamente profissional, sofisticada e harmoniosa sob medida para o produto e seu nicho comercial).";

  const secondaryColor = (userProfile?.secondaryColor && userProfile.secondaryColor.trim())
    ? userProfile.secondaryColor.trim()
    : "Não especificada (escolha uma cor secundária complementar de alto contraste).";

  prompt = prompt.replace("{{primary_color}}", primaryColor);
  prompt = prompt.replace("{{secondary_color}}", secondaryColor);

  prompt = prompt.replace("{{product_description}}", `Use o produto como o elemento principal da composição.`);

  let humanModelPrompt = "";
  if (hasHumanModel) {
    const genderStr = humanModelGender === "man" ? "masculino (homem adulto)" : humanModelGender === "kids" ? "infantil (criança / modelo infantil)" : "feminino (mulher adulta)";
    humanModelPrompt = `
• EXIGÊNCIA OBRIGATÓRIA DE MODELO: A imagem gerada DEVE OBRIGATORIAMENTE conter um modelo humano ${genderStr} VESTINDO e apresentando a peça de roupa / produto principal na composição.

• Se a imagem de entrada mostrar a roupa em um manequim, cabide, mesa ou produto isolado, VOCÊ DEVE SUBSTITTUIR essa apresentação e colocar a peça de roupa VESTIDA por um(a) modelo humano(a) real ${genderStr}. Preserve fielmente o design da roupa, incluindo cores, estampas, tecidos, modelagem e todos os detalhes originais. NUNCA gere a imagem final com o produto isolado ou em manequim quando esta regra estiver ativa.

• O(A) modelo deve estar vestindo a peça de forma natural, realista e elegante, como em um ensaio fotográfico profissional para catálogo de moda ou redes sociais.

• Garanta que o produto principal continue em destaque absoluto e não seja modificado, ocultado ou obstruído.
`;
  } else {
    humanModelPrompt = "Não adicione nenhum modelo humano (pessoas, homens ou mulheres) na imagem. O foco visual deve ser puramente no produto.";
  }
  prompt = prompt.replace("{{human_model_prompt}}", humanModelPrompt);

  const contactText = (userProfile?.contactNumber && userProfile.contactNumber.trim() && userProfile.contactNumber !== "Não fornecido")
    ? `Inclua o número de telefone de contato '${userProfile.contactNumber.trim()}' no post.`
    : "NÃO inclua nenhum número de telefone ou WhatsApp na imagem do post, pois o usuário não possui telefone de contato cadastrado.";

  const instagramText = (userProfile?.instagramProfile && userProfile.instagramProfile.trim() && userProfile.instagramProfile !== "Não fornecido")
    ? `Inclua o perfil do Instagram '${userProfile.instagramProfile.trim()}' no post.`
    : "NÃO inclua nenhum perfil ou arroba do Instagram na imagem do post, pois o usuário não possui Instagram cadastrado. Deixe a arte totalmente sem arroba ou ícone do Instagram.";

  const logoText = (userProfile?.logoUrl && userProfile.logoUrl.trim() && userProfile.logoUrl !== "Não fornecido")
    ? `Utilize esta imagem como o logotipo oficial da marca: ${userProfile.logoUrl.trim()}`
    : "NÃO invente, simule ou desenhe nenhum logotipo na imagem. É proibido criar logotipos fictícios ou adicionar textos de substituição de marca (como 'sua logo', 'logo da empresa'). Se o logotipo não estiver fornecido, deixe a imagem totalmente sem logotipo.";

  prompt = prompt.replace("{{contact_number}}", contactText);
  prompt = prompt.replace("{{instagram_profile}}", instagramText);
  prompt = prompt.replace("{{logo_url}}", logoText);
  return prompt;
}

export class PostGeneratorService {
  private readonly openaiClient: OpenAIClient;

  constructor() {
    this.openaiClient = new OpenAIClient();
  }

  /**
   * Gera uma imagem promocional solicitando à API do gerador-posts-ia (HTTP /api/generate-post)
   * utilizando estritamente o modelo gpt-image-2 da OpenAI e os prompts oficiais dos templates.
   */
  async generatePostImage(data: {
    businessType: string;
    templateId: string;
    productTitle: string;
    productPrice: string;
    hasHumanModel?: boolean | null | undefined;
    humanModelGender?: string | null | undefined;
    postType?: string | null | undefined;
    productImage?: string | null | undefined;
    userProfile?: { contactNumber?: string; instagramProfile?: string; logoUrl?: string; primaryColor?: string; secondaryColor?: string } | null | undefined;
    colors?: string | null | undefined;
    extraContext?: string | null | undefined;
  }): Promise<{ imageUrl: string; prompt: string }> {
    const category = getCategoryOrDefault(data.businessType);
    const template = getTemplateOrDefault(category, data.templateId);

    const base64Image = data.productImage && data.productImage.startsWith("data:image/")
      ? data.productImage
      : DEFAULT_CANVAS_BASE64;

    const productImagesJson = JSON.stringify([base64Image]);

    console.log(`[PostGeneratorService] Dados do Perfil -> Telefone: "${data.userProfile?.contactNumber || 'N/A'}" | Instagram: "${data.userProfile?.instagramProfile || 'N/A'}" | Cores Customizadas: "${data.colors || 'Padrão'}"`);
    console.log(`[PostGeneratorService] Modelo Humano -> Ativo: ${data.hasHumanModel ?? false} | Perfil: "${data.humanModelGender || 'N/A'}"`);
    if (data.extraContext) {
      console.log(`[PostGeneratorService] Contexto extra da legenda: "${data.extraContext}"`);
    }

    const primaryColor = (data.colors && data.colors.trim())
      ? data.colors.trim()
      : (data.userProfile?.primaryColor && data.userProfile.primaryColor.trim())
      ? data.userProfile.primaryColor.trim()
      : undefined;

    const secondaryColor = (data.userProfile?.secondaryColor && data.userProfile.secondaryColor.trim())
      ? data.userProfile.secondaryColor.trim()
      : undefined;

    console.log(`[PostGeneratorService] Cores da Marca -> Primária: "${primaryColor || 'Automático (Designer IA)'}" | Secundária: "${secondaryColor || 'Automático (Designer IA)'}"`);

    // 1. Tentar gerar através da API da aplicação gerador-posts-ia (que usa gpt-image-2 e os prompts oficiais)
    if (env.geradorPostsApiUrl && !env.geradorPostsApiUrl.includes("localhost")) {
      try {
        console.log(`[PostGeneratorService] Conectando ao gerador-posts-ia em ${env.geradorPostsApiUrl}/api/generate-post...`);

        const apiResponse = await axios.post(
          `${env.geradorPostsApiUrl}/api/generate-post`,
          {
            templateId: template.id,
            productName: data.productTitle,
            price: data.productPrice,
            description: data.extraContext,
            dimension: "1:1",
            hasHumanModel: Boolean(data.hasHumanModel),
            humanModelGender: data.humanModelGender || "woman",
            postType: data.postType || "produto",
            productImages: productImagesJson,
            contactNumber: data.userProfile?.contactNumber,
            instagramProfile: data.userProfile?.instagramProfile,
            logoUrl: data.userProfile?.logoUrl,
            primaryColor,
            secondaryColor,
          },
          { timeout: 120000 }
        );

        if (apiResponse.data?.success && apiResponse.data?.imageUrl) {
          console.log(`[PostGeneratorService] Post gerado com SUCESSO via gerador-posts-ia (gpt-image-2)! URL: ${apiResponse.data.imageUrl}`);
          return {
            imageUrl: apiResponse.data.imageUrl,
            prompt: apiResponse.data.revisedPrompt || "Gerado via gerador-posts-ia API (gpt-image-2)",
          };
        }
      } catch (apiError: any) {
        console.warn(`[PostGeneratorService] Conexão com gerador-posts-ia falhou (${apiError.message}). Executando fallback com gpt-image-2 usando o prompt oficial do template...`);
      }
    }

    // 2. Fallback usando o prompt oficial do gerador-posts-ia e o modelo gpt-image-2
    const finalPrompt = buildExactGeradorPostsPrompt(
      template.basePrompt,
      data.productTitle,
      data.productPrice,
      data.userProfile,
      data.colors,
      data.hasHumanModel,
      data.humanModelGender,
      data.extraContext
    );

    console.log(`[PostGeneratorService] Solicitando geração de imagem com o modelo 'gpt-image-2' usando o prompt oficial do template '${template.title}'...`);

    try {
      const match = base64Image.match(/^data:image\/([a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!match) {
        throw new Error("Formato de imagem base64 inválido.");
      }
      const type = match[1] || "png";
      const base64Data = match[2] || "";
      const buffer = Buffer.from(base64Data, "base64");

      const file = await toFile(buffer, `product.${type}`, {
        type: `image/${type}`,
      });

      const response = await this.openaiClient.client.images.edit({
        model: "gpt-image-2",
        image: file,
        prompt: finalPrompt,
        n: 1,
        size: "1024x1024",
        quality: "medium",
      });

      const b64Json = response.data?.[0]?.b64_json;
      const imageUrl = response.data?.[0]?.url;

      const finalUrl = b64Json ? `data:image/png;base64,${b64Json}` : imageUrl;

      if (!finalUrl) {
        throw new Error("A API da OpenAI não retornou uma imagem com o modelo gpt-image-2.");
      }

      console.log(`[PostGeneratorService] Imagem gerada com sucesso via gpt-image-2 com o prompt do template!`);
      return { imageUrl: finalUrl, prompt: finalPrompt };
    } catch (error: any) {
      console.error(`[PostGeneratorService] Erro ao gerar imagem com gpt-image-2:`, error.message || error);
      throw error;
    }
  }
}
