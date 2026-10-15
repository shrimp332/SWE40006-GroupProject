import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authMutation } from "../api/mutations/auth.mutations";

function LogoutButton() {
  const navigate = useNavigate();

  const mutation = useMutation({
    ...authMutation.logout,
    onSuccess: () => {
      navigate("/login", { replace: true });
    },
  });

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="bg-orange-600 text-white p-2 cursor-pointer hover:bg-orange-700 disabled:opacity-25 disabled:cursor-not-allowed"
    >
      Logout
    </button>
  );
}

export default LogoutButton;
