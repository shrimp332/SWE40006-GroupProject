import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Express, Router } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { AuthController } from "./controllers/auth.controller";
import { HealthController } from "./controllers/health.controller";
import { rateLimitOptions } from "./config/rate-limit.config";
import { corsOptions } from "./config/cors.config";
import { validationMiddleware } from "./middlewares/validation.middleware";
import { authSchema } from "./validation-schemas/auth.schema";
import { healthSchema } from "./validation-schemas/health.schema.ts/health.schema";
import { Kysely } from "kysely";
import { DB } from "./types/kysely-types";

export function app(db: Kysely<DB>): Express {
  const app = express();

  setupMiddleware(app);
  configApp(app);
  app.use(setupRoutes(db));

  return app;
}

function setupRoutes(db: Kysely<DB>) {
  const router = Router();
  const healthController = new HealthController(db);
  const authController = new AuthController(db);

  // Note: Express stores a reference to the controller function but it loses the reference to the controller instance.
  router.get("/health", healthController.Get.bind(healthController));
  router.post("/health", validationMiddleware(healthSchema.post), healthController.Post.bind(healthController));

  router.post("/api/register", validationMiddleware(authSchema.credentials), authController.Register.bind(authController));
  router.post("/api/login", validationMiddleware(authSchema.credentials), authController.Login.bind(authController));
  router.post("/api/logout", authController.Logout.bind(authController));

  return router;
}

/**
 * @mutatable app
 */
function setupMiddleware(app: Express) {
  app.use(express.json());
  app.use(helmet());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(cors(corsOptions));
  app.use(rateLimit(rateLimitOptions));
}

/**
 * @mutatable app
 */
function configApp(app: Express) {
  app.disable("x-powered-by");
}
