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
    // Settings go to the sign-in address, never the password.
    void this.accountMail.send(user.email, { kind: "mailbox-created", address: mailbox.address });
    return { mailbox: await this.view(mailbox), password };
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
