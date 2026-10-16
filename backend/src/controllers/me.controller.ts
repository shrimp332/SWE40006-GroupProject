import { CookieOptions, Request, Response } from "express-serve-static-core";
import { Kysely } from "kysely";
import { DB } from "../types/kysely-types";
import * as auth from "../services/auth.service";
import { SESSION_COOKIE } from "../middlewares/auth.middleware";

export class MeController {
  constructor(private db: Kysely<DB>) {}

  public async Get(request: Request, response: Response) {
    try {
      const cookie = request.cookies?.[SESSION_COOKIE];
      if (!cookie) return response.status(403).send("0");

      const result = await auth.getUserIdFromCookie(cookie, this.db);
      if (!result) return response.status(403).send("0");

      return response.status(200).send("1");
    } catch (error: any) {
      console.error(error);
      return response.status(500).send("Internal Server Error");
    }
  }
}
