import { CorsOptions } from "cors";

export const corsOptions: CorsOptions = {
  origin: ["http://localhost:5173", "http://localhost:4173"],
  credentials: true,
  methods: ["GET", "POST", "DELETE", "PATCH", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Content-Length", "Authorization", "X-Requested-With", "Accept", "Origin"],
  exposedHeaders: ["Content-Range", "X-Content-Range", "X-Total-Count"],
  maxAge: 86400, // 24 hours
};
