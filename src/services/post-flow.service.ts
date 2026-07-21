import fs from "fs";
import path from "path";
import axios from "axios";
import { PostSessionRepository } from "../repositories/post-session.repository.js";
import { WhatsAppService } from "./whatsapp.service.js";
import { PostGeneratorService } from "./post-generator.service.js";
import {
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

/**
 * Mapeia a opção escolhida na Etapa 2 (1 a 4) para o ID do template no nicho selecionado
 */
function mapOptionToTemplateId(businessType: string, optionInput: string): string {
  const num = parseInt(optionInput, 10);

  if (businessType === "gastronomia") {
    if (num === 2) return "retail-bakery-offers";
    if (num === 3) return "bakery-red-impact";
    if (num === 4) return "bakery-split-diagonal";
    return "food-promo"; // 1 ou padrão
  }

  if (businessType === "moda") {
    if (num === 2) return "fashion-combo-pinwheel";
    if (num === 3) return "fashion-botanical-discount";
    if (num === 4) return "fashion-duo-spotlight-light";
    return "dark-fashion"; // 1 ou padrão
  }

  if (businessType === "promocao") {
    if (num === 2) return "grocery-tabloid-grid";
    if (num === 3) return "flash-offer-carnivora";
    if (num === 4) return "retail-impact";
    return "quick-offer"; // 1 ou padrão
  }

  // Geral
  if (num === 2) return "moderno";
  if (num === 3) return "elegante";
  return "minimalista";
}

export class PostFlowService {
  constructor(
    private readonly postSessionRepository: PostSessionRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly postGeneratorService: PostGeneratorService,
    private readonly aiService?: AIService
  ) {}

  /**
   * Verifica se a mensagem de entrada é um gatilho para iniciar a criação de um novo post
   */
  isTriggerMessage(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const triggers = [
      "olá",
      "ola",
      "oi",
      "novo post",
      "criar post",
      "gerar post",
      "fazer post",
      "post",
      "1",
      "iniciar",
      "menu",
    ];
    return triggers.some((t) => clean === t || clean.startsWith(t));
  }

  /**
   * Orquestra o fluxo interativo em 5 etapas para geração ágil de posts
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

    // Tratar comando de cancelamento
    if (session && (cleanLower === "cancelar" || cleanLower === "sair" || cleanLower === "parar")) {
      await this.postSessionRepository.deleteByContactId(contactId);
      await this.whatsappService.sendText(
        senderPhone,
        "❌ *Fluxo de criação de post cancelado.*\n\nComo posso te ajudar agora?",
        cwCtx
      );
      return true;
    }

    // --- ETAPA 1: Boas-vindas e Escolha do Nicho (Apenas quando não houver sessão criada) ---
    if (!session) {
      if (!this.isTriggerMessage(cleanText)) {
        return false; // Não é gatilho, segue para atendimento conversacional padrão
      }

      // Cria a sessão na Etapa 1: Seleção de Nicho
      session = await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_BUSINESS_TYPE,
      });

      let welcomeMsg = "Seja bem-vindo ao PostGen! 🚀\n\n";
      welcomeMsg += "Vou te ajudar a criar artes profissionais para o seu negócio em segundos.\n\n";
      welcomeMsg += "Para eu ajustar os modelos para a sua marca, qual é o seu segmento/nicho?\n\n";
      welcomeMsg += "1️⃣ Padaria / Alimentação / Café\n";
      welcomeMsg += "2️⃣ Loja de Roupas / Moda\n";
      welcomeMsg += "3️⃣ Varejo / Mercadinho / Utilidades\n";
      welcomeMsg += "4️⃣ Outro";

      await this.whatsappService.sendText(senderPhone, welcomeMsg, cwCtx);
      return true;
    }

    // --- ETAPA 2: Confirmação do Nicho e Escolha do Tipo de Post ---
    if (session.step === PostStep.SELECT_BUSINESS_TYPE) {
      let selectedBusinessType = session.businessType || "gastronomia";

      if (cleanText === "2" || cleanLower.includes("moda") || cleanLower.includes("roupa")) {
        selectedBusinessType = "moda";
      } else if (cleanText === "3" || cleanLower.includes("varejo") || cleanLower.includes("mercadinho")) {
        selectedBusinessType = "promocao";
      } else if (cleanText === "4" || cleanLower.includes("outro")) {
        selectedBusinessType = "geral";
      } else if (cleanText === "1" || cleanLower.includes("padaria") || cleanLower.includes("alimentacao") || cleanLower.includes("alimentação")) {
        selectedBusinessType = "gastronomia";
      }

      const nichoDisplay = getNichoDisplayName(selectedBusinessType);

      // Atualiza sessão com o nicho configurado e avança para SELECT_TEMPLATE
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_TEMPLATE,
        businessType: selectedBusinessType,
      });

      let postTypeMsg = `Perfeito! Nicho de ${nichoDisplay} configurado! 🥐☕ (Salvo para os próximos posts)\n\n`;
      postTypeMsg += "O que você quer criar hoje? Digite o número:\n\n";
      postTypeMsg += "1️⃣ Post de 1 Produto (1 Foto + Nome + Preço)\n";
      postTypeMsg += "2️⃣ Combo / Lanche (2 Fotos + Preço)\n";
      postTypeMsg += "3️⃣ Promoção De/Por (1 Foto + Preço Antigo e Novo)\n";
      postTypeMsg += "4️⃣ Encarte da Semana (3 Produtos + Áudio/Texto)";

      await this.whatsappService.sendText(senderPhone, postTypeMsg, cwCtx);
      return true;
    }

    // --- ETAPA 3: Instrução do Envio (Agilidade) ---
    if (session.step === PostStep.SELECT_TEMPLATE) {
      const templateId = mapOptionToTemplateId(session.businessType || "gastronomia", cleanText);

      // Salva o templateId e avança para aguardar o envio da foto e legenda
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.INPUT_IMAGE,
        templateId,
      });

      let instructionMsg = "Show! Me envie a foto do produto e escreva na legenda da própria foto o Nome e o Preço.\n\n";
      instructionMsg += "💡 *Exemplo:* Bolo de Cenoura R$ 12,00";

      await this.whatsappService.sendText(senderPhone, instructionMsg, cwCtx);
      return true;
    }

    // --- ETAPA 4: Envio pelo Cliente e Processamento ---
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

        // Salva a imagem na sessão para ser usada se o usuário mandar o título/preço na mensagem seguinte
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

      // Verificar se a mensagem possui uma legenda ou texto descritivo real
      const hasCaption = rawCaption.length > 0 && rawCaption !== "[Imagem]";

      // Caso o usuário tenha enviado a FOTO sem legenda
      if (!hasCaption) {
        if (isNewImage) {
          let requestTextMsg = "📸 *Foto do Produto Recebida!*\n\n";
          requestTextMsg += "Para garantirmos uma arte incrível e sem erros, por favor digite o **Nome do Produto** e o **Preço**.\n\n";
          requestTextMsg += "💡 *Exemplo:* Bolo de Cenoura R$ 12,00";

          await this.whatsappService.sendText(senderPhone, requestTextMsg, cwCtx);
          return true;
        }

        if (this.isTriggerMessage(cleanText)) {
          let promptMsg = "📸 *Foto do Produto*\n\n";
          promptMsg += "Por favor, envie a *foto do produto* no chat com a legenda contendo o Nome e o Preço.\n\n";
          promptMsg += "💡 *Exemplo:* Bolo de Cenoura R$ 12,00\n";
          promptMsg += '_(Ou digite *"pular"* se quiser criar o post sem foto)_';

          await this.whatsappService.sendText(senderPhone, promptMsg, cwCtx);
          return true;
        }
      }

      // Extrai Nome e Preço da legenda enviada na foto ou no texto seguinte
      let extractedData: { title: string; price: string };
      if (this.aiService) {
        extractedData = await this.aiService.extractTitleAndPrice(rawCaption);
      } else {
        extractedData = parseTitleAndPriceRegex(rawCaption);
      }

      const { title, price } = extractedData;
      const nichoDisplay = getNichoDisplayName(session.businessType);

      // Salva dados e avança para a geração da arte
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

      // Dispara a geração da imagem e a entrega final
      await this.generatePostAndSend(contactId, senderPhone, userProfile, cwCtx);
      return true;
    }

    // Se a sessão estiver em estado GENERATING e o usuário enviar uma nova mensagem
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
    const productTitle = session?.productTitle || "Pão de Queijo Recheado";
    const productPrice = session?.productPrice || "R$ 6,50";
    const productImage = session?.productImage || null;

    try {
      console.log(`[PostFlowService] Gerando arte para ${senderPhone} (Nicho: ${category.name} | Produto: ${productTitle})...`);

      const result = await this.postGeneratorService.generatePostImage({
        businessType: category.id,
        templateId: template.id,
        productTitle,
        productPrice,
        productImage,
        userProfile,
      });

      // 1. Enviar a imagem do post pronta via WhatsApp / Chatwoot
      await this.whatsappService.sendImage(
        senderPhone,
        result.imageUrl,
        `🖼️ *Arte gerada para ${productTitle}!*`,
        cwCtx
      );

      // 2. Enviar a sugestão de legenda para o Instagram + Opções de retenção (Etapa 5)
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
      // Manter o nicho salvo na sessão do contato e redefinir o passo para a Etapa 2
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_TEMPLATE,
        businessType: session?.businessType ?? null,
      });
    }
  }
}
