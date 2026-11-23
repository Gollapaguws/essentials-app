import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { GroupChatService, MAX_MESSAGE_LENGTH } from "./group-chat.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    eventGroupChat: { findUnique: jest.fn(), create: jest.fn() },
    guestList: { findFirst: jest.fn() },
    groupMessage: { findMany: jest.fn(), create: jest.fn() },
  },
}));

const db = prisma as unknown as {
  event: { findUnique: jest.Mock };
  eventGroupChat: { findUnique: jest.Mock; create: jest.Mock };
  guestList: { findFirst: jest.Mock };
  groupMessage: { findMany: jest.Mock; create: jest.Mock };
};

const guest: JwtUser = { sub: "guest-1", email: "g@example.com", role: "guest" };
const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

const service = () => new GroupChatService();

beforeEach(() => {
  db.event.findUnique.mockReset().mockResolvedValue({
    promoterId: "promoter-1",
    venue: { managerId: "venue-1" },
  });
  db.eventGroupChat.findUnique.mockReset().mockResolvedValue({ id: "chat-1" });
  db.eventGroupChat.create.mockReset();
  db.guestList.findFirst.mockReset().mockResolvedValue({ id: "entry-1" });
  db.groupMessage.findMany.mockReset().mockResolvedValue([]);
  db.groupMessage.create.mockReset();
});

describe("GroupChatService", () => {
  it("refuses a guest who is not on the night's list", async () => {
    db.guestList.findFirst.mockResolvedValue(null);

    await expect(service().messages(guest, "event-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.guestList.findFirst).toHaveBeenCalledWith({
      where: { eventId: "event-1", userId: "guest-1", status: { in: ["attending", "checked_in"] } },
      select: { id: true },
    });
  });

  it("returns the room oldest first and flags the caller's own messages", async () => {
    db.groupMessage.findMany.mockResolvedValue([
      { id: "m2", body: "later", createdAt: new Date("2027-03-13T20:05:00Z"), isIcebreaker: false, userId: "guest-1", user: { id: "guest-1", name: null, avatar: null } },
      { id: "m1", body: "first", createdAt: new Date("2027-03-13T20:00:00Z"), isIcebreaker: true, userId: "someone", user: { id: "someone", name: "Thabo", avatar: "/media/t.jpg" } },
    ]);

    const room = await service().messages(guest, "event-1");

    expect(room.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(room.messages[0]).toMatchObject({ isIcebreaker: true, mine: false, author: { name: "Thabo" } });
    expect(room.messages[1]).toMatchObject({ mine: true, author: { name: "Guest" } });
  });

  it("lets the promoter read the room without being on the list", async () => {
    db.groupMessage.findMany.mockResolvedValue([]);

    await expect(service().messages(promoter, "event-1")).resolves.toMatchObject({ chatId: "chat-1" });
    expect(db.guestList.findFirst).not.toHaveBeenCalled();
  });

  it("creates the room for a night that predates chats", async () => {
    db.eventGroupChat.findUnique.mockResolvedValue(null);
    db.eventGroupChat.create.mockResolvedValue({ id: "chat-new" });

    const room = await service().messages(promoter, "event-1");

    expect(db.eventGroupChat.create).toHaveBeenCalledWith({ data: { eventId: "event-1" }, select: { id: true } });
    expect(room.chatId).toBe("chat-new");
  });

  it("rejects an empty or oversized message", async () => {
    await expect(service().post(guest, "event-1", "   ")).rejects.toBeInstanceOf(BadRequestException);
    await expect(service().post(guest, "event-1", "x".repeat(MAX_MESSAGE_LENGTH + 1))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.groupMessage.create).not.toHaveBeenCalled();
  });

  it("saves a trimmed message from a guest as a normal message", async () => {
    db.groupMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "m1",
      body: data.body,
      createdAt: new Date("2027-03-13T20:00:00Z"),
      isIcebreaker: data.isIcebreaker,
      userId: data.userId,
      user: { id: "guest-1", name: "Lerato", avatar: null },
    }));

    const saved = await service().post(guest, "event-1", "  see you there  ", true);

    expect(db.groupMessage.create).toHaveBeenCalledWith({
      data: { chatId: "chat-1", userId: "guest-1", body: "see you there", isIcebreaker: false },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
    expect(saved).toMatchObject({ body: "see you there", mine: true, isIcebreaker: false });
  });

  it("lets staff open the room with an icebreaker", async () => {
    db.groupMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "m1",
      body: data.body,
      createdAt: new Date("2027-03-13T20:00:00Z"),
      isIcebreaker: data.isIcebreaker,
      userId: data.userId,
      user: { id: "promoter-1", name: "Sam", avatar: null },
    }));

    const saved = await service().post(promoter, "event-1", "Who is coming from Soweto?", true);

    expect(saved.isIcebreaker).toBe(true);
  });
});
