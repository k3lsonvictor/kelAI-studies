import { prisma } from "../config/prisma.js";
import type { Contact } from "@prisma/client";

export class ContactRepository {
  /**
   * Busca um contato pelo número de telefone
   */
  async findByPhone(phone: string): Promise<Contact | null> {
    return prisma.contact.findUnique({
      where: { phone },
    });
  }

  /**
   * Busca um contato pelo seu ID interno (UUID)
   */
  async findById(id: string): Promise<Contact | null> {
    return prisma.contact.findUnique({
      where: { id },
    });
  }

  /**
   * Cria um novo contato no banco de dados
   */
  async create(data: { phone: string; name?: string | null }): Promise<Contact> {
    return prisma.contact.create({
      data: {
        phone: data.phone,
        name: data.name ?? null,
      },
    });
  }

  /**
   * Atualiza as informações de um contato existente
   */
  async update(id: string, data: { name?: string | null }): Promise<Contact> {
    return prisma.contact.update({
      where: { id },
      data: {
        name: data.name ?? null,
      },
    });
  }
}
