import type { ContactRepository } from "../repositories/contact.repository.js";
import type { Contact } from "@prisma/client";

export class ContactService {
  constructor(private readonly contactRepository: ContactRepository) {}

  /**
   * Localiza um contato pelo número de telefone.
   */
  async findByPhone(phone: string): Promise<Contact | null> {
    return this.contactRepository.findByPhone(phone);
  }

  /**
   * Localiza um contato pelo ID interno.
   */
  async findById(id: string): Promise<Contact | null> {
    return this.contactRepository.findById(id);
  }

  /**
   * Localiza um contato pelo telefone. Se não existir, cria-o no banco de dados.
   * Se já existir, atualiza o nome se o nome fornecido for diferente do salvo.
   */
  async getOrCreateContact(phone: string, name?: string): Promise<Contact> {
    let contact = await this.contactRepository.findByPhone(phone);

    if (!contact) {
      console.log(`[ContactService] Criando novo contato para o telefone: ${phone}`);
      contact = await this.contactRepository.create({ phone, name: name ?? null });
    } else if (name && contact.name !== name) {
      console.log(`[ContactService] Atualizando nome do contato ${phone}: "${contact.name}" -> "${name}"`);
      contact = await this.contactRepository.update(contact.id, { name: name ?? null });
    }

    return contact;
  }
}
