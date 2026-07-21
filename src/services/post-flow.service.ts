import fs from "fs";
import path from "path";
import axios from "axios";
import { PostSessionRepository } from "../repositories/post-session.repository.js";
import { WhatsAppService } from "./whatsapp.service.js";
import { PostGeneratorService } from "./post-generator.service.js";
import {
  BUSINESS_CATEGORIES,
  findCategoryByIndexOrId,
  getCategoryOrDefault,
  getTemplateOrDefault,
} from "../config/templates.config.js";
import { PostStep } from "@prisma/client";
import type { IncomingMessageDTO } from "../dto/incoming-message.dto.js";
import type { UserProfileInfo } from "./supabase-profile.service.js";
import type { AIService } from "./ai.service.js";
import { parseTitleAndPriceRegex } from "./ai.service.js";

/**
 * Utilitário para baixar imagem a partir de uma URL remota e converter em Base64 Data URL
 */
async function downloadImageFromUrlAsBase64(url: string): Promise<string> {
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  const contentType = response.headers["content-type"] || "image/png";
  const base64 = Buffer.from(response.data).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

/**
 * Retorna o nome amigável do nicho para exibição nas mensagens do bot
 */
function getNichoDisplayName(businessType?: string | null): string {
  if (businessType === "gastronomia") return "Alimentação/Padaria";
  if (businessType === "moda") return "Moda/Roupas";
  if (businessType === "promocao") return "Varejo/Mercadinho";
  return "Geral/Outro";
}

/**
 * Retorna o nome amigável do tipo de post para exibição
 */
function getPostTypeDisplayName(postType?: string | null): string {
  if (postType === "combo") return "Combo / Kit";
  if (postType === "promocao") return "Promoção / Oferta";
  if (postType === "encarte") return "Encarte / Tabela";
  return "Produto Único";
}

import type { SupabaseProfileService } from "./supabase-profile.service.js";

export class PostFlowService {
  constructor(
    private readonly postSessionRepository: PostSessionRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly postGeneratorService: PostGeneratorService,
    private readonly aiService?: AIService,
    private readonly supabaseProfileService?: SupabaseProfileService
  ) {}

  /**
   * Verifica se a mensagem é um comando para encerrar ou cancelar o fluxo de post
   */
  isCancellationCommand(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const cancelWords = [
      "cancelar",
      "sair",
      "parar",
      "encerrar",
      "finalizar",
      "fim",
      "desistir",
      "parar fluxo",
      "encerrar fluxo",
      "cancelar fluxo",
    ];
    return cancelWords.some((word) => clean === word || clean.startsWith(word));
  }

  /**
   * Verifica se a mensagem é um comando para alterar o nicho do negócio
   */
  isNichoChangeCommand(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const commands = [
      "alterar nicho",
      "mudar nicho",
      "trocar nicho",
      "nicho",
      "segmento",
      "alterar segmento",
      "mudar segmento",
      "trocar segmento",
    ];
    return commands.some((cmd) => clean === cmd || clean.startsWith(cmd));
  }

  /**
   * Verifica se a mensagem é um comando para alterar o tipo/formato do post
   */
  isPostTypeChangeCommand(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const commands = [
      "alterar tipo",
      "mudar tipo",
      "trocar tipo",
      "tipo de post",
      "tipo post",
      "formato",
      "alterar formato",
      "mudar formato",
      "tipo",
    ];
    return commands.some((cmd) => clean === cmd || clean.startsWith(cmd));
  }

  /**
   * Verifica se a mensagem de entrada é um gatilho para iniciar ou reiniciar a criação de um post
   */
  isTriggerMessage(text: string, hasActiveSession: boolean): boolean {
    const clean = text.trim().toLowerCase();
    const explicitTriggers = [
      "novo post",
      "novo-post",
      "criar post",
      "gerar post",
      "fazer post",
      "menu",
      "reiniciar",
      "recomeçar",
      "recomecar",
    ];

    if (explicitTriggers.some((t) => clean === t || clean.startsWith(t))) {
      return true;
    }

    if (!hasActiveSession) {
      return true;
    }

    return false;
  }

  /**
   * Orquestra o fluxo de criação de posts com botões e listas interativas no WhatsApp
   */
  async handlePostFlow(
    contactId: string,
    incomingMsg: IncomingMessageDTO,
    userProfile?: UserProfileInfo | null
  ): Promise<boolean> {
    const senderPhone = incomingMsg.senderPhone;
    const cleanText = incomingMsg.body.trim();
    const cleanLower = cleanText.toLowerCase();

    const cwCtx = (incomingMsg.chatwootAccountId && incomingMsg.chatwootConversationId)
      ? { accountId: incomingMsg.chatwootAccountId, conversationId: incomingMsg.chatwootConversationId }
      : undefined;

    let session = await this.postSessionRepository.findByContactId(contactId);
    const hasSession = Boolean(session);
    const isTrigger = this.isTriggerMessage(cleanText, hasSession);

    // --- COMANDO DE CANCELAMENTO OU ENCERRAMENTO ---
    if (session && this.isCancellationCommand(cleanText)) {
      await this.postSessionRepository.deleteByContactId(contactId);
      await this.whatsappService.sendText(
        senderPhone,
        "❌ *Fluxo de criação de post encerrado.*\n\nQuando quiser criar um novo post, basta digitar *'novo post'* ou me enviar a foto do produto com o preço na legenda!",
        cwCtx
      );
      return true;
    }

    // --- COMANDO DE ALTERAR NICHO ---
    if (this.isNichoChangeCommand(cleanText)) {
      session = await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_BUSINESS_TYPE,
        productTitle: null,
        productPrice: null,
        productImage: null,
      });

      await this.sendBusinessTypePrompt(
        senderPhone,
        "🔄 *Alterar Segmento do Negócio*\n\nPara qual segmento você deseja alterar a sua conta?",
        cwCtx
      );
      return true;
    }

    // --- COMANDO DE ALTERAR TIPO DE POST ---
    if (this.isPostTypeChangeCommand(cleanText)) {
      session = await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_POST_TYPE,
        productTitle: null,
        productPrice: null,
        productImage: null,
      });

      await this.sendPostTypePrompt(
        senderPhone,
        "📌 *Alterar Tipo de Post*\n\nComo você deseja apresentar o seu produto ou oferta?",
        cwCtx
      );
      return true;
    }

    // --- GATILHO INICIAL OU COMANDO DE NOVO POST ---
    if (!session || isTrigger) {
      if (!session && !isTrigger) {
        return false;
      }

      session = await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_FLOW_MODE,
        businessType: session?.businessType ?? null,
        hasHumanModel: session?.hasHumanModel ?? null,
        modelProfile: session?.modelProfile ?? null,
        postType: session?.postType ?? "produto",
        productTitle: null,
        productPrice: null,
        productImage: null,
        templateId: null,
      });

      await this.sendFlowModePrompt(senderPhone, cwCtx);
      return true;
    }

    // --- ETAPA: Processar Seleção do Modo de Criação (Post Rápido vs Personalizado) ---
    if (session.step === PostStep.SELECT_FLOW_MODE) {
      if (cleanText === "1" || cleanLower.includes("rapido") || cleanLower.includes("rápido")) {
        // MODO 1: POST RÁPIDO
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.INPUT_IMAGE,
          templateId: session.templateId || "food-promo",
          productTitle: null,
          productPrice: null,
          productImage: null,
        });

        let fastMsg = "⚡ *Modo Post Rápido Ativado!*\n\n";
        if (session.businessType === "moda") {
          fastMsg += "Legal! Agora me mande a foto da peça (esticada na mesa, no cabide ou no manequim) com o Nome e Preço na legenda.\n\n";
          fastMsg += "💡 *Exemplo:* Vestido Linho Verde R$ 149,90";
        } else {
          fastMsg += "Me envie a foto do produto e escreva na legenda da própria foto o Nome e o Preço.\n\n";
          fastMsg += "💡 *Exemplo:* Bolo de Cenoura R$ 12,00";
        }

        await this.whatsappService.sendText(senderPhone, fastMsg, cwCtx);
        return true;
      }

      if (cleanText === "2" || cleanLower.includes("personalizado") || cleanLower.includes("detalhado")) {
        // MODO 2: POST PERSONALIZADO
        if (!session.businessType) {
          await this.postSessionRepository.createOrUpdate(contactId, {
            step: PostStep.SELECT_BUSINESS_TYPE,
            productTitle: null,
            productPrice: null,
            productImage: null,
          });

          await this.sendBusinessTypePrompt(
            senderPhone,
            "🎨 *Modo Post Personalizado*\n\nPara eu ajustar os modelos para a sua marca, qual é o seu segmento/nicho?",
            cwCtx
          );
          return true;
        } else {
          await this.postSessionRepository.createOrUpdate(contactId, {
            step: PostStep.SELECT_POST_TYPE,
            productTitle: null,
            productPrice: null,
            productImage: null,
          });

          await this.sendPostTypePrompt(
            senderPhone,
            "📌 *Tipo de Post*\n\nComo você deseja apresentar o seu produto ou oferta?",
            cwCtx
          );
          return true;
        }
      }

      await this.sendFlowModePrompt(senderPhone, cwCtx);
      return true;
    }

    // --- ETAPA: Seleção de Nicho (Menu Lista) ---
    if (session.step === PostStep.SELECT_BUSINESS_TYPE) {
      let selectedBusinessType = "gastronomia";

      if (cleanText === "2" || cleanLower.includes("moda") || cleanLower.includes("roupa")) {
        selectedBusinessType = "moda";
      } else if (cleanText === "3" || cleanLower.includes("varejo") || cleanLower.includes("mercadinho") || cleanLower.includes("mercado")) {
        selectedBusinessType = "promocao";
      } else if (cleanText === "4" || cleanLower.includes("outro")) {
        selectedBusinessType = "geral";
      } else {
        selectedBusinessType = "gastronomia";
      }

      if (selectedBusinessType === "moda") {
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.SELECT_FASHION_PRESENTATION,
          businessType: "moda",
        });

        await this.sendFashionPresentationPrompt(senderPhone, cwCtx);
        return true;
      }

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_POST_TYPE,
        businessType: selectedBusinessType,
        hasHumanModel: false,
        modelProfile: null,
      });

      await this.sendPostTypePrompt(
        senderPhone,
        `✅ *Nicho configurado como ${getNichoDisplayName(selectedBusinessType)}!*\n\n📌 Escolha o *Tipo de Post*:`,
        cwCtx
      );
      return true;
    }

    // --- ETAPA MODA 2: Foto Real vs Modelo Virtual (Botões Interativos) ---
    if (session.step === PostStep.SELECT_FASHION_PRESENTATION) {
      if (cleanText === "2" || cleanLower.includes("modelo") || cleanLower.includes("virtual") || cleanLower.includes("ia")) {
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.SELECT_FASHION_MODEL,
          hasHumanModel: true,
        });

        await this.sendFashionModelPrompt(senderPhone, cwCtx);
        return true;
      } else {
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.SELECT_POST_TYPE,
          hasHumanModel: false,
          modelProfile: null,
        });

        await this.sendPostTypePrompt(
          senderPhone,
          "Perfeito! Nicho de Moda (Foto Real) configurado!\n\n📌 Escolha o *Tipo de Post*:",
          cwCtx
        );
        return true;
      }
    }

    // --- ETAPA MODA 3: Modelo Virtual (Botões Interativos) ---
    if (session.step === PostStep.SELECT_FASHION_MODEL) {
      let selectedModelProfile = "woman";

      if (cleanText === "2" || cleanLower.includes("homem") || cleanLower.includes("masculino")) {
        selectedModelProfile = "man";
      } else if (cleanText === "3" || cleanLower.includes("crianca") || cleanLower.includes("criança") || cleanLower.includes("infantil") || cleanLower.includes("kids")) {
        selectedModelProfile = "kids";
      } else {
        selectedModelProfile = "woman";
      }

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_POST_TYPE,
        hasHumanModel: true,
        modelProfile: selectedModelProfile,
      });

      await this.sendPostTypePrompt(
        senderPhone,
        "Perfeito! Modelo Virtual selecionado!\n\n📌 Escolha o *Tipo de Post*:",
        cwCtx
      );
      return true;
    }

    // --- ETAPA: Seleção do Tipo de Post (Menu Lista Interativa) ---
    if (session.step === PostStep.SELECT_POST_TYPE) {
      let selectedPostType = "produto";

      if (cleanText === "2" || cleanLower.includes("combo") || cleanLower.includes("kit")) {
        selectedPostType = "combo";
      } else if (cleanText === "3" || cleanLower.includes("promo") || cleanLower.includes("oferta")) {
        selectedPostType = "promocao";
      } else if (cleanText === "4" || cleanLower.includes("encarte") || cleanLower.includes("tabela") || cleanLower.includes("lista")) {
        selectedPostType = "encarte";
      } else {
        selectedPostType = "produto";
      }

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_TEMPLATE,
        postType: selectedPostType,
      });

      await this.sendTemplatesMenu(contactId, senderPhone, session.businessType, cwCtx);
      return true;
    }

    // --- ETAPA: Seleção de Template (Menu Lista Interativa de Templates) ---
    if (session.step === PostStep.SELECT_TEMPLATE) {
      const category = getCategoryOrDefault(session.businessType);
      const index = parseInt(cleanText, 10);
      const defaultTmpl = category.templates[0] || { id: "food-promo", title: "Template Padrão", description: "Design moderno" };
      const selectedTemplate = category.templates[index - 1] || defaultTmpl;

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.INPUT_TITLE,
        templateId: selectedTemplate.id,
      });

      let titleMsg = "📝 *Título do Produto / Oferta*\n\n";
      titleMsg += `Template selecionado: *${selectedTemplate.title}*\n`;
      titleMsg += `Tipo de post: *${getPostTypeDisplayName(session.postType)}*\n\n`;
      titleMsg += "Por favor, digite o *Título do Produto* que vai aparecer na arte:\n";
      titleMsg += "_(Exemplo: Hambúrguer Artesanal Duplo ou Camisa Oversized)_";

      await this.whatsappService.sendText(senderPhone, titleMsg, cwCtx);
      return true;
    }

    // --- ETAPA: Digitação do Título ---
    if (session.step === PostStep.INPUT_TITLE) {
      if (!cleanText) {
        await this.whatsappService.sendText(senderPhone, "⚠️ Por favor, digite um título válido para o produto.", cwCtx);
        return true;
      }

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.INPUT_PRICE,
        productTitle: cleanText,
      });

      let priceMsg = "💰 *Valor do Produto*\n\n";
      priceMsg += `Produto: *${cleanText}*\n\n`;
      priceMsg += "Agora, informe o *Valor do Produto* ou a condição da promoção:\n";
      priceMsg += "_(Exemplo: R$ 49,90 ou Apenas R$ 129,00)_";

      await this.whatsappService.sendText(senderPhone, priceMsg, cwCtx);
      return true;
    }

    // --- ETAPA: Digitação do Valor ---
    if (session.step === PostStep.INPUT_PRICE) {
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.INPUT_IMAGE,
        productPrice: cleanText,
      });

      let imageMsg = "📸 *Foto do Produto*\n\n";
      imageMsg += `Produto: *${session.productTitle}*\n`;
      imageMsg += `Valor: *${cleanText}*\n\n`;

      if (session.businessType === "moda") {
        imageMsg += "Legal! Agora me mande a foto da peça (esticada na mesa, no cabide ou no manequim) com o Nome e Preço na legenda.\n\n";
        imageMsg += "💡 *Exemplo:* Vestido Linho Verde R$ 149,90\n\n";
      } else {
        imageMsg += "Envie agora a *Foto do Produto* aqui no chat! 📷\n\n";
      }
      imageMsg += '_(Se preferir que a IA crie a arte do zero sem foto, digite *"pular"*)_';

      await this.whatsappService.sendText(senderPhone, imageMsg, cwCtx);
      return true;
    }

    // --- ETAPA: Envio da Foto e Processamento ---
    if (session.step === PostStep.INPUT_IMAGE) {
      let base64Image: string | null = session.productImage || null;
      let rawCaption = (incomingMsg.caption || incomingMsg.body || "").trim();

      const isNewImage = incomingMsg.type === "image" || Boolean(incomingMsg.mediaId) || Boolean(incomingMsg.mediaUrl);

      if (isNewImage) {
        try {
          if (incomingMsg.mediaUrl) {
            console.log(`[PostFlowService] Baixando imagem de anexo do Chatwoot (${incomingMsg.mediaUrl})...`);
            base64Image = await downloadImageFromUrlAsBase64(incomingMsg.mediaUrl);
          } else if (incomingMsg.mediaId) {
            console.log(`[PostFlowService] Baixando imagem da Meta API (mediaId: ${incomingMsg.mediaId})...`);
            base64Image = await this.whatsappService.downloadMedia(incomingMsg.mediaId);
          }
        } catch (error: any) {
          console.error(`[PostFlowService] Erro ao baixar foto do produto:`, error.message || error);
        }

        if (base64Image) {
          await this.postSessionRepository.createOrUpdate(contactId, {
            step: PostStep.INPUT_IMAGE,
            productImage: base64Image,
          });
        }
      }

      if (["pular", "sem foto", "nao", "não"].includes(cleanLower)) {
        base64Image = null;
      }

      let title = session.productTitle;
      let price = session.productPrice;

      if (!title || !price) {
        const hasCaption = rawCaption.length > 0 && rawCaption !== "[Imagem]";

        if (!hasCaption) {
          if (isNewImage) {
            let requestTextMsg = "📸 *Foto do Produto Recebida!*\n\n";
            requestTextMsg += "Para garantirmos uma arte incrível e sem erros, por favor digite o **Nome do Produto** e o **Preço**.\n\n";
            if (session.businessType === "moda") {
              requestTextMsg += "💡 *Exemplo:* Vestido Linho Verde R$ 149,90";
            } else {
              requestTextMsg += "💡 *Exemplo:* Bolo de Cenoura R$ 12,00";
            }

            await this.whatsappService.sendText(senderPhone, requestTextMsg, cwCtx);
            return true;
          }

          if (this.isTriggerMessage(cleanText, true)) {
            let promptMsg = "📸 *Foto do Produto*\n\n";
            if (session.businessType === "moda") {
              promptMsg += "Legal! Agora me mande a foto da peça (esticada na mesa, no cabide ou no manequim) com o Nome e Preço na legenda.\n\n";
              promptMsg += "💡 *Exemplo:* Vestido Linho Verde R$ 149,90\n";
            } else {
              promptMsg += "Por favor, envie a *foto do produto* no chat com a legenda contendo o Nome e o Preço.\n\n";
              promptMsg += "💡 *Exemplo:* Bolo de Cenoura R$ 12,00\n";
            }
            promptMsg += '_(Ou digite *"pular"* se quiser criar o post sem foto)_';

            await this.whatsappService.sendText(senderPhone, promptMsg, cwCtx);
            return true;
          }
        }

        let extractedData: { title: string; price: string };
        if (this.aiService) {
          extractedData = await this.aiService.extractTitleAndPrice(rawCaption);
        } else {
          extractedData = parseTitleAndPriceRegex(rawCaption);
        }

        title = extractedData.title;
        price = extractedData.price;
      }

      const nichoDisplay = getNichoDisplayName(session.businessType);
      const postTypeDisplay = getPostTypeDisplayName(session.postType);

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.GENERATING,
        productTitle: title,
        productPrice: price,
        productImage: base64Image,
      });

      let confirmMsg = "Recebido! 🧀\n\n";
      confirmMsg += "Identifiquei:\n";
      confirmMsg += `🏷️ *Produto:* ${title}\n`;
      confirmMsg += `💰 *Preço:* ${price}\n`;
      confirmMsg += `📌 *Tipo de Post:* ${postTypeDisplay}\n\n`;
      confirmMsg += `Aplicando o template de ${nichoDisplay} e gerando a arte... ⚙️`;

      await this.whatsappService.sendText(senderPhone, confirmMsg, cwCtx);

      await this.generatePostAndSend(contactId, senderPhone, userProfile, cwCtx);
      return true;
    }

    if (session.step === PostStep.GENERATING) {
      await this.whatsappService.sendText(
        senderPhone,
        "⏳ A sua arte já está sendo gerada pela IA! Em alguns instantes você a receberá aqui.",
        cwCtx
      );
      return true;
    }

    return false;
  }

  // --- PROMPTS INTERATIVOS (BOTÕES E LISTAS NATIVAS DO WHATSAPP) ---

  private async sendFlowModePrompt(
    senderPhone: string,
    cwCtx?: { accountId?: number | string; conversationId?: number | string }
  ) {
    let text = "Como você deseja criar o seu post hoje? 🚀\n\n";
    text += "1️⃣ *Post Rápido* (Envie 1 foto com Nome e Preço na legenda e a IA cria a arte na hora!)\n\n";
    text += "2️⃣ *Post Personalizado* (Escolha o nicho, tipo de post e selecione o modelo/template visual)";

    const buttons = [
      { id: "1", title: "⚡ Post Rápido" },
      { id: "2", title: "🎨 Personalizado" },
    ];
    await this.whatsappService.sendButtons(senderPhone, text, buttons, cwCtx);
  }

  private async sendBusinessTypePrompt(
    senderPhone: string,
    headerText: string,
    cwCtx?: { accountId?: number | string; conversationId?: number | string }
  ) {
    const sections = [
      {
        title: "Segmentos do Negócio",
        rows: [
          { id: "1", title: "Padaria / Café", description: "Padarias, confeitarias e alimentação" },
          { id: "2", title: "Loja de Roupas", description: "Moda masculina, feminina e infantil" },
          { id: "3", title: "Varejo / Mercado", description: "Mercadinhos, conveniências e utilidades" },
          { id: "4", title: "Outro Segmento", description: "Serviços e comércios em geral" },
        ],
      },
    ];
    await this.whatsappService.sendList(senderPhone, headerText, "Escolher Nicho", sections, cwCtx);
  }

  private async sendFashionPresentationPrompt(
    senderPhone: string,
    cwCtx?: { accountId?: number | string; conversationId?: number | string }
  ) {
    const text = "Perfeito! Como você quer a apresentação das suas peças de roupa?";
    const buttons = [
      { id: "1", title: "📸 Foto Real" },
      { id: "2", title: "🤖 Modelo Virtual" },
    ];
    await this.whatsappService.sendButtons(senderPhone, text, buttons, cwCtx);
  }

  private async sendFashionModelPrompt(
    senderPhone: string,
    cwCtx?: { accountId?: number | string; conversationId?: number | string }
  ) {
    const text = "Show! Escolha quem vai vestir a peça:";
    const buttons = [
      { id: "1", title: "👩 Mulher Adulta" },
      { id: "2", title: "👨 Homem Adulto" },
      { id: "3", title: "🧒 Criança / Infantil" },
    ];
    await this.whatsappService.sendButtons(senderPhone, text, buttons, cwCtx);
  }

  private async sendPostTypePrompt(
    senderPhone: string,
    headerText: string,
    cwCtx?: { accountId?: number | string; conversationId?: number | string }
  ) {
    const sections = [
      {
        title: "Formatos de Publicação",
        rows: [
          { id: "1", title: "Produto Único", description: "Destaque comercial de 1 produto principal" },
          { id: "2", title: "Combo / Kit", description: "Dois ou mais produtos num pacote promocional" },
          { id: "3", title: "Promoção / Oferta", description: "Destaque para valores e descontos especiais" },
          { id: "4", title: "Encarte / Tabela", description: "Estilo catálogo ou encarte de supermercado" },
        ],
      },
    ];
    await this.whatsappService.sendList(senderPhone, headerText, "Escolher Formato", sections, cwCtx);
  }

  /**
   * Envia a imagem do guia visual e a lista interativa de templates do nicho
   */
  private async sendTemplatesMenu(
    contactId: string,
    senderPhone: string,
    businessType?: string | null,
    cwCtx?: { accountId?: number | string; conversationId?: number | string }
  ): Promise<void> {
    const category = getCategoryOrDefault(businessType);

    try {
      const categoryFileMap: Record<string, string> = {
        gastronomia: "templates-comida.png",
        promocao: "templates-varejo.png",
        varejo: "templates-varejo.png",
        moda: "templates-moda.png",
      };

      const targetFileName = categoryFileMap[category.id] || `templates-${category.id}.png`;
      const assetPath = path.resolve(process.cwd(), "assets", targetFileName);
      const fallbackPath = path.resolve(process.cwd(), "assets", "templates-moda.png");
      const finalPath = fs.existsSync(assetPath) ? assetPath : (fs.existsSync(fallbackPath) ? fallbackPath : null);

      if (finalPath) {
        const imgBuffer = fs.readFileSync(finalPath);
        const base64Url = `data:image/png;base64,${imgBuffer.toString("base64")}`;
        await this.whatsappService.sendImage(
          senderPhone,
          base64Url,
          `🖼️ *Guia Visual dos Templates de ${category.name}*`,
          cwCtx
        );
      }
    } catch (assetErr: any) {
      console.warn(`[PostFlowService] Falha ao enviar imagem do guia visual: ${assetErr.message}`);
    }

    const rows = category.templates.map((tmpl, index) => ({
      id: String(index + 1),
      title: tmpl.title.slice(0, 24),
      description: tmpl.description.slice(0, 72),
    }));

    await this.whatsappService.sendList(
      senderPhone,
      `✨ *Templates para ${category.name}* ✨\n\nEscolha o estilo do template para a sua arte:`,
      "Ver Templates",
      [
        {
          title: `Templates de ${category.name}`,
          rows,
        },
      ],
      cwCtx
    );
  }

  /**
   * Entrega da Arte + Sugestão de Legenda para Instagram + Menu de Retenção
   */
  private async generatePostAndSend(
    contactId: string,
    senderPhone: string,
    userProfile?: UserProfileInfo | null,
    cwCtx?: { accountId?: number | string; conversationId?: number | string }
  ): Promise<void> {
    const session = await this.postSessionRepository.findByContactId(contactId);

    const category = getCategoryOrDefault(session?.businessType);
    const template = getTemplateOrDefault(category, session?.templateId);
    const productTitle = session?.productTitle || "Vestido Linho Verde";
    const productPrice = session?.productPrice || "R$ 149,90";
    const productImage = session?.productImage || null;

    if (!userProfile && this.supabaseProfileService) {
      const auth = await this.supabaseProfileService.getProfileByPhone(senderPhone);
      if (auth.profile) {
        userProfile = auth.profile;
        console.log(`[PostFlowService] Perfil do Supabase obtido no momento da geração para ${senderPhone}. Instagram: "${userProfile.instagramProfile}"`);
      }
    }

    try {
      console.log(`[PostFlowService] Gerando arte para ${senderPhone} (Nicho: ${category.name} | Produto: ${productTitle} | Tipo: ${session?.postType || "produto"})...`);

      const result = await this.postGeneratorService.generatePostImage({
        businessType: category.id,
        templateId: template.id,
        productTitle,
        productPrice,
        hasHumanModel: session?.hasHumanModel,
        humanModelGender: session?.modelProfile,
        postType: session?.postType || "produto",
        productImage,
        userProfile,
      });

      await this.whatsappService.sendImage(
        senderPhone,
        result.imageUrl,
        `🖼️ *Arte gerada para ${productTitle}!*`,
        cwCtx
      );

      const sanitizedTitle = productTitle.replace(/[^\w\s]/gi, "").replace(/\s+/g, "");
      const nichoHashtag = category.id === "gastronomia" ? "Padaria #Gastronomia" : category.id === "moda" ? "Moda #Fashion" : "Promocao #Varejo";

      let finalDeliveryMsg = "Sua arte tá pronta! 🔥\n\n";
      finalDeliveryMsg += "📝 *Sugestão de legenda:*\n\n";
      finalDeliveryMsg += `"Saindo quentinho por aqui! Venha garantir o seu ${productTitle} por apenas ${productPrice}. 😋 #${nichoHashtag} #${sanitizedTitle}"\n\n`;
      finalDeliveryMsg += "🔄 1. Criar outro post\n";
      finalDeliveryMsg += "💳 2. Ver meus créditos (2 de 3 testes grátis restantes)";

      await this.whatsappService.sendText(senderPhone, finalDeliveryMsg, cwCtx);

      console.log(`[PostFlowService] Fluxo completo concluído com SUCESSO para ${senderPhone}`);
    } catch (error) {
      console.error(`[PostFlowService] Erro ao gerar arte final:`, error);
      await this.whatsappService.sendText(
        senderPhone,
        "❌ Ocorreu uma falha ao gerar a arte. Por favor, envie '1' para tentar gerar novamente!",
        cwCtx
      );
    } finally {
      // Limpa os dados temporários do produto (imagem, título, preço) ao encerrar o fluxo
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_FLOW_MODE,
        businessType: session?.businessType ?? null,
        hasHumanModel: session?.hasHumanModel ?? null,
        modelProfile: session?.modelProfile ?? null,
        postType: session?.postType ?? "produto",
        productTitle: null,
        productPrice: null,
        productImage: null,
        templateId: null,
      });
    }
  }
}
