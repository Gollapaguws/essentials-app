import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { prisma } from "@essentials/db";
import { AccountMailService } from "../account-mail/account-mail.service";
import { AliasMapService, CATCH_ALL_KEY } from "./alias-map.service";
import {
  MailboxProvisioner,
  isReservedLocalpart,
  isValidLocalpart,
  normaliseLocalpart,
} from "./mailbox.provisioner";

export interface MailboxView {
  id: string;
  address: string;
  localpart: string;
  aliases: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
  usedBytes: number | null;
}

interface Actor {
  id?: string | null;
  email: string;
}

function mailboxPassword(): string {
  return `Aa1${randomBytes(18).toString("base64url")}`;
}

/**
 * Admin-facing mailbox administration for real accounts on the platform mail
 * server. Sign-in email and mailbox address are deliberately separate: an admin
 * provisions `name@essentialsedm.com` without touching the login.
 */
@Injectable()
export class UserMailService {
  constructor(
    private readonly provisioner: MailboxProvisioner,
    private readonly accountMail: AccountMailService,
    private readonly aliasMap: AliasMapService,
  ) {}

  async get(userId: string) {
    const user = await this.account(userId);
    return {
      enabled: this.provisioner.enabled,
      domain: this.provisioner.domain,
      mailbox: user.mailbox ? await this.view(user.mailbox) : null,
    };
  }

  async create(userId: string, localpartInput: string | undefined, actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (user.mailbox) throw new ConflictException("This account already has a mailbox.");

    const localpart = normaliseLocalpart(localpartInput || user.email.split("@")[0]);
    if (!localpart) throw new BadRequestException("Choose an address before the @.");
    if (!isValidLocalpart(localpart)) {
      throw new BadRequestException(
        "Use 1–30 characters — letters, numbers, dots, dashes or underscores — starting and ending with a letter or number.",
      );
    }
    if (isReservedLocalpart(localpart)) {
      throw new BadRequestException(`${localpart} is reserved by the mail server.`);
    }
    if (await prisma.userMailbox.findUnique({ where: { localpart }, select: { id: true } })) {
      throw new ConflictException(`${localpart}@${this.provisioner.domain} is already assigned.`);
    }
    if (await this.provisioner.userExists(localpart)) {
      throw new ConflictException(
        `${localpart}@${this.provisioner.domain} already exists on the mail server.`,
      );
    }

    const password = mailboxPassword();
    await this.provisioner.create(localpart, password);

    let mailbox;
    try {
      mailbox = await prisma.userMailbox.create({
        data: {
          userId,
          localpart,
          address: this.provisioner.addressFor(localpart),
        },
      });
    } catch (err) {
      // No mailbox without a row: undo the Unix account if the write failed.
      await this.provisioner.remove(localpart).catch(() => null);
      throw err;
    }

    await this.audit(user.id, user.email, "mailbox_created", { localpart, actor });
    // The map carries the sign-in alias, so `name@domain` logins reach the mailbox.
    await this.aliasMap.sync();
    // Settings go to the sign-in address, never the password.
    void this.accountMail.send(user.email, { kind: "mailbox-created", address: mailbox.address });
    return { mailbox: await this.view(mailbox), password };
  }

  /**
   * Attach a mailbox that already exists on the mail server — one created before
   * this feature, or by hand. The Unix account, its password and its stored mail
   * are left exactly as they are; only the ownership row is created.
   */
  async adopt(userId: string, localpartInput: string | undefined, actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (user.mailbox) throw new ConflictException("This account already has a mailbox.");

    const localpart = normaliseLocalpart(localpartInput || user.email.split("@")[0]);
    if (!localpart) throw new BadRequestException("Choose an address before the @.");
    if (!isValidLocalpart(localpart)) {
      throw new BadRequestException(
        "Use 1–30 characters — letters, numbers, dots, dashes or underscores — starting and ending with a letter or number.",
      );
    }
    if (isReservedLocalpart(localpart)) {
      throw new BadRequestException(`${localpart} is reserved by the mail server.`);
    }
    if (await prisma.userMailbox.findUnique({ where: { localpart }, select: { id: true } })) {
      throw new ConflictException(`${localpart}@${this.provisioner.domain} is already assigned.`);
    }
    if (!(await this.provisioner.userExists(localpart))) {
      throw new BadRequestException(
        `No ${localpart}@${this.provisioner.domain} account exists on the mail server — create a new mailbox instead.`,
      );
    }

    const mailbox = await prisma.userMailbox.create({
      data: { userId, localpart, address: this.provisioner.addressFor(localpart) },
    });
    await this.aliasMap.sync();
    await this.audit(user.id, user.email, "mailbox_adopted", { localpart, actor });
    return { mailbox: await this.view(mailbox) };
  }

  /** The mailbox belonging to the signed-in account, for its own console. */
  async own(userId: string) {
    const user = await this.account(userId);
    return {
      enabled: this.provisioner.enabled,
      domain: this.provisioner.domain,
      mailbox: user.mailbox ? await this.view(user.mailbox) : null,
    };
  }

  /**
   * Owner-initiated password change. The old password is not required — a user
   * who has lost it must still be able to recover without an administrator.
   */
  async setOwnPassword(userId: string, password: string, actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (!user.mailbox) throw new NotFoundException("This account has no mailbox.");
    if (user.mailbox.status !== "active") {
      throw new ConflictException("This mailbox is disabled. Ask an administrator to re-enable it.");
    }
    if (password.length < 10 || password.length > 72) {
      throw new BadRequestException("Use a password between 10 and 72 characters.");
    }
    if (/[\r\n]/.test(password)) {
      throw new BadRequestException("The password cannot contain line breaks.");
    }

    await this.provisioner.setPassword(user.mailbox.localpart, password);
    await this.audit(user.id, user.email, "mailbox_password_reset_by_owner", {
      address: user.mailbox.address,
      actor,
    });
    return { ok: true };
  }

  /** Re-send the connection settings to the account's sign-in address. */
  async emailSettings(userId: string, actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (!user.mailbox) throw new NotFoundException("This account has no mailbox.");

    const sent = await this.accountMail.send(user.email, {
      kind: "mailbox-created",
      address: user.mailbox.address,
    });
    if (!sent) {
      throw new ServiceUnavailableException(
        "The mail relay did not accept the message, so the settings were not sent. Check the sign-in address and the mail log.",
      );
    }

    await this.audit(user.id, user.email, "mailbox_settings_emailed", {
      to: user.email,
      address: user.mailbox.address,
      actor,
    });
    return { to: user.email, address: user.mailbox.address };
  }

  /** Replace the extra local parts that deliver to this mailbox. */
  async updateAliases(userId: string, input: string[], actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (!user.mailbox) throw new NotFoundException("This account has no mailbox.");

    const aliases = [...new Set(input.map(normaliseLocalpart).filter(Boolean))];
    if (aliases.length > 5) throw new BadRequestException("A mailbox can have at most 5 aliases.");

    const others = await prisma.userMailbox.findMany({
      where: { NOT: { userId } },
      select: { localpart: true, aliases: true },
    });
    const taken = new Set<string>();
    for (const other of others) {
      taken.add(other.localpart);
      for (const alias of other.aliases) taken.add(alias);
    }

    for (const alias of aliases) {
      if (alias === user.mailbox.localpart) {
        throw new BadRequestException("The mailbox's own address does not need an alias.");
      }
      if (!isValidLocalpart(alias)) {
        throw new BadRequestException(
          `“${alias}” is not a valid address: use 1–30 letters, numbers, dots, dashes or underscores.`,
        );
      }
      if (isReservedLocalpart(alias)) {
        throw new BadRequestException(`${alias} is reserved by the mail server.`);
      }
      if (taken.has(alias)) {
        throw new ConflictException(`${alias}@${this.provisioner.domain} is already in use.`);
      }
      if (await this.provisioner.userExists(alias)) {
        throw new ConflictException(`${alias}@${this.provisioner.domain} already exists on the mail server.`);
      }
    }

    const updated = await prisma.userMailbox.update({ where: { userId }, data: { aliases } });
    await this.aliasMap.sync();
    await this.audit(user.id, user.email, "mailbox_aliases_changed", { aliases, actor });
    return { mailbox: await this.view(updated) };
  }

  async getCatchAll() {
    const setting = await prisma.platformSetting.findUnique({ where: { key: CATCH_ALL_KEY } });
    return { address: setting?.value || null, domain: this.provisioner.domain };
  }

  /** One domain-wide catch-all: everything unknown goes to this mailbox. */
  async setCatchAll(addressInput: string | null, actor?: Actor) {
    this.assertEnabled();
    const address = addressInput?.trim().toLowerCase() || null;

    if (!address) {
      await prisma.platformSetting.deleteMany({ where: { key: CATCH_ALL_KEY } });
      await this.aliasMap.sync();
      return { address: null, domain: this.provisioner.domain };
    }

    const mailbox = await prisma.userMailbox.findUnique({ where: { address }, select: { userId: true } });
    if (!mailbox) {
      throw new BadRequestException("The catch-all must point at an existing provisioned mailbox.");
    }

    await prisma.platformSetting.upsert({
      where: { key: CATCH_ALL_KEY },
      create: { key: CATCH_ALL_KEY, value: address },
      update: { value: address },
    });
    await this.aliasMap.sync();
    await this.audit(mailbox.userId, address, "mailbox_catch_all_changed", { address, actor });
    return { address, domain: this.provisioner.domain };
  }

  async resetPassword(userId: string, actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (!user.mailbox) throw new NotFoundException("This account has no mailbox.");

    const password = mailboxPassword();
    await this.provisioner.setPassword(user.mailbox.localpart, password);
    await this.audit(user.id, user.email, "mailbox_password_reset", {
      localpart: user.mailbox.localpart,
      actor,
    });
    return { password };
  }

  async setStatus(userId: string, status: "active" | "disabled", actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (!user.mailbox) throw new NotFoundException("This account has no mailbox.");

    if (user.mailbox.status !== status) {
      await this.provisioner.setLocked(user.mailbox.localpart, status === "disabled");
      const updated = await prisma.userMailbox.update({ where: { userId }, data: { status } });
      await this.audit(
        user.id,
        user.email,
        status === "disabled" ? "mailbox_disabled" : "mailbox_enabled",
        { localpart: user.mailbox.localpart, actor },
      );
      return { mailbox: await this.view(updated) };
    }

    return { mailbox: await this.view(user.mailbox) };
  }

  async remove(userId: string, actor?: Actor) {
    this.assertEnabled();
    const user = await this.account(userId);
    if (!user.mailbox) throw new NotFoundException("This account has no mailbox.");

    const { localpart } = user.mailbox;
    if (await this.provisioner.userExists(localpart)) {
      await this.provisioner.remove(localpart);
    }
    await prisma.userMailbox.delete({ where: { userId } });
    await this.audit(user.id, user.email, "mailbox_deleted", { localpart, actor });
    return { removed: true };
  }

  private assertEnabled() {
    if (!this.provisioner.enabled) {
      throw new ServiceUnavailableException(
        "Mailbox provisioning is not enabled on this server (set MAILBOX_PROVISIONING=1).",
      );
    }
  }

  private async account(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, mailbox: true },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  private async view(mailbox: {
    id: string;
    address: string;
    localpart: string;
    aliases: string[];
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<MailboxView> {
    return {
      ...mailbox,
      usedBytes: await this.provisioner.usageBytes(mailbox.localpart),
    };
  }

  private async audit(userId: string, email: string, kind: string, meta: unknown) {
    await prisma.authEvent.create({ data: { kind, userId, email, meta: meta as object } }).catch(
      () => null,
    );
  }
}
