import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageArgs, parsePaging } from "./paging";

describe("parsePaging", () => {
  it("defaults to the page size, not to everything", () => {
    expect(parsePaging()).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(parsePaging(undefined, undefined)).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it("clamps an oversized ask to the maximum instead of rejecting it", () => {
    expect(parsePaging("100000").limit).toBe(MAX_PAGE_SIZE);
    expect(parsePaging("5000", "10")).toEqual({ limit: MAX_PAGE_SIZE, offset: 10 });
  });

  it("treats junk and negatives as defaults rather than 400s", () => {
    expect(parsePaging("abc", "nope")).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(parsePaging("0", "-20")).toEqual({ limit: 1, offset: 0 });
    expect(parsePaging("25.9", "3.7")).toEqual({ limit: 25, offset: 3 });
  });

  it("passes a normal page straight through", () => {
    expect(pageArgs(parsePaging("100", "200"))).toEqual({ take: 100, skip: 200 });
  });
});
