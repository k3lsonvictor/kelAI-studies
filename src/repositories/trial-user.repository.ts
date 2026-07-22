import { prisma } from "../config/prisma.js";
import type { TrialUser } from "@prisma/client";

export class TrialUserRepository {
  async findByPhone(phone: string): Promise<TrialUser | null> {
    const cleanDigits = phone.replace(/\D/g, "");
    if (!cleanDigits) return null;

    const trial = await prisma.trialUser.findFirst({
      where: {
        OR: [
          { phone: phone },
          { phone: cleanDigits },
          { phone: { endsWith: cleanDigits.slice(-8) } },
        ],
      },
    });

    return trial;
  }

  async create(phone: string, credits: number = 3): Promise<TrialUser> {
    const cleanDigits = phone.replace(/\D/g, "");
    return prisma.trialUser.create({
      data: {
        phone: cleanDigits || phone,
        credits,
        isWelcomed: false,
      },
    });
  }

  async deductCredit(id: string, currentCredits: number): Promise<number> {
    const finalCredits = Math.max(0, currentCredits - 1);
    await prisma.trialUser.update({
      where: { id },
      data: { credits: finalCredits },
    });
    return finalCredits;
  }

  async markAsWelcomed(id: string): Promise<void> {
    await prisma.trialUser.update({
      where: { id },
      data: { isWelcomed: true },
    });
  }
}
