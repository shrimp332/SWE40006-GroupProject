import { Options } from "express-rate-limit";

export const rateLimitOptions: Partial<Options> = {
  windowMs: 60 * 60,
  message: {
    data: null,
    message: "Timeout.",
    success: false,
  },
  limit: 1_050, // configure according to application needs
};
