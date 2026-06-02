import { useEffect, useRef, useState } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

interface Msg {
  id: string;
  user_id: string;
  nome: string;
  texto: string;
  gif_url?: string;
  created_at: string;
}

// ── Storage resiliente (funciona mesmo em iframe sandboxado) ──
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
  backendUrl?: string; // mantido por compatibilidade, não usado
}) {
  const [msgs,     setMsgs]     = useState<Msg[]>([]);
  const [texto,    setTexto]    = useState("");
  const [nome,     setNome]     = useState(sGet("etv_nome") || "Espectador");
  const [editNome, setEditNome] = useState(!sGet("etv_nome"));
  const [online,   setOnline]   = useState(0);
  const [archived, setArchived] = useState(false);
  const [status,   setStatus]   = useState<"connecting"|"open"|"closed">("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const msgsRef    = useRef<Msg[]>([]);
  const bottomRef  = useRef<HTMLDivElement>(null);

  // Mantém ref sincronizada para uso no cleanup sem closure stale
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  // ── Inicializa: carrega histórico + canal realtime ──
  useEffect(() => {
    let cancelled = false;
    setMsgs([]);
    setArchived(false);
    setStatus("connecting");

    async function init() {
      // 1. Verifica se já existe arquivo (transmissão encerrada)
      const { data: arc } = await sb
        .from("chat_archives")
        .select("messages_json, encerrado_at")
        .eq("room_id", roomId)
        .maybeSingle();

      if (arc) {
        if (!cancelled) {
          setMsgs(arc.messages_json as Msg[]);
          setArchived(true);
          setStatus("closed");
        }
        return;
      }

      // 2. Carrega histórico do banco
      const { data: hist } = await sb
        .from("chat_messages")
        .select("id, user_id, nome, texto, gif_url, created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(500);

      if (!cancelled && hist) setMsgs(hist as Msg[]);

      // 3. Canal Realtime com broadcast (não requer auth)
      const channel = sb
        .channel(`chat-broadcast:${roomId}`, {
          config: { broadcast: { self: true }, presence: { key: UID } },
        })
        .on("broadcast", { event: "msg" }, ({ payload }) => {
          if (!cancelled) setMsgs(p => {
            // evita duplicata se já veio do INSERT
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
            channel.track({ uid: UID, nome });
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // ── Enviar mensagem ──
  const enviar = async () => {
    const t = texto.trim();
    if (!t || archived || status !== "open") return;
    setTexto("");

    const msg: Msg = {
      id: `${UID}_${Date.now()}`,
      user_id: UID,
      nome,
      texto: t,
      created_at: new Date().toISOString(),
    };

    // Broadcast instantâneo para todos na sala
    channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });

    // Persiste no banco (histórico permanente)
    await sb.from("chat_messages").insert({
      room_id: roomId,
      user_id: UID,
      nome,
      texto: t,
    });
  };

  // ── Salvar nome ──
  const salvarNome = () => {
    const n = nome.trim() || "Espectador";
    sSet("etv_nome", n);
    setNome(n);
    setEditNome(false);
    // Atualiza presence com novo nome
    channelRef.current?.track({ uid: UID, nome: n });
  };

  const fmtHora = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

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
      <div className="chat-header">
        <span className="chat-title">💬 Chat ao vivo</span>
        <div className="chat-meta">
          {online > 0 && <span className="chat-online">👁 {online}</span>}
          <span className={`chat-status ${status}`}>{statusLabel}</span>
          <button className="chat-edit-nome" onClick={() => setEditNome(true)} title="Mudar nome">✏️</button>
        </div>
      </div>

      {archived && (
        <div className="chat-archived">
          🔒 Transmissão encerrada — histórico completo
        </div>
      )}

      <div className="chat-messages">
        {msgs.length === 0 && status === "connecting" && (
          <p className="chat-empty">⏳ Conectando ao chat...</p>
        )}
        {msgs.length === 0 && status === "open" && (
          <p className="chat-empty">Seja o primeiro a comentar! 👋</p>
        )}
        {msgs.map((m, i) => (
          <div key={m.id ?? i} className={`chat-msg ${m.user_id === UID ? "own" : ""}`}>
            <span className="chat-msg-nome">{m.nome}</span>
            {m.gif_url
              ? <img src={m.gif_url} alt="gif" className="chat-gif" />
              : <span className="chat-msg-texto">{m.texto}</span>}
            <span className="chat-msg-hora">{fmtHora(m.created_at)}</span>
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
      )}
    </div>
  );
}
