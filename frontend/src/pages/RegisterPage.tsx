import AuthenticationForm from "../components/AuthenticationForm";

function RegisterPage() {
  return (
    <div className="w-full p-4 sm:p-0">
      <p className="mt-8 sm:mt-32 text-2xl md:text-4xl text-center">Welcome, create an account to get started.</p>

      <div className="flex-1 mt-12">
        <AuthenticationForm kind="register" />
      </div>
    </div>
  );
}

export default RegisterPage;
