import fs from "fs";
import path from "path";
import { PostSessionRepository } from "../repositories/post-session.repository.js";
import { WhatsAppService } from "./whatsapp.service.js";
import { PostGeneratorService } from "./post-generator.service.js";
import {
  BUSINESS_CATEGORIES,
  findCategoryByIndexOrId,
  findTemplateByIndexOrId,
  getCategoryOrDefault,
  getTemplateOrDefault,
} from "../config/templates.config.js";
import { PostStep } from "@prisma/client";
import type { IncomingMessageDTO } from "../dto/incoming-message.dto.js";

export class PostFlowService {
  constructor(
    private readonly postSessionRepository: PostSessionRepository,
    private readonly whatsappService: WhatsAppService,
    private readonly postGeneratorService: PostGeneratorService
  ) {}

  /**
   * Verifica se a mensagem de entrada é um gatilho para iniciar a criação de um novo post
   */
  isTriggerMessage(text: string): boolean {
    const clean = text.trim().toLowerCase();
    const triggers = [
      "novo post",
      "criar post",
      "gerar post",
      "fazer post",
      "post",
      "novo-post",
      "gerador de post",
      "quero um post",
    ];
    return triggers.some((t) => clean === t || clean.startsWith(t));
  }

  /**
   * Processa a mensagem no contexto do fluxo interativo de criação de posts
   * Retorna true se a mensagem foi tratada pelo fluxo do post, ou false se deve seguir para o fluxo de IA padrão.
   */
  async handlePostFlow(
    contactId: string,
    incomingMsg: IncomingMessageDTO
  ): Promise<boolean> {
    const senderPhone = incomingMsg.senderPhone;
    const cleanText = incomingMsg.body.trim();
    const cleanLower = cleanText.toLowerCase();

    // 1. Buscar se existe uma sessão ativa de criação de post para este contato
    let session = await this.postSessionRepository.findByContactId(contactId);

    // Tratar comando de cancelamento a qualquer momento
    if (session && (cleanLower === "cancelar" || cleanLower === "sair" || cleanLower === "parar")) {
      await this.postSessionRepository.deleteByContactId(contactId);
      await this.whatsappService.sendText(
        senderPhone,
        "❌ *Fluxo de criação de post cancelado.*\n\nComo posso te ajudar agora?"
      );
      return true;
    }

    // 2. Se não houver sessão ativa: verificar se a mensagem é um gatilho para iniciar
    if (!session) {
      if (!this.isTriggerMessage(cleanText)) {
        return false; // Não é um gatilho de post, segue para o fluxo conversacional padrão
      }

      // Inicia nova sessão no passo SELECT_BUSINESS_TYPE
      session = await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_BUSINESS_TYPE,
      });

      let menu = "🎨 *Gerador de Posts kel-IA* 🎨\n\n";
      menu += "Vamos criar uma arte incrível para o seu post!\n";
      menu += "Por favor, escolha o *Tipo de Negócio*:\n\n";

      BUSINESS_CATEGORIES.forEach((cat, index) => {
        menu += `${index + 1}️⃣ *${cat.name}*\n`;
      });

      menu += '\n*(Digite o número da opção desejada ou "cancelar" a qualquer momento)*';

      await this.whatsappService.sendText(senderPhone, menu);
      return true;
    }

    // 3. Processar de acordo com a etapa atual da sessão

    // --- ETAPA 1: Seleção do Tipo de Negócio ---
    if (session.step === PostStep.SELECT_BUSINESS_TYPE) {
      const category = findCategoryByIndexOrId(cleanText);

      if (!category) {
        let errorMsg = "⚠️ *Opção inválida.*\n\n";
        errorMsg += "Por favor, escolha um dos tipos de negócio da lista:\n\n";
        BUSINESS_CATEGORIES.forEach((cat, index) => {
          errorMsg += `${index + 1}️⃣ ${cat.name}\n`;
        });
        errorMsg += '\n*(Ou digite "cancelar" para encerrar)*';

        await this.whatsappService.sendText(senderPhone, errorMsg);
        return true;
      }

      // Atualiza sessão com o negócio selecionado e avança para SELECT_TEMPLATE
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.SELECT_TEMPLATE,
        businessType: category.id,
      });

      // Tentar enviar imagem de guia visual (ex: templates-comida.png, templates-varejo.png, templates-moda.png) antes do texto
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
          console.log(`[PostFlowService] Enviando imagem de guia visual (${finalPath}) para ${senderPhone}...`);
          const imgBuffer = fs.readFileSync(finalPath);
          const base64Url = `data:image/png;base64,${imgBuffer.toString("base64")}`;
          await this.whatsappService.sendImage(
            senderPhone,
            base64Url,
            `🖼️ *Guia Visual dos Templates de ${category.name}*`
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

      await this.whatsappService.sendText(senderPhone, templateMenu);
      return true;
    }

    // --- ETAPA 2: Seleção do Template ---
    if (session.step === PostStep.SELECT_TEMPLATE) {
      const category = getCategoryOrDefault(session.businessType);
      const template = findTemplateByIndexOrId(category, cleanText);

      if (!template) {
        let errorMsg = "⚠️ *Template não encontrado.*\n\n";
        errorMsg += `Por favor, escolha um dos templates para *${category.name}*:\n\n`;
        category.templates.forEach((tmpl, index) => {
          errorMsg += `*${index + 1}* - ${tmpl.title}\n`;
        });
        await this.whatsappService.sendText(senderPhone, errorMsg);
        return true;
      }

      // Atualiza sessão e avança para INPUT_TITLE
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.INPUT_TITLE,
        templateId: template.id,
      });

      let msg = "📝 *Título do Produto / Oferta*\n\n";
      msg += `Template selecionado: *${template.title}*\n\n`;
      msg += "Por favor, digite o *Título do Produto* ou *Nome da Oferta* que vai aparecer na arte:\n";
      msg += "_(Exemplo: Hambúrguer Artesanal Duplo ou Camisa Oversized Algodão)_";

      await this.whatsappService.sendText(senderPhone, msg);
      return true;
    }

    // --- ETAPA 3: Digitação do Título ---
    if (session.step === PostStep.INPUT_TITLE) {
      if (!cleanText) {
        await this.whatsappService.sendText(
          senderPhone,
          "⚠️ Por favor, digite um título válido para o produto."
        );
        return true;
      }

      // Atualiza sessão e avança para INPUT_PRICE
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.INPUT_PRICE,
        productTitle: cleanText,
      });

      let msg = "💰 *Valor do Produto*\n\n";
      msg += `Produto: *${cleanText}*\n\n`;
      msg += "Agora, informe o *Valor do Produto* ou a condição da promoção:\n";
      msg += "_(Exemplo: R$ 49,90 ou Apenas R$ 129,00)_";

      await this.whatsappService.sendText(senderPhone, msg);
      return true;
    }

    // --- ETAPA 4: Digitação do Valor -> Pergunta pela Imagem ---
    if (session.step === PostStep.INPUT_PRICE) {
      const productPrice = cleanText;

      // Salva o preço e avança para INPUT_IMAGE
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.INPUT_IMAGE,
        productPrice,
      });

      let msg = "📸 *Foto do Produto*\n\n";
      msg += `Produto: *${session.productTitle}*\n`;
      msg += `Valor: *${productPrice}*\n\n`;
      msg += "Envie agora a *Foto do Produto* aqui no chat! 📷\n\n";
      msg += '_(Se preferir que a IA crie a arte do zero sem foto, digite *"pular"*)_';

      await this.whatsappService.sendText(senderPhone, msg);
      return true;
    }

    // --- ETAPA 5: Recebimento da Imagem / Opção de Pular ---
    if (session.step === PostStep.INPUT_IMAGE) {
      let base64Image: string | null = null;

      if (incomingMsg.type === "image" && incomingMsg.mediaId) {
        // Usuário enviou uma foto via WhatsApp
        await this.whatsappService.sendText(senderPhone, "📥 *Imagem recebida!* Processando o arquivo...");
        try {
          base64Image = await this.whatsappService.downloadMedia(incomingMsg.mediaId);
        } catch (error) {
          console.error(`[PostFlowService] Erro ao baixar imagem do WhatsApp mediaId ${incomingMsg.mediaId}:`, error);
          await this.whatsappService.sendText(
            senderPhone,
            "⚠️ Não foi possível baixar a foto enviada. Continuando a geração com arte gerada do zero..."
          );
        }
      } else if (["pular", "sem foto", "nao", "não", "sem imagem", "pular foto"].includes(cleanLower)) {
        // Usuário escolheu pular a foto
        base64Image = null;
      } else {
        // Mensagem de texto que não é comando de pular nem imagem
        await this.whatsappService.sendText(
          senderPhone,
          '📷 Por favor, envie uma *foto do produto* no chat ou digite *"pular"* se quiser criar o post sem foto.'
        );
        return true;
      }

      // Atualiza a sessão para GENERATING com a foto (se houver)
      await this.postSessionRepository.createOrUpdate(contactId, {
        step: PostStep.GENERATING,
        productImage: base64Image,
      });

      await this.generatePostAndSend(contactId, senderPhone);
      return true;
    }

    // Se estiver em estado GENERATING e o usuário enviar nova mensagem
    if (session.step === PostStep.GENERATING) {
      await this.whatsappService.sendText(
        senderPhone,
        "⏳ A sua imagem já está sendo gerada pela IA! Em alguns instantes você a receberá aqui."
      );
      return true;
    }

    return false;
  }

  /**
   * Método auxiliar para orquestrar a geração do post na OpenAI/gerador-posts-ia e disparar o envio via WhatsApp
   */
  private async generatePostAndSend(contactId: string, senderPhone: string): Promise<void> {
    const session = await this.postSessionRepository.findByContactId(contactId);

    const category = getCategoryOrDefault(session?.businessType);
    const template = getTemplateOrDefault(category, session?.templateId);
    const productTitle = session?.productTitle || "Produto Especial";
    const productPrice = session?.productPrice || "Consulte";
    const productImage = session?.productImage || null;

    // Notificação de progresso
    let statusMsg = "🎨 *Criando a arte do seu post...*\n\n";
    statusMsg += "📋 *Resumo do Pedido:*\n";
    statusMsg += `• Categoria: *${category.name}*\n`;
    statusMsg += `• Template: *${template.title}*\n`;
    statusMsg += `• Produto: *${productTitle}*\n`;
    statusMsg += `• Valor: *${productPrice}*\n`;
    statusMsg += `• Foto enviada: *${productImage ? "Sim 📸" : "Não (Criar do zero)"}*\n\n`;
    statusMsg += "⏳ A IA está processando e gerando a imagem em alta definição. Aguarde alguns segundos!";

    await this.whatsappService.sendText(senderPhone, statusMsg);

    try {
      console.log(`[PostFlowService] Solicitando geração de post para ${senderPhone} (com foto: ${!!productImage})...`);

      const result = await this.postGeneratorService.generatePostImage({
        businessType: category.id,
        templateId: template.id,
        productTitle,
        productPrice,
        productImage,
      });

      // Envia a imagem gerada via WhatsApp
      const caption = `🚀 Aqui está o seu post pronto!\n\n📌 *${productTitle}* — *${productPrice}*`;
      await this.whatsappService.sendImage(senderPhone, result.imageUrl, caption);

      console.log(`[PostFlowService] Post entregue com SUCESSO para ${senderPhone}`);
    } catch (error) {
      console.error(`[PostFlowService] Erro ao gerar post para ${senderPhone}:`, error);
      await this.whatsappService.sendText(
        senderPhone,
        "❌ Desculpe, ocorreu uma falha ao gerar a imagem do post com a IA. Por favor, tente novamente enviando 'novo post'."
      );
    } finally {
      // Encerra a sessão
      await this.postSessionRepository.deleteByContactId(contactId);
    }
  }
}
