import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authMutation } from "../api/mutations/auth.mutations";
import { toast } from "sonner";
import { ME_QK } from "../api/queries/me.queries";

function LogoutButton() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const mutation = useMutation({
    ...authMutation.logout,
    onSuccess: async () => {
      qc.setQueryData([ME_QK], null);
      qc.removeQueries({ queryKey: [ME_QK] });

      toast.info("You have been logged out.");
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
