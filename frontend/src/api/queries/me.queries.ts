import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const ME_QK = "me";

const get = queryOptions({
  queryKey: [ME_QK],
  queryFn: async () => {
    const rawText = await api.get("/me").text();
    const parsedId = parseInt(rawText, 10);

    if (Number.isNaN(parsedId) || parsedId === 0) {
      return null;
    }

    return parsedId;
  },
});

export const meQuery = {
  get,
};
