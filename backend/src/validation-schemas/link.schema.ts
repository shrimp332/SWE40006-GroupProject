import z from "zod";

const create = z
  .object({
    // Only http(s) destinations: anything else (javascript:, data:, file:) would turn the redirect into an attack vector.
    url: z.url({ protocol: /^https?$/ }).max(2048),
  })
  .strict();

// Disabling is the only change a link accepts: the destination and the code are never edited through this route.
const update = z
  .object({
    disabled: z.boolean(),
  })
  .strict();

export const linkSchema = {
  create,
  update,
};
