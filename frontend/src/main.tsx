import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import RegisterPage from "./pages/RegisterPage.tsx";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LoginPage from "./pages/LoginPage.tsx";
import type { ToasterProps } from "sonner";
import { Toaster } from "sonner";
import PageGuard from "./components/PageGuard.tsx";
import RedirectWhenLoggedIn from "./components/RedirectWhenLoggedIn.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
      gcTime: 60 * 1000,
    },
    mutations: {
      retry: false,
    },
  },
});

const toasterConfig: ToasterProps = {
  richColors: true,
  toastOptions: {
    duration: 2_500,
  },
  visibleToasts: 10,
  position: "top-center",
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toaster {...toasterConfig} />
      <BrowserRouter>
        <Routes>
          <Route element={<RedirectWhenLoggedIn />}>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<PageGuard />}>
            <Route path="/" element={<App />}></Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
