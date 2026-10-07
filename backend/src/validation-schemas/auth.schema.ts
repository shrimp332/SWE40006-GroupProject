import z from "zod";

const login = z
  .object({
    email: z.string().email().max(320),
    // No minimum here: a length rule on login only tells an attacker the policy.
    // The max bounds how much work an argon2 verify can be made to do.
    password: z.string().min(1).max(200),
  })
  .strict();

export const authSchema = {
  login,
};
