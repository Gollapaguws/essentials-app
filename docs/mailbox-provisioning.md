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

A mailbox that already exists on the mail server — created before this feature
or by hand — is attached with **Link existing** (`POST /users/:id/mailbox/adopt`).
Adoption only writes the ownership row: the Unix account, its password and its
stored mail are untouched, and no settings email is sent because the password is
unknown.

Prisma tracks the mailbox in `UserMailbox`; every action writes an `AuthEvent`
(`mailbox_created`, `mailbox_password_reset`, `mailbox_disabled`,
`mailbox_enabled`, `mailbox_deleted`, `mailbox_settings_emailed`).

## Settings email

Creating a mailbox emails its connection details (IMAP 993 SSL, SMTP 587
STARTTLS, the address) to the account's **sign-in** address — never to the
mailbox itself, and never with the password, which the administrator passes on
separately. The dashboard's **Email settings** button re-sends it on demand via
`POST /users/:id/mailbox/settings-email`; a relay that refuses the message
returns `503` rather than reporting success.

Sign-in addresses on `MAILBOX_DOMAIN` are routed to their owner's mailbox
automatically: the map gains `smoke@domain → smoke-test@domain` for an account
whose login and mailbox differ, so notices reach a real inbox. An alias set
explicitly by an admin wins over that automatic line.

## Owner password changes

The account console (Account → Mailbox) shows the address and IMAP/SMTP details
and sets a new mailbox password through `PATCH /mailbox/me/password`. The old
password is not required, because the usual reason to be there is having lost
it; the signed-in session and its two-step verification are the gate. Passwords
must be 10–72 characters, cannot contain line breaks, are never emailed, and
are refused while the mailbox is disabled. Each change is audited as
`mailbox_password_reset_by_owner`.

## Aliases and catch-all

A mailbox can carry up to five extra local parts (for example `bookings@`). The
dashboard also has one domain-wide catch-all: everything addressed to an unknown
`@MAILBOX_DOMAIN` recipient is delivered to the chosen mailbox.

Both are written to `/etc/postfix/virtual-mailboxes` and activated with
`postmap` + `postfix reload`; the file is generated from the database and must
not be edited by hand. Postfix loads it through:

```
virtual_alias_maps = hash:/etc/postfix/virtual-mailboxes
```

With the catch-all **off** (the default), unknown addresses are rejected exactly
as before. Turning it on also captures role addresses that are not explicit
mailboxes or aliases, so enable it deliberately.

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
- `virtual_alias_maps` includes `hash:/etc/postfix/virtual-mailboxes` (the API
  creates and reloads the map; the Postfix setting must exist once).

## Deliberate limits

- **No per-mailbox quota yet.** Dovecot has no quota policy on this host, so the
  dashboard shows actual Maildir usage instead of enforcing a cap.
- **No aliases or catch-all.** One address per account.
- Deleting a mailbox is destructive and cannot be undone; the dashboard asks for
  confirmation and says so.
- Mailbox mail is stored on the mail server, not in the app database. The privacy
  notice lists mailbox content as a data category.
