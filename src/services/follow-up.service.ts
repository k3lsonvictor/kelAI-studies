import { prisma } from "../config/prisma.js";
import { WhatsAppService } from "./whatsapp.service.js";
import { PostStep } from "@prisma/client";

export class FollowUpService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly whatsappService: WhatsAppService;

  constructor() {
    this.whatsappService = new WhatsAppService();
  }

  /**
   * Inicializa o loop de verificação em background (executa a cada 5 minutos)
   */
  start() {
    console.log("[FollowUpService] Iniciando serviço de disparos automáticos (Follow-up)...");
    
    // Executa a primeira verificação após 1 minuto
    setTimeout(() => this.runVerification(), 60000);

    // Loop permanente a cada 5 minutos
    this.intervalId = setInterval(() => {
      this.runVerification();
    }, 5 * 60 * 1000);
  }

  /**
   * Para o loop do serviço
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[FollowUpService] Serviço de Follow-up finalizado.");
    }
  }

  /**
   * Executa a lógica de verificação de regras para envio de lembretes
   */
  async runVerification() {
    const now = new Date();

    // 1. Regra de Horário Comercial (disparar apenas entre 08:30 e 19:30 local)
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const timeInMinutes = currentHour * 60 + currentMin;

    const startLimit = 8 * 60 + 30; // 08:30
    const endLimit = 19 * 60 + 30; // 19:30

    if (timeInMinutes < startLimit || timeInMinutes > endLimit) {
      console.log("[FollowUpService] Fora do horário comercial (08:30 - 19:30). Lembretes suspensos.");
      return;
    }

    try {
      console.log("[FollowUpService] Executando verificação de follow-ups candidatos...");

      // Busca todas as sessões ativas e contatos associados
      const sessions = await prisma.postSession.findMany({
        include: {
          contact: true,
        },
      });

      for (const session of sessions) {
        const contact = session.contact;
        const senderPhone = contact.phone;
        const contactName = contact.name || "Cliente";

        const cwCtx = (session.chatwootAccountId && session.chatwootConversationId)
          ? { accountId: session.chatwootAccountId, conversationId: session.chatwootConversationId }
          : undefined;

        // --- REGRA 1: Recuperação (Carrinho Abandonado de Fluxo) ---
        // Se está em um passo ativo do fluxo (não SELECT_FLOW_MODE)
        // E a última interação foi entre 15 e 60 minutos atrás
        // E nenhum lembrete de recuperação foi enviado para esta sessão atual
        if (session.step !== PostStep.SELECT_FLOW_MODE) {
          const timeSinceUpdateMs = now.getTime() - session.updatedAt.getTime();
          const minsSinceUpdate = timeSinceUpdateMs / (60 * 1000);

          const hasSentRecoveryRecent = session.lastRecoverySentAt && 
            (session.lastRecoverySentAt.getTime() > session.updatedAt.getTime());

          if (minsSinceUpdate >= 20 && minsSinceUpdate <= 90 && !hasSentRecoveryRecent) {
            console.log(`[FollowUpService] Disparando lembrete de RECUPERAÇÃO para ${contactName} (${senderPhone})...`);

            const msg = `Oi, ${contactName}! Vi que você começou a criar seu post, mas a rotina por aí deve estar corrida. 🥐\n\nÉ só me mandar a foto do produto com o preço aqui que sua arte fica pronta em menos de 1 minuto! Quer terminar agora?`;
            
            // Envia botões interativos de ação rápida
            const buttons = [
              { id: "1", title: "📸 Enviar Foto Agora" },
            ];

            await this.whatsappService.sendButtons(senderPhone, msg, buttons, cwCtx);

            // Marca o envio no banco
            await prisma.postSession.update({
              where: { id: session.id },
              data: {
                lastRecoverySentAt: now,
              },
            });
            continue; // Evita mandar múltiplos lembretes no mesmo ciclo
          }
        }

        // --- REGRA 2: Recorrência & Constância (Ativação e Retenção) ---
        // Se o usuário já gerou arte no passado (lastPostGeneratedAt está definido)
        // E a sessão está inativa/idle no passo SELECT_FLOW_MODE
        // E a última arte gerada foi há mais de 48 horas (2 dias)
        // E não enviamos lembrete de retenção nas últimas 48 horas
        if (session.step === PostStep.SELECT_FLOW_MODE && session.lastPostGeneratedAt) {
          const timeSinceLastPostMs = now.getTime() - session.lastPostGeneratedAt.getTime();
          const daysSinceLastPost = timeSinceLastPostMs / (24 * 60 * 60 * 1000);

          const hasSentRetentionRecent = session.lastRetentionSentAt &&
            (now.getTime() - session.lastRetentionSentAt.getTime() < 47 * 60 * 60 * 1000);

          if (daysSinceLastPost >= 2.0 && !hasSentRetentionRecent) {
            console.log(`[FollowUpService] Disparando lembrete de RETENÇÃO para ${contactName} (${senderPhone})...`);

            let msg = `Fala, ${contactName}! Passando pra te lembrar: quem não é visto, não é lembrado! 🔥\n\n`;
            msg += `Faz 2 dias que você não divulga uma oferta no seu perfil. Qual produto do seu estoque está parado ou qual é a novidade de hoje?\n\n`;
            msg += `Me manda a foto dele aqui que a gente deixa a sua vitrine pronta em 1 minuto!`;

            await this.whatsappService.sendText(senderPhone, msg, cwCtx);

            await prisma.postSession.update({
              where: { id: session.id },
              data: {
                lastRetentionSentAt: now,
              },
            });
            continue;
          }
        }

        // --- REGRA 3: Educativo de Sexta-feira (Gatilho de Fim de Semana) ---
        // Toda Sexta-feira a partir das 10h00
        // E nenhum lembrete semanal foi enviado nesta semana
        const isFriday = now.getDay() === 5;
        const isTimeForWeekly = now.getHours() >= 10;

        if (isFriday && isTimeForWeekly) {
          const hasSentWeeklyThisWeek = session.lastWeeklySentAt &&
            (now.getTime() - session.lastWeeklySentAt.getTime() < 6 * 24 * 60 * 60 * 1000);

          if (!hasSentWeeklyThisWeek) {
            console.log(`[FollowUpService] Disparando lembrete de SEXTOU para ${contactName} (${senderPhone})...`);

            let msg = `Sextou por aí, ${contactName}! 🚀\n\n`;
            msg += `Fim de semana é o momento que seus clientes mais compram. Já preparou as artes das ofertas ou do cardápio do fds?\n\n`;
            msg += `Mande a foto do seu carro-chefe de hoje para movimentar suas vendas hoje e amanhã!`;

            await this.whatsappService.sendText(senderPhone, msg, cwCtx);

            await prisma.postSession.update({
              where: { id: session.id },
              data: {
                lastWeeklySentAt: now,
              },
            });
          }
        }
      }
    } catch (err: any) {
      console.error("[FollowUpService] Erro no loop de verificação de follow-ups:", err.message || err);
    }
  }
}
export const followUpService = new FollowUpService();
