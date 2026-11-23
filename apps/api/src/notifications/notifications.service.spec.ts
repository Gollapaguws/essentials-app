import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { NotificationsService } from "./notifications.service";
import type { TelegramService } from "../telegram/telegram.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    notification: { create: jest.fn(), createMany: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  notification: { createMany: jest.Mock };
  user: { findUnique: jest.Mock; findMany: jest.Mock };
};

const DJ = {
  id: "dj-1",
  email: "dj@example.com",
  name: null,
  role: "artist",
  telegramChatId: "12345",
  artistProfile: { stageName: "REM-OD" },
};

function serviceFor(overrides: { telegramSend?: jest.Mock } = {}) {
  const telegram = { sendMessage: overrides.telegramSend ?? jest.fn().mockResolvedValue(true) };
  const config = {
    get: (key: string) => (key === "APP_URL" ? "https://essentials.example/dashboard/" : undefined),
  } as unknown as ConfigService;
  return {
    service: new NotificationsService(telegram as unknown as TelegramService, config),
    telegram,
  };
}

describe("NotificationsService.sendTest", () => {
  beforeEach(() => {
    db.notification.createMany.mockReset().mockResolvedValue({ count: 1 });
    db.user.findUnique.mockReset();
    db.user.findMany.mockReset();
  });

  it("rejects an account that is not a DJ", async () => {
    db.user.findUnique.mockResolvedValue({ ...DJ, role: "guest" });

    await expect(serviceFor().service.sendTest("guest-1")).rejects.toThrow(BadRequestException);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown account", async () => {
    db.user.findUnique.mockResolvedValue(null);

    await expect(serviceFor().service.sendTest("missing")).rejects.toThrow(NotFoundException);
  });

  it("writes the bell row and reports one delivery per channel", async () => {
    db.user.findUnique.mockResolvedValue(DJ);
    db.user.findMany.mockResolvedValue([{ id: DJ.id, telegramChatId: "12345" }]);
    const { service, telegram } = serviceFor();

    const result = await service.sendTest(DJ.id);

    expect(result.channels).toEqual({ inapp: 1, telegram: 1 });
    expect(result.delivered).toBe(1);
    expect(result.recipient.stageName).toBe("REM-OD");
    expect(db.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: DJ.id,
          kind: "generic",
          title: "TEST NOTIFICATION",
          link: "https://essentials.example/dashboard/notifications",
        }),
      ],
    });
    expect(telegram.sendMessage).toHaveBeenCalledWith("12345", expect.stringContaining("TEST NOTIFICATION"));
  });
});
