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
 * Utilitário para baixar imagem a partir de uma URL remota (ex: anexos do Chatwoot) e converter em Base64 Data URL
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

export class PostFlowService {
  constructor(
    private readonly postSessionRepository: PostSessionRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly postGeneratorService: PostGeneratorService,
    private readonly aiService?: AIService
  ) {}

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

    // Se NÃO houver sessão criada, saudações e comandos iniciais também disparam a primeira interação
    if (!hasActiveSession) {
      const initialTriggers = ["olá", "ola", "oi", "iniciar", "1", "post"];
      return initialTriggers.some((t) => clean === t || clean.startsWith(t));
    }

    return false;
  }

  /**
   * Orquestra o fluxo duplo (Post Rápido vs Post Personalizado) e alteração de nicho
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

    // 1. Buscar a sessão ativa para este contato
    let session = await this.postSessionRepository.findByContactId(contactId);
    const hasSession = Boolean(session);
    const isTrigger = this.isTriggerMessage(cleanText, hasSession);

    // Tratar comando de cancelamento a qualquer momento
    if (session && (cleanLower === "cancelar" || cleanLower === "sair" || cleanLower === "parar")) {
      await this.postSessionRepository.deleteByContactId(contactId);
      await this.whatsappService.sendText(
        senderPhone,
        "❌ *Fluxo de criação de post cancelado.*\n\nComo posso te ajudar agora?",
        cwCtx
      );
      return true;
    }

    // --- COMANDO DE ALTERAR NICHO ---
    if (this.isNichoChangeCommand(cleanText)) {
      session = await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_BUSINESS_TYPE,
      });

      let changeNichoMsg = "🔄 *Alterar Segmento / Nicho do Negócio*\n\n";
      changeNichoMsg += "Para qual segmento você deseja alterar a sua conta?\n\n";
      changeNichoMsg += "1️⃣ Padaria / Alimentação / Café\n";
      changeNichoMsg += "2️⃣ Loja de Roupas / Moda\n";
      changeNichoMsg += "3️⃣ Varejo / Mercadinho / Utilidades\n";
      changeNichoMsg += "4️⃣ Outro";

      await this.whatsappService.sendText(senderPhone, changeNichoMsg, cwCtx);
      return true;
    }

    // --- GATILHO INICIAL OU COMANDO DE NOVO POST: Apresenta as opções de fluxo ---
    if (!session || isTrigger) {
      if (!session && !isTrigger) {
        return false; // Não é gatilho e não há sessão, segue para atendimento conversacional normal
      }

      // Reinicia a sessão na etapa SELECT_FLOW_MODE mantendo o nicho salvo se já existir
      session = await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_FLOW_MODE,
        businessType: session?.businessType ?? null,
        hasHumanModel: session?.hasHumanModel ?? null,
        modelProfile: session?.modelProfile ?? null,
        productTitle: null,
        productPrice: null,
        productImage: null,
        templateId: null,
      });

      let modeMsg = "Como você deseja criar o seu post hoje? 🚀\n\n";
      modeMsg += "1️⃣ *Post Rápido* (Envie 1 foto com Nome e Preço na legenda e a IA cria a arte na hora!)\n\n";
      modeMsg += "2️⃣ *Post Personalizado* (Escolha o nicho e selecione o modelo/template visual do post)";

      await this.whatsappService.sendText(senderPhone, modeMsg, cwCtx);
      return true;
    }

    // --- ETAPA: Processar Seleção do Modo de Criação ---
    if (session.step === PostStep.SELECT_FLOW_MODE) {
      if (cleanText === "1" || cleanLower.includes("rapido") || cleanLower.includes("rápido")) {
        // MODO 1: POST RÁPIDO
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.INPUT_IMAGE,
          templateId: session.templateId || "food-promo",
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
          // Se o nicho ainda não foi configurado, pede o nicho
          await this.postSessionRepository.createOrUpdate(contactId, {
            step: PostStep.SELECT_BUSINESS_TYPE,
          });

          let welcomeMsg = "🎨 *Modo Post Personalizado*\n\n";
          welcomeMsg += "Para eu ajustar os modelos para a sua marca, qual é o seu segmento/nicho?\n\n";
          welcomeMsg += "1️⃣ Padaria / Alimentação / Café\n";
          welcomeMsg += "2️⃣ Loja de Roupas / Moda\n";
          welcomeMsg += "3️⃣ Varejo / Mercadinho / Utilidades\n";
          welcomeMsg += "4️⃣ Outro";

          await this.whatsappService.sendText(senderPhone, welcomeMsg, cwCtx);
          return true;
        } else {
          // Se o nicho já foi configurado, exibe os templates do nicho diretamente
          await this.postSessionRepository.createOrUpdate(contactId, {
            step: PostStep.SELECT_TEMPLATE,
          });

          await this.sendTemplatesMenu(contactId, senderPhone, session.businessType, cwCtx);
          return true;
        }
      }

      // Escolha inválida no menu de modo
      let retryMsg = "⚠️ *Opção inválida.*\n\nPor favor, digite:\n1️⃣ para *Post Rápido*\n2️⃣ para *Post Personalizado*";
      await this.whatsappService.sendText(senderPhone, retryMsg, cwCtx);
      return true;
    }

    // --- ETAPA: Seleção ou Alteração de Nicho ---
    if (session.step === PostStep.SELECT_BUSINESS_TYPE) {
      let selectedBusinessType = "gastronomia";

      if (cleanText === "2" || cleanLower.includes("moda") || cleanLower.includes("roupa")) {
        selectedBusinessType = "moda";
      } else if (cleanText === "3" || cleanLower.includes("varejo") || cleanLower.includes("mercadinho")) {
        selectedBusinessType = "promocao";
      } else if (cleanText === "4" || cleanLower.includes("outro")) {
        selectedBusinessType = "geral";
      } else if (cleanText === "1" || cleanLower.includes("padaria") || cleanLower.includes("alimentacao") || cleanLower.includes("alimentação")) {
        selectedBusinessType = "gastronomia";
      }

      // SE FOR NICHO DE MODA: Pergunta chave de apresentação das peças (Foto Real vs Modelo Virtual)
      if (selectedBusinessType === "moda") {
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.SELECT_FASHION_PRESENTATION,
          businessType: "moda",
        });

        let fashionPresentationMsg = "Perfeito! Como você quer a apresentação das suas peças de roupa?\n\n";
        fashionPresentationMsg += "1️⃣ Foto Real do Produto (No cabide, na arara ou mesa)\n\n";
        fashionPresentationMsg += "2️⃣ Aplicar Modelo Virtual (A IA veste a roupa em uma modelo)";

        await this.whatsappService.sendText(senderPhone, fashionPresentationMsg, cwCtx);
        return true;
      }

      const nichoDisplay = getNichoDisplayName(selectedBusinessType);

      // Atualiza o novo nicho na sessão e avança para a seleção de modo
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_FLOW_MODE,
        businessType: selectedBusinessType,
        hasHumanModel: false,
        modelProfile: null,
      });

      let confirmMsg = `✅ *Nicho atualizado para ${nichoDisplay}!*\n\n`;
      confirmMsg += "Como você deseja criar o seu post hoje? 🚀\n\n";
      confirmMsg += "1️⃣ *Post Rápido* (Envie 1 foto com Nome e Preço na legenda e a IA cria a arte na hora!)\n\n";
      confirmMsg += "2️⃣ *Post Personalizado* (Escolha o modelo/template visual do post)";

      await this.whatsappService.sendText(senderPhone, confirmMsg, cwCtx);
      return true;
    }

    // --- ETAPA MODA 2: Escolha entre Foto Real vs Modelo Virtual ---
    if (session.step === PostStep.SELECT_FASHION_PRESENTATION) {
      if (cleanText === "2" || cleanLower.includes("modelo") || cleanLower.includes("virtual") || cleanLower.includes("ia")) {
        // ESCOLHEU MODELO VIRTUAL: Pergunta quem vai vestir (Mulher Adulta, Homem Adulto, Criança)
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.SELECT_FASHION_MODEL,
          hasHumanModel: true,
        });

        let fashionModelMsg = "Show! Escolha quem vai vestir a peça:\n\n";
        fashionModelMsg += "👩 1️⃣ Mulher Adulta\n\n";
        fashionModelMsg += "👨 2️⃣ Homem Adulto\n\n";
        fashionModelMsg += "🧒 3️⃣ Criança / Infantil";

        await this.whatsappService.sendText(senderPhone, fashionModelMsg, cwCtx);
        return true;
      } else {
        // ESCOLHEU FOTO REAL (Opção 1)
        await this.postSessionRepository.createOrUpdate(contactId, {
          step: PostStep.SELECT_FLOW_MODE,
          hasHumanModel: false,
          modelProfile: null,
        });

        let confirmMsg = "Perfeito! Nicho de Moda (Foto Real) configurado! 👗 (Salvo para os próximos posts)\n\n";
        confirmMsg += "Como você deseja criar o seu post hoje? 🚀\n\n";
        confirmMsg += "1️⃣ *Post Rápido* (Envie 1 foto com Nome e Preço na legenda e a IA cria a arte na hora!)\n\n";
        confirmMsg += "2️⃣ *Post Personalizado* (Escolha o modelo/template visual do post)";

        await this.whatsappService.sendText(senderPhone, confirmMsg, cwCtx);
        return true;
      }
    }

    // --- ETAPA MODA 3: Escolha do Perfil do Modelo Virtual (1. Mulher Adulta, 2. Homem Adulto, 3. Criança) ---
    if (session.step === PostStep.SELECT_FASHION_MODEL) {
      let selectedModelProfile = "woman";
      let modelDisplay = "Mulher Adulta";

      if (cleanText === "2" || cleanLower.includes("homem") || cleanLower.includes("masculino")) {
        selectedModelProfile = "man";
        modelDisplay = "Homem Adulto";
      } else if (cleanText === "3" || cleanLower.includes("crianca") || cleanLower.includes("criança") || cleanLower.includes("infantil") || cleanLower.includes("kids")) {
        selectedModelProfile = "kids";
        modelDisplay = "Criança / Infantil";
      } else {
        selectedModelProfile = "woman"; // 1 ou padrão
        modelDisplay = "Mulher Adulta";
      }

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_FLOW_MODE,
        hasHumanModel: true,
        modelProfile: selectedModelProfile,
      });

      let confirmMsg = `Perfeito! Nicho de Moda com Modelo Virtual (${modelDisplay}) configurado! 👗 (Salvo para os próximos posts)\n\n`;
      confirmMsg += "Como você deseja criar o seu post hoje? 🚀\n\n";
      confirmMsg += "1️⃣ *Post Rápido* (Envie 1 foto com Nome e Preço na legenda e a IA cria a arte na hora!)\n\n";
      confirmMsg += "2️⃣ *Post Personalizado* (Escolha o modelo/template visual do post)";

      await this.whatsappService.sendText(senderPhone, confirmMsg, cwCtx);
      return true;
    }

    // --- ETAPA: Seleção de Template (Post Personalizado) ---
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
      titleMsg += `Template selecionado: *${selectedTemplate.title}*\n\n`;
      titleMsg += "Por favor, digite o *Título do Produto* que vai aparecer na arte:\n";
      titleMsg += "_(Exemplo: Hambúrguer Artesanal Duplo ou Camisa Oversized)_";

      await this.whatsappService.sendText(senderPhone, titleMsg, cwCtx);
      return true;
    }

    // --- ETAPA: Digitação do Título (Post Personalizado) ---
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

    // --- ETAPA: Digitação do Valor (Post Personalizado) ---
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

    // --- ETAPA: Envio da Foto e Processamento (Post Rápido ou Personalizado) ---
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

      // Se já possui título e preço definidos pelo fluxo Personalizado
      let title = session.productTitle;
      let price = session.productPrice;

      // Se NÃO possui título e preço (Post Rápido), extrai da legenda via IA
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

      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.GENERATING,
        productTitle: title,
        productPrice: price,
        productImage: base64Image,
      });

      let confirmMsg = "Recebido! 🧀\n\n";
      confirmMsg += "Identifiquei:\n";
      confirmMsg += `🏷️ *Produto:* ${title}\n`;
      confirmMsg += `💰 *Preço:* ${price}\n\n`;
      confirmMsg += `Aplicando o template do nicho de ${nichoDisplay} e gerando a arte... ⚙️`;

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

  /**
   * Envia a imagem do guia visual e o menu de templates do nicho
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

    let templateMenu = `✨ *Templates para ${category.name}* ✨\n\n`;
    templateMenu += "Escolha o estilo do template para sua arte:\n\n";

    category.templates.forEach((tmpl, index) => {
      templateMenu += `*${index + 1}* - *${tmpl.title}*\n   _${tmpl.description}_\n\n`;
    });

    templateMenu += "*(Digite o número do template escolhido)*";

    await this.whatsappService.sendText(senderPhone, templateMenu, cwCtx);
  }

  /**
   * ETAPA 5: Entrega da Arte + Sugestão de Legenda para Instagram + Menu de Retenção
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

    try {
      console.log(`[PostFlowService] Gerando arte para ${senderPhone} (Nicho: ${category.name} | Produto: ${productTitle} | Modelo Virtual: ${session?.hasHumanModel})...`);

      const result = await this.postGeneratorService.generatePostImage({
        businessType: category.id,
        templateId: template.id,
        productTitle,
        productPrice,
        hasHumanModel: session?.hasHumanModel,
        humanModelGender: session?.modelProfile,
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
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_FLOW_MODE,
        businessType: session?.businessType ?? null,
        hasHumanModel: session?.hasHumanModel ?? null,
        modelProfile: session?.modelProfile ?? null,
      });
    }
  }
}
