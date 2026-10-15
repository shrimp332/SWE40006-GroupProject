import LogoutButton from "./components/LogoutButton";

function App() {
  return (
    <div>
      <nav className="flex bg-zinc-100 items-center justify-between pl-2">
        <p>Holy URL Shortner</p>
        <LogoutButton />
      </nav>
      <main className="p-2">DASHBOARD HERE</main>
    </div>
  );
}

export default App;
