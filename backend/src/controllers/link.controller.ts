import { Request, Response } from "express-serve-static-core";
import { Kysely } from "kysely";
import { DB } from "../types/kysely-types";
import * as links from "../services/link.service";

export class LinkController {
    constructor(private db: Kysely<DB>) { }

    /** Requires authMiddleware, which puts the logged-in user's id on response.locals.userId. */
    public async Create(request: Request, response: Response) {
        try {
            const link = await links.createLink(response.locals.userId, request.body.url, this.db);

            return response.status(201).json(link);
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }
}
