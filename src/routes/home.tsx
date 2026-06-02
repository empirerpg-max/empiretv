import { useEffect, useState } from "react";
import { motion } from "motion/react";
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

// Variantes para stagger de cards
const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show:   { opacity: 1, y: 0,  scale: 1 },
};
const listVariants = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.06 } },
};

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
        <div className="nf-logo"><img src={LOGO} alt="Empire TV" /></div>
        <nav className="nf-nav">
          <button className="nf-nav-link active" onClick={() => onNavigate("home")}>Início</button>
          <button className="nf-nav-link" onClick={() => onNavigate("ao-vivo")}>Ao Vivo</button>
          <button className="nf-nav-link" onClick={() => onNavigate("grade")}>Grade</button>
          <button className="nf-nav-link" onClick={() => onNavigate("arquivo")}>Arquivo</button>
        </nav>
      </header>

      {loading && <div className="nf-loading">Carregando…</div>}

      {/* Hero com fade + scale */}
      {!loading && hero && (
        <motion.div
          className="nf-hero"
          style={{ backgroundImage: hero.capaUrl ? `url(${hero.capaUrl})` : undefined }}
          initial={{ opacity: 0, scale: 1.03 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="nf-hero-gradient" />
          <div className="nf-hero-orb" />
          <motion.div
            className="nf-hero-content"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            {isLive && <span className="nf-live-badge">◉ ao vivo</span>}
            {hero.tipo && <span className="nf-hero-eyebrow">{hero.tipo}</span>}
            <h1 className="nf-hero-title">{hero.programa}</h1>
            {hero.material && <p className="nf-hero-desc">{hero.material}</p>}
            <div className="nf-hero-actions">
              <motion.button
                className="nf-btn-play"
                onClick={() => onNavigate("ao-vivo")}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <span>▶</span> {isLive ? "Assistir Ao Vivo" : "Ver Grade"}
              </motion.button>
              <motion.button
                className="nf-btn-info"
                onClick={() => onNavigate("grade")}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                <span>i</span> Saiba mais
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
      {!loading && !hero && <div className="nf-empty">Nenhuma transmissão programada.</div>}

      {/* Próximos programas — stagger */}
      {schedule.length > 0 && (
        <section className="nf-section">
          <h2 className="nf-section-title">Próximos Programas</h2>
          <motion.div
            className="nf-carousel"
            variants={listVariants}
            initial="hidden"
            animate="show"
          >
            {schedule.map((p, i) => (
              <motion.div
                key={i}
                className="nf-card"
                variants={cardVariants}
                transition={{ duration: 0.32, ease: [0.34, 1.2, 0.64, 1] }}
                whileHover={{ y: -7, scale: 1.04, transition: { type: "spring", stiffness: 320, damping: 20 } }}
                whileTap={{ scale: 0.96 }}
                onClick={() => onNavigate("grade")}
              >
                {p.capaUrl
                  ? <img src={p.capaUrl} alt={p.programa} className="nf-card-img" />
                  : <div className="nf-card-placeholder">📺</div>}
                <div className="nf-card-info">
                  <span className="nf-card-horario">{p.horarioStr || p.data || ""}</span>
                  <span className="nf-card-title">{p.programa}</span>
                  {p.tipo && <span className="nf-card-tipo">{p.tipo}</span>}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      {/* Arquivo — stagger */}
      {archive.length > 0 && (
        <section className="nf-section">
          <h2 className="nf-section-title">Transmissões Anteriores</h2>
          <motion.div
            className="nf-carousel"
            variants={listVariants}
            initial="hidden"
            animate="show"
          >
            {archive.map(item => (
              <motion.div
                key={item.roomId}
                className="nf-card"
                variants={cardVariants}
                transition={{ duration: 0.32, ease: [0.34, 1.2, 0.64, 1] }}
                whileHover={{ y: -7, scale: 1.04, transition: { type: "spring", stiffness: 320, damping: 20 } }}
                whileTap={{ scale: 0.96 }}
                onClick={() => onNavigate("arquivo")}
              >
                {item.capaUrl
                  ? <img src={item.capaUrl} alt={item.programa} className="nf-card-img" />
                  : <div className="nf-card-placeholder">🎬</div>}
                <div className="nf-card-info">
                  <span className="nf-card-horario">{item.data}</span>
                  <span className="nf-card-title">{item.programa}</span>
                  <span className="nf-card-msgs">💬 {item.totalMsgs}</span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}
      <div style={{ height: 20 }} />
    </div>
  );
}
