import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Tab } from "../App";
import { fetchGAS } from "../lib/gas";

const BACKEND = "https://empiretv-chat-backend.onrender.com";
const LOGO    = "https://i.imgur.com/6cL3Ca9.png";

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
  const [heroIdx,  setHeroIdx]  = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [gasRes, archRes] = await Promise.all([
          fetchGAS(),
          fetch(`${BACKEND}/archive`).then(r => r.json()).catch(() => ({})),
        ]);
        if (gasRes.current) setCurrent(gasRes.current);
        setSchedule((gasRes.fullSchedule || []).slice(0, 20));
        setArchive((archRes.archive || []).slice(0, 12));
      } finally { setLoading(false); }
    })();
  }, []);

  // Hero: só itens COM capa
  const heroItems = [
    ...(current?.capaUrl ? [current] : []),
    ...schedule.filter(p => p.capaUrl && p !== current),
  ].slice(0, 5);

  useEffect(() => {
    if (heroItems.length <= 1) return;
    const t = setInterval(() => setHeroIdx(i => (i + 1) % heroItems.length), 6000);
    return () => clearInterval(t);
  }, [heroItems.length]);

  const hero   = heroItems[heroIdx] || null;
  const isLive = current?.status === "broadcasting";
  const proximos = schedule.slice(0, 10);

  return (
    <div className="home-page">
      <header className="nf-header">
        <div className="nf-logo"><img src={LOGO} alt="Empire TV" /></div>
        <nav className="nf-nav">
          <button className="nf-nav-link active" onClick={() => onNavigate("home")}>Início</button>
          <button className="nf-nav-link" onClick={() => onNavigate("ao-vivo")}>Ao Vivo</button>
          <button className="nf-nav-link" onClick={() => onNavigate("grade")}>Grade</button>
        </nav>
      </header>

      {loading && (
        <div className="home-loading">
          <div className="home-spinner" />
          <span>Carregando programação…</span>
        </div>
      )}

      {!loading && (
        <>
          {/* Hero Banner — só renderiza se tiver capa */}
          {hero ? (
            <div className="nf-hero">
              <AnimatePresence mode="wait">
                <motion.div
                  key={heroIdx}
                  className="nf-hero-bg"
                  style={{ backgroundImage: `url(${hero.capaUrl})` }}
                  initial={{ opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                />
              </AnimatePresence>
              <div className="nf-hero-gradient" />
              <div className="nf-hero-orb" />

              <motion.div
                className="nf-hero-content"
                key={`c-${heroIdx}`}
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15 }}
              >
                {isLive && hero === current && (
                  <span className="nf-live-badge">◉ ao vivo agora</span>
                )}
                {hero.tipo && <span className="nf-hero-eyebrow">{hero.tipo}</span>}
                <h1 className="nf-hero-title">{hero.programa || "Empire TV"}</h1>
                {hero.material && <p className="nf-hero-desc">{hero.material}</p>}
                <div className="nf-hero-actions">
                  <motion.button
                    className="nf-btn-play"
                    onClick={() => onNavigate(isLive && hero === current ? "ao-vivo" : "grade")}
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  >
                    ▶ {isLive && hero === current ? "Assistir Ao Vivo" : "Ver Grade"}
                  </motion.button>
                  {hero.buff && (
                    <motion.button className="nf-btn-info" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                      🎮 {hero.buff}
                    </motion.button>
                  )}
                </div>
              </motion.div>

              {heroItems.length > 1 && (
                <div className="nf-hero-dots">
                  {heroItems.map((_, i) => (
                    <button key={i} className={`nf-hero-dot ${i === heroIdx ? "active" : ""}`} onClick={() => setHeroIdx(i)} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Banner vazio quando não há capa */
            <div className="nf-hero-empty">
              <div className="nf-hero-empty-orb" />
              <div className="nf-hero-content" style={{ position: "relative", padding: "40px 16px 24px" }}>
                <h1 className="nf-hero-title">Empire TV</h1>
                <p className="nf-hero-desc">Sua central de entretenimento RPG ao vivo.</p>
                <div className="nf-hero-actions" style={{ marginTop: 12 }}>
                  <motion.button className="nf-btn-play" onClick={() => onNavigate("ao-vivo")} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    ▶ Assistir Ao Vivo
                  </motion.button>
                  <motion.button className="nf-btn-info" onClick={() => onNavigate("grade")} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                    📅 Ver Grade
                  </motion.button>
                </div>
              </div>
            </div>
          )}

          {/* Ao Vivo */}
          {isLive && current && (
            <section className="nf-section">
              <div className="nf-section-header">
                <span className="nf-pulse-dot" />
                <h2 className="nf-section-title">Ao Vivo Agora</h2>
              </div>
              <motion.div className="nf-live-card" onClick={() => onNavigate("ao-vivo")}
                whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.98 }}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              >
                {current.capaUrl
                  ? <img src={current.capaUrl} alt={current.programa} className="nf-live-card-img" />
                  : <div className="nf-live-card-placeholder">📺</div>}
                <div className="nf-live-card-overlay">
                  <span className="nf-live-card-badge">◉ AO VIVO</span>
                  <span className="nf-live-card-title">{current.programa}</span>
                  {current.tipo && <span className="nf-live-card-tipo">{current.tipo}</span>}
                  <span className="nf-live-card-cta">Entrar →</span>
                </div>
              </motion.div>
            </section>
          )}

          {/* Próximos */}
          {proximos.length > 0 && (
            <section className="nf-section">
              <div className="nf-section-header">
                <h2 className="nf-section-title">Próximos Programas</h2>
                <button className="nf-section-link" onClick={() => onNavigate("grade")}>Ver todos →</button>
              </div>
              <div className="nf-carousel">
                {proximos.map((p, i) => (
                  <motion.div key={i} className="nf-card"
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.3 }}
                    whileHover={{ y: -6, scale: 1.04, transition: { type: "spring", stiffness: 320, damping: 20 } }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => onNavigate("grade")}
                  >
                    {p.capaUrl
                      ? <img src={p.capaUrl} alt={p.programa} className="nf-card-img" />
                      : <div className="nf-card-placeholder">📺</div>}
                    <div className="nf-card-info">
                      <span className="nf-card-horario">{p.horarioStr || p.data || "—"}</span>
                      <span className="nf-card-title">{p.programa}</span>
                      {p.tipo && <span className="nf-card-tipo">{p.tipo}</span>}
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Arquivo */}
          {archive.length > 0 && (
            <section className="nf-section">
              <div className="nf-section-header">
                <h2 className="nf-section-title">Transmissões Anteriores</h2>
                <button className="nf-section-link" onClick={() => onNavigate("arquivo")}>Ver arquivo →</button>
              </div>
              <div className="nf-carousel">
                {archive.map(item => (
                  <motion.div key={item.roomId} className="nf-card"
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -6, scale: 1.04, transition: { type: "spring", stiffness: 320, damping: 20 } }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => onNavigate("arquivo")}
                  >
                    {item.capaUrl
                      ? <img src={item.capaUrl} alt={item.programa} className="nf-card-img" />
                      : <div className="nf-card-placeholder">🎬</div>}
                    <div className="nf-card-info">
                      <span className="nf-card-horario">{item.data}</span>
                      <span className="nf-card-title">{item.programa}</span>
                      <span className="nf-card-msgs">💬 {item.totalMsgs} msgs</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {proximos.length === 0 && archive.length === 0 && (
            <div className="home-empty">
              <div className="home-empty-icon">📡</div>
              <p className="home-empty-title">Nenhuma programação ainda</p>
              <p className="home-empty-sub">Em breve novos conteúdos serão adicionados.</p>
            </div>
          )}
          <div style={{ height: 24 }} />
        </>
      )}
    </div>
  );
}
