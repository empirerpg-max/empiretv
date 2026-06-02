import { useEffect, useRef, useState } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

interface Msg {
  id: number;
  created_at: string;
  room_id: string;
  user_id: string;
  nome: string;
  texto: string;
  gif_url?: string;
}

// ── Armazenamento resiliente ──
const mem: Record<string, string> = {};
function sGet(k: string) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } }
function sSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } }
function genUid() {
  let id = sGet("etv_uid");
  if (!id) { id = "u_" + Date.now().toString(36); sSet("etv_uid", id); }
  return id;
}
const uid = genUid();

export default function Chat({ roomId }: { roomId: string; backendUrl?: string }) {
  const [msgs,     setMsgs]     = useState<Msg[]>([]);
  const [texto,    setTexto]    = useState("");
  const [nome,     setNome]     = useState(sGet("etv_nome") || "Espectador");
  const [editNome, setEditNome] = useState(!sGet("etv_nome"));
  const [online,   setOnline]   = useState(0);
  const [status,   setStatus]   = useState<"connecting"|"open"|"closed">("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);

  // ── Carrega histórico + assina Realtime ──
  useEffect(() => {
    let cancelled = false;

    // Busca últimas 100 mensagens da sala
    supabase
      .from("chat_messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled && data) setMsgs(data as Msg[]);
      });

    // Canal Realtime para novas mensagens
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (!cancelled) setMsgs(p => [...p.slice(-499), payload.new as Msg]);
        }
      )
      // Presence para contar online
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnline(Object.keys(state).length);
      })
      .subscribe((s) => {
        if (cancelled) return;
        setStatus(s === "SUBSCRIBED" ? "open" : s === "CLOSED" ? "closed" : "connecting");
      });

    channel.track({ uid, nome });
    channelRef.current = channel;

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, nome]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const salvarNome = () => {
    const n = nome.trim() || "Espectador";
    sSet("etv_nome", n); setNome(n); setEditNome(false);
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t || status !== "open") return;
    setTexto("");
    await supabase.from("chat_messages").insert({
      room_id: roomId, user_id: uid, nome, texto: t,
    });
  };

  const fmtHora = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  const statusLabel =
    status === "open"       ? "● ao vivo" :
    status === "connecting" ? "⏳ conectando" :
                              "○ offline";

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

      <div className="chat-messages">
        {msgs.length === 0 && status !== "open" && (
          <p className="chat-empty">⏳ Conectando ao chat...</p>
        )}
        {msgs.length === 0 && status === "open" && (
          <p className="chat-empty">Seja o primeiro a comentar!</p>
        )}
        {msgs.map(m => (
          <div key={m.id} className={`chat-msg ${m.user_id === uid ? "own" : ""}`}>
            <span className="chat-msg-nome">{m.nome}</span>
            {m.gif_url
              ? <img src={m.gif_url} alt="gif" className="chat-gif" />
              : <span className="chat-msg-texto">{m.texto}</span>}
            <span className="chat-msg-hora">{fmtHora(m.created_at)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

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
    </div>
  );
}
