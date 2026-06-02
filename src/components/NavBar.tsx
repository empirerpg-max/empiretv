import type { Tab } from "../App";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "ao-vivo",  label: "Ao Vivo",  icon: "📺" },
  { id: "grade",   label: "Grade",    icon: "📋" },
  { id: "arquivo", label: "Arquivo",  icon: "🎬" },
];

export default function NavBar({ current, onNavigate }: { current: Tab; onNavigate: (t: Tab) => void }) {
  return (
    <nav className="navbar">
      {TABS.map(t => (
        <button
          key={t.id}
          className={`nav-btn ${current === t.id ? "active" : ""}`}
          onClick={() => onNavigate(t.id)}
        >
          <span className="nav-icon">{t.icon}</span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
