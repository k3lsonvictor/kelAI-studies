import type { ConversationRepository } from "../repositories/conversation.repository.js";
import type { MessageRepository } from "../repositories/message.repository.js";
import type { Conversation, Message } from "@prisma/client";
import { NotFoundError } from "../errors/app-error.js";

export class ConversationService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository
  ) {}

  /**
   * Busca uma conversa ativa (aberta) para o contato
   */
  async findOpenConversation(contactId: string): Promise<Conversation | null> {
    return this.conversationRepository.findOpenConversation(contactId);
  }

  /**
   * Obtém a conversa aberta atual ou cria uma nova se não houver nenhuma ativa
   */
  async getOrCreateOpenConversation(contactId: string): Promise<Conversation> {
    let conversation = await this.conversationRepository.findOpenConversation(contactId);

    if (!conversation) {
      console.log(`[ConversationService] Nenhuma conversa aberta encontrada para o contato ${contactId}. Iniciando nova conversa.`);
      conversation = await this.conversationRepository.create(contactId);
    }

    return conversation;
  }

  /**
   * Localiza uma conversa específica pelo seu ID
   */
  async findById(id: string): Promise<Conversation> {
    const conversation = await this.conversationRepository.findById(id);
    if (!conversation) {
      throw new NotFoundError(`Conversa com ID "${id}" não foi encontrada.`);
    }
    return conversation;
  }

  /**
   * Fecha uma conversa aberta ativa
   */
  async closeConversation(id: string): Promise<Conversation> {
    // Validar se existe
    await this.findById(id);
    console.log(`[ConversationService] Fechando conversa ${id}.`);
    return this.conversationRepository.closeConversation(id);
  }

  /**
   * Busca o histórico recente das últimas mensagens de uma conversa.
   * Utilizado para alimentar o contexto do modelo de IA.
   * @param conversationId ID da conversa
   * @param limit Limite máximo de mensagens a buscar (default: 15 para evitar sobrecarga de contexto)
   */
  async getHistory(conversationId: string, limit = 15): Promise<Message[]> {
    console.log(`[ConversationService] Buscando histórico das últimas ${limit} mensagens para a conversa ${conversationId}`);
    // Garante que a conversa existe antes de buscar
    await this.findById(conversationId);
    return this.messageRepository.findLastMessages(conversationId, limit);
  }
}
