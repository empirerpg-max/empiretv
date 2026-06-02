import { useEffect, useRef, useState } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

interface ReplyTo {
  id: string;
  nome: string;
  texto: string;
}

interface Msg {
  id: string;
  user_id: string;
  nome: string;
  texto: string;
  gif_url?: string;
  reply_to?: ReplyTo;
  created_at: string;
}

// ── Storage resiliente ──
const mem: Record<string, string> = {};
function sGet(k: string) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } }
function sSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } }
function genUid() {
  let id = sGet("etv_uid");
  if (!id) { id = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`; sSet("etv_uid", id); }
  return id;
}
const UID = genUid();

export default function Chat({ roomId, programa, backendUrl }: {
  roomId: string;
  programa?: string;
  backendUrl?: string;
}) {
  const [msgs,      setMsgs]      = useState<Msg[]>([]);
  const [texto,     setTexto]     = useState("");
  const [nome,      setNome]      = useState(sGet("etv_nome") || "Espectador");
  const [editNome,  setEditNome]  = useState(!sGet("etv_nome"));
  const [online,    setOnline]    = useState(0);
  const [archived,  setArchived]  = useState(false);
  const [status,    setStatus]    = useState<"connecting"|"open"|"closed">("connecting");
  const [replyTo,   setReplyTo]   = useState<ReplyTo | null>(null);
  const channelRef  = useRef<RealtimeChannel | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);

  // ── Init ──
  useEffect(() => {
    let cancelled = false;
    setMsgs([]); setArchived(false); setStatus("connecting"); setReplyTo(null);

    async function init() {
      const { data: arc } = await sb
        .from("chat_archives")
        .select("messages_json, encerrado_at")
        .eq("room_id", roomId)
        .maybeSingle();

      if (arc) {
        if (!cancelled) { setMsgs(arc.messages_json as Msg[]); setArchived(true); setStatus("closed"); }
        return;
      }

      const { data: hist } = await sb
        .from("chat_messages")
        .select("id, user_id, nome, texto, gif_url, reply_to, created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(500);

      if (!cancelled && hist) setMsgs(hist as Msg[]);

      const channel = sb
        .channel(`chat-broadcast:${roomId}`, {
          config: { broadcast: { self: true }, presence: { key: UID } },
        })
        .on("broadcast", { event: "msg" }, ({ payload }) => {
          if (!cancelled) setMsgs(p => {
            if (p.some(m => m.id === (payload as Msg).id)) return p;
            return [...p.slice(-999), payload as Msg];
          });
        })
        .on("broadcast", { event: "close_room" }, () => {
          if (!cancelled) setArchived(true);
        })
        .on("presence", { event: "sync" }, () => {
          const count = Object.keys(channel.presenceState()).length;
          if (!cancelled) setOnline(count);
        })
        .subscribe((s) => {
          if (cancelled) return;
          if (s === "SUBSCRIBED") { setStatus("open"); channel.track({ uid: UID, nome }); }
          else if (s === "CLOSED" || s === "CHANNEL_ERROR") setStatus("closed");
        });

      channelRef.current = channel;
    }

    init();
    return () => { cancelled = true; if (channelRef.current) sb.removeChannel(channelRef.current); };
  }, [roomId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  // ── Responder ──
  const responder = (m: Msg) => {
    setReplyTo({ id: m.id, nome: m.nome, texto: m.gif_url ? "🖼 GIF" : m.texto });
    inputRef.current?.focus();
  };

  const cancelarReply = () => setReplyTo(null);

  // ── Enviar ──
  const enviar = async () => {
    const t = texto.trim();
    if (!t || archived || status !== "open") return;
    setTexto("");
    const reply = replyTo;
    setReplyTo(null);

    const msg: Msg = {
      id: `${UID}_${Date.now()}`,
      user_id: UID,
      nome,
      texto: t,
      ...(reply ? { reply_to: reply } : {}),
      created_at: new Date().toISOString(),
    };

    channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });

    await sb.from("chat_messages").insert({
      room_id: roomId,
      user_id: UID,
      nome,
      texto: t,
      ...(reply ? { reply_to: reply } : {}),
    });
  };

  // ── Salvar nome ──
  const salvarNome = () => {
    const n = nome.trim() || "Espectador";
    sSet("etv_nome", n); setNome(n); setEditNome(false);
    channelRef.current?.track({ uid: UID, nome: n });
  };

  const fmtHora = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  const truncar = (s: string, n = 60) => s.length > n ? s.slice(0, n) + "…" : s;

  const statusLabel =
    status === "open"       ? "● ao vivo" :
    status === "connecting" ? "⏳ conectando..." :
                              "○ encerrado";

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
      {/* Header */}
      <div className="chat-header">
        <span className="chat-title">💬 Chat ao vivo</span>
        <div className="chat-meta">
          {online > 0 && <span className="chat-online">👁 {online}</span>}
          <span className={`chat-status ${status}`}>{statusLabel}</span>
          <button className="chat-edit-nome" onClick={() => setEditNome(true)} title="Mudar nome">✏️</button>
        </div>
      </div>

      {archived && (
        <div className="chat-archived">🔒 Transmissão encerrada — histórico completo</div>
      )}

      {/* Mensagens */}
      <div className="chat-messages">
        {msgs.length === 0 && status === "connecting" && <p className="chat-empty">⏳ Conectando ao chat...</p>}
        {msgs.length === 0 && status === "open"       && <p className="chat-empty">Seja o primeiro a comentar! 👋</p>}

        {msgs.map((m, i) => (
          <div
            key={m.id ?? i}
            className={`chat-msg ${m.user_id === UID ? "own" : ""}`}
          >
            {/* Quote de reply */}
            {m.reply_to && (
              <div className="chat-reply-quote">
                <span className="chat-reply-quote-nome">{m.reply_to.nome}</span>
                <span className="chat-reply-quote-texto">{truncar(m.reply_to.texto)}</span>
              </div>
            )}

            <div className="chat-msg-body">
              <div className="chat-msg-content">
                <span className="chat-msg-nome">{m.nome}</span>
                {m.gif_url
                  ? <img src={m.gif_url} alt="gif" className="chat-gif" />
                  : <span className="chat-msg-texto">{m.texto}</span>}
                <span className="chat-msg-hora">{fmtHora(m.created_at)}</span>
              </div>

              {/* Botão responder */}
              {!archived && status === "open" && (
                <button
                  className="chat-reply-btn"
                  onClick={() => responder(m)}
                  title="Responder"
                >↩</button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!archived && (
        <div className="chat-input-area">
          {/* Preview do reply */}
          {replyTo && (
            <div className="chat-reply-preview">
              <div className="chat-reply-preview-inner">
                <span className="chat-reply-preview-nome">↩ {replyTo.nome}</span>
                <span className="chat-reply-preview-texto">{truncar(replyTo.texto)}</span>
              </div>
              <button className="chat-reply-cancel" onClick={cancelarReply} title="Cancelar">✕</button>
            </div>
          )}
          <div className="chat-input-row">
            <input
              ref={inputRef}
              className="chat-input"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => e.key === "Enter" && enviar()}
              placeholder={status === "open" ? `Comentar como ${nome}...` : "Aguardando conexão..."}
              maxLength={500}
              disabled={status !== "open"}
            />
            <button
              className="chat-send"
              onClick={enviar}
              disabled={status !== "open" || !texto.trim()}
            >➤</button>
          </div>
        </div>
      )}
    </div>
  );
}
