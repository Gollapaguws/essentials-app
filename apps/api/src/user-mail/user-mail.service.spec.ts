import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { AliasMapService } from "./alias-map.service";
import { renderAliasMap } from "./alias-map.service";
import type { MailboxProvisioner } from "./mailbox.provisioner";
import { isReservedLocalpart, isValidLocalpart, normaliseLocalpart } from "./mailbox.provisioner";
import { UserMailService } from "./user-mail.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    userMailbox: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    authEvent: { create: jest.fn() },
  },
}));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock };
  userMailbox: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  authEvent: { create: jest.Mock };
};

const USER = { id: "u1", email: "dj@example.com", mailbox: null };

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const provisioner = {
    enabled: true,
    domain: "essentialsedm.com",
    addressFor: (localpart: string) => `${localpart}@essentialsedm.com`,
    userExists: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockResolvedValue(undefined),
    setPassword: jest.fn().mockResolvedValue(undefined),
    setLocked: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    usageBytes: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
  const accountMail = { send: jest.fn().mockResolvedValue(true) };
  const aliasMap = { sync: jest.fn().mockResolvedValue(true) };
  return {
    provisioner,
    accountMail,
    aliasMap,
    service: new UserMailService(
      provisioner as unknown as MailboxProvisioner,
      accountMail as unknown as import("../account-mail/account-mail.service").AccountMailService,
      aliasMap as unknown as AliasMapService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.user.findUnique.mockResolvedValue(USER);
  db.userMailbox.findUnique.mockResolvedValue(null);
  db.authEvent.create.mockResolvedValue({});
});

describe("alias map", () => {
  it("renders one line per alias plus the catch-all when set", () => {
    const map = renderAliasMap(
      [{ address: "dj@essentialsedm.com", aliases: ["bookings", "dj"] }],
      "crew@essentialsedm.com",
      "essentialsedm.com",
    );

    expect(map).toContain("bookings@essentialsedm.com\tdj@essentialsedm.com");
    expect(map).toContain("dj@essentialsedm.com\tdj@essentialsedm.com");
    expect(map).toContain("@essentialsedm.com\tcrew@essentialsedm.com");
    expect(map.startsWith("# Managed")).toBe(true);
  });

  it("omits the catch-all line when it is off", () => {
    const map = renderAliasMap([], null, "essentialsedm.com");
    expect(map).not.toContain("@essentialsedm.com\t");
  });

  it("routes a sign-in address to its mailbox, letting an explicit alias win", () => {
    const map = renderAliasMap(
      [{ address: "smoke-test@essentialsedm.com", aliases: ["bookings"] }],
      null,
      "essentialsedm.com",
      [
        { localpart: "smoke", address: "smoke-test@essentialsedm.com" },
        { localpart: "bookings", address: "smoke-test@essentialsedm.com" },
      ],
    );

    expect(map).toContain("smoke@essentialsedm.com\tsmoke-test@essentialsedm.com");
    expect(map.match(/bookings@essentialsedm\.com/g)).toHaveLength(1);
  });
});

describe("local-part rules", () => {
  it("normalises case, spaces and punctuation", () => {
    expect(normaliseLocalpart("  DJ Snake!  ")).toBe("dj-snake");
    expect(normaliseLocalpart("--a..b--")).toBe("a..b");
  });

  it("rejects reserved and malformed names", () => {
    expect(isReservedLocalpart("postmaster")).toBe(true);
    expect(isValidLocalpart("postmaster")).toBe(true);
    expect(isValidLocalpart("a..b")).toBe(false);
    expect(isValidLocalpart("-a")).toBe(false);
    expect(isValidLocalpart("a".repeat(31))).toBe(false);
    expect(isValidLocalpart("a")).toBe(true);
  });
});

describe("UserMailService", () => {
  it("refuses when provisioning is disabled on the server", async () => {
    const { service } = setup({ enabled: false });
    await expect(service.create("u1", "dj", { email: "admin@example.com" })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("refuses a reserved address", async () => {
    const { service, provisioner } = setup();
    await expect(service.create("u1", "postmaster")).rejects.toBeInstanceOf(BadRequestException);
    expect(provisioner.create).not.toHaveBeenCalled();
  });

  it("refuses an address that already exists on the mail server", async () => {
    const { service } = setup({ userExists: jest.fn().mockResolvedValue(true) });
    await expect(service.create("u1", "info")).rejects.toBeInstanceOf(ConflictException);
  });

  it("provisions, stores, audits and returns the password once", async () => {
    const mailbox = {
      id: "m1",
      userId: "u1",
      address: "dj@essentialsedm.com",
      localpart: "dj",
      aliases: [],
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.userMailbox.findMany.mockResolvedValue([]);
    db.userMailbox.create.mockResolvedValue(mailbox);
    const { service, provisioner, accountMail } = setup();

    const result = await service.create("u1", "dj", { email: "admin@example.com" });

    expect(provisioner.create).toHaveBeenCalledWith("dj", expect.stringMatching(/^Aa1/));
    expect(result.mailbox.address).toBe("dj@essentialsedm.com");
    expect(result.password).toMatch(/^Aa1/);
    expect(db.userMailbox.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ localpart: "dj", userId: "u1" }) }),
    );
    expect(db.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "mailbox_created" }) }),
    );
    expect(accountMail.send).toHaveBeenCalledWith("dj@example.com", {
      kind: "mailbox-created",
      address: "dj@essentialsedm.com",
    });
  });

  it("removes the Unix account when the database write fails", async () => {
    db.userMailbox.create.mockRejectedValue(new Error("unique constraint"));
    const { service, provisioner } = setup();

    await expect(service.create("u1", "dj")).rejects.toThrow("unique constraint");
    expect(provisioner.remove).toHaveBeenCalledWith("dj");
  });

  it("locks the mailbox password when disabled", async () => {
    db.user.findUnique.mockResolvedValue({
      ...USER,
      mailbox: {
        id: "m1",
        userId: "u1",
        address: "dj@essentialsedm.com",
        localpart: "dj",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    db.userMailbox.update.mockResolvedValue({
      id: "m1",
      userId: "u1",
      address: "dj@essentialsedm.com",
      localpart: "dj",
      status: "disabled",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { service, provisioner } = setup();

    const result = await service.setStatus("u1", "disabled");

    expect(provisioner.setLocked).toHaveBeenCalledWith("dj", true);
    expect(result.mailbox.status).toBe("disabled");
  });

  it("saves aliases and rewrites the Postfix map", async () => {
    db.user.findUnique.mockResolvedValue({
      ...USER,
      mailbox: {
        id: "m1",
        userId: "u1",
        address: "dj@essentialsedm.com",
        localpart: "dj",
        aliases: [],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    db.userMailbox.findMany.mockResolvedValue([]);
    db.userMailbox.update.mockResolvedValue({
      id: "m1",
      userId: "u1",
      address: "dj@essentialsedm.com",
      localpart: "dj",
      aliases: ["bookings"],
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { service, aliasMap } = setup();

    const result = await service.updateAliases("u1", ["Bookings", "bookings"]);

    expect(db.userMailbox.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { aliases: ["bookings"] },
    });
    expect(aliasMap.sync).toHaveBeenCalled();
    expect(result.mailbox.aliases).toEqual(["bookings"]);
  });

  it("emails the settings to the sign-in address on request", async () => {
    db.user.findUnique.mockResolvedValue({
      ...USER,
      mailbox: {
        id: "m1",
        userId: "u1",
        address: "dj@essentialsedm.com",
        localpart: "dj",
        aliases: [],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const { service, accountMail } = setup();

    const result = await service.emailSettings("u1", { email: "admin@example.com" });

    expect(accountMail.send).toHaveBeenCalledWith("dj@example.com", {
      kind: "mailbox-created",
      address: "dj@essentialsedm.com",
    });
    expect(result).toEqual({ to: "dj@example.com", address: "dj@essentialsedm.com" });
    expect(db.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "mailbox_settings_emailed" }),
      }),
    );
  });

  it("refuses to email settings when the account has no mailbox", async () => {
    const { service } = setup();
    await expect(service.emailSettings("u1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("reports a relay failure instead of claiming the settings were sent", async () => {
    db.user.findUnique.mockResolvedValue({
      ...USER,
      mailbox: {
        id: "m1",
        userId: "u1",
        address: "dj@essentialsedm.com",
        localpart: "dj",
        aliases: [],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const { service, accountMail } = setup();
    accountMail.send.mockResolvedValue(false);

    await expect(service.emailSettings("u1")).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("links a mailbox that already exists without touching it", async () => {
    const mailbox = {
      id: "m1",
      userId: "u1",
      address: "admin@essentialsedm.com",
      localpart: "admin",
      aliases: [],
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.userMailbox.create.mockResolvedValue(mailbox);
    const { service, provisioner, accountMail, aliasMap } = setup({
      userExists: jest.fn().mockResolvedValue(true),
    });

    const result = await service.adopt("u1", "admin", { email: "admin@example.com" });

    expect(provisioner.create).not.toHaveBeenCalled();
    expect(provisioner.setPassword).not.toHaveBeenCalled();
    expect(accountMail.send).not.toHaveBeenCalled();
    expect(aliasMap.sync).toHaveBeenCalled();
    expect(result.mailbox.address).toBe("admin@essentialsedm.com");
    expect(db.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "mailbox_adopted" }),
      }),
    );
  });

  it("refuses to link an address with no mail account on the server", async () => {
    const { service } = setup();
    await expect(service.adopt("u1", "nobody")).rejects.toBeInstanceOf(BadRequestException);
    expect(db.userMailbox.create).not.toHaveBeenCalled();
  });

  it("lets the owner set a new mailbox password without the old one", async () => {
    db.user.findUnique.mockResolvedValue({
      ...USER,
      mailbox: {
        id: "m1",
        userId: "u1",
        address: "dj@essentialsedm.com",
        localpart: "dj",
        aliases: [],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const { service, provisioner } = setup();

    await expect(service.setOwnPassword("u1", "correct horse battery")).resolves.toEqual({
      ok: true,
    });
    expect(provisioner.setPassword).toHaveBeenCalledWith("dj", "correct horse battery");
    expect(db.authEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "mailbox_password_reset_by_owner" }),
      }),
    );
  });

  it("rejects short passwords and line breaks from the owner", async () => {
    db.user.findUnique.mockResolvedValue({
      ...USER,
      mailbox: {
        id: "m1",
        userId: "u1",
        address: "dj@essentialsedm.com",
        localpart: "dj",
        aliases: [],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const { service, provisioner } = setup();

    await expect(service.setOwnPassword("u1", "short")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.setOwnPassword("u1", "longenough\ndj:evil"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provisioner.setPassword).not.toHaveBeenCalled();
  });

  it("refuses an owner password change while the mailbox is disabled", async () => {
    db.user.findUnique.mockResolvedValue({
      ...USER,
      mailbox: {
        id: "m1",
        userId: "u1",
        address: "dj@essentialsedm.com",
        localpart: "dj",
        aliases: [],
        status: "disabled",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const { service, provisioner } = setup();

    await expect(service.setOwnPassword("u1", "correct horse battery")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(provisioner.setPassword).not.toHaveBeenCalled();
  });

  it("refuses a catch-all that is not a provisioned mailbox", async () => {
    db.userMailbox.findUnique.mockResolvedValue(null);
    const { service } = setup();
    await expect(service.setCatchAll("nobody@essentialsedm.com")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
