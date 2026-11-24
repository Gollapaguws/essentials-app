/**
 * Query-string paging for list endpoints.
 *
 * Values are clamped, never rejected: a mistyped `?limit=` should not 400 a
 * dashboard, and no caller should be able to ask for the whole table. The max is
 * deliberately equal to what the busiest screen (the admin account list) renders.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface Paging {
  limit: number;
  offset: number;
}

function int(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function parsePaging(limit?: unknown, offset?: unknown): Paging {
  return {
    limit: Math.min(Math.max(int(limit, DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE),
    offset: Math.max(int(offset, 0), 0),
  };
}

/** Prisma args for a page. */
export const pageArgs = (paging: Paging) => ({ take: paging.limit, skip: paging.offset });
