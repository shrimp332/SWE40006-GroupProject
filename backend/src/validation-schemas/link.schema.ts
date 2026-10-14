import z from "zod";

const create = z
  .object({
    // Only http(s) destinations: anything else (javascript:, data:, file:) would turn the redirect into an attack vector.
    url: z.url({ protocol: /^https?$/ }).max(2048),
  })
  .strict();

export const linkSchema = {
  create,
};
