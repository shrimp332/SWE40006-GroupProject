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

    /** Requires authMiddleware. Lists only the logged-in user's links. */
    public async List(request: Request, response: Response) {
        try {
            return response.status(200).json(await links.listLinks(response.locals.userId, this.db));
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }

    /** Requires authMiddleware. Turns the logged-in user's link off or on. */
    public async Update(request: Request, response: Response) {
        try {
            const link = await links.setDisabled(response.locals.userId, String(request.params.code), request.body.disabled, this.db);

            // Same answer for "no such code" and "someone else's code", so codes can't be probed.
            if (!link) return response.status(404).json({ error: "Link not found" });

            return response.status(200).json(link);
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }

    /** Public: anyone with the short link is redirected, and the click is recorded for the owner. */
    public async Redirect(request: Request, response: Response) {
        try {
            const code = String(request.params.code);

            // Anything that could not be one of our codes never touches the database
            if (!links.CODE_PATTERN.test(code)) return response.status(404).send("Not Found");

            const link = await links.resolveCode(code, this.db);

            if (!link) return response.status(404).send("Not Found");

            try {
                await links.recordClick(link.id, request.get("referer"), request.get("user-agent"), this.db);
            } catch (error) {
                // A failed analytics write must not stop the visitor reaching their destination
                console.error(error);
            }

            // 302, not 301: browsers cache a 301, so a later disable or delete would not reach people who already clicked
            return response.redirect(302, link.target_url);
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }
}
