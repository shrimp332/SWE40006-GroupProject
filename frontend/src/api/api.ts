import ky, { isHTTPError } from "ky";

export const api = ky.extend({
  prefix: "/api",
  credentials: "include",
  retry: {
    limit: 1,
    jitter: true,
  },
  hooks: {
    beforeError: [
      ({ request, options, error }) => {
        if (isHTTPError(error)) {
          if (typeof error.data === "object" && error.data !== null && "message" in error.data) {
            error.name = "ApiError";
            error.message = `${String(error.data.message)} (${error.response.status})`;

            return new Error(error.message);
          }
        }

        console.log(`Request to ${request.url} failed`, options.context);
        return error;
      },
    ],
  },
});
