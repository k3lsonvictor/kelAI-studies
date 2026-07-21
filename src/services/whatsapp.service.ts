import { WhatsAppClient } from "../integrations/whatsapp/whatsapp.client.js";
import {
  sendChatwootMessage,
  sendChatwootImageMessage,
  sendChatwootInteractiveMessage,
} from "../controllers/webhook.controller.js";

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
   */
  async sendText(to: string, body: string, chatwootContext?: ChatwootContext) {
    console.log(`[WhatsAppService] Despachando mensagem de texto para ${to}`);

    if (chatwootContext?.accountId && chatwootContext?.conversationId) {
      await sendChatwootMessage(chatwootContext.accountId, chatwootContext.conversationId, body);
      return { messages: [{ id: `cw_sent_${Date.now()}` }] };
    }

    return this.whatsappClient.sendTextMessage(to, body);
  }

  /**
   * Envia botões clicáveis interativos (até 3 botões).
   * Se a conversa for do Chatwoot, envia via API interativa do Chatwoot (evitando 2ª mensagem).
   */
  async sendButtons(
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    chatwootContext?: ChatwootContext
  ) {
    console.log(`[WhatsAppService] Despachando botões interativos para ${to}`);

    if (chatwootContext?.accountId && chatwootContext?.conversationId) {
      const items = buttons.map((b) => ({ title: b.title, value: b.id }));
      await sendChatwootInteractiveMessage(chatwootContext.accountId, chatwootContext.conversationId, bodyText, items);
      return { messages: [{ id: `cw_sent_btn_${Date.now()}` }] };
    }

    return this.whatsappClient.sendInteractiveButtons(to, bodyText, buttons);
  }

  /**
   * Envia menu de lista interativa (menu com gaveta expansível para até 10 opções).
   * Se a conversa for do Chatwoot, envia via API interativa do Chatwoot (evitando 2ª mensagem).
   */
  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
    chatwootContext?: ChatwootContext
  ) {
    console.log(`[WhatsAppService] Despachando lista interativa para ${to}`);

    if (chatwootContext?.accountId && chatwootContext?.conversationId) {
      const items: Array<{ title: string; value: string }> = [];
      sections.forEach((sec) => {
        sec.rows.forEach((r) => {
          items.push({ title: r.title, value: r.id });
        });
      });
      await sendChatwootInteractiveMessage(chatwootContext.accountId, chatwootContext.conversationId, bodyText, items);
      return { messages: [{ id: `cw_sent_list_${Date.now()}` }] };
    }

    return this.whatsappClient.sendInteractiveList(to, bodyText, buttonText, sections);
  }

  /**
   * Envia uma mensagem de imagem.
   */
  async sendImage(to: string, imageUrl: string, caption?: string, chatwootContext?: ChatwootContext) {
    console.log(`[WhatsAppService] Despachando imagem para ${to}`);

    if (chatwootContext?.accountId && chatwootContext?.conversationId) {
      await sendChatwootImageMessage(chatwootContext.accountId, chatwootContext.conversationId, imageUrl, caption);
      return { messages: [{ id: `cw_sent_img_${Date.now()}` }] };
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