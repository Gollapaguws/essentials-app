import { mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ChangelogService } from "./changelog.service";

const NOTES = `# Changelog

Notable changes to SONUS. Dates are UTC.

## 2026-11-12

### Front page

- **A confirmed event puts itself on the lineup.** \`GET /api/site/content\` now
  merges every approved event.
- Public events carry an \`artists\` array.

### Fixes

- **Sign-in loop.** The effect keyed on parsed strings.

## 2026-11-08

### Security

- Closed a mass-assignment hole.
`;

const saved = process.env.CHANGELOG_PATH;

function write(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), "changelog-"));
  const file = join(dir, "CHANGELOG.md");
  writeFileSync(file, contents);
  process.env.CHANGELOG_PATH = file;
  return file;
}

afterEach(() => {
  if (saved === undefined) delete process.env.CHANGELOG_PATH;
  else process.env.CHANGELOG_PATH = saved;
});

describe("ChangelogService", () => {
  it("reads dated releases, sections and wrapped items in order", () => {
    write(NOTES);
    const { releases } = new ChangelogService().get();

    expect(releases.map((r) => r.date)).toEqual(["2026-11-12", "2026-11-08"]);
    expect(releases[0].sections.map((s) => s.title)).toEqual(["Front page", "Fixes"]);

    expect(releases[0].sections[0].items).toEqual([
      { title: "A confirmed event puts itself on the lineup.", text: "GET /api/site/content now merges every approved event." },
      { title: null, text: "Public events carry an artists array." },
    ]);
  });

  it("picks up an edit without a restart", () => {
    const file = write(NOTES);
    const service = new ChangelogService();
    expect(service.get().releases).toHaveLength(2);

    writeFileSync(file, NOTES.replace("## 2026-11-12", "## 2026-11-20"));
    // Force a different mtime; the cache keys on mtime and size.
    const later = new Date(Date.now() + 5_000);
    utimesSync(file, later, later);

    expect(service.get().releases[0].date).toBe("2026-11-20");
  });

  it("latest() is the newest release, and null when the notes are empty", async () => {
    write(NOTES);
    expect((await new ChangelogService().latest())?.date).toBe("2026-11-12");

    write("# Changelog\n\nNo releases yet.\n");
    expect(await new ChangelogService().latest()).toBeNull();
  });

  it("returns nothing rather than throwing when the file is gone", () => {
    process.env.CHANGELOG_PATH = join(tmpdir(), "does-not-exist", "CHANGELOG.md");
    expect(new ChangelogService().get()).toEqual({ updatedAt: null, releases: [] });
  });
});
