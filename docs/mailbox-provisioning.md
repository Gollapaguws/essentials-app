# User mailbox provisioning

Admins can give an account a real mailbox on the platform mail server —
`name@essentialsedm.com` — from **Dashboard → Users → Add mailbox**. The mailbox
is deliberately separate from the sign-in email: changing one never changes the
other.

## What the API does

| Action | System change |
| --- | --- |
| Create | `useradd -m -U -s /usr/sbin/nologin`, `chpasswd`, Maildir |
| Reset password | `chpasswd` (old password stops working) |
| Disable | `usermod -L` — IMAP, POP and SMTP AUTH reject the account |
| Enable | `usermod -U` |
| Delete | `userdel -r` — removes the account and its stored mail |

Every command receives validated argv entries, never a shell string. Local
parts must be 1–30 characters of `[a-z0-9._-]`, start and end with a letter or
number, and must not collide with a reserved name or an existing Unix account
(`getent passwd`). The password is generated, returned once, and never stored.

Prisma tracks the mailbox in `UserMailbox`; every action writes an `AuthEvent`
(`mailbox_created`, `mailbox_password_reset`, `mailbox_disabled`,
`mailbox_enabled`, `mailbox_deleted`).

## Host requirements

- The API must run with permission to manage Unix accounts (the systemd unit on
  this VPS runs as root).
- Postfix accepts local recipients from `mydestination` and Dovecot
  authenticates system users through PAM — both already true on
  `mail.essentialsedm.com`.
- Submission (587) authenticates through Dovecot, so a provisioned mailbox can
  also send.
- `MAILBOX_PROVISIONING=1` and `MAILBOX_DOMAIN=essentialsedm.com` in the API env.
  With the flag unset the endpoints answer `503` and the dashboard shows that
  provisioning is off.

## Deliberate limits

- **No per-mailbox quota yet.** Dovecot has no quota policy on this host, so the
  dashboard shows actual Maildir usage instead of enforcing a cap.
- **No aliases or catch-all.** One address per account.
- Deleting a mailbox is destructive and cannot be undone; the dashboard asks for
  confirmation and says so.
- Mailbox mail is stored on the mail server, not in the app database. The privacy
  notice lists mailbox content as a data category.
