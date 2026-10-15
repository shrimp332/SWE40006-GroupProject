import AuthenticationForm from "../components/AuthenticationForm";
import IMG from "./../assets/Subject.png";

function LoginPage() {
  return (
    <div className=" w-full p-4 sm:p-0">
      <p className="mt-8 sm:mt-32 text-2xl md:text-4xl text-center">Welcome back</p>

      <div className="flex-1 mt-12">
        <AuthenticationForm kind="login" />
      </div>
      {/* Credit: https://www.pngegg.com/en/png-fmoaf */}
      <img src={IMG} className="absolute bottom-0 w-8 sm:w-16 opacity-25 " />
    </div>
  );
}

export default LoginPage;
