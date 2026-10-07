import { NextFunction, Request, Response } from "express-serve-static-core";
import { Kysely } from "kysely";
import { getUserIdFromCookie } from "../services/auth.service";

export const SESSION_COOKIE = "session";

/**
 * Authenticates the session cookie, or redirects to /login.
 * gives login's user_id to later requests
 * @example
 * // inside setupRoutes(db) in app.ts
 * router.get("/urls", authMiddleware(db), (request, response) => {
 *   response.json({ userId: response.locals.userId });
 * });
 */
export const authMiddleware = (db: Kysely<any>) => {
    return async (request: Request, response: Response, next: NextFunction) => {
        const cookie = request.cookies?.[SESSION_COOKIE];

        if (!cookie) return response.redirect(302, "/login");

        try {
            const userId = await getUserIdFromCookie(cookie, db);

            // Cookie present but expired
            if (userId === null) {
                response.clearCookie(SESSION_COOKIE);
                return response.redirect(302, "/login");
            }

            response.locals.userId = userId;
            return next();
        } catch (error) {
            return next(error);
        }
    };
};
