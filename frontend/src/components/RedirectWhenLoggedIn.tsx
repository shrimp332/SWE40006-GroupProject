import { useQuery } from "@tanstack/react-query";
import { meQuery } from "../api/queries/me.queries";
import { Navigate, Outlet } from "react-router-dom";

function RedirectWhenLoggedIn() {
  const { data: repsonseId, isLoading } = useQuery(meQuery.get);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Loading session...</p>
      </div>
    );
  }

  if (repsonseId) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export default RedirectWhenLoggedIn;
