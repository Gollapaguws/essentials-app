import { escapeHtml } from "../common/html";

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

  winback: (name: string, eventTitle: string, url: string) => `${h1("WE MISSED YOU")}
  <p>${escapeHtml(name)}, it's been a while. ${escapeHtml(eventTitle)} is coming up — first drink on us with code ESSENTIALS.</p>
  <p><a href="${escapeHtml(url)}" style="color:#00FF66">RSVP →</a></p>`,
};
