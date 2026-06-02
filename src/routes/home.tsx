import { useEffect, useState } from "react";
import type { Tab } from "../App";

const GAS_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3b7sK8DD59BHRBRc5Ow1YB/exec";
const BACKEND = "https://empiretv-chat-backend.onrender.com";

const LOGO = "https://i.imgur.com/6cL3Ca9.png";

interface Programa {
  programa: string; tipo: string; material?: string;
  buff?: string; horarioStr?: string; data?: string;
  capaUrl?: string; status?: string;
}
interface ArchiveItem {
  roomId: string; programa: string; tipo: string;
  data: string; horario: string; capaUrl: string; totalMsgs: number;
}

export default function Home({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const [current,  setCurrent]  = useState<Programa | null>(null);
  const [schedule, setSchedule] = useState<Programa[]>([]);
  const [archive,  setArchive]  = useState<ArchiveItem[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [gasRes, archRes] = await Promise.all([
          fetch(GAS_URL).then(r => r.json()).catch(() => ({})),
          fetch(`${BACKEND}/archive`).then(r => r.json()).catch(() => ({})),
        ]);
        if (gasRes.current) setCurrent(gasRes.current);
        setSchedule((gasRes.fullSchedule || []).slice(0, 20));
        setArchive((archRes.archive || []).slice(0, 12));
      } finally { setLoading(false); }
    })();
  }, []);

  const hero = current?.capaUrl ? current : schedule.find(p => p.capaUrl) || null;
  const isLive = current?.status === "broadcasting";

  return (
    <div className="home-page">
      {/* Header */}
      <header className="nf-header">
        <div className="nf-logo">
          <img src={LOGO} alt="Empire TV" />
        </div>
        <nav className="nf-nav">
          <button className="nf-nav-link active" onClick={() => onNavigate("home")}>Início</button>
          <button className="nf-nav-link" onClick={() => onNavigate("ao-vivo")}>Ao Vivo</button>
          <button className="nf-nav-link" onClick={() => onNavigate("grade")}>Grade</button>
          <button className="nf-nav-link" onClick={() => onNavigate("arquivo")}>Arquivo</button>
        </nav>
      </header>

      {loading && <div className="nf-loading">Carregando…</div>}

      {/* Hero */}
      {!loading && hero && (
        <div className="nf-hero" style={{ backgroundImage: hero.capaUrl ? `url(${hero.capaUrl})` : undefined }}>
          <div className="nf-hero-gradient" />
          <div className="nf-hero-orb" />
          <div className="nf-hero-content">
            {isLive && <span className="nf-live-badge">● ao vivo</span>}
            {hero.tipo && <span className="nf-hero-eyebrow">{hero.tipo}</span>}
            <h1 className="nf-hero-title">{hero.programa}</h1>
            {hero.material && <p className="nf-hero-desc">{hero.material}</p>}
            <div className="nf-hero-actions">
              <button className="nf-btn-play" onClick={() => onNavigate("ao-vivo")}>
                <span>▶</span> {isLive ? "Assistir Ao Vivo" : "Ver Grade"}
              </button>
              <button className="nf-btn-info" onClick={() => onNavigate("grade")}>
                <span>i</span> Saiba mais
              </button>
            </div>
          </div>
        </div>
      )}
      {!loading && !hero && <div className="nf-empty">Nenhuma transmissão programada.</div>}

      {/* Próximos programas */}
      {schedule.length > 0 && (
        <section className="nf-section">
          <h2 className="nf-section-title">Próximos Programas</h2>
          <div className="nf-carousel">
            {schedule.map((p, i) => (
              <div key={i} className="nf-card" onClick={() => onNavigate("grade")}>
                {p.capaUrl
                  ? <img src={p.capaUrl} alt={p.programa} className="nf-card-img" />
                  : <div className="nf-card-placeholder">📺</div>}
                <div className="nf-card-info">
                  <span className="nf-card-horario">{p.horarioStr || p.data || ""}</span>
                  <span className="nf-card-title">{p.programa}</span>
                  {p.tipo && <span className="nf-card-tipo">{p.tipo}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Arquivo */}
      {archive.length > 0 && (
        <section className="nf-section">
          <h2 className="nf-section-title">Transmissões Anteriores</h2>
          <div className="nf-carousel">
            {archive.map(item => (
              <div key={item.roomId} className="nf-card" onClick={() => onNavigate("arquivo")}>
                {item.capaUrl
                  ? <img src={item.capaUrl} alt={item.programa} className="nf-card-img" />
                  : <div className="nf-card-placeholder">🎬</div>}
                <div className="nf-card-info">
                  <span className="nf-card-horario">{item.data}</span>
                  <span className="nf-card-title">{item.programa}</span>
                  <span className="nf-card-msgs">💬 {item.totalMsgs}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <div style={{ height: 20 }} />
    </div>
  );
}
