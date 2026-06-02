import { useEffect, useState } from "react";
import Chat from "../components/Chat";

const BACKEND = "https://empiretv-chat-backend.onrender.com";

interface Item {
  roomId: string;
  programa: string;
  tipo: string;
  data: string;
  horario: string;
  capaUrl: string;
  closedAt: string;
  totalMsgs: number;
  totalUsers: number;
}

export default function Arquivo() {
  const [lista,    setLista]    = useState<Item[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [erro,     setErro]     = useState("");
  const [selected, setSelected] = useState<Item | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`${BACKEND}/archive`);
        const data = await res.json();
        setLista(data.archive || []);
      } catch {
        setErro("Erro ao carregar arquivo.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmtData = (iso: string) => { try { return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };

  if (selected) return (
    <div className="arquivo-detail">
      <button className="arquivo-back" onClick={() => setSelected(null)}>← Voltar</button>
      <div className="arquivo-detail-header">
        {selected.capaUrl && <img src={selected.capaUrl} alt={selected.programa} className="arquivo-detail-capa" />}
        <div>
          <h2 className="arquivo-detail-title">{selected.programa}</h2>
          {selected.tipo && <span className="arquivo-detail-tipo">{selected.tipo}</span>}
          <p className="arquivo-detail-meta">📅 {selected.data} {selected.horario} — {fmtData(selected.closedAt)}</p>
          <p className="arquivo-detail-meta">💬 {selected.totalMsgs} mensagens · 👥 {selected.totalUsers} participantes</p>
        </div>
      </div>
      <Chat roomId={selected.roomId} backendUrl={BACKEND} />
    </div>
  );

  if (loading) return <div className="arquivo-loading">🎬 Carregando arquivo...</div>;
  if (erro)    return <div className="arquivo-erro">{erro}</div>;
  if (!lista.length) return <div className="arquivo-vazio"><p>Nenhuma transmissão arquivada ainda.</p><p className="arquivo-vazio-sub">Os programas encerrados aparecem aqui.</p></div>;

  return (
    <div className="arquivo-page">
      <h1 className="arquivo-title">🎬 Arquivo Empire TV</h1>
      <ul className="arquivo-lista">
        {lista.map(item => (
          <li key={item.roomId} className="arquivo-item" onClick={() => setSelected(item)}>
            {item.capaUrl
              ? <img src={item.capaUrl} alt={item.programa} className="arquivo-thumb" />
              : <div className="arquivo-thumb-placeholder">📺</div>}
            <div className="arquivo-item-info">
              <span className="arquivo-programa">{item.programa}</span>
              {item.tipo && <span className="arquivo-tipo">{item.tipo}</span>}
              <span className="arquivo-data">{item.data} {item.horario}</span>
              <span className="arquivo-stats">💬 {item.totalMsgs} · 👥 {item.totalUsers}</span>
            </div>
            <span className="arquivo-arrow">›</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
