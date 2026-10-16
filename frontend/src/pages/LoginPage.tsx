import AuthenticationForm from "../components/AuthenticationForm";

function LoginPage() {
  return (
    <div className=" w-full p-4 sm:p-0">
      <p className="mt-8 sm:mt-32 text-2xl md:text-4xl text-center">Welcome back</p>

      <div className="flex-1 mt-12">
        <AuthenticationForm kind="login" />
      </div>
    </div>
  );
}

export default LoginPage;
