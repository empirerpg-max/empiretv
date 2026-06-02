import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

const BACKEND = "https://empiretv-chat-backend.onrender.com";

interface ArchiveItem {
  roomId: string; programa: string; tipo: string;
  data: string; horario: string; capaUrl: string; totalMsgs: number;
}
interface RoomMsg {
  nome: string; texto: string; hora: string; gifUrl?: string;
}

export default function Arquivo() {
  const [items,    setItems]    = useState<ArchiveItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [erro,     setErro]     = useState("");
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  const [msgs,     setMsgs]     = useState<RoomMsg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/archive`)
      .then(r => r.json())
      .then(d => setItems(d.archive || []))
      .catch(() => setErro("Erro ao carregar o arquivo."))
      .finally(() => setLoading(false));
  }, []);

  const openRoom = async (item: ArchiveItem) => {
    setSelected(item); setMsgs([]); setLoadingMsgs(true);
    try {
      const r = await fetch(`${BACKEND}/messages/${item.roomId}`);
      const d = await r.json();
      setMsgs(d.messages || []);
    } catch {}
    finally { setLoadingMsgs(false); }
  };

  return (
    <div className="arquivo-page">
      <AnimatePresence mode="wait">
        {selected ? (
          <motion.div
            key="detail"
            className="arquivo-detail"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <button className="arquivo-back" onClick={() => setSelected(null)}>← Voltar</button>
            <div className="arquivo-detail-header">
              {selected.capaUrl
                ? <img src={selected.capaUrl} alt={selected.programa} className="arquivo-detail-capa" />
                : <div className="arquivo-thumb-placeholder">🎬</div>}
              <div>
                <div className="arquivo-detail-title">{selected.programa}</div>
                <span className="arquivo-detail-tipo">{selected.tipo}</span>
                <div className="arquivo-detail-meta">{selected.data} • {selected.horario}</div>
                <div className="arquivo-detail-meta">💬 {selected.totalMsgs} mensagens</div>
              </div>
            </div>
            {loadingMsgs && <div className="arquivo-loading">Carregando mensagens…</div>}
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {msgs.map((m, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.22 }}
                  style={{
                    background: "var(--glass-card)", borderRadius: "var(--r)",
                    border: "1px solid var(--glass-border)", padding: "10px 13px",
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--purple-light)", marginBottom: 4 }}>{m.nome}</div>
                  {m.gifUrl
                    ? <img src={m.gifUrl} alt="gif" style={{ maxWidth: 160, borderRadius: 8 }} />
                    : <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{m.texto}</div>}
                  <div style={{ fontSize: 9, color: "var(--text3)", marginTop: 4 }}>{m.hora}</div>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.22 }}
          >
            <h1 className="arquivo-title">Arquivo</h1>
            {loading && <div className="arquivo-loading">Carregando…</div>}
            {erro    && <div className="arquivo-erro">{erro}</div>}
            {!loading && !erro && items.length === 0 && (
              <div className="arquivo-vazio"><p>📭</p><p>Nenhuma transmissão arquivada.</p><p className="arquivo-vazio-sub">As transmissões anteriores aparecerão aqui.</p></div>
            )}
            <ul className="arquivo-lista">
              {items.map((item, i) => (
                <motion.li
                  key={item.roomId}
                  className="arquivo-item"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: i * 0.05, ease: [0.4, 0, 0.2, 1] }}
                  whileHover={{ x: 4, borderColor: "var(--purple-border)", transition: { type: "spring", stiffness: 300, damping: 22 } }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => openRoom(item)}
                >
                  {item.capaUrl
                    ? <img src={item.capaUrl} alt={item.programa} className="arquivo-thumb" />
                    : <div className="arquivo-thumb-placeholder">🎬</div>}
                  <div className="arquivo-item-info">
                    <span className="arquivo-programa">{item.programa}</span>
                    <span className="arquivo-tipo">{item.tipo}</span>
                    <span className="arquivo-data">{item.data} • {item.horario}</span>
                    <span className="arquivo-stats">💬 {item.totalMsgs} msgs</span>
                  </div>
                  <span className="arquivo-arrow">›</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
