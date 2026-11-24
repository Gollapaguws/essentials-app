import { Injectable, NotFoundException } from "@nestjs/common";
import { EventStatus, prisma } from "@essentials/db";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;
const SITE = "https://essentialsedm.com";

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
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fade)"/>
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="#c6ff3d"/>
  <text x="72" y="96" fill="#c6ff3d" font-family="Lato, DejaVu Sans, sans-serif" font-size="22" letter-spacing="8" font-weight="700">${esc(eyebrow)}</text>
  <text x="72" y="150" fill="#f5f5f5" font-family="Lato, DejaVu Sans, sans-serif" font-size="30" letter-spacing="14" font-weight="700">ESSENTIALS</text>
${titleLines
  .map(
    (line, i) =>
      `  <text x="72" y="${titleTop + i * lineHeight}" fill="#ffffff" font-family="Lato, DejaVu Sans, sans-serif" font-size="78" font-weight="900">${esc(line)}</text>`,
  )
  .join("\n")}
${metaLines
  .map(
    (line, i) =>
      `  <text x="72" y="${metaTop + i * 42}" fill="#a3a3a3" font-family="Lato, DejaVu Sans, sans-serif" font-size="28">${esc(line)}</text>`,
  )
  .join("\n")}
  <text x="72" y="${HEIGHT - 56}" fill="#525252" font-family="Lato, DejaVu Sans, sans-serif" font-size="20" letter-spacing="4">${esc(footer)}</text>
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
      footer: `${SITE}/events/${id}`,
    });
  }

  async djCard(id: string): Promise<Buffer> {
    const dj = await prisma.artistProfile.findUnique({
      where: { id },
      select: { stageName: true, bio: true },
    });
    if (!dj) throw new NotFoundException("DJ not found");

    return this.card({
      eyebrow: "ESSENTIALS ROSTER",
      title: dj.stageName,
      meta: [(dj.bio ?? "").slice(0, 90)].filter(Boolean),
      footer: `${SITE}/djs/${id}`,
    });
  }
}
