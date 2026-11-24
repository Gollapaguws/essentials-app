import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  requestId?: string;
  /** Machine-readable reason some guards attach (`MFA_REQUIRED`, …). */
  code?: string;
  /** Extra context a guard deliberately exposes, e.g. the role or a reset URL. */
  [key: string]: unknown;
}

/**
 * The single place an unhandled failure becomes a response.
 *
 * Clients get Nest's usual `{ statusCode, message, error }` shape plus the request
 * id; anything 5xx is replaced with a generic message so internals never leak, and
 * the original is logged against the same id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("error");

  catch(exception: unknown, host: ArgumentsHost): void {
    // Websocket and RPC failures are shaped differently; log and let their own
    // handlers deal with the client side.
    if (host.getType() !== "http") {
      this.logger.error(
        `non-http exception: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      return;
    }

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = this.body(exception, status, req.id);

    const where = `${req.method} ${req.originalUrl ?? req.url}`;
    if (status >= 500) {
      const detail = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `${req.id ?? "-"} ${where} → ${status} ${detail}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      // 4xx is routine traffic (expired tokens, validation); debug keeps it out of
      // the journal unless someone is actively looking.
      this.logger.debug(`${req.id ?? "-"} ${where} → ${status}`);
    }

    res.status(status).json(body);
  }

  private body(exception: unknown, status: number, requestId?: string): ErrorBody {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: status,
        message: "Something went wrong on our side.",
        error: "Internal Server Error",
        requestId,
      };
    }

    const payload = exception.getResponse();
    let message: string | string[] = exception.message;
    let error = exception.name;
    // Custom fields on the exception payload are part of the API contract: the
    // dashboard branches on `code` (MFA_REQUIRED, PASSWORD_RESET_REQUIRED) and
    // needs fields like `role`. Dropping them made those errors unrecognizable.
    const extra: Record<string, unknown> = {};

    if (typeof payload === "string") {
      message = payload;
    } else if (payload && typeof payload === "object") {
      const shaped = payload as { message?: string | string[]; error?: string };
      if (shaped.message) message = shaped.message;
      if (shaped.error) error = shaped.error;
      for (const [key, value] of Object.entries(payload)) {
        if (!["statusCode", "message", "error", "requestId"].includes(key)) {
          extra[key] = value;
        }
      }
    }

    // A deliberate 5xx (e.g. an upstream refusal) still must not describe internals.
    if (status >= 500) {
      message = "Something went wrong on our side.";
      error = "Internal Server Error";
    }

    return { ...extra, statusCode: status, message, error, requestId };
  }
}
