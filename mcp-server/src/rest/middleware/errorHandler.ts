import type { ErrorHandler } from "hono";
import { z } from "zod";
import { AuthError } from "../../auth/index.js";

/**
 * Global error handler for REST API
 * Converts errors to RFC 6750 compliant responses
 */
export const errorHandler: ErrorHandler = (err, c) => {
  console.error("[REST] Error:", err);

  // Auth errors (401, 403)
  if (err instanceof AuthError) {
    if (err.oauthError === "insufficient_scope") {
      return c.json(
        {
          error: "insufficient_scope",
          message: err.message,
        },
        403
      );
    }

    if (err.statusCode === 403) {
      return c.json(
        {
          error: "forbidden",
          message: "Access denied",
        },
        403
      );
    }

    return c.json(
      {
        error: err.oauthError || "unauthorized",
        message: "Authentication failed",
      },
      401
    );
  }

  // Zod validation errors (400)
  if (err instanceof z.ZodError) {
    return c.json(
      {
        error: "validation_error",
        message: "Invalid request parameters",
        details: err.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      },
      400
    );
  }

  // Convex errors (pass through message for known types)
  if (err instanceof Error && err.message) {
    // Check for common Convex error patterns
    if (err.message.includes("not found")) {
      return c.json(
        {
          error: "not_found",
          message: err.message,
        },
        404
      );
    }

    if (err.message.includes("already exists") || err.message.includes("duplicate")) {
      return c.json(
        {
          error: "conflict",
          message: err.message,
        },
        409
      );
    }

    if (err.message.includes("permission") || err.message.includes("access")) {
      return c.json(
        {
          error: "forbidden",
          message: err.message,
        },
        403
      );
    }
  }

  // Unknown errors (500)
  return c.json(
    {
      error: "internal_error",
      message: "An unexpected error occurred",
    },
    500
  );
};
