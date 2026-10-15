import { mutationOptions } from "@tanstack/react-query";
import { api } from "../api";

type AuthPayload = {
  email: string;
  password: string;
};

export const REGISTER_MK = "register";
export const LOGIN_MK = "login";
export const LOGOUT_MK = "logout";

const register = mutationOptions({
  mutationKey: [REGISTER_MK],
  mutationFn: async (payload: AuthPayload) => {
    await api.post("/register", { json: payload });
    return;
  },
});

const login = mutationOptions({
  mutationKey: [LOGIN_MK],
  mutationFn: async (payload: AuthPayload) => {
    await api.post("/login", { json: payload });
    return;
  },
});

const logout = mutationOptions({
  mutationKey: [LOGOUT_MK],
  mutationFn: async () => {
    await api.post("logout");
    return;
  },
});

export const authMutation = {
  register,
  login,
  logout,
};
