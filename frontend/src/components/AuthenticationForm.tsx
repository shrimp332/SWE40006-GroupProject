import { formOptions, useForm } from "@tanstack/react-form";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import z from "zod";
import { authMutation, LOGIN_MK, REGISTER_MK } from "../api/mutations/auth.mutations";

type Authentication = {
  email: string;
  password: string;
};

const authSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});

function AuthenticationForm({ kind }: { kind: "login" | "register" }) {
  const defaultValues: Authentication = { email: "", password: "" };
  const navigate = useNavigate();

  const mutation = useMutation(authMutation[kind]);
  const isLoading = useIsMutating({ mutationKey: [kind === "register" ? REGISTER_MK : LOGIN_MK] }) > 0;

  const buttonLabel = kind === "register" ? "Create account" : "Login";

  const formOps = formOptions({
    defaultValues,
    validators: {
      onBlur: authSchema,
    },
  });

  const form = useForm({
    ...formOps,
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value).then(() => {
        navigate(kind === "login" ? "/" : "/login", { replace: true });
      });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="flex flex-col items-center"
    >
      <div className="flex flex-col gap-2 sm:w-72 w-full">
        <form.Field
          name="email"
          children={(field) => (
            <>
              <label className="flex flex-col gap-1">
                Email address:
                <input
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Enter your email address..."
                  className="border p-2 bg-zinc-100 border-zinc-200 outline-none focus:border-zinc-400"
                />
                <div>
                  {field.state.meta.errors.map((error, idx) => (
                    <p key={idx} className="text-red-700">
                      {error?.message}
                    </p>
                  ))}
                </div>
              </label>
            </>
          )}
        />
        <form.Field
          name="password"
          children={(field) => (
            <>
              <label className="flex flex-col gap-1">
                Password:
                <input
                  type="password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Enter your password..."
                  className="border p-2 bg-zinc-100 border-zinc-200 outline-none focus:border-zinc-400"
                />
                <div>
                  {field.state.meta.errors.map((error, idx) => (
                    <p key={idx} className="text-red-700">
                      {error?.message}
                    </p>
                  ))}
                </div>
              </label>
            </>
          )}
        />
      </div>

      <div className={`flex flex-col gap-2 items-center mt-8 sm:w-72 w-full`}>
        <button
          type="submit"
          className="bg-orange-600 text-white p-2 w-full cursor-pointer hover:bg-orange-700 disabled:opacity-25 disabled:cursor-not-allowed"
          disabled={isLoading}
        >
          {buttonLabel}
        </button>
        <Link to={`/${kind === "register" ? "Login" : "Register"}`} className="border border-orange-600 text-orange-700 block p-2 w-full text-center hover:bg-orange-50">
          {kind === "register" ? "Login" : "Register"}
        </Link>
      </div>
    </form>
  );
}

export default AuthenticationForm;
