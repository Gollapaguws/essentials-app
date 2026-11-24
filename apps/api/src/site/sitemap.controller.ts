import { Controller, Get, Header } from "@nestjs/common";
import { PublicDjsService } from "./public-djs.service";
import { PublicEventsService } from "./public-events.service";

const SITE = "https://essentialsedm.com";

interface Url {
  path: string;
  lastmod?: string;
  priority: string;
  changefreq: "daily" | "weekly" | "monthly";
}

function xml(urls: Url[]): string {
  const rows = urls
    .map(
      (u) => `  <url>
    <loc>${SITE}${u.path}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows}
</urlset>
`;
}

/**
 * Served at /sitemap.xml (nginx proxies it here). Generated from live data so a
 * newly announced night is discoverable without a rebuild; the static pages are
 * listed first because they change least.
 */
@Controller("site")
export class SitemapController {
  constructor(
    private readonly events: PublicEventsService,
    private readonly djs: PublicDjsService,
  ) {}

  @Get("sitemap")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=900")
  async sitemap(): Promise<string> {
    const [events, djs] = await Promise.all([this.events.list(), this.djs.list()]);
    const today = new Date().toISOString().slice(0, 10);

    return xml([
      { path: "/", priority: "1.0", changefreq: "weekly" },
      { path: "/events", priority: "0.9", changefreq: "daily" },
      ...events.map((e) => ({
        path: `/events/${e.id}`,
        lastmod: new Date(e.date).toISOString().slice(0, 10),
        priority: "0.8",
        changefreq: "weekly" as const,
      })),
      ...djs.map((d) => ({
        path: `/djs/${d.id}`,
        lastmod: today,
        priority: "0.6",
        changefreq: "monthly" as const,
      })),
      { path: "/whats-new", priority: "0.4", changefreq: "weekly" as const },
      { path: "/privacy", priority: "0.2", changefreq: "monthly" as const },
    ]);
  }
}
