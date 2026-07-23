import axios from "axios";
import { env } from "../config/env.js";

export interface ProcessFinancialMessagePayload {
  phoneNumber: string;
  userName?: string;
  messageType?: "text" | "audio" | "image";
  textBody?: string;
  audioBase64?: string;
  imageBase64?: string;
}

export class FinancialIntegrationService {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = env.gestaoFinanceiraApiUrl;
  }

  /**
   * Encaminha a mensagem recebida pelo kel-ia para o serviço de Gestão Financeira (porta 3334)
   * e retorna a resposta gerada pelo agente financeiro.
   */
  async processFinancialMessage(payload: ProcessFinancialMessagePayload): Promise<string> {
    try {
      console.log(`[FinancialIntegrationService] Encaminhando mensagem de ${payload.phoneNumber} para ${this.baseUrl}/api/finance/process-message...`);

      const response = await axios.post(
        `${this.baseUrl}/api/finance/process-message`,
        {
          phoneNumber: payload.phoneNumber,
          userName: payload.userName,
          messageType: payload.messageType || "text",
          textBody: payload.textBody,
          audioBase64: payload.audioBase64,
          imageBase64: payload.imageBase64,
          sendWhatsAppReply: false, // O próprio kel-ia enviará a resposta final de volta ao WhatsApp/Chatwoot
        },
        { timeout: 30000 }
      );

      const responseText = response.data?.data?.responseText;
      if (!responseText) {
        throw new Error("Serviço de Gestão Financeira não retornou um 'responseText' válido.");
      }

      return responseText;
    } catch (error: any) {
      console.error("[FinancialIntegrationService] Erro ao comunicar com o serviço de Gestão Financeira:", error.response?.data || error.message);
      return "⚠️ Não foi possível se conectar ao serviço de Gestão Financeira no momento. Por favor, tente novamente em instantes.";
    }
  }
}
