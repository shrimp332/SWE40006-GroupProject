import z from "zod";

const post = z
  .object({
    name: z.string().nonempty().max(155),
  })
  .strict();

export const healthSchema = {
  post,
};
