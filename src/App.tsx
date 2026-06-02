import { useState } from "react";
import AoVivo from "./routes/ao-vivo";
import Grade from "./routes/grade";
import Arquivo from "./routes/arquivo";
import NavBar from "./components/NavBar";

export type Tab = "ao-vivo" | "grade" | "arquivo";

export default function App() {
  const [tab, setTab] = useState<Tab>("ao-vivo");

  return (
    <div className="app-shell">
      <div className="app-content">
        {tab === "ao-vivo" && <AoVivo />}
        {tab === "grade"  && <Grade />}
        {tab === "arquivo" && <Arquivo />}
      </div>
      <NavBar current={tab} onNavigate={setTab} />
    </div>
  );
}
