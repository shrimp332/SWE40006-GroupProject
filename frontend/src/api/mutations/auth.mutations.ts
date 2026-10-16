import { mutationOptions } from "@tanstack/react-query";
import { api } from "../api";
import { toast } from "sonner";

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
  onError: () => {
    toast.error("Failed to register account. Please try again.");
  },
  onSuccess: () => {
    toast.info("Registered successfully. Please login.");
  },
});

const login = mutationOptions({
  mutationKey: [LOGIN_MK],
  mutationFn: async (payload: AuthPayload) => {
    await api.post("/login", { json: payload });
    return;
  },
  onError: () => {
    toast.error("Failed to login to your account. Please try again.");
  },
  onSuccess: () => {
    toast.info("Welcome back.");
  },
});

const logout = mutationOptions({
  mutationKey: [LOGOUT_MK],
  mutationFn: async () => {
    await api.post("logout");
    return;
  },
  onError: () => {
    toast.error("Failed to logout from account. Please try again.");
  },
});

export const authMutation = {
  register,
  login,
  logout,
};
