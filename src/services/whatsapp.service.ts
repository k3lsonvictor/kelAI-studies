import { WhatsAppClient } from "../integrations/whatsapp/whatsapp.client.js";
import { sendChatwootMessage } from "../controllers/webhook.controller.js";

export interface ChatwootContext {
  accountId?: number | string | undefined;
  conversationId?: number | string | undefined;
}

export class WhatsAppService {
  private readonly whatsappClient: WhatsAppClient;

  constructor() {
    this.whatsappClient = new WhatsAppClient();
  }

  /**
   * Envia uma mensagem de texto simples.
   * Se for originada do Chatwoot, envia também via API do Chatwoot.
   */
  async sendText(to: string, body: string, chatwootContext?: ChatwootContext) {
    console.log(`[WhatsAppService] Despachando envio de mensagem de texto para ${to}`);

    if (chatwootContext?.accountId && chatwootContext?.conversationId) {
      await sendChatwootMessage(chatwootContext.accountId, chatwootContext.conversationId, body);
    }

    return this.whatsappClient.sendTextMessage(to, body);
  }

  /**
   * Envia uma mensagem de imagem.
   * Se for originada do Chatwoot, envia também via API do Chatwoot.
   */
  async sendImage(to: string, imageUrl: string, caption?: string, chatwootContext?: ChatwootContext) {
    console.log(`[WhatsAppService] Despachando envio de imagem para ${to}`);

    if (chatwootContext?.accountId && chatwootContext?.conversationId) {
      const chatwootText = caption ? `${caption}\n\n${imageUrl}` : imageUrl;
      await sendChatwootMessage(chatwootContext.accountId, chatwootContext.conversationId, chatwootText);
    }

    return this.whatsappClient.sendImageMessage(to, imageUrl, caption);
  }

  /**
   * Baixa uma mídia enviada pelo usuário via WhatsApp e a retorna no formato base64 Data URL
   */
  async downloadMedia(mediaId: string): Promise<string> {
    console.log(`[WhatsAppService] Baixando mídia ${mediaId} via Graph API...`);
    return this.whatsappClient.downloadMediaAsBase64(mediaId);
  }
}