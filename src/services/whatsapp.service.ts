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
}