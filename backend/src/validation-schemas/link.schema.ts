import z from "zod";

const create = z
  .object({
    // Only http(s), so javascript: and data: links are rejected
    url: z.url({ protocol: /^https?$/ }).max(2048),
  })
  .strict();

// Only disabled can change, never the url or the code
const update = z
  .object({
    disabled: z.boolean(),
  })
  .strict();

// No body fields, the server always picks the new code
const regenerate = z.object({}).strict();

export const linkSchema = {
  create,
  update,
  regenerate,
};
