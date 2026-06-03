import { useEffect, useRef, useState } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

const GAS_PRESENCE_WEBHOOK = import.meta.env.VITE_GAS_CHAT_WEBHOOK || "";

// ── Telegram WebApp identity ──────────────────────────────────
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

function getTelegramUser(): TelegramUser | null {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) return tg.initDataUnsafe.user as TelegramUser;
  } catch {}
  return null;
}

function buildIdentity() {
  const tg = getTelegramUser();
  if (tg) {
    const name = [tg.first_name, tg.last_name].filter(Boolean).join(" ");
    return { uid: `tg_${tg.id}`, nome: name, tgId: String(tg.id), fromTelegram: true };
  }
  // Fallback para web
  const mem: Record<string, string> = {};
  function sGet(k: string) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } }
  function sSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } }
  let uid = sGet("etv_uid");
  if (!uid) { uid = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`; sSet("etv_uid", uid); }
  return { uid, nome: sGet("etv_nome") || "", tgId: "", fromTelegram: false };
}

const IDENTITY = buildIdentity();

// ── Presença ────────────────────────────────────────────────────
interface PresenceSession {
  roomId: string;
  programa: string;
  entradaMs: number;
}

const presenceSession = { current: null as PresenceSession | null };

export function startPresence(roomId: string, programa: string) {
  if (presenceSession.current?.roomId === roomId) return;
  presenceSession.current = { roomId, programa, entradaMs: Date.now() };
}

export async function endPresence(transmissaoDuracaoMs: number) {
  const s = presenceSession.current;
  if (!s) return;
  presenceSession.current = null;

  const tempoMs = Date.now() - s.entradaMs;
  const pct = transmissaoDuracaoMs > 0
    ? Math.min(100, Math.round((tempoMs / transmissaoDuracaoMs) * 100))
    : 0;

  if (!GAS_PRESENCE_WEBHOOK) return;
  try {
    await fetch(GAS_PRESENCE_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "presenca",
        uid:       IDENTITY.uid,
        nome:      IDENTITY.nome,
        tgId:      IDENTITY.tgId,
        roomId:    s.roomId,
        programa:  s.programa,
        tempoMs,
        presencaPct: pct,
        data:      new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn("[endPresence] webhook falhou:", e);
  }
}

// ── Tipos ────────────────────────────────────────────────────────
interface ReplyTo { id: string; nome: string; texto: string; }
interface Msg {
  id: string; user_id: string; nome: string; texto: string;
  gif_url?: string; reply_to?: ReplyTo; created_at: string;
}

// ── Chat component ───────────────────────────────────────────────
export default function Chat({ roomId, programa, backendUrl: _backendUrl }: {
  roomId: string;
  programa?: string;
  backendUrl?: string;
}) {
  const [msgs,     setMsgs]     = useState<Msg[]>([]);
  const [texto,    setTexto]    = useState("");
  const [nome,     setNome]     = useState(IDENTITY.nome);
  const [editNome, setEditNome] = useState(!IDENTITY.fromTelegram && !IDENTITY.nome);
  const [online,   setOnline]   = useState(0);
  const [archived, setArchived] = useState(false);
  const [status,   setStatus]   = useState<"connecting"|"open"|"closed">("connecting");
  const [replyTo,  setReplyTo]  = useState<ReplyTo | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);

  // ── Init ──
  useEffect(() => {
    let cancelled = false;
    setMsgs([]); setArchived(false); setStatus("connecting"); setReplyTo(null);
    startPresence(roomId, programa || "Empire TV");

    async function init() {
      const { data: arc } = await sb
        .from("chat_archives")
        .select("messages_json")
        .eq("room_id", roomId)
        .maybeSingle();

      if (arc) {
        if (!cancelled) { setMsgs(arc.messages_json as Msg[]); setArchived(true); setStatus("closed"); }
        return;
      }

      const { data: hist } = await sb
        .from("chat_messages")
        .select("id,user_id,nome,texto,gif_url,reply_to,created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(500);

      if (!cancelled && hist) setMsgs(hist as Msg[]);

      const channel = sb
        .channel(`chat-broadcast:${roomId}`, {
          config: { broadcast: { self: true }, presence: { key: IDENTITY.uid } },
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
          if (s === "SUBSCRIBED") {
            setStatus("open");
            channel.track({ uid: IDENTITY.uid, nome });
          } else if (s === "CLOSED" || s === "CHANNEL_ERROR") {
            setStatus("closed");
          }
        });

      channelRef.current = channel;
    }

    init();
    return () => {
      cancelled = true;
      if (channelRef.current) sb.removeChannel(channelRef.current);
    };
  }, [roomId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const responder = (m: Msg) => {
    setReplyTo({ id: m.id, nome: m.nome, texto: m.gif_url ? "🖼 GIF" : m.texto });
    inputRef.current?.focus();
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t || archived || status !== "open") return;
    setTexto("");
    const reply = replyTo;
    setReplyTo(null);

    // Salva nome se veio do Telegram
    if (IDENTITY.fromTelegram && nome !== IDENTITY.nome) setNome(IDENTITY.nome);

    const msgNome = IDENTITY.fromTelegram ? IDENTITY.nome : nome;
    const msg: Msg = {
      id: `${IDENTITY.uid}_${Date.now()}`,
      user_id: IDENTITY.uid,
      nome: msgNome,
      texto: t,
      ...(reply ? { reply_to: reply } : {}),
      created_at: new Date().toISOString(),
    };

    channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });
    await sb.from("chat_messages").insert({
      room_id: roomId, user_id: IDENTITY.uid, nome: msgNome, texto: t,
      ...(reply ? { reply_to: reply } : {}),
    });
  };

  const salvarNome = () => {
    const n = nome.trim() || "Espectador";
    try { localStorage.setItem("etv_nome", n); } catch {}
    setNome(n); setEditNome(false);
    channelRef.current?.track({ uid: IDENTITY.uid, nome: n });
  };

  const fmtHora = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  const truncar = (s: string, n = 55) => s.length > n ? s.slice(0, n) + "…" : s;

  const displayNome = IDENTITY.fromTelegram ? IDENTITY.nome : nome;

  // ── Tela de nome (somente quando não é Telegram e sem nome salvo) ──
  if (editNome && !IDENTITY.fromTelegram) return (
    <div className="cf-nome-screen">
      <div className="cf-nome-header" />
      <div className="cf-nome-body">
        <div className="cf-nome-logo">💬</div>
        <p className="cf-nome-title">Como quer ser chamado?</p>
        <p className="cf-nome-sub">Seu apelido no chat ao vivo</p>
        <input
          className="cf-nome-input"
          value={nome}
          onChange={e => setNome(e.target.value)}
          onKeyDown={e => e.key === "Enter" && salvarNome()}
          placeholder="Digite seu nome..."
          maxLength={24}
          autoFocus
        />
        <button className="cf-nome-btn" onClick={salvarNome}>Entrar no Chat</button>
      </div>
    </div>
  );

  return (
    <div className="cf-wrap">
      {/* Header */}
      <div className="cf-header">
        <div className="cf-header-info">
          <span className="cf-header-title">Chat ao vivo</span>
          {online > 0 && (
            <span className="cf-header-online">
              <span className="cf-online-dot" />
              {online}
            </span>
          )}
        </div>
        <div className="cf-header-actions">
          {archived
            ? <span className="cf-badge-closed">Encerrado</span>
            : <span className="cf-badge-live">● Ao Vivo</span>
          }
          {!IDENTITY.fromTelegram && (
            <button className="cf-edit-btn" onClick={() => setEditNome(true)} title="Mudar nome">✏️</button>
          )}
        </div>
      </div>

      {archived && (
        <div className="cf-archived-bar">🔒 Histórico da transmissão</div>
      )}

      {/* Mensagens */}
      <div className="cf-messages">
        {msgs.length === 0 && status === "connecting" && (
          <div className="cf-empty"><div className="cf-spinner" /><span>Conectando...</span></div>
        )}
        {msgs.length === 0 && status === "open" && (
          <div className="cf-empty">👋 Seja o primeiro a comentar!</div>
        )}

        {msgs.map((m, i) => {
          const isOwn = m.user_id === IDENTITY.uid;
          return (
            <div key={m.id ?? i} className={`cf-msg-row ${isOwn ? "own" : ""}`}>
              <div className={`cf-bubble ${isOwn ? "own" : "other"}`}>
                {/* Reply quote */}
                {m.reply_to && (
                  <div className="cf-quote">
                    <span className="cf-quote-nome">{m.reply_to.nome}</span>
                    <span className="cf-quote-texto">{truncar(m.reply_to.texto)}</span>
                  </div>
                )}
                {!isOwn && <span className="cf-msg-nome">{m.nome}</span>}
                {m.gif_url
                  ? <img src={m.gif_url} alt="gif" className="cf-gif" />
                  : <span className="cf-msg-texto">{m.texto}</span>
                }
                <div className="cf-msg-footer">
                  <span className="cf-msg-hora">{fmtHora(m.created_at)}</span>
                  {!archived && status === "open" && (
                    <button className="cf-reply-btn" onClick={() => responder(m)} title="Responder">↩</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!archived && (
        <div className="cf-input-area">
          {replyTo && (
            <div className="cf-reply-preview">
              <div>
                <span className="cf-reply-preview-nome">↩ {replyTo.nome}</span>
                <span className="cf-reply-preview-texto">{truncar(replyTo.texto, 45)}</span>
              </div>
              <button className="cf-reply-cancel" onClick={() => setReplyTo(null)}>✕</button>
            </div>
          )}
          <div className="cf-input-row">
            <input
              ref={inputRef}
              className="cf-input"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => e.key === "Enter" && enviar()}
              placeholder={status === "open" ? `${displayNome || "Comentar"}...` : "Aguardando conexão..."}
              maxLength={500}
              disabled={status !== "open"}
            />
            <button
              className="cf-send-btn"
              onClick={enviar}
              disabled={status !== "open" || !texto.trim()}
              aria-label="Enviar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
