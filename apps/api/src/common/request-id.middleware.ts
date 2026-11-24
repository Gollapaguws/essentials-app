import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

/** A proxy-supplied id is reused only if it looks like an id, not an injection attempt. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Stamps every request with an id and echoes it back. Without this a 500 is
 * untraceable: the user sees "something went wrong" and the journal has no way to
 * tie their request to the stack that failed.
 */
export function requestId(
  req: Request & { id?: string },
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
