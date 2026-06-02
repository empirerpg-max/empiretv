import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { fetchGAS } from "../lib/gas";
import "../styles/grade.css";

interface Programa {
  programa: string; tipo: string; material?: string;
  buff?: string; horarioStr?: string; data?: string;
  capaUrl?: string; topicoUrl?: string;
}

function toKey(d: Date) {
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function hojeKey() { return toKey(new Date()); }
function parseKey(key: string): Date {
  const [dd, mm, yyyy] = key.split("/");
  return new Date(+yyyy, +mm - 1, +dd);
}

const SEMANA = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const MESES  = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

export default function Grade() {
  const [items,   setItems]   = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro,    setErro]    = useState("");
  const [diaSel,  setDiaSel]  = useState(hojeKey());
  const hoje = new Date();
  const [mesVis, setMesVis]   = useState({ year: hoje.getFullYear(), month: hoje.getMonth() });

  useEffect(() => {
    fetchGAS()
      .then(d => setItems(d.fullSchedule || []))
      .catch(() => setErro("Erro ao carregar a grade."))
      .finally(() => setLoading(false));
  }, []);

  const diasDoMes = useMemo(() => {
    const { year, month } = mesVis;
    const primeiro = new Date(year, month, 1);
    const ultimo   = new Date(year, month + 1, 0);
    const cells: (Date | null)[] = [];
    for (let i = 0; i < primeiro.getDay(); i++) cells.push(null);
    for (let d = 1; d <= ultimo.getDate(); d++) cells.push(new Date(year, month, d));
    return cells;
  }, [mesVis]);

  const diasComEvento = useMemo(() => {
    const set = new Set<string>();
    items.forEach(p => { if (p.data) set.add(p.data.trim()); });
    return set;
  }, [items]);

  const itensDia = useMemo(() => {
    return items
      .filter(p => String(p.data || "").trim() === diaSel)
      .sort((a, b) => (a.horarioStr || "").localeCompare(b.horarioStr || ""));
  }, [items, diaSel]);

  const now = new Date();
  const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60;

  function prevMes() {
    setMesVis(p => p.month === 0
      ? { year: p.year - 1, month: 11 }
      : { year: p.year, month: p.month - 1 });
  }
  function nextMes() {
    setMesVis(p => p.month === 11
      ? { year: p.year + 1, month: 0 }
      : { year: p.year, month: p.month + 1 });
  }

  const dataSel = parseKey(diaSel);
  const labelDia = diaSel === hojeKey()
    ? "Hoje"
    : diaSel === toKey(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1))
    ? "Amanhã"
    : `${SEMANA[dataSel.getDay()]}, ${dataSel.getDate()} de ${MESES[dataSel.getMonth()]}`;

  return (
    <div className="grade-page">
      <h1 className="grade-title">Grade de Programação</h1>

      {/* ── Calendário mensal ── */}
      <div className="grade-cal-card">
        <div className="grade-cal-header">
          <button className="grade-cal-nav" onClick={prevMes}>‹</button>
          <span className="grade-cal-mes">{MESES[mesVis.month]} {mesVis.year}</span>
          <button className="grade-cal-nav" onClick={nextMes}>›</button>
        </div>
        <div className="grade-cal-semana">
          {SEMANA.map(s => <span key={s}>{s}</span>)}
        </div>
        <div className="grade-cal-grid">
          {diasDoMes.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="grade-cal-cell empty" />;
            const key       = toKey(d);
            const isHoje    = key === hojeKey();
            const isSel     = key === diaSel;
            const temEvento = diasComEvento.has(key);
            return (
              <button
                key={key}
                className={`grade-cal-cell ${isSel ? "sel" : isHoje ? "hoje" : ""} ${temEvento ? "tem-evento" : ""}`}
                onClick={() => setDiaSel(key)}
              >
                <span>{d.getDate()}</span>
                {temEvento && <span className="grade-cal-dot" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Cabeçalho do dia ── */}
      <div className="grade-dia-header">
        <span className="grade-dia-label">{labelDia}</span>
        <span className="grade-dia-count">{itensDia.length} programa{itensDia.length !== 1 ? "s" : ""}</span>
      </div>

      {loading && <div className="grade-loading">Carregando…</div>}
      {erro    && <div className="grade-erro">{erro}</div>}

      <AnimatePresence mode="wait">
        <motion.div
          key={diaSel}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          {!loading && !erro && itensDia.length === 0 && (
            <div className="grade-vazia">
              <span style={{ fontSize: 40 }}>📭</span>
              <p>Sem programas para este dia.</p>
            </div>
          )}

          <div className="grade-cards">
            {itensDia.map((p, i) => {
              const hParts   = (p.horarioStr || "").split(":");
              const hSecs    = hParts.length >= 2 ? +hParts[0] * 3600 + +hParts[1] * 60 : null;
              const isAoVivo  = diaSel === hojeKey() && hSecs !== null && nowSecs >= hSecs && nowSecs < hSecs + 7200;
              const isPassado = diaSel === hojeKey() && hSecs !== null && nowSecs >= hSecs + 7200;

              return (
                <motion.div
                  key={i}
                  className={`grade-card ${isAoVivo ? "ao-vivo" : isPassado ? "passado" : ""}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: i * 0.05 }}
                  whileHover={{ y: -3, transition: { type: "spring", stiffness: 300, damping: 20 } }}
                  onClick={() => { if (p.topicoUrl) window.open(p.topicoUrl, "_blank"); }}
                  style={{ cursor: p.topicoUrl ? "pointer" : "default" }}
                >
                  <div className="grade-card-thumb">
                    {p.capaUrl
                      ? <img src={p.capaUrl} alt={p.programa} />
                      : <div className="grade-card-thumb-placeholder">📺</div>}
                    {isAoVivo  && <span className="grade-card-live">● AO VIVO</span>}
                    {isPassado && <span className="grade-card-ended">Encerrado</span>}
                  </div>
                  <div className="grade-card-info">
                    <span className="grade-card-horario">{p.horarioStr || "—"}</span>
                    <span className="grade-card-programa">{p.programa}</span>
                    {p.tipo     && <span className="grade-card-tipo">{p.tipo}</span>}
                    {p.material && <span className="grade-card-material">{p.material}</span>}
                    {p.buff     && <span className="grade-card-buff">🎮 {p.buff}</span>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
