import LogoutButton from "./components/LogoutButton";
import Dashboard from "./components/Dashboard"

function App() {
  return (
    <div>
      <nav className="flex bg-zinc-100 items-center justify-between pl-2">
        <p>Holy URL Shortner</p>
        <LogoutButton />
      </nav>
      <main className="p-2"><Dashboard /></main>
    </div>
  );
}

export default App;
