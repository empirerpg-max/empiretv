import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { driveImg } from "../lib/driveImg";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

interface Archive {
  room_id: string;
  programa: string;
  encerrado_at: string;
  messages_json: Msg[];
}

interface Msg {
  id: string;
  nome: string;
  texto: string;
  gif_url?: string;
  reply_to?: { nome: string; texto: string };
  created_at: string;
}

function fmtData(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function fmtHora(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function Arquivo() {
  const [items,    setItems]    = useState<Archive[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [erro,     setErro]     = useState("");
  const [selected, setSelected] = useState<Archive | null>(null);

  useEffect(() => {
    sb.from("chat_archives")
      .select("room_id, programa, encerrado_at, messages_json")
      .order("encerrado_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro("Erro ao carregar o arquivo."); }
        else        { setItems((data as Archive[]) || []); }
        setLoading(false);
      });
  }, []);

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
              <div>
                <div className="arquivo-detail-title">{selected.programa}</div>
                <div className="arquivo-detail-meta">
                  Encerrado em {fmtData(selected.encerrado_at)}
                </div>
                <div className="arquivo-detail-meta">
                  💬 {selected.messages_json.length} mensagens
                </div>
              </div>
            </div>

            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              {selected.messages_json.map((m, i) => (
                <motion.li
                  key={m.id ?? i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.22 }}
                  style={{
                    background: "var(--glass-card)", borderRadius: "var(--r)",
                    border: "1px solid var(--glass-border)", padding: "10px 13px",
                  }}
                >
                  {/* reply quote */}
                  {m.reply_to && (
                    <div style={{
                      borderLeft: "3px solid var(--purple-light)",
                      paddingLeft: 8, marginBottom: 6,
                      fontSize: 11, color: "var(--text3)"
                    }}>
                      <span style={{ fontWeight: 700, color: "var(--purple-light)" }}>{m.reply_to.nome} </span>
                      {m.reply_to.texto}
                    </div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--purple-light)", marginBottom: 4 }}>
                    {m.nome}
                  </div>
                  {m.gif_url
                    ? <img src={m.gif_url} alt="gif" style={{ maxWidth: 160, borderRadius: 8 }} />
                    : <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{m.texto}</div>}
                  <div style={{ fontSize: 9, color: "var(--text3)", marginTop: 4 }}>{fmtHora(m.created_at)}</div>
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
            {loading  && <div className="arquivo-loading">Carregando…</div>}
            {erro     && <div className="arquivo-erro">{erro}</div>}
            {!loading && !erro && items.length === 0 && (
              <div className="arquivo-vazio">
                <p>📭</p>
                <p>Nenhuma transmissão arquivada.</p>
                <p className="arquivo-vazio-sub">As transmissões anteriores aparecerão aqui.</p>
              </div>
            )}
            <ul className="arquivo-lista">
              {items.map((item, i) => (
                <motion.li
                  key={item.room_id}
                  className="arquivo-item"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: i * 0.05, ease: [0.4, 0, 0.2, 1] }}
                  whileHover={{ x: 4, borderColor: "var(--purple-border)", transition: { type: "spring", stiffness: 300, damping: 22 } }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelected(item)}
                >
                  <div className="arquivo-thumb-placeholder">🎬</div>
                  <div className="arquivo-item-info">
                    <span className="arquivo-programa">{item.programa}</span>
                    <span className="arquivo-data">{fmtData(item.encerrado_at)}</span>
                    <span className="arquivo-stats">💬 {item.messages_json.length} msgs</span>
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
