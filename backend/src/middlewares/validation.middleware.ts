import { NextFunction, Request, Response } from "express-serve-static-core";
import { ZodError, ZodIssue, ZodSchema } from "zod";

export const validationMiddleware = (schema: ZodSchema) => {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method === "POST" || request.method === "PATCH") {
      const result = schema.safeParse(request.body);
      if (!result.success) {
        const errorMessages = result.error.issues.map((issue: ZodIssue) => ({
          message: `${issue.path.join(".")} - ${issue.message}`,
        }));
        return response.status(400).json({ error: "Invalid data", details: errorMessages });
      }
      return next();
    }

    /** @todo add validation logic for url params AND query strings */

    return next();
  };
};
