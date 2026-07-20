import { prisma } from "../config/prisma.js";
import type { PostSession, PostStep } from "@prisma/client";

export class PostSessionRepository {
  async findByContactId(contactId: string): Promise<PostSession | null> {
    return prisma.postSession.findUnique({
      where: { contactId },
    });
  }

  async createOrUpdate(
    contactId: string,
    data: {
      step: PostStep;
      businessType?: string | null;
      templateId?: string | null;
      productTitle?: string | null;
      productPrice?: string | null;
      productImage?: string | null;
    }
  ): Promise<PostSession> {
    return prisma.postSession.upsert({
      where: { contactId },
      create: {
        contactId,
        step: data.step,
        businessType: data.businessType ?? null,
        templateId: data.templateId ?? null,
        productTitle: data.productTitle ?? null,
        productPrice: data.productPrice ?? null,
        productImage: data.productImage ?? null,
      },
      update: {
        step: data.step,
        ...(data.businessType !== undefined && { businessType: data.businessType }),
        ...(data.templateId !== undefined && { templateId: data.templateId }),
        ...(data.productTitle !== undefined && { productTitle: data.productTitle }),
        ...(data.productPrice !== undefined && { productPrice: data.productPrice }),
        ...(data.productImage !== undefined && { productImage: data.productImage }),
      },
    });
  }

  async deleteByContactId(contactId: string): Promise<void> {
    await prisma.postSession.deleteMany({
      where: { contactId },
    });
  }
}
