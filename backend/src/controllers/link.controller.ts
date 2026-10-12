import { Request, Response } from "express-serve-static-core";
import { Kysely } from "kysely";
import { DB } from "../types/kysely-types";

export class LinkController {
    constructor(private db: Kysely<DB>) { }

    /**
     * GET /x/:code
     * @todo look up request.params.code and redirect to its target url
     * You'll also need to create a new data migration in backend/src/migrations for the db. example schema can be seen in the project plan uml
     */
    public async Redirect(request: Request, response: Response) {
        return response.status(501).send("Not Implemented");
    }
}
