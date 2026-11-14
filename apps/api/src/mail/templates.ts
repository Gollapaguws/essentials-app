import { escapeHtml } from "../common/html";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

function codePoint(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
}

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** Readable plain-text alternative for clients that do not render HTML. */
export function htmlToText(html: string) {
  const withLinks = html
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_, double: string, single: string, inner: string) => {
      const href = double ?? single;
      const label = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return label && label !== href ? ` ${label} (${href}) ` : ` ${href} `;
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n---\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(withLinks)
    .replace(/\r/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wrapTemplate(body: string, unsubscribeUrl?: string) {
  return `<div style="font-family:Helvetica,Arial,sans-serif;background:#0A0A0A;color:#ffffff">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    ${body}
    <hr style="border-color:#222;margin:24px 0" />
    <p style="color:#666;font-size:12px">
      ESSENTIALS · You receive this because you RSVP'd or signed up.
      ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#00FF66">Unsubscribe or manage preferences</a>` : ""}
    </p>
  </div>
</div>`;
}

const h1 = (t: string) => `<h1 style="color:#00FF66;letter-spacing:2px;font-size:22px">${escapeHtml(t)}</h1>`;

export const emailTemplates = {
  welcomeSeries: (name: string, inviteLink: string) => `${h1("WELCOME TO ESSENTIALS")}
  <p>${escapeHtml(name)}, you're on the list. Expect weekly drops, door passes and VIP tables — nothing else.</p>
  <p><a href="${escapeHtml(inviteLink)}" style="color:#00FF66">Set up your profile →</a></p>`,

  weeklyDrop: (name: string, events: { title: string; date: string; url: string }[]) => `${h1("ESSENTIALS THIS WEEK")}
  ${events.map((e) => `<p style="font-size:16px"><strong>${escapeHtml(e.title)}</strong><br/>${escapeHtml(e.date)} · <a href="${escapeHtml(e.url)}" style="color:#00FF66">RSVP →</a></p>`).join("")}`,

  eventReminder: (name: string, eventTitle: string, hoursAway: number, url: string) => `${h1(eventTitle.toUpperCase())}
  <p>${escapeHtml(name)}, doors in ${hoursAway === 24 ? "24 hours" : "1 hour"}. Your door pass is in the app.</p>
  <p><a href="${escapeHtml(url)}" style="background:#00FF66;color:#0A0A0A;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">OPEN DOOR PASS</a></p>`,

  whatsNew:
    (date: string, sections: { title: string; items: string[] }[], url: string) => `${h1("WHAT'S NEW")}
  <p style="color:#666;font-size:12px;letter-spacing:2px">${escapeHtml(date)}</p>
  ${sections
    .map(
      (s) => `<h2 style="color:#ffffff;font-size:14px;letter-spacing:2px;margin-top:24px">${escapeHtml(s.title)}</h2>
    <ul style="padding-left:18px;color:#cccccc;line-height:1.5">${s.items
      .map((item) => `<li style="margin:8px 0">${escapeHtml(item)}</li>`)
      .join("")}</ul>`,
    )
    .join("")}
  <p><a href="${escapeHtml(url)}" style="background:#00FF66;color:#0A0A0A;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">READ THE NOTES</a></p>`,

  winback: (name: string, eventTitle: string, url: string) => `${h1("WE MISSED YOU")}
  <p>${escapeHtml(name)}, it's been a while. ${escapeHtml(eventTitle)} is coming up — first drink on us with code ESSENTIALS.</p>
  <p><a href="${escapeHtml(url)}" style="color:#00FF66">RSVP →</a></p>`,
};
