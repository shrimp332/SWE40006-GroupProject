import z from "zod";

// Shared by /api/login and /api/register.
const credentials = z
  .object({
    email: z.string().email().max(320),
    // The max bounds how much work an argon2 hash or verify can be made to do.
    password: z.string().min(1).max(200),
  })
  .strict();

export const authSchema = {
  credentials,
};
