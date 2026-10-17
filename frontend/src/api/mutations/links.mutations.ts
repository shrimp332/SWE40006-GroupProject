import { mutationOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { Link } from "../queries/links.queries";

export const LINK_CREATE_MK = "link-create";
export const LINK_SET_DISABLED_MK = "link-set-disabled";
export const LINK_DELETE_MK = "link-delete";

type SetDisabledPayload = {
  code: string;
  disabled: boolean;
};

const create = mutationOptions({
  mutationKey: [LINK_CREATE_MK],
  mutationFn: async (url: string) => {
    return api.post("/links", { json: { url } }).json<Link>();
  },
});

const setDisabled = mutationOptions({
  mutationKey: [LINK_SET_DISABLED_MK],
  mutationFn: async ({ code, disabled }: SetDisabledPayload) => {
    return api.patch(`/links/${code}`, { json: { disabled } }).json<Link>();
  },
});

const remove = mutationOptions({
  mutationKey: [LINK_DELETE_MK],
  mutationFn: async (code: string) => {
    await api.delete(`/links/${code}`);
    return code;
  },
});

export const linkMutation = {
  create,
  setDisabled,
  remove,
};
