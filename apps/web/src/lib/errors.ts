/**
 * `catch` binds `unknown` under `strict`, so every handler that wants to show a
 * message has to narrow first. This is that narrowing, in one place.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong.";
}
