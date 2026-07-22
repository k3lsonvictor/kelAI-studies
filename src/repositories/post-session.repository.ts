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
      hasHumanModel?: boolean | null;
      modelProfile?: string | null;
      postType?: string | null;
      templateId?: string | null;
      colors?: string | null;
      productTitle?: string | null;
      productPrice?: string | null;
      productImage?: string | null;
      extraContext?: string | null;
      chatwootAccountId?: string | null;
      chatwootConversationId?: string | null;
      lastPostGeneratedAt?: Date | null;
      lastRecoverySentAt?: Date | null;
      lastRetentionSentAt?: Date | null;
      lastWeeklySentAt?: Date | null;
    }
  ): Promise<PostSession> {
    return prisma.postSession.upsert({
      where: { contactId },
      create: {
        contactId,
        step: data.step,
        businessType: data.businessType ?? null,
        hasHumanModel: data.hasHumanModel ?? null,
        modelProfile: data.modelProfile ?? null,
        postType: data.postType ?? null,
        templateId: data.templateId ?? null,
        colors: data.colors ?? null,
        productTitle: data.productTitle ?? null,
        productPrice: data.productPrice ?? null,
        productImage: data.productImage ?? null,
        extraContext: data.extraContext ?? null,
        chatwootAccountId: data.chatwootAccountId ?? null,
        chatwootConversationId: data.chatwootConversationId ?? null,
        lastPostGeneratedAt: data.lastPostGeneratedAt ?? null,
        lastRecoverySentAt: data.lastRecoverySentAt ?? null,
        lastRetentionSentAt: data.lastRetentionSentAt ?? null,
        lastWeeklySentAt: data.lastWeeklySentAt ?? null,
      },
      update: {
        step: data.step,
        ...(data.businessType !== undefined && { businessType: data.businessType }),
        ...(data.hasHumanModel !== undefined && { hasHumanModel: data.hasHumanModel }),
        ...(data.modelProfile !== undefined && { modelProfile: data.modelProfile }),
        ...(data.postType !== undefined && { postType: data.postType }),
        ...(data.templateId !== undefined && { templateId: data.templateId }),
        ...(data.colors !== undefined && { colors: data.colors }),
        ...(data.productTitle !== undefined && { productTitle: data.productTitle }),
        ...(data.productPrice !== undefined && { productPrice: data.productPrice }),
        ...(data.productImage !== undefined && { productImage: data.productImage }),
        ...(data.extraContext !== undefined && { extraContext: data.extraContext }),
        ...(data.chatwootAccountId !== undefined && { chatwootAccountId: data.chatwootAccountId }),
        ...(data.chatwootConversationId !== undefined && { chatwootConversationId: data.chatwootConversationId }),
        ...(data.lastPostGeneratedAt !== undefined && { lastPostGeneratedAt: data.lastPostGeneratedAt }),
        ...(data.lastRecoverySentAt !== undefined && { lastRecoverySentAt: data.lastRecoverySentAt }),
        ...(data.lastRetentionSentAt !== undefined && { lastRetentionSentAt: data.lastRetentionSentAt }),
        ...(data.lastWeeklySentAt !== undefined && { lastWeeklySentAt: data.lastWeeklySentAt }),
      },
    });
  }

  async deleteByContactId(contactId: string): Promise<void> {
    await prisma.postSession.deleteMany({
      where: { contactId },
    });
  }
}
