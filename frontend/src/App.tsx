import LogoutButton from "./components/LogoutButton";
import Dashboard from "./components/Dashboard"
import AddRedirectDialog from "./components/AddRedirectDialog";

function App() {
  return (
    <div>
      <nav className="flex bg-zinc-100 items-center justify-between pl-2">
        <p>UnHoly URL Shortner</p>
        <LogoutButton />
      </nav>
      <main className="p-2">
        <AddRedirectDialog />
        <Dashboard />
      </main>
    </div>
  );
}

export default App;
