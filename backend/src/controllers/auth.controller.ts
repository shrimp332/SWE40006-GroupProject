import { CookieOptions, Request, Response } from "express-serve-static-core";
import { Kysely } from "kysely";
import { DB } from "../types/kysely-types";
import * as auth from "../services/auth.service";
import { SESSION_COOKIE } from "../middlewares/auth.middleware";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: false, // we don't have https yet, add: process.env.NODE_ENV === "production", later
  sameSite: "lax",
  path: "/",
};

export class AuthController {
  constructor(private db: Kysely<DB>) {}

  public async Register(request: Request, response: Response) {
    try {
      await auth.register(request.body.email, request.body.password, this.db);

      return response.status(201).send();
    } catch (error: any) {
      if (error?.code === "23505") {
        // postgres unique violation
        return response.status(409).json({ error: "Email already registered" });
      }

      console.error(error);
      return response.status(500).send("Internal Server Error");
    }
  }

  public async Login(request: Request, response: Response) {
    try {
      const cookie = await auth.login(request.body.email, request.body.password, this.db);

      if (cookie === null) {
        return response.status(401).json({ error: "Invalid email or password" });
      }

      response.cookie(SESSION_COOKIE, cookie, { ...COOKIE_OPTIONS, maxAge: SEVEN_DAYS_MS });
      return response.status(204).send();
    } catch (error) {
      console.error(error);
      return response.status(500).send("Internal Server Error");
    }
  }

  public async Logout(request: Request, response: Response) {
    try {
      const cookie = request.cookies?.[SESSION_COOKIE];

      if (cookie) await auth.logout(cookie, this.db);

      response.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
      return response.status(204).send();
    } catch (error) {
      console.error(error);
      return response.status(500).send("");
    }
  }
}
