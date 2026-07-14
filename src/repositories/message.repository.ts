import { prisma } from "../config/prisma.js";
import { MessageDirection } from "@prisma/client";
import type { Message } from "@prisma/client";

export class MessageRepository {
  /**
   * Cria e persiste uma nova mensagem (recebida ou enviada) no banco de dados
   */
  async create(data: {
    conversationId: string;
    direction: "INCOMING" | "OUTGOING";
    body: string;
    externalId?: string | null;
    type?: string | null;
    status?: string | null;
  }): Promise<Message> {
    return prisma.message.create({
      data: {
        conversationId: data.conversationId,
        direction: data.direction === "INCOMING" ? MessageDirection.INCOMING : MessageDirection.OUTGOING,
        body: data.body,
        type: data.type || "text",
        status: data.status ?? null,
        externalId: data.externalId ?? null,
      },
    });
  }

  /**
   * Busca todas as mensagens associadas a uma conversa específica
   */
  async findByConversation(conversationId: string): Promise<Message[]> {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Busca o histórico das últimas X mensagens de uma conversa
   */
  async findLastMessages(conversationId: string, limit = 10): Promise<Message[]> {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }).then((messages) => messages.reverse()); // Retorna em ordem cronológica (antigas para novas)
  }

  /**
   * Atualiza o status de entrega/leitura de uma mensagem enviado via webhook de status (Meta callback)
   * @param externalId O ID externo (wamid) retornado pela API do WhatsApp
   * @param status O novo status (delivered, read, failed, etc.)
   */
  async updateStatus(externalId: string, status: string): Promise<Message | null> {
    try {
      const message = await prisma.message.findUnique({
        where: { externalId },
      });

      if (!message) return null;

      return prisma.message.update({
        where: { id: message.id },
        data: { status },
      });
    } catch (error) {
      console.error(`[MessageRepository] Erro ao atualizar status para wamid: ${externalId}:`, error);
      return null;
    }
  }
}
