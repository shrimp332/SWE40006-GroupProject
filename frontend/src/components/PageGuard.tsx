import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router";
import { meQuery } from "../api/queries/me.queries";

function PageGuard() {
  const { data: responseId, isLoading, isError } = useQuery(meQuery.get);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (isError || !responseId) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default PageGuard;
