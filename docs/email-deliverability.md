# Email — the mail host and its DNS

The VPS runs the domain's mail itself: Postfix on `25` (inbound) and `587`
(submission), Dovecot on `143`/`993`, mailboxes in `/home/<localpart>/Maildir`.
The console reads that store through `doveadm`, so the same mailbox password works
in any IMAP client.

`essentialsedm.com` DNS lives at **Hostinger**, delegated from the `.com` zone to
`aurora.dns-parking.com` and `nebula.dns-parking.com`. Records are edited in
hPanel → *Domains → DNS / Nameservers → DNS records*; there is no API. The old
Bluehost zone (`ns1/ns2.bluehost.com`) still answers if queried directly but is no
longer authoritative — ignore it.

## How mail moves

**Inbound.** External MTA → `MX 10 mail.essentialsedm.com` → `72.62.211.31:25`
(Postfix) → `relay=local … delivered to maildir` → Dovecot. Verified end to end on
2026-11-24 with a live message from Amazon SES: accepted, delivered, readable over
IMAP and visible in the console.

**Outbound.** Console and account mail submit through **Resend**, whose
`essentialsedm.com` domain is verified (DKIM, SPF, MX and return-path all green in
Resend → Domains). `relay()` in `apps/api/src/mail/mail.service.ts` picks
`smtp.resend.com` whenever `RESEND_API_KEY` is set in
`/opt/essentials/app/.env`, falling back to `SMTP_HOST` (`127.0.0.1:25`, local
Postfix) otherwise.

That fallback is **not authenticated today**: Postfix signs with selector
`default`, but `default._domainkey` is unpublished, and the apex SPF does not list
`72.62.211.31`. Anything that falls back to local Postfix will fail both SPF and
DKIM at Gmail (`550 5.7.26 … sender is unauthenticated`). Fixing that needs the two
records under *Outstanding* below. Mail sent through Resend is unaffected.

## The zone as it stands

All of these are live at `aurora.dns-parking.com` (serial `2026112403`).

| Record | Host | Value | Purpose |
|---|---|---|---|
| A | `@` | `72.62.211.31` | the VPS |
| CNAME | `www` | `essentialsedm.com.` | site |
| A | `sonus` | `72.62.211.31` | console host |
| A | `mail` | `72.62.211.31` | the MX target |
| MX | `@` | `10 mail.essentialsedm.com.` | inbound mail |
| TXT | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` | SPF |
| TXT | `_dmarc` | `v=DMARC1; p=none` | DMARC (monitor only) |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCPJg2wkA4oN51ZmPBhoU1ItAFIPbUluHuK60ECkoLh14yqsf1i6xAlv3wmmbWBIgf81nWLVLJ09DElXvnykoQ9jw55PSYglA4gBKy5HhtHcIX5pXuJ9FF+wL3j9z6SmgOPmIPvc01yjCnl54TiZSHjBglTlY1b1+Jvnm9usiyLwIDAQAB` | Resend DKIM |
| MX | `send` | `10 feedback-smtp.eu-west-1.amazonses.com.` | Resend bounce domain |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | Resend bounce SPF |
| CNAME | `rsend` | `send.forge.rmta.net.` | Resend return-path |

PTR for `72.62.211.31` is `mail.essentialsedm.com.` — keep it, most receivers
require forward-confirmed reverse DNS from a sending host.

Keep the apex TXT as one SPF record. A second `v=spf1` record makes SPF
permanently fail, and stay inside the 10-DNS-lookup limit when adding includes.

## Outstanding — apply at Hostinger

**1. Publish `default._domainkey`** (TXT, host `default._domainkey`). Postfix's
milter signs every `*@essentialsedm.com` message with this key, so publishing it is
what makes local-Postfix mail pass DKIM. Value, as one string (`h=sha256; k=rsa; p=…`):

```
v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtD5rd3hd5Gtg2uZ23Kr7mHBcM1AxlLXY7Hgp/IhoSOjLCSeTEndFiWC2GPXZDnad9q8lGfBQWsYKPigFRu45ug+o/tfIbWlGp8xl8xirkESrQAViMyj/d7i96zGSo72g0q13z/jHn6FatjXRq8bed+N4WiWjWZ0VYzt2BqLcbtzK0in06VElvx2iFlHcBqb8O6FPYY/VFiXB2emeefpFcpi5OKbLUnuezVudWCFjZXEnfN9/9dqeRfw6aBsFXEWJSsbo7GwN99dTzTNU7q3l9/C0ofZbmido7PSyDw/chbzwo2JpL+Y9l0iYMMb5EyLhz+/0G92WTPFutmCxoq196wIDAQAB
```

`opendkim-testkey -d essentialsedm.com -s default -vvv` reports `key OK` against the
local key even when DNS is empty or stale — compare with `dig` before believing it.

**2. Add this host's IP to SPF** — `@` (TXT):

```
v=spf1 include:_spf.mail.hostinger.com ip4:72.62.211.31 ~all
```

Only needed for mail that leaves from the VPS directly rather than through Resend.

**3. Tighten DMARC once 1 and 2 pass** (optional):

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@essentialsedm.com
```

## Mailbox client settings

| | Value |
|---|---|
| IMAP | `mail.essentialsedm.com`, port `993`, SSL/TLS |
| SMTP | `mail.essentialsedm.com`, port `587`, STARTTLS, authentication required |
| Username | the full address, e.g. `refrakt@essentialsedm.com` |
| Password | issued at provisioning; reset from Account → Mailbox |

Port 25 is inbound only — never offer it as a submission port to clients.

## Verifying

```bash
dig +short MX essentialsedm.com                    # 10 mail.essentialsedm.com.
dig +short A mail.essentialsedm.com                # 72.62.211.31
dig +short TXT essentialsedm.com                   # one SPF record, with ip4:
dig +short TXT default._domainkey.essentialsedm.com  # empty = still outstanding
opendkim-testkey -d essentialsedm.com -s default -vvv
```

Inbound, in one pass: send from an outside account, then

```bash
journalctl -u postfix --since '-5 min' | grep -E 'connect from|status=sent'
doveadm search -u refrakt mailbox INBOX ALL
doveadm mailbox status -u refrakt "messages unseen" INBOX
```

The status command takes its field list as a single argument — split fields make
Dovecot silently omit `unseen`, which is how the console once showed zero unread
everywhere.

## Gotchas worth remembering

- **Reachability, not `ufw`, is the usual cause of "mail does not arrive".** On
  2026-11-24 every mail port was filtered upstream at the provider while 443
  worked: `ss` showed listeners, `ufw` allowed them, and only a packet capture
  proved no SYN ever arrived. Test with `tcpdump -i eth0 -n 'tcp port 25'` during a
  probe from outside; port scanners frequently report false negatives because they
  block outbound 25 themselves.
- **Resend suppressions persist.** A bounced test recipient stays suppressed and
  later sends return `suppressed` rather than delivering. Clear one with
  `DELETE https://api.resend.com/suppressions/<address>`.
- **Cached MX outlives the change.** Resolvers holding the old answer keep sending
  to it until their TTL expires; Google and Cloudflare moved within the hour,
  Quad9 and OpenDNS took hours. Check with
  `dig +short MX essentialsedm.com @9.9.9.9`.
- Unknown recipients are rejected on purpose — there is no catch-all; pointing MX
  here for an address with no mailbox produces a legitimate `550`.
