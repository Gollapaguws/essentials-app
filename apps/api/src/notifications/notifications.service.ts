import { Injectable } from "@nestjs/common";
import { prisma } from "@essentials/db";

/** In-app notifications (bell feed) — creation is best-effort, never blocks. */
@Injectable()
export class NotificationsService {
  async notify(userId: string, kind: string, title: string, body: string, link?: string) {
    await prisma.notification
      .create({ data: { userId, kind, title, body, link } })
      .catch(() => null);
  }

  async notifyMany(userIds: string[], kind: string, title: string, body: string, link?: string) {
    if (!userIds.length) return;
    await prisma.notification
      .createMany({ data: userIds.map((userId) => ({ userId, kind, title, body, link })) })
      .catch(() => null);
  }

  listFor(userId: string) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(userId: string, id?: string) {
    await prisma.notification.updateMany({
      where: { userId, ...(id ? { id } : {}) },
      data: { read: true },
    });
    return { ok: true };
  }
}
