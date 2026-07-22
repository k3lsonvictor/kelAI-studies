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
import type { SupabaseProfileService } from "./supabase-profile.service.js";

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

export class PostFlowService {
  constructor(
    private readonly postSessionRepository: PostSessionRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly postGeneratorService: PostGeneratorService,
    private readonly aiService?: AIService,
    private readonly supabaseProfileService?: SupabaseProfileService
  ) { }

  /**
   * Wrapper privado para atualizar a sessão incluindo e persistindo o contexto do Chatwoot
   */
  private async updateSession(
    contactId: string,
    cwCtx: { accountId?: number | string; conversationId?: number | string } | undefined,
    data: Parameters<PostSessionRepository["createOrUpdate"]>[1]
  ) {
    const chatwootAccountId = cwCtx?.accountId ? String(cwCtx.accountId) : undefined;
    const chatwootConversationId = cwCtx?.conversationId ? String(cwCtx.conversationId) : undefined;
    return this.postSessionRepository.createOrUpdate(contactId, {
      ...data,
      ...(chatwootAccountId !== undefined && { chatwootAccountId }),
      ...(chatwootConversationId !== undefined && { chatwootConversationId }),
    });
  }

  /**
   * Verifica se a mensagem é um comando para encerrar ou cancelar o fluxo de post
   */
  /**
   * Função auxiliar para normalizar texto de entrada (remove emojis, substitui _ por espaço)
   */
  private normalizeInputText(text: string): string {
    return text
      .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "")
      .replace(/_/g, " ")
      .trim()
      .toLowerCase();
  }

  /**
   * Verifica se a mensagem é um comando de cancelamento ou encerramento
   */
  isCancellationCommand(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const normalized = this.normalizeInputText(text);
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
      "agora nao",
      "agora não",
    ];
    return cancelWords.some((word) =>
      clean === word || clean.startsWith(word) || normalized === word || normalized.startsWith(word)
    );
  }

  /**
   * Verifica se a mensagem é um comando para alterar o nicho do negócio
   */
  isNichoChangeCommand(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const normalized = this.normalizeInputText(text);
    const commands = [
      "alterar nicho",
      "alterar_nicho",
      "mudar nicho",
      "mudar_nicho",
      "trocar nicho",
      "trocar_nicho",
      "nicho",
      "segmento",
      "alterar segmento",
      "mudar segmento",
      "trocar segmento",
    ];
    return commands.some((cmd) =>
      clean === cmd || clean.startsWith(cmd) || clean.includes(cmd) ||
      normalized === cmd || normalized.startsWith(cmd) || normalized.includes(cmd)
    );
  }

  /**
   * Verifica se a mensagem é um comando para alterar o tipo/formato do post
   */
  isPostTypeChangeCommand(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const normalized = this.normalizeInputText(text);
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
    return commands.some((cmd) =>
      clean === cmd || clean.startsWith(cmd) || normalized === cmd || normalized.startsWith(cmd)
    );
  }

  /**
   * Verifica se a mensagem de entrada é um gatilho para iniciar ou reiniciar a criação de um post
   */
  isTriggerMessage(text: string, hasActiveSession: boolean): boolean {
    const clean = text.trim().toLowerCase();
    const normalized = this.normalizeInputText(text);
    const explicitTriggers = [
      "novo post",
      "novo-post",
      "novo_post",
      "criar post",
      "gerar post",
      "fazer post",
      "menu",
      "reiniciar",
      "recomeçar",
      "recomecar",
    ];

    if (explicitTriggers.some((t) => clean === t || clean.startsWith(t) || normalized === t || normalized.startsWith(t))) {
      return true;
    }

    if (!hasActiveSession) {
      return true;
    }

    return false;
  }

  /**
   * Orquestra o fluxo de criação de posts seguindo a nova especificação de passos
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

    // --- GATILHO RE-GERAÇÃO COM OUTRO TEMPLATE ---
    if (session && (cleanLower === "gerar novamente" || cleanLower === "gerar_novamente" || cleanLower.includes("gerar novamente") || cleanLower.includes("gerar_novamente"))) {
      if (!session.productTitle) {
        await this.whatsappService.sendText(
          senderPhone,
          "⚠️ Não encontrei os dados do post anterior para gerar novamente. Digite *'novo post'* para começar um do zero!",
          cwCtx
        );
        return true;
      }

      const category = getCategoryOrDefault(session.businessType);
      const currentTemplateId = session.templateId || "fashion";

      const currentIndex = category.templates.findIndex((t) => t.id === currentTemplateId);
      let nextTemplate = category.templates[0]!;
      if (currentIndex !== -1) {
        const nextIndex = (currentIndex + 1) % category.templates.length;
        nextTemplate = category.templates[nextIndex]!;
      }

      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.GENERATING,
        templateId: nextTemplate.id,
      });

      let confirmMsg = "Re-gerando sua arte! 🔄\n\n";
      confirmMsg += `🏷️ *Produto:* ${session.productTitle}\n`;
      confirmMsg += `💰 *Preço:* ${session.productPrice}\n`;
      confirmMsg += `📌 *Novo Template:* *${nextTemplate.title}*\n`;
      if (session.colors) {
        confirmMsg += `🎨 *Cores:* ${session.colors}\n`;
      }
      confirmMsg += "\n⚡ *Nossa IA de alta precisão está criando seu design do zero com um novo layout. Em menos de 60 segundos você terá a nova arte!* ⚙️";

      await this.whatsappService.sendText(senderPhone, confirmMsg, cwCtx);
      await this.generatePostAndSend(contactId, senderPhone, userProfile, cwCtx);
      return true;
    }

    // --- COMANDO DE CANCELAMENTO OU ENCERRAMENTO ---
    if (session && this.isCancellationCommand(cleanText)) {
      // Em vez de deletar para não perder o nicho salvo, apenas reiniciamos a sessão preservando o nicho
      await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_FLOW_MODE,
        postType: null,
        templateId: null,
        colors: null,
        productTitle: null,
        productPrice: null,
        productImage: null,
      });

      await this.whatsappService.sendText(
        senderPhone,
        "❌ *Fluxo de criação de post encerrado.*\n\nQuando quiser criar um novo post, basta digitar *'novo post'* ou me enviar a foto do produto!",
        cwCtx
      );
      return true;
    }

    // --- COMANDO DE ALTERAR NICHO (Limpa o nicho salvo e reinicia) ---
    if (this.isNichoChangeCommand(cleanText)) {
      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_BUSINESS_TYPE,
        businessType: null,
        hasHumanModel: null,
        modelProfile: null,
        postType: null,
        templateId: null,
        colors: null,
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

    // --- GATILHO INICIAL: "novo post" ➔ Só pergunta o Nicho se NÃO estiver salvo ---
    if (!session || isTrigger) {
      if (!session && !isTrigger) {
        return false;
      }

      const hasSavedNicho = session && session.businessType;

      if (hasSavedNicho) {
        // Nicho já está salvo, pula direto para a escolha do Modo (Rápido vs Personalizado)
        session = await this.updateSession(contactId, cwCtx, {
          step: PostStep.SELECT_FLOW_MODE,
          postType: null,
          templateId: null,
          colors: null,
          productTitle: null,
          productPrice: null,
          productImage: null,
        });

        await this.sendFlowModePrompt(senderPhone, cwCtx);
        return true;
      } else {
        // Primeira vez: precisa perguntar o Nicho
        session = await this.updateSession(contactId, cwCtx, {
          step: PostStep.SELECT_BUSINESS_TYPE,
          businessType: null,
          hasHumanModel: null,
          modelProfile: null,
          postType: null,
          templateId: null,
          colors: null,
          productTitle: null,
          productPrice: null,
          productImage: null,
        });

        await this.sendBusinessTypePrompt(
          senderPhone,
          "Olá! 🚀 Bem-vindo ao Gerador de Posts Promto!\n\nQual é o segmento/nicho do seu negócio?",
          cwCtx
        );
        return true;
      }
    }

    // --- PASSO 1: Escolha do Nicho ➔ Validação estrita dos botões de Nicho ---
    if (session.step === PostStep.SELECT_BUSINESS_TYPE) {
      const isOption1 = cleanText === "1" || cleanLower.includes("padaria") || cleanLower.includes("alimentação") || cleanLower.includes("alimentacao") || cleanLower.includes("café") || cleanLower.includes("cafe");
      const isOption2 = cleanText === "2" || cleanLower.includes("moda") || cleanLower.includes("roupa");
      const isOption3 = cleanText === "3" || cleanLower.includes("varejo") || cleanLower.includes("mercadinho") || cleanLower.includes("mercado");
      const isOption4 = cleanText === "4" || cleanLower.includes("outro");

      if (!isOption1 && !isOption2 && !isOption3 && !isOption4) {
        await this.sendBusinessTypePrompt(
          senderPhone,
          "⚠️ Opção inválida. Por favor, selecione um dos nichos da lista abaixo:",
          cwCtx
        );
        return true;
      }

      let selectedBusinessType = "gastronomia";
      if (isOption2) {
        selectedBusinessType = "moda";
      } else if (isOption3) {
        selectedBusinessType = "promocao";
      } else if (isOption4) {
        selectedBusinessType = "geral";
      }

      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_FLOW_MODE,
        businessType: selectedBusinessType,
      });

      await this.sendFlowModePrompt(senderPhone, cwCtx);
      return true;
    }

    // --- PASSO 2: Escolha do Modo (Rápido vs Personalizado) ➔ Validação estrita ---
    if (session.step === PostStep.SELECT_FLOW_MODE) {
      const isQuick = cleanText === "1" || cleanLower.includes("rapido") || cleanLower.includes("rápido");
      const isCustom = cleanText === "2" || cleanLower.includes("personalizado") || cleanLower.includes("detalhado");

      if (!isQuick && !isCustom) {
        await this.sendFlowModePrompt(senderPhone, cwCtx);
        return true;
      }

      const modeStr = isQuick ? "quick" : "custom";

      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_FLOW_MODE,
        templateId: modeStr,
        postType: null,
        colors: null,
        productTitle: null,
        productPrice: null,
        productImage: null,
      });

      if (session.businessType === "moda") {
        session = await this.updateSession(contactId, cwCtx, {
          step: PostStep.SELECT_FASHION_PRESENTATION,
        });
        await this.sendFashionPresentationPrompt(senderPhone, cwCtx);
        return true;
      }

      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_POST_TYPE,
      });

      if (isQuick) {
        await this.sendPostTypePrompt(
          senderPhone,
          "⚡ *Modo Post Rápido*\n\nPra quantos produtos é o seu post hoje?",
          cwCtx
        );
      } else {
        await this.sendPostTypePrompt(
          senderPhone,
          "🎨 *Modo Post Personalizado*\n\nComo deseja apresentar o seu produto ou oferta?",
          cwCtx
        );
      }
      return true;
    }

    // --- PASSO ADICIONAL MODA 1: Foto Real vs Modelo Virtual ➔ Validação estrita ---
    if (session.step === PostStep.SELECT_FASHION_PRESENTATION) {
      const isRealPhoto = cleanText === "1" || cleanLower.includes("foto") || cleanLower.includes("real");
      const isVirtualModel = cleanText === "2" || cleanLower.includes("modelo") || cleanLower.includes("virtual") || cleanLower.includes("ia");
      const isQuick = session.templateId === "quick";

      if (!isRealPhoto && !isVirtualModel) {
        await this.sendFashionPresentationPrompt(senderPhone, cwCtx);
        return true;
      }

      if (isVirtualModel) {
        session = await this.updateSession(contactId, cwCtx, {
          step: PostStep.SELECT_FASHION_MODEL,
          hasHumanModel: true,
        });
        await this.sendFashionModelPrompt(senderPhone, cwCtx);
        return true;
      } else {
        session = await this.updateSession(contactId, cwCtx, {
          step: PostStep.SELECT_POST_TYPE,
          hasHumanModel: false,
          modelProfile: null,
        });

        if (isQuick) {
          await this.sendPostTypePrompt(
            senderPhone,
            "⚡ *Modo Post Rápido (Moda - Foto Real)*\n\nPra quantos produtos é o seu post hoje?",
            cwCtx
          );
        } else {
          await this.sendPostTypePrompt(
            senderPhone,
            "🎨 *Modo Post Personalizado (Moda - Foto Real)*\n\nComo deseja apresentar o seu produto ou oferta?",
            cwCtx
          );
        }
        return true;
      }
    }

    // --- PASSO ADICIONAL MODA 2: Escolha do Modelo Virtual ➔ Validação estrita ---
    if (session.step === PostStep.SELECT_FASHION_MODEL) {
      const isWoman = cleanText === "1" || cleanLower.includes("mulher") || cleanLower.includes("feminino");
      const isMan = cleanText === "2" || cleanLower.includes("homem") || cleanLower.includes("masculino");
      const isKids = cleanText === "3" || cleanLower.includes("crianca") || cleanLower.includes("criança") || cleanLower.includes("infantil") || cleanLower.includes("kids");

      if (!isWoman && !isMan && !isKids) {
        await this.sendFashionModelPrompt(senderPhone, cwCtx);
        return true;
      }

      let selectedModelProfile = "woman";
      if (isMan) {
        selectedModelProfile = "man";
      } else if (isKids) {
        selectedModelProfile = "kids";
      }

      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_POST_TYPE,
        modelProfile: selectedModelProfile,
      });

      const isQuick = session.templateId === "quick";

      if (isQuick) {
        await this.sendPostTypePrompt(
          senderPhone,
          "⚡ *Modo Post Rápido (Moda - Modelo Virtual)*\n\nPra quantos produtos é o seu post hoje?",
          cwCtx
        );
      } else {
        await this.sendPostTypePrompt(
          senderPhone,
          "🎨 *Modo Post Personalizado (Moda - Modelo Virtual)*\n\nComo deseja apresentar o seu produto ou oferta?",
          cwCtx
        );
      }
      return true;
    }

    // --- PASSO 3: Seleção do Tipo de Post (Quantidade de Produtos / Formato) ➔ Validação estrita ---
    if (session.step === PostStep.SELECT_POST_TYPE) {
      const isType1 = cleanText === "1" || cleanLower.includes("único") || cleanLower.includes("unico") || cleanLower.includes("produto");
      const isType2 = cleanText === "2" || cleanLower.includes("combo") || cleanLower.includes("kit");
      const isType3 = cleanText === "3" || cleanLower.includes("promo") || cleanLower.includes("oferta");
      const isType4 = cleanText === "4" || cleanLower.includes("encarte") || cleanLower.includes("tabela") || cleanLower.includes("lista");

      const isQuick = session.templateId === "quick";

      if (!isType1 && !isType2 && !isType3 && !isType4) {
        if (isQuick) {
          await this.sendPostTypePrompt(
            senderPhone,
            "⚠️ Opção inválida. Pra quantos produtos é o seu post hoje?",
            cwCtx
          );
        } else {
          await this.sendPostTypePrompt(
            senderPhone,
            "⚠️ Opção inválida. Como deseja apresentar o seu produto ou oferta?",
            cwCtx
          );
        }
        return true;
      }

      let selectedPostType = "produto";
      if (isType2) {
        selectedPostType = "combo";
      } else if (isType3) {
        selectedPostType = "promocao";
      } else if (isType4) {
        selectedPostType = "encarte";
      }

      if (isQuick) {
        session = await this.updateSession(contactId, cwCtx, {
          step: PostStep.INPUT_IMAGE,
          postType: selectedPostType,
          templateId: "food-promo",
          colors: null,
          productTitle: null,
          productPrice: null,
          productImage: null,
        });

        let fastMsg = "⚡ *Modo Post Rápido!*\n\n";
        fastMsg += "📸 **Envie a foto do produto** e escreva na legenda o **Nome** e **Preço**!\n\n";
        fastMsg += "• *Com preço:* Bolo de Cenoura R$ 15,00\n";
        fastMsg += "• *Sem preço (Desejo):* Bolo de Cenoura";
        await this.whatsappService.sendText(senderPhone, fastMsg, cwCtx);
        return true;
      } else {
        session = await this.updateSession(contactId, cwCtx, {
          step: PostStep.SELECT_TEMPLATE,
          postType: selectedPostType,
          templateId: null,
        });

        await this.sendTemplatesMenu(contactId, senderPhone, session.businessType, cwCtx);
        return true;
      }
    }

    // --- PASSO 4 (Custom): Seleção de Template ➔ Validação estrita ---
    if (session.step === PostStep.SELECT_TEMPLATE) {
      const category = getCategoryOrDefault(session.businessType);
      const index = parseInt(cleanText, 10);

      if (isNaN(index) || index < 1 || index > category.templates.length) {
        await this.whatsappService.sendText(
          senderPhone,
          `⚠️ Opção inválida. Por favor, escolha um número de template válido (de 1 a ${category.templates.length}).`,
          cwCtx
        );
        await this.sendTemplatesMenu(contactId, senderPhone, session.businessType, cwCtx);
        return true;
      }

      const selectedTemplate = category.templates[index - 1];
      if (!selectedTemplate) {
        return true;
      }

      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.INPUT_COLORS,
        templateId: selectedTemplate.id,
      });

      let colorsMsg = "🎨 *Cores do seu Post*\n\n";
      colorsMsg += `Template selecionado: *${selectedTemplate.title}*\n\n`;
      colorsMsg += "Quais são as **cores principais** que você deseja na sua arte?\n";
      colorsMsg += "Você pode digitar as cores (ex: *'Azul e Branco'*) ou os códigos hexadecimais.\n\n";
      colorsMsg += "💡 *Dica:* Se preferir que a IA defina as cores automaticamente, basta digitar *'pular'*!";

      await this.whatsappService.sendText(senderPhone, colorsMsg, cwCtx);
      return true;
    }

    // --- PASSO 5 (Custom): Digitação das Cores ➔ Vai direto para INPUT_IMAGE ---
    if (session.step === PostStep.INPUT_COLORS) {
      let savedColors: string | null = cleanText;
      const isSkip = ["pular", "deixar a ia escolher", "ia escolher", "padrao", "padrão", "não", "nao", "ignorar"].some((word) => cleanLower === word || cleanLower.includes(word));

      if (isSkip) {
        savedColors = null;
      }

      session = await this.updateSession(contactId, cwCtx, {
        step: PostStep.INPUT_IMAGE,
        colors: savedColors,
        productTitle: null,
        productPrice: null,
        productImage: null,
      });

      let imageMsg = "📸 *Foto do Produto*\n\n";
      if (savedColors) {
        imageMsg += `Cores escolhidas: *${savedColors}*\n\n`;
      } else {
        imageMsg += "Cores definidas: *Automáticas (IA)* 🎨\n\n";
      }
      imageMsg += "Por favor, me envie agora a *Foto do Produto* e escreva na legenda da foto o **Nome** e o **Preço** (você também pode incluir uma descrição ou contexto comercial do seu negócio!).\n\n";
      imageMsg += "💡 *Dica:* Se NÃO quiser mostrar o preço no post (*Post de Desejo*), digite apenas o Nome do Produto!\n\n";
      imageMsg += "• *Exemplo com Preço:* Bolo de Cenoura R$ 15,00\n";
      imageMsg += "• *Exemplo de Desejo:* Bolo de Cenoura\n";
      imageMsg += "• *Exemplo com Contexto:* Venha encomendar seu delicioso pudim na Padaria Pão Nosso\n\n";
      imageMsg += '_(Se preferir criar a arte do zero sem foto, digite *"pular"*)_';

      await this.whatsappService.sendText(senderPhone, imageMsg, cwCtx);
      return true;
    }

    // --- PASSO final (Rápido & Custom): Envio da Foto e Processamento ---
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
          await this.updateSession(contactId, cwCtx, {
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
      let extraContext: string | undefined = session.extraContext || undefined;

      const hasCaption = rawCaption.length > 0 && rawCaption !== "[Imagem]";

      if (hasCaption || !title || !price) {
        if (!hasCaption) {
          if (isNewImage) {
            let requestTextMsg = "📸 *Foto do Produto Recebida!*\n\n";
            requestTextMsg += "Por favor, digite o **Nome do Produto** (e o **Preço**, se desejar exibi-lo na arte).\n\n";
            requestTextMsg += "💡 *Dica:* Para criar um *Post de Desejo* (sem preço), digite apenas o Nome do Produto!";

            await this.whatsappService.sendText(senderPhone, requestTextMsg, cwCtx);
            return true;
          }

          if (this.isTriggerMessage(cleanText, true)) {
            let promptMsg = "📸 *Foto do Produto*\n\n";
            promptMsg += "Por favor, envie a *foto do produto* no chat com a legenda contendo o Nome (e o Preço, se houver).\n\n";
            promptMsg += "💡 *Dica:* Se NÃO quiser preço no post (*Post de Desejo*), digite apenas o Nome do Produto!\n";
            promptMsg += '_(Ou digite *"pular"* se quiser criar o post sem foto)_';

            await this.whatsappService.sendText(senderPhone, promptMsg, cwCtx);
            return true;
          }
        } else {
          let extractedData: { title: string; price: string; extraContext?: string };
          if (this.aiService) {
            extractedData = await this.aiService.extractTitleAndPrice(rawCaption);
          } else {
            extractedData = parseTitleAndPriceRegex(rawCaption);
          }

          title = extractedData.title;
          price = extractedData.price;
          extraContext = extractedData.extraContext || rawCaption;
        }
      }

      const nichoDisplay = getNichoDisplayName(session.businessType);
      const postTypeDisplay = getPostTypeDisplayName(session.postType);

      await this.updateSession(contactId, cwCtx, {
        step: PostStep.GENERATING,
        productTitle: title,
        productPrice: price,
        productImage: base64Image,
        ...(extraContext && { extraContext }),
      });

      const isWish = !price || price === "Consulte" || price.toLowerCase().includes("desejo") || price.toLowerCase().includes("sem preço");

      let confirmMsg = "Recebido! ⚙️\n\n";
      confirmMsg += `🏷️ *Produto:* ${title}\n`;
      confirmMsg += isWish ? `✨ *Tipo:* Post de Desejo\n` : `💰 *Preço:* ${price}\n`;
      if (extraContext) confirmMsg += `📝 *Contexto:* ${extraContext}\n`;
      confirmMsg += "\n⚡ *Criando sua arte em menos de 60s...*";

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
    let templateId = session?.templateId;
    const productTitle = session?.productTitle || "Vestido Linho Verde";
    const productPrice = session?.productPrice || "R$ 149,90";
    const productImage = session?.productImage || null;

    // Se for Post Rápido ou se não houve seleção manual de template no menu customizado, escolhe o melhor template dinamicamente
    const isFastPost = !session?.step || session.step === PostStep.INPUT_IMAGE || templateId === "food-promo" || templateId === "quick" || templateId === "luxury-single-oval-light" || !templateId;
    if (isFastPost) {
      if (category.id === "moda") {
        const titleLower = productTitle.toLowerCase();

        if (session?.modelProfile === "kids" || titleLower.includes("infantil") || titleLower.includes("criança") || titleLower.includes("bebê") || titleLower.includes("kids")) {
          templateId = "kids";
        } else if (session?.hasHumanModel) {
          if (session?.modelProfile === "man") {
            templateId = "dark-fashion"; // Masculino: Dark Fashion
          } else {
            templateId = "fashion"; // Feminino: Fashion (Zara style)
          }
        } else {
          // Post Rápido de moda sem modelo de IA (usando foto original):
          // Alterna aleatoriamente entre os dois templates principais de moda: "fashion" e "dark-fashion"
          const fashionTemplates = ["fashion", "dark-fashion"];
          templateId = fashionTemplates[Math.floor(Math.random() * fashionTemplates.length)];
        }
      } else if (category.id === "gastronomia") {
        const titleLower = productTitle.toLowerCase();
        if (titleLower.includes("pão") || titleLower.includes("pao") || titleLower.includes("artesanal") || titleLower.includes("doce") || titleLower.includes("bolo")) {
          templateId = "bakery-spotlight"; // Acolhedor/rústico/madeira
        } else {
          templateId = "food-promo"; // Escuro texturizado/apetitoso
        }
      } else if (category.id === "promocao" || category.id === "varejo") {
        const titleLower = productTitle.toLowerCase();
        if (titleLower.includes("horta") || titleLower.includes("fruta") || titleLower.includes("verdura") || titleLower.includes("feirinha") || titleLower.includes("alface") || titleLower.includes("legume")) {
          templateId = "grocery-color-block-spotlight"; // Hortifruti color block
        } else {
          templateId = "quick-offer"; // Clean retail
        }
      }

      // Salva o template ID de fato resolvido no banco para que o "Gerar Novamente" saiba de onde rotacionar
      await this.updateSession(contactId, cwCtx, {
        step: session?.step || PostStep.SELECT_FLOW_MODE,
        templateId: templateId || null,
      });
      if (session) {
        session.templateId = templateId || null;
      }
    }

    const template = getTemplateOrDefault(category, templateId);

    if (!userProfile && this.supabaseProfileService) {
      const auth = await this.supabaseProfileService.getProfileByPhone(senderPhone);
      if (auth.profile) {
        userProfile = auth.profile;
        console.log(`[PostFlowService] Perfil do Supabase obtido no momento da geração para ${senderPhone}. Instagram: "${userProfile.instagramProfile}"`);
      }
    }

    if (userProfile && typeof userProfile.credits === "number" && userProfile.credits <= 0) {
      console.warn(`[PostFlowService] Usuário ${senderPhone} tentou gerar arte sem créditos suficientes (saldo: ${userProfile.credits}).`);

      const noCreditsMsg = userProfile.isTrial
        ? "⚠️ *Seus 3 testes grátis acabaram!* 🚀\n\nGostou do resultado? 🔥\n\nPara continuar criando artes ilimitadas com o Promto, fale com nosso suporte e escolha seu plano! 💳✨"
        : "⚠️ *Seus créditos de geração de artes acabaram!*\n\nEntre em contato com o suporte para renovar seu plano e continuar criando artes incríveis em segundos! 🚀";

      await this.whatsappService.sendText(senderPhone, noCreditsMsg, cwCtx);
      return;
    }

    let success = false;
    let typingInterval: NodeJS.Timeout | null = null;

    if (cwCtx) {
      this.whatsappService.sendTypingIndicator(senderPhone, cwCtx).catch(() => { });
      typingInterval = setInterval(() => {
        this.whatsappService.sendTypingIndicator(senderPhone, cwCtx).catch(() => { });
      }, 5000);
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
        colors: session?.colors,
        extraContext: session?.extraContext,
      });

      await this.whatsappService.sendImage(
        senderPhone,
        result.imageUrl,
        `🖼️ *Arte gerada para ${productTitle}!*`,
        cwCtx
      );

      // Deduz o crédito do usuário após a geração de sucesso
      if (userProfile?.id && typeof userProfile.credits === "number" && this.supabaseProfileService) {
        try {
          const newCredits = await this.supabaseProfileService.deductCredit(userProfile.id, userProfile.credits, userProfile.isTrial);
          userProfile.credits = newCredits;
        } catch (creditErr) {
          console.error(`[PostFlowService] Erro ao deduzir crédito para o usuário ${senderPhone}:`, creditErr);
        }
      }

      // Delay de 3.5 segundos para garantir que a imagem seja entregue/renderizada antes do texto no celular do usuário
      await new Promise((resolve) => setTimeout(resolve, 3500));

      const sanitizedTitle = productTitle.replace(/[^\w\s]/gi, "").replace(/\s+/g, "");
      const nichoHashtag = category.id === "gastronomia" ? "Padaria #Gastronomia" : category.id === "moda" ? "Moda #Fashion" : "Promocao #Varejo";
      const isWishDelivery = !productPrice || productPrice === "Consulte" || productPrice.toLowerCase().includes("desejo") || productPrice.toLowerCase().includes("sem preço");

      let finalDeliveryMsg = "Sua arte tá pronta! 🔥\n\n";
      finalDeliveryMsg += "📝 *Sugestão de legenda:*\n\n";
      if (isWishDelivery) {
        finalDeliveryMsg += `"Saindo quentinho por aqui! Venha garantir o seu ${productTitle}. Clique no link da bio ou chame no WhatsApp e peça o seu! 😋 #${nichoHashtag} #${sanitizedTitle}"\n\n`;
      } else {
        finalDeliveryMsg += `"Saindo quentinho por aqui! Venha garantir o seu ${productTitle} por apenas ${productPrice}. 😋 #${nichoHashtag} #${sanitizedTitle}"\n\n`;
      }

      if (userProfile && typeof userProfile.credits === "number") {
        finalDeliveryMsg += userProfile.isTrial
          ? `💳 *Testes restantes:* ${userProfile.credits} de 3\n\n`
          : `💳 *Créditos disponíveis:* ${userProfile.credits} post(s)\n\n`;
      }

      finalDeliveryMsg += "Escolha uma das opções abaixo para prosseguir:";

      const buttons = [
        { id: "gerar_novamente", title: "🔄 Gerar Novamente" },
        { id: "novo_post", title: "➕ Novo Post" },
        { id: "alterar_nicho", title: "📁 Alterar Nicho" },
      ];

      await this.whatsappService.sendButtons(senderPhone, finalDeliveryMsg, buttons, cwCtx);

      console.log(`[PostFlowService] Fluxo completo concluído com SUCESSO para ${senderPhone}`);
      success = true;
    } catch (error) {
      console.error(`[PostFlowService] Erro ao gerar arte final:`, error);
      await this.whatsappService.sendText(
        senderPhone,
        "❌ Ocorreu uma falha ao gerar a arte. Por favor, digite 'novo post' para reiniciar o fluxo!",
        cwCtx
      );
    } finally {
      if (typingInterval) {
        clearInterval(typingInterval);
      }
      if (cwCtx) {
        this.whatsappService.stopTypingIndicator(senderPhone, cwCtx).catch(() => { });
      }

      // Redefine apenas o step preservando as informações para possibilitar o "Gerar Novamente"
      await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_FLOW_MODE,
        ...(success && {
          lastPostGeneratedAt: new Date(),
          lastRecoverySentAt: null,
          lastRetentionSentAt: null,
          lastWeeklySentAt: null,
        }),
      });
    }
  }
}
