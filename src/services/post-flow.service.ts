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
  ) {}

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
      "agora nao",
      "agora não",
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
          "Olá! 🚀 Bem-vindo ao Gerador de Posts kel-IA!\n\nQual é o segmento/nicho do seu negócio?",
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

        let fastMsg = "⚡ *Modo Post Rápido Ativado!*\n\n";
        fastMsg += "Por favor, me envie agora a *Foto do Produto* e escreva na legenda da foto o **Nome** e o **Preço**.\n\n";
        fastMsg += "💡 *Exemplo:* Vestido Linho R$ 149,90";
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
      imageMsg += "Por favor, me envie agora a *Foto do Produto* e escreva na legenda da foto o **Nome** e o **Preço**.\n\n";
      imageMsg += "💡 *Exemplo:* Vestido Linho R$ 149,90\n\n";
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

      if (!title || !price) {
        const hasCaption = rawCaption.length > 0 && rawCaption !== "[Imagem]";

        if (!hasCaption) {
          if (isNewImage) {
            let requestTextMsg = "📸 *Foto do Produto Recebida!*\n\n";
            requestTextMsg += "Por favor, digite o **Nome do Produto** e o **Preço** para adicionarmos na arte.\n\n";
            requestTextMsg += "💡 *Exemplo:* Vestido Linho R$ 149,90";

            await this.whatsappService.sendText(senderPhone, requestTextMsg, cwCtx);
            return true;
          }

          if (this.isTriggerMessage(cleanText, true)) {
            let promptMsg = "📸 *Foto do Produto*\n\n";
            promptMsg += "Por favor, envie a *foto do produto* no chat com a legenda contendo o Nome e o Preço.\n\n";
            promptMsg += "💡 *Exemplo:* Vestido Linho R$ 149,90\n";
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

      await this.updateSession(contactId, cwCtx, {
        step: PostStep.GENERATING,
        productTitle: title,
        productPrice: price,
        productImage: base64Image,
      });

      let confirmMsg = "Recebido! 🧀\n\n";
      confirmMsg += "Identifiquei:\n";
      confirmMsg += `🏷️ *Produto:* ${title}\n`;
      confirmMsg += `💰 *Preço:* ${price}\n`;
      confirmMsg += `📌 *Tipo de Post:* ${postTypeDisplay}\n`;
      if (session.colors) {
        confirmMsg += `🎨 *Cores:* ${session.colors}\n`;
      }
      confirmMsg += "\n⚡ *Nossa IA de alta precisão está criando seu design do zero. Em menos de 60 segundos você terá uma arte que levaria 1 hora no Canva!* ⚙️";

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

    // Se for Post Rápido (usando placeholder "food-promo" ou sem template definido), escolhe o melhor template dinamicamente
    if (templateId === "food-promo" || !templateId) {
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
        } else if (titleLower.includes("florido") || titleLower.includes("vestido") || titleLower.includes("saia") || titleLower.includes("estampado") || titleLower.includes("leve") || titleLower.includes("linho") || titleLower.includes("seda") || titleLower.includes("floral") || titleLower.includes("colorido")) {
          templateId = "luxury-single-oval-light"; // Light, elegant off-white/creme
        } else if (titleLower.includes("streetwear") || titleLower.includes("moletom") || titleLower.includes("jaqueta") || titleLower.includes("tênis") || titleLower.includes("tenis") || titleLower.includes("boné") || titleLower.includes("bone")) {
          templateId = "streetwear"; // Streetwear style
        } else {
          templateId = "fashion"; // Zara minimal, light/clean fashion template
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
    }

    const template = getTemplateOrDefault(category, templateId);

    if (!userProfile && this.supabaseProfileService) {
      const auth = await this.supabaseProfileService.getProfileByPhone(senderPhone);
      if (auth.profile) {
        userProfile = auth.profile;
        console.log(`[PostFlowService] Perfil do Supabase obtido no momento da geração para ${senderPhone}. Instagram: "${userProfile.instagramProfile}"`);
      }
    }

    let success = false;
    let typingInterval: NodeJS.Timeout | null = null;

    if (cwCtx) {
      this.whatsappService.sendTypingIndicator(senderPhone, cwCtx).catch(() => {});
      typingInterval = setInterval(() => {
        this.whatsappService.sendTypingIndicator(senderPhone, cwCtx).catch(() => {});
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

      if (userProfile && typeof userProfile.credits === "number") {
        finalDeliveryMsg += `💳 *Créditos disponíveis:* ${userProfile.credits} post(s)\n\n`;
      }

      finalDeliveryMsg += "🔄 Digite *'novo post'* para criar outra arte ou altere o nicho com *'alterar nicho'*!";

      await this.whatsappService.sendText(senderPhone, finalDeliveryMsg, cwCtx);

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
        this.whatsappService.stopTypingIndicator(senderPhone, cwCtx).catch(() => {});
      }

      // Limpa os dados temporários e redefine preservando o Nicho salvo
      await this.updateSession(contactId, cwCtx, {
        step: PostStep.SELECT_FLOW_MODE,
        postType: null,
        templateId: null,
        colors: null,
        productTitle: null,
        productPrice: null,
        productImage: null,
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
