import { Injectable, NotFoundException } from "@nestjs/common";
import { EventStatus, prisma } from "@essentials/db";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;
/**
 * The public host printed on a share card. Read at request time because the env
 * file is not parsed yet when this module is imported.
 */
const siteUrl = () => (process.env.SITE_URL ?? "https://sonus.essentialsedm.com").replace(/\/$/, "");

/** SVG is hand-built, so anything from the database has to be escaped. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy wrap by character count — predictable for display type, no font metrics needed. */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (!lines.length) return [""];
  // An overlong title is cut with an ellipsis rather than spilling off the card.
  if (words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\s+\S*$/, "")}…`;
  }
  return lines;
}

interface Card {
  eyebrow: string;
  title: string;
  meta: string[];
  footer: string;
}

/**
 * 1200×630 (the size every social platform crops from) rendered from SVG, so a
 * shared link shows the night rather than a grey box. Cheap enough to build per
 * request; the response is cached at the edge for a few minutes.
 */
@Injectable()
export class ShareService {
  async card({ eyebrow, title, meta, footer }: Card): Promise<Buffer> {
    const titleLines = wrap(title.toUpperCase(), 20, 3);
    const lineHeight = 86;
    const titleTop = 250 - (titleLines.length - 1) * 42;
    const metaTop = titleTop + titleLines.length * lineHeight + 30;
    const metaLines = meta.slice(0, 3);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="space" cx="50%" cy="-10%" r="115%">
      <stop offset="0%" stop-color="#0d1838"/>
      <stop offset="52%" stop-color="#070c1c"/>
      <stop offset="100%" stop-color="#03050c"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#space)"/>
  <!-- The ringed orb from the front page, ghosted so the type stays legible. -->
  <g fill="none" stroke="#cfe3ff">
    <circle cx="1012" cy="198" r="150" stroke-opacity="0.10"/>
    <ellipse cx="1012" cy="198" rx="262" ry="94" transform="rotate(-16 1012 198)" stroke-opacity="0.16"/>
    <ellipse cx="1012" cy="198" rx="212" ry="150" transform="rotate(24 1012 198)" stroke-opacity="0.12"/>
  </g>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" fill="none" stroke="#cfe3ff" stroke-opacity="0.16"/>
  <text x="72" y="96" fill="#9fd8ff" font-family="Lato, DejaVu Sans, sans-serif" font-size="22" letter-spacing="8" font-weight="700">${esc(eyebrow)}</text>
  <text x="72" y="154" fill="#eaf6ff" font-family="DejaVu Serif, Georgia, serif" font-size="26" letter-spacing="13">SONUS</text>
${titleLines
  .map(
    (line, i) =>
      `  <text x="72" y="${titleTop + i * lineHeight}" fill="#ffffff" font-family="Lato, DejaVu Sans, sans-serif" font-size="78" font-weight="900">${esc(line)}</text>`,
  )
  .join("\n")}
${metaLines
  .map(
    (line, i) =>
      `  <text x="72" y="${metaTop + i * 42}" fill="#9dbbdd" font-family="Lato, DejaVu Sans, sans-serif" font-size="28">${esc(line)}</text>`,
  )
  .join("\n")}
  <text x="72" y="${HEIGHT - 56}" fill="#6c86a8" font-family="Lato, DejaVu Sans, sans-serif" font-size="20" letter-spacing="4">${esc(footer)}</text>
</svg>`;

    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  }

  async eventCard(id: string): Promise<Buffer> {
    const event = await prisma.event.findFirst({
      where: { id, status: { in: [EventStatus.approved, EventStatus.live] } },
      select: {
        title: true,
        date: true,
        dressCode: true,
        venue: { select: { name: true } },
        artistBookings: {
          where: { status: "confirmed" },
          select: { artist: { select: { stageName: true } } },
          orderBy: { startAt: "asc" },
          take: 4,
        },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const when = event.date.toLocaleDateString("en-ZA", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Africa/Johannesburg",
    });
    const lineup = event.artistBookings.map((b) => b.artist.stageName);
    return this.card({
      eyebrow: when.toUpperCase(),
      title: event.title,
      meta: [event.venue.name, lineup.length ? lineup.join(" · ") : "Lineup to be announced"],
      footer: `${siteUrl()}/events/${id}`,
    });
  }

  async djCard(id: string): Promise<Buffer> {
    const dj = await prisma.artistProfile.findUnique({
      where: { id },
      select: { stageName: true, bio: true },
    });
    if (!dj) throw new NotFoundException("DJ not found");

    return this.card({
      eyebrow: "SONUS ROSTER",
      title: dj.stageName,
      meta: [(dj.bio ?? "").slice(0, 90)].filter(Boolean),
      footer: `${siteUrl()}/djs/${id}`,
    });
  }
}
