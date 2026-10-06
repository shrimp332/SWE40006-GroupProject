import { Request, Response } from "express-serve-static-core";
import { Kysely } from "kysely";
import { DB } from "../types/kysely-types";

export class HealthController {
  constructor(private db: Kysely<DB>) {}

  public async Get(request: Request, response: Response) {
    try {
      return response.status(200).send("HEALTHY");
    } catch (error) {
      return response.status(500).send("UNHEALTHY");
    }
  }

  public async Post(request: Request, response: Response) {
    try {
      const body = request.body;
      const queryResult = await this.db.insertInto("sample_table").values({ name: body.name }).returningAll().executeTakeFirst();

      return response.status(201).json(queryResult);
    } catch (error) {
      console.log(error);
      return response.status(500).send("UNHEALTHY");
    }
  }
}
