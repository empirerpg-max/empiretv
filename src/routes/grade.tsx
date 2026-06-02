import { useEffect, useState } from "react";

const GAS_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";

interface Programa {
  programa: string;
  tipo: string;
  material?: string;
  buff?: string;
  horarioStr: string;
  data?: string;
  capaUrl?: string;
  status?: string;
  topicoUrl?: string;
  inicio?: number;
  fim?: number;
  fonte?: string;
}

function getSecsNow() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export default function Grade() {
  const [lista,   setLista]   = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro,    setErro]    = useState("");
  const [nowSecs, setNowSecs] = useState(getSecsNow());

  useEffect(() => {
    const t = setInterval(() => setNowSecs(getSecsNow()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(GAS_URL);
        const data = await res.json();
        const all  = (data.fullSchedule || []) as Programa[];
        setLista(all);
      } catch {
        setErro("Erro ao carregar grade.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isAtual = (p: Programa) =>
    p.inicio !== undefined && p.fim !== undefined
      ? nowSecs >= p.inicio && nowSecs < p.fim
      : false;

  if (loading) return <div className="grade-loading">📋 Carregando grade...</div>;
  if (erro)    return <div className="grade-erro">{erro}</div>;
  if (!lista.length) return <div className="grade-vazia">Nenhum programa encontrado.</div>;

  return (
    <div className="grade-page">
      <h1 className="grade-title">📋 Grade de Programação</h1>
      <ul className="grade-lista">
        {lista.map((p, i) => (
          <li key={i} className={`grade-item ${isAtual(p) ? "atual" : ""}`}>
            {isAtual(p) && <span className="grade-ao-vivo">● AO VIVO</span>}
            <div className="grade-item-top">
              {p.capaUrl && <img src={p.capaUrl} alt={p.programa} className="grade-capa" />}
              <div className="grade-item-info">
                <span className="grade-horario">{p.horarioStr || p.data}</span>
                <span className="grade-programa">{p.programa}</span>
                {p.tipo && <span className="grade-tipo">{p.tipo}</span>}
              </div>
            </div>
            {p.material && <p className="grade-material">{p.material}</p>}
            {p.buff && <span className="grade-buff">🎮 {p.buff}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
