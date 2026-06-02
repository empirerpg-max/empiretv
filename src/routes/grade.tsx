import { useEffect, useState } from "react";
import { motion } from "motion/react";

const GAS_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3b7sK8DD59BHRBRc5Ow1YB/exec";

interface Programa {
  programa: string; tipo: string; material?: string;
  buff?: string; horarioStr?: string; data?: string;
  capaUrl?: string; status?: string;
}

export default function Grade() {
  const [items,   setItems]   = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro,    setErro]    = useState("");

  useEffect(() => {
    fetch(GAS_URL)
      .then(r => r.json())
      .then(d => setItems(d.fullSchedule || []))
      .catch(() => setErro("Erro ao carregar a grade."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="grade-page">
      <h1 className="grade-title">Grade de Programação</h1>
      {loading && <div className="grade-loading">Carregando…</div>}
      {erro    && <div className="grade-erro">{erro}</div>}
      {!loading && !erro && items.length === 0 && <div className="grade-vazia">Sem programas agendados.</div>}
      <ul className="grade-lista">
        {items.map((p, i) => (
          <motion.li
            key={i}
            className={`grade-item ${p.status === "broadcasting" ? "atual" : ""}`}
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28, delay: i * 0.045, ease: [0.4, 0, 0.2, 1] }}
            whileHover={{ x: 4, transition: { type: "spring", stiffness: 300, damping: 22 } }}
          >
            {p.status === "broadcasting" && <span className="grade-ao-vivo">● AO VIVO</span>}
            <div className="grade-item-top">
              {p.capaUrl && <img src={p.capaUrl} alt={p.programa} className="grade-capa" />}
              <div className="grade-item-info">
                <span className="grade-horario">{p.horarioStr || p.data || ""}</span>
                <span className="grade-programa">{p.programa}</span>
                {p.tipo && <span className="grade-tipo">{p.tipo}</span>}
                {p.material && <p className="grade-material">{p.material}</p>}
                {p.buff && <span className="grade-buff">🎮 {p.buff}</span>}
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
