import { Request, Response } from "express-serve-static-core";
import { Kysely } from "kysely";
import { DB } from "../types/kysely-types";
import * as links from "../services/link.service";

export class LinkController {
    constructor(private db: Kysely<DB>) { }

    /** Needs authMiddleware, which sets response.locals.userId. */
    public async Create(request: Request, response: Response) {
        try {
            const link = await links.createLink(response.locals.userId, request.body.url, this.db);

            return response.status(201).json(link);
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }

    /** Needs authMiddleware. Lists the user's own links. */
    public async List(request: Request, response: Response) {
        try {
            return response.status(200).json(await links.listLinks(response.locals.userId, this.db));
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }

    /** Needs authMiddleware. Disables or enables the user's own link. */
    public async Update(request: Request, response: Response) {
        try {
            const link = await links.setDisabled(response.locals.userId, String(request.params.code), request.body.disabled, this.db);

            // Same 404 whether the code is missing or not yours
            if (!link) return response.status(404).json({ error: "Link not found" });

            return response.status(200).json(link);
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }

    /** Needs authMiddleware. Replaces the link's code, the old one stops working. */
    public async Regenerate(request: Request, response: Response) {
        try {
            const link = await links.regenerateCode(response.locals.userId, String(request.params.code), this.db);

            // Same 404 whether the code is missing or not yours
            if (!link) return response.status(404).json({ error: "Link not found" });

            return response.status(200).json(link);
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }

    /** Needs authMiddleware. Deletes the user's own link, its short link stops working. */
    public async Delete(request: Request, response: Response) {
        try {
            const deleted = await links.deleteLink(response.locals.userId, String(request.params.code), this.db);

            // Same 404 whether the code is missing or not yours
            if (!deleted) return response.status(404).json({ error: "Link not found" });

            return response.status(204).send();
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }

    /** Public. Redirects and records the click. */
    public async Redirect(request: Request, response: Response) {
        try {
            const code = String(request.params.code);

            // Cannot be one of our codes, so skip the database
            if (!links.CODE_PATTERN.test(code)) return response.status(404).send("Not Found");

            const link = await links.resolveCode(code, this.db);

            if (!link) return response.status(404).send("Not Found");

            try {
                await links.recordClick(link.id, request.get("referer"), request.get("user-agent"), this.db);
            } catch (error) {
                // Analytics must not block the redirect
                console.error(error);
            }

            // 302 not 301, browsers cache a 301
            return response.redirect(302, link.target_url);
        } catch (error) {
            console.error(error);
            return response.status(500).send("Internal Server Error");
        }
    }
}
