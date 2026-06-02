import type { Tab } from "../App";

const ICONS: Record<Tab, string> = {
  "home":    "https://i.imgur.com/NFj1HK2.png",
  "ao-vivo": "https://i.imgur.com/pADidsJ.png",
  "grade":   "https://i.imgur.com/fToxRWs.png",
  "arquivo": "https://i.imgur.com/EdqAlej.png",
};

const LABELS: Record<Tab, string> = {
  "home":    "Início",
  "ao-vivo": "Ao Vivo",
  "grade":   "Grade",
  "arquivo": "Arquivo",
};

const TABS: Tab[] = ["home", "ao-vivo", "grade", "arquivo"];

export default function NavBar({ current, onNavigate }: { current: Tab; onNavigate: (t: Tab) => void }) {
  return (
    <nav className="navbar">
      {TABS.map(t => (
        <button
          key={t}
          className={`nav-btn ${current === t ? "active" : ""}`}
          onClick={() => onNavigate(t)}
        >
          <span className="nav-icon">
            <img src={ICONS[t]} alt={LABELS[t]} />
          </span>
          <span className="nav-label">{LABELS[t]}</span>
        </button>
      ))}
    </nav>
  );
}
