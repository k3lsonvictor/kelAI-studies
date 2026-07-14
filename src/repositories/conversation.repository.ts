import { prisma } from "../config/prisma.js";
import { ConversationStatus } from "@prisma/client";
import type { Conversation } from "@prisma/client";

export class ConversationRepository {
  /**
   * Busca uma conversa ativa (OPEN) para um determinado contato
   */
  async findOpenConversation(contactId: string): Promise<Conversation | null> {
    return prisma.conversation.findFirst({
      where: {
        contactId,
        status: ConversationStatus.OPEN,
      },
    });
  }

  /**
   * Cria uma nova conversa aberta para o contato
   */
  async create(contactId: string): Promise<Conversation> {
    return prisma.conversation.create({
      data: {
        contactId,
        status: ConversationStatus.OPEN,
      },
    });
  }

  /**
   * Fecha uma conversa ativa mudando seu status para CLOSED
   */
  async closeConversation(id: string): Promise<Conversation> {
    return prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.CLOSED,
      },
    });
  }

  /**
   * Busca uma conversa específica pelo seu ID (incluindo ou não mensagens)
   */
  async findById(id: string): Promise<Conversation | null> {
    return prisma.conversation.findUnique({
      where: { id },
    });
  }
}
