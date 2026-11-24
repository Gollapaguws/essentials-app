import { describe, expect, it } from "vitest";
import { pageTitle } from "./PageTitle";

describe("pageTitle", () => {
  it("names a dashboard screen and brands it", () => {
    expect(pageTitle("/events")).toBe("Events · SONUS");
    expect(pageTitle("/gig-calendar")).toBe("Gig calendar · SONUS");
  });

  it("prefers the longest matching route", () => {
    expect(pageTitle("/artists/abc123")).toBe("Artists · SONUS");
    expect(pageTitle("/artist")).toBe("Artist · SONUS");
  });

  it("distinguishes the auth screens", () => {
    expect(pageTitle("/login")).toBe("Sign in · SONUS");
    expect(pageTitle("/auth/password")).toBe("Set a password · SONUS");
    expect(pageTitle("/auth/mfa")).toBe("Verify sign-in · SONUS");
  });

  it("falls back to the dashboard name for the home route and unknowns", () => {
    expect(pageTitle("/")).toBe("Promoter dashboard · SONUS");
    expect(pageTitle("/doorcheck")).toBe("Promoter dashboard · SONUS");
  });
});
