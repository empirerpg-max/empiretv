import { useEffect, useRef, useState, useCallback } from "react";

interface Msg {
  id: string;
  tgId: string;
  nome: string;
  texto: string;
  tipo: string;
  gifUrl?: string;
  data: string;
}

// ── Armazenamento resiliente ──
const memStore: Record<string, string> = {};
function storeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memStore[key] ?? null; }
}
function storeSet(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { memStore[key] = val; }
}
function genUid() {
  let id = storeGet("etv_uid");
  if (!id) { id = "u_" + Date.now().toString(36); storeSet("etv_uid", id); }
  return id;
}
function getNome() { return storeGet("etv_nome") || "Espectador"; }

// ── Acorda o servidor Render antes de conectar o WS ──
async function wakeBackend(url: string) {
  try { await fetch(`${url}/ping`, { signal: AbortSignal.timeout(8000) }); } catch { /* ignora */ }
}

export default function Chat({ roomId, backendUrl }: { roomId: string; backendUrl: string }) {
  const [msgs,     setMsgs]     = useState<Msg[]>([]);
  const [texto,    setTexto]    = useState("");
  const [nome,     setNome]     = useState(getNome());
  const [editNome, setEditNome] = useState(!storeGet("etv_nome"));
  const [online,   setOnline]   = useState(0);
  const [archived, setArchived] = useState(false);
  const [status,   setStatus]   = useState<"waking"|"connecting"|"open"|"closed">("waking");
  const wsRef       = useRef<WebSocket | null>(null);
  const retryRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const uid = genUid();

  const connect = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    const wsUrl = backendUrl.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(
      `${wsUrl}/ws?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(uid)}&nome=${encodeURIComponent(nome)}`
    );
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen  = () => setStatus("open");
    ws.onclose = () => {
      setStatus("closed");
      // Tenta acordar novamente antes de reconectar
      retryRef.current = setTimeout(async () => {
        await wakeBackend(backendUrl);
        connect();
      }, 5000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "history")     { setMsgs(msg.messages || []); if (msg.archived) setArchived(true); }
      if (msg.type === "message")     setMsgs(p => [...p.slice(-499), msg.message]);
      if (msg.type === "online")      setOnline(msg.count);
      if (msg.type === "room_closed") setArchived(true);
      if (msg.type === "ping")        ws.send(JSON.stringify({ type: "pong" }));
    };
  }, [roomId, backendUrl, uid, nome]);

  // ── Na montagem: acorda o servidor primeiro, depois conecta ──
  useEffect(() => {
    let cancelled = false;
    setStatus("waking");
    wakeBackend(backendUrl).then(() => {
      if (!cancelled) connect();
    });
    // Keep-alive a cada 10 min para não deixar dormir enquanto o chat estiver aberto
    const keepAlive = setInterval(() => fetch(`${backendUrl}/ping`).catch(() => {}), 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(keepAlive);
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, backendUrl]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const salvarNome = () => {
    const n = nome.trim() || "Espectador";
    storeSet("etv_nome", n);
    setNome(n); setEditNome(false);
  };

  const enviar = () => {
    const t = texto.trim();
    if (!t || archived || status !== "open") return;
    wsRef.current?.send(JSON.stringify({ type: "message", texto: t }));
    setTexto("");
  };

  const fmtHora = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  const statusLabel =
    status === "waking"     ? "⏳ acordando..." :
    status === "connecting" ? "⏳ conectando" :
    status === "open"       ? "● ao vivo" :
                              "○ reconectando...";

  if (editNome) return (
    <div className="chat-nome-screen">
      <p className="chat-nome-title">Como quer ser chamado no chat?</p>
      <input
        className="chat-nome-input"
        value={nome}
        onChange={e => setNome(e.target.value)}
        onKeyDown={e => e.key === "Enter" && salvarNome()}
        placeholder="Seu nome..."
        maxLength={24}
        autoFocus
      />
      <button className="chat-nome-btn" onClick={salvarNome}>Entrar no Chat</button>
    </div>
  );

  return (
    <div className="chat-wrap">
      <div className="chat-header">
        <span className="chat-title">💬 Chat</span>
        <div className="chat-meta">
          {online > 0 && <span className="chat-online">👁 {online}</span>}
          <span className={`chat-status ${status}`}>{statusLabel}</span>
          <button className="chat-edit-nome" onClick={() => setEditNome(true)} title="Mudar nome">✏️</button>
        </div>
      </div>

      {archived && <div className="chat-archived">🔒 Transmissão encerrada — modo arquivo</div>}

      <div className="chat-messages">
        {msgs.length === 0 && status !== "open" && (
          <p className="chat-empty">⏳ Aguardando conexão com o servidor...</p>
        )}
        {msgs.length === 0 && status === "open" && (
          <p className="chat-empty">Seja o primeiro a enviar uma mensagem!</p>
        )}
        {msgs.map(m => (
          <div key={m.id} className={`chat-msg ${m.tgId === uid ? "own" : ""}`}>
            <span className="chat-msg-nome">{m.nome}</span>
            {m.gifUrl
              ? <img src={m.gifUrl} alt="gif" className="chat-gif" />
              : <span className="chat-msg-texto">{m.texto}</span>}
            <span className="chat-msg-hora">{fmtHora(m.data)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!archived && (
        <div className="chat-input-row">
          <input
            className="chat-input"
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => e.key === "Enter" && enviar()}
            placeholder={status === "open" ? "Mensagem..." : "Aguardando conexão..."}
            maxLength={500}
            disabled={status !== "open"}
          />
          <button className="chat-send" onClick={enviar} disabled={status !== "open" || !texto.trim()}>➤</button>
        </div>
      )}
    </div>
  );
}
