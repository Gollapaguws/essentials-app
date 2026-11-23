import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { prisma } from "@essentials/db";
import { UpdateMeDto } from "./auth.controller";
import { AuthUserService } from "./auth-user.service";

jest.mock("@essentials/db", () => ({
  prisma: { user: { update: jest.fn(), findUnique: jest.fn(), create: jest.fn() } },
}));

const users = (prisma as unknown as { user: { update: jest.Mock } }).user;
const service = () => new AuthUserService();

const rejects = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateMeDto, body))).length > 0;

beforeEach(() => {
  users.update.mockReset().mockResolvedValue({
    id: "user-1",
    name: "Lerato",
    avatar: null,
    musicTastes: ["Amapiano"],
    vibeTag: "Party",
  });
});

describe("PATCH /auth/me", () => {
  it("accepts the card the guest app collects and nothing else", async () => {
    await expect(rejects({ name: "Lerato", musicTastes: ["Amapiano", "Afro"], vibeTag: "Party" })).resolves.toBe(false);
    await expect(rejects({})).resolves.toBe(false);
  });

  it("refuses a taste or vibe the app does not offer", async () => {
    await expect(rejects({ musicTastes: ["Polka"] })).resolves.toBe(true);
    await expect(rejects({ vibeTag: "Chaos" })).resolves.toBe(true);
  });

  it("refuses a name long enough to break a door list", async () => {
    await expect(rejects({ name: "x".repeat(61) })).resolves.toBe(true);
    await expect(rejects({ name: "x".repeat(60) })).resolves.toBe(false);
  });

  it("saves the profile card on the account", async () => {
    await service().updateMe("user-1", { name: "  Lerato  ", musicTastes: ["Amapiano"], vibeTag: "Party" });

    expect(users.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "Lerato", musicTastes: ["Amapiano"], vibeTag: "Party" },
      select: { id: true, name: true, avatar: true, musicTastes: true, vibeTag: true },
    });
  });

  it("leaves fields the caller did not send untouched", async () => {
    await service().updateMe("user-1", { vibeTag: "Chill" });

    expect(users.update.mock.calls[0][0].data).toEqual({ vibeTag: "Chill" });
  });

  it("clears the name instead of storing whitespace", async () => {
    await service().updateMe("user-1", { name: "   " });

    expect(users.update.mock.calls[0][0].data).toEqual({ name: null });
  });
});
