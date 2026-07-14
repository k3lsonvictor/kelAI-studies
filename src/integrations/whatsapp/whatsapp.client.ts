import axios from "axios";
import type { AxiosInstance } from "axios";
import { env } from "../../config/env.js";
import type { WhatsAppSendResponse } from "../../types/whatsapp.types.js";

export class WhatsAppClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: `https://graph.facebook.com/v23.0/${env.phoneNumberId}`,
      headers: {
        Authorization: `Bearer ${env.whatsappToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Envia uma mensagem de texto simples pelo WhatsApp
   * @param to Número de telefone do destinatário no formato internacional (ex: 5586999999999)
   * @param text Texto da mensagem
   */
  async sendTextMessage(to: string, text: string): Promise<WhatsAppSendResponse> {
    try {
      const response = await this.http.post<WhatsAppSendResponse>("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          body: text,
        },
      });

      return response.data;
    } catch (error) {
      this.handleError(error, `Erro ao enviar mensagem de texto para ${to}`);
      throw error;
    }
  }

  /**
   * Método utilitário para tratar erros de requisições HTTP à API do WhatsApp.
   */
  private handleError(error: any, contextMessage: string): void {
    if (axios.isAxiosError(error)) {
      const apiErrors = error.response?.data;
      console.error(`${contextMessage}:`, {
        status: error.response?.status,
        data: apiErrors,
      });
    } else {
      console.error(`${contextMessage}:`, error);
    }
  }
}
