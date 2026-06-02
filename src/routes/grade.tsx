import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { fetchGAS } from "../lib/gas";

interface Programa {
  programa: string; tipo: string; material?: string;
  buff?: string; horarioStr?: string; data?: string;
  capaUrl?: string; status?: string; fonte?: string;
}

// Gera os 14 próximos dias a partir de hoje
function gerarDias() {
  const dias: { label: string; key: string; full: string }[] = [];
  const weekNames = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dd   = String(d.getDate()).padStart(2, "0");
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const key  = `${dd}/${mm}/${yyyy}`;
    const label = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : weekNames[d.getDay()];
    dias.push({ label, key, full: `${dd}/${mm}` });
  }
  return dias;
}

function hojeKey() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function Grade() {
  const [items,   setItems]   = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro,    setErro]    = useState("");
  const [diaSel,  setDiaSel]  = useState(hojeKey());

  const dias = useMemo(() => gerarDias(), []);

  useEffect(() => {
    fetchGAS()
      .then(d => setItems(d.fullSchedule || []))
      .catch(() => setErro("Erro ao carregar a grade."))
      .finally(() => setLoading(false));
  }, []);

  // Filtra por dia selecionado
  const itensDia = useMemo(() => {
    return items.filter(p => {
      const d = String(p.data || "").trim();
      // Aceita dd/MM/yyyy ou dd/MM/yy ou sem data (considera hoje)
      if (!d) return diaSel === hojeKey();
      // Normaliza ano 2 dígitos
      const parts = d.split("/");
      if (parts.length === 3) {
        const ano = parts[2].length === 2 ? "20" + parts[2] : parts[2];
        return `${parts[0]}/${parts[1]}/${ano}` === diaSel;
      }
      return false;
    });
  }, [items, diaSel]);

  const now = new Date();
  const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  return (
    <div className="grade-page">
      <h1 className="grade-title">Grade de Programação</h1>

      {/* ── Calendário horizontal ── */}
      <div className="grade-cal-wrap">
        <div className="grade-cal">
          {dias.map(dia => (
            <button
              key={dia.key}
              className={`grade-cal-day ${diaSel === dia.key ? "active" : ""}`}
              onClick={() => setDiaSel(dia.key)}
            >
              <span className="grade-cal-label">{dia.label}</span>
              <span className="grade-cal-num">{dia.full}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Conteúdo ── */}
      {loading && <div className="grade-loading">Carregando…</div>}
      {erro    && <div className="grade-erro">{erro}</div>}

      <AnimatePresence mode="wait">
        <motion.div
          key={diaSel}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {!loading && !erro && itensDia.length === 0 && (
            <div className="grade-vazia">
              <span style={{ fontSize: 40 }}>📭</span>
              <p>Sem programas para este dia.</p>
              <p style={{ fontSize: 11, color: "var(--text3)" }}>Selecione outro dia no calendário.</p>
            </div>
          )}

          <ul className="grade-lista">
            {itensDia.map((p, i) => {
              // calcula se está passado, atual ou futuro
              const hParts = (p.horarioStr || "").split(":");
              const hSecs  = hParts.length >= 2
                ? parseInt(hParts[0]) * 3600 + parseInt(hParts[1]) * 60
                : null;
              const isAtual = p.status === "broadcasting" || (
                diaSel === hojeKey() && hSecs !== null &&
                nowSecs >= hSecs && nowSecs < hSecs + 7200
              );
              const isPassado = diaSel === hojeKey() && hSecs !== null && nowSecs >= hSecs + 7200;

              return (
                <motion.li
                  key={i}
                  className={`grade-item ${
                    isAtual ? "atual" : isPassado ? "passado" : ""
                  }`}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.26, delay: i * 0.04 }}
                  whileHover={{ x: 3, transition: { type: "spring", stiffness: 300, damping: 22 } }}
                >
                  {/* Linha de tempo vertical */}
                  <div className="grade-timeline">
                    <div className={`grade-tl-dot ${isAtual ? "ao-vivo" : isPassado ? "passado" : ""}`} />
                    {i < itensDia.length - 1 && <div className="grade-tl-line" />}
                  </div>

                  <div className="grade-item-body">
                    <div className="grade-item-top">
                      {p.capaUrl
                        ? <img src={p.capaUrl} alt={p.programa} className="grade-capa" />
                        : <div className="grade-capa-placeholder">📺</div>}
                      <div className="grade-item-info">
                        <div className="grade-item-row1">
                          <span className="grade-horario">{p.horarioStr || "—"}</span>
                          {isAtual && <span className="grade-ao-vivo">● AO VIVO</span>}
                          {isPassado && <span className="grade-passado-tag">Encerrado</span>}
                        </div>
                        <span className="grade-programa">{p.programa}</span>
                        {p.tipo && <span className="grade-tipo">{p.tipo}</span>}
                        {p.material && <p className="grade-material">{p.material}</p>}
                        {p.buff && <span className="grade-buff">🎮 {p.buff}</span>}
                      </div>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
