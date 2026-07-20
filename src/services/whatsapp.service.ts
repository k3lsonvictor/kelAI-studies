import { WhatsAppClient } from "../integrations/whatsapp/whatsapp.client.js";

export class WhatsAppService {
  private readonly whatsappClient: WhatsAppClient;

  constructor() {
    this.whatsappClient = new WhatsAppClient();
  }

  /**
   * Envia uma mensagem de texto simples delegando a chamada para o WhatsAppClient (Graph API)
   * @param to Número de telefone do destinatário
   * @param body Corpo do texto da mensagem
   */
  async sendText(to: string, body: string) {
    console.log(`[WhatsAppService] Despachando envio de mensagem de texto para ${to}`);
    return this.whatsappClient.sendTextMessage(to, body);
  }

  /**
   * Envia uma mensagem de imagem delegando a chamada para o WhatsAppClient (Graph API)
   * @param to Número de telefone do destinatário
   * @param imageUrl URL pública da imagem
   * @param caption Legenda da imagem (opcional)
   */
  async sendImage(to: string, imageUrl: string, caption?: string) {
    console.log(`[WhatsAppService] Despachando envio de imagem para ${to}`);
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