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
   * Envia uma imagem com legenda pelo WhatsApp.
   * Se a URL da imagem for um Data URL base64 (gerado pelo gpt-image-2), faz o upload prévio
   * para a Meta Media API e despacha a mensagem utilizando o ID do arquivo de mídia retornado.
   * @param to Número de telefone do destinatário
   * @param imageUrl URL pública da imagem (HTTP/HTTPS) ou string base64 Data URL
   * @param caption Legenda da imagem (opcional)
   */
  async sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<WhatsAppSendResponse> {
    try {
      let imagePayload: { link?: string; id?: string; caption?: string };

      if (imageUrl.startsWith("data:image/")) {
        console.log(`[WhatsAppClient] Imagem enviada em formato base64. Fazendo upload para a Meta Media API...`);
        const mediaId = await this.uploadMediaBase64(imageUrl);
        console.log(`[WhatsAppClient] Upload de mídia concluído com SUCESSO! Media ID: ${mediaId}`);
        imagePayload = {
          id: mediaId,
          ...(caption && { caption }),
        };
      } else {
        imagePayload = {
          link: imageUrl,
          ...(caption && { caption }),
        };
      }

      const response = await this.http.post<WhatsAppSendResponse>("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "image",
        image: imagePayload,
      });

      return response.data;
    } catch (error) {
      this.handleError(error, `Erro ao enviar imagem para ${to}`);
      throw error;
    }
  }

  /**
   * Envia o buffer binário de uma imagem base64 para o endpoint de upload de mídia da Meta (/media)
   * e retorna o ID da mídia gerada.
   */
  async uploadMediaBase64(base64DataUrl: string): Promise<string> {
    try {
      const match = base64DataUrl.match(/^data:(image\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!match) {
        throw new Error("Formato de imagem base64 inválido para upload de mídia.");
      }
      const mimeType = match[1] || "image/png";
      const base64Data = match[2] || "";
      const buffer = Buffer.from(base64Data, "base64");

      const formData = new FormData();
      formData.append("messaging_product", "whatsapp");
      formData.append("type", mimeType);
      const blob = new Blob([buffer], { type: mimeType });
      formData.append("file", blob, "post.png");

      const response = await axios.post<{ id: string }>(
        `https://graph.facebook.com/v23.0/${env.phoneNumberId}/media`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${env.whatsappToken}`,
          },
        }
      );

      const mediaId = response.data?.id;
      if (!mediaId) {
        throw new Error("A API da Meta não retornou um ID de mídia válido.");
      }

      return mediaId;
    } catch (error) {
      this.handleError(error, "Erro ao fazer upload de mídia base64 para a Meta");
      throw error;
    }
  }

  /**
   * Baixa um arquivo de mídia do WhatsApp pelo mediaId e o converte para Data URL base64
   */
  async downloadMediaAsBase64(mediaId: string): Promise<string> {
    try {
      // 1. Obter URL do arquivo de mídia na Graph API Meta
      const metaResponse = await axios.get<{ url: string; mime_type: string }>(
        `https://graph.facebook.com/v23.0/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${env.whatsappToken}`,
          },
        }
      );

      const mediaUrl = metaResponse.data.url;
      const mimeType = metaResponse.data.mime_type || "image/jpeg";

      // 2. Fazer o download do arquivo de mídia binário
      const mediaBufferResponse = await axios.get(mediaUrl, {
        headers: {
          Authorization: `Bearer ${env.whatsappToken}`,
        },
        responseType: "arraybuffer",
      });

      const base64 = Buffer.from(mediaBufferResponse.data).toString("base64");
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      this.handleError(error, `Erro ao baixar mídia com ID ${mediaId}`);
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
