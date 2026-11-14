import { Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

export interface ChangelogItem {
  /** The bold lead sentence, when the note starts with one. */
  title: string | null;
  text: string;
}

export interface ChangelogSection {
  title: string;
  items: ChangelogItem[];
}

export interface ChangelogRelease {
  /** Release date, `YYYY-MM-DD`. Doubles as the id for "already announced". */
  date: string;
  sections: ChangelogSection[];
}

export interface Changelog {
  /** File mtime, or null when the notes could not be read. */
  updatedAt: string | null;
  releases: ChangelogRelease[];
}

/** Inline markdown that would only be noise on a customer-facing page. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parse(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;
  let openItem = false;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      // Only a dated h2 opens a release; anything else (the README-style title,
      // a future "Archive" heading) closes the current one.
      const dated = heading[1].match(/^(\d{4}-\d{2}-\d{2})$/);
      release = dated ? { date: dated[1], sections: [] } : null;
      if (release) releases.push(release);
      section = null;
      openItem = false;
      continue;
    }

    const subheading = line.match(/^###\s+(.+?)\s*$/);
    if (subheading && release) {
      section = { title: plain(subheading[1]), items: [] };
      release.sections.push(section);
      openItem = false;
      continue;
    }

    if (!release || !section) continue;

    if (/^\s*-\s+/.test(line)) {
      const body = line.replace(/^\s*-\s+/, "").trim();
      const bold = body.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      section.items.push({
        title: bold ? plain(bold[1]) : null,
        text: plain(bold ? bold[2] : body),
      });
      openItem = true;
      continue;
    }

    if (!line.trim()) {
      openItem = false;
      continue;
    }

    // A wrapped bullet continues on the next lines, indented.
    if (openItem && section.items.length) {
      const last = section.items[section.items.length - 1];
      last.text = plain(`${last.text} ${line.trim()}`);
    }
  }

  return releases.filter((r) => r.sections.some((s) => s.items.length > 0));
}

/**
 * The release notes on the site, read from the repo's `CHANGELOG.md`.
 *
 * Re-read whenever the file changes (checked by mtime/size), so editing the
 * changelog and deploying is enough for new entries to appear — no build and no
 * restart. A missing file is not an error: the page simply has nothing to show.
 */
@Injectable()
export class ChangelogService {
  private readonly logger = new Logger(ChangelogService.name);
  private cache?: { key: string; changelog: Changelog };
  private warned = false;

  /** `CHANGELOG_PATH` is authoritative; otherwise the first existing candidate wins. */
  private path(): string | null {
    const configured = process.env.CHANGELOG_PATH;
    if (configured) return existsSync(configured) ? configured : null;

    const candidates = [
      resolve(process.cwd(), "CHANGELOG.md"),
      resolve(process.cwd(), "../../CHANGELOG.md"),
      // dist/site|src/site → apps/api/dist|src → apps/api → apps → repo root
      resolve(__dirname, "../../../../CHANGELOG.md"),
    ].filter(Boolean) as string[];
    return candidates.find((p) => existsSync(p)) ?? null;
  }

  get(): Changelog {
    const file = this.path();
    if (!file) {
      if (!this.warned) {
        this.logger.warn("CHANGELOG.md not found; the site's what's-new page has no entries");
        this.warned = true;
      }
      return { updatedAt: null, releases: [] };
    }

    try {
      const stat = statSync(file);
      const key = `${file}:${stat.mtimeMs}:${stat.size}`;
      if (this.cache?.key === key) return this.cache.changelog;

      const changelog: Changelog = {
        updatedAt: stat.mtime.toISOString(),
        releases: parse(readFileSync(file, "utf8")),
      };
      this.cache = { key, changelog };
      return changelog;
    } catch (err) {
      this.logger.error(`could not read ${file}: ${(err as Error).message}`);
      return { updatedAt: null, releases: [] };
    }
  }

  /** Newest release, or null when the notes are empty. */
  async latest(): Promise<ChangelogRelease | null> {
    return this.get().releases[0] ?? null;
  }
}
