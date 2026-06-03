import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import Chat from "../components/Chat";
import { fetchGAS } from "../lib/gas";
import { closeRoom } from "../lib/chatArchive";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

const LOGO         = "https://i.imgur.com/6cL3Ca9.png";
const KICK_CHANNEL = "empiretvoficial";
const KICK_PLAYER  = `https://player.kick.com/${KICK_CHANNEL}?muted=false`;

// 5 polls × 60s = 5 minutos de confirmação antes de fechar a sala
// + 90s de delay de segurança após confirmar = ~6,5 min total
const POLLS_TO_CLOSE  = 5;
const CLOSE_DELAY_MS  = 90_000; // 90 segundos de grace period

interface Transmission {
  status: string; programa: string; tipo?: string;
  material?: string; buff?: string;
  videoUrl?: string; seekOffset?: number; duracao?: number;
  isBackup?: boolean; rowNum?: number;
  topicoId?: string; topicoUrl?: string; capaUrl?: string;
  secondsToStart?: number;
}

function resolveMode(c: Transmission | null, loading: boolean): "loading"|"kick"|"video"|"upcoming"|"static" {
  if (loading)                                               return "loading";
  if (!c || c.status === "off" || c.status === "finalizado") return "static";
  if (c.status === "upcoming")                               return "upcoming";
  const isKick = !!c.topicoUrl?.includes("kick.com") || !c.videoUrl;
  return isKick ? "kick" : "video";
}

function fallbackRoomId(c: Transmission): string {
  const hoje = new Date().toISOString().slice(0, 10);
  return `room-${hoje}-${(c.programa || "live").toLowerCase().replace(/\s+/g, "-")}`;
}

export default function AoVivo() {
  const videoRef          = useRef<HTMLVideoElement>(null);
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const currentUrlRef     = useRef("");
  const errorCountRef     = useRef(0);
  const closedRooms       = useRef<Set<string>>(new Set());
  const lastActiveRoom    = useRef<{ roomId: string; programa: string; duracaoMs: number } | null>(null);
  const inactivePollCount = useRef(0);
  const closeTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [current,     setCurrent]     = useState<Transmission | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [muted,       setMuted]       = useState(false);
  const [isSyncing,   setIsSyncing]   = useState(false);
  const [countdown,   setCountdown]   = useState<number | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);

  const playerMode = resolveMode(current, loading);
  const roomId   = current?.topicoId || (current ? fallbackRoomId(current) : null);
  const showChat = (playerMode === "kick" || playerMode === "video") && !!roomId;

  // ── Estática analógica ──
  useEffect(() => {
    if (playerMode !== "static") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const resize = () => {
      canvas.width  = canvas.parentElement?.clientWidth  || 640;
      canvas.height = canvas.parentElement?.clientHeight || 360;
    };
    resize();
    window.addEventListener("resize", resize);
    const draw = () => {
      const { width: w, height: h } = canvas;
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.floor(Math.random() * 255);
        img.data[i] = img.data[i+1] = img.data[i+2] = v;
        img.data[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [playerMode]);

  // ── Fetch principal ──
  const fetchAndSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const data = await fetchGAS();
      const c: Transmission = data?.current || { status: "off", programa: "Empire TV" };

      const isNowInactive = c.status === "off" || c.status === "finalizado";

      if (isNowInactive && lastActiveRoom.current) {
        inactivePollCount.current += 1;
        console.log(`[AoVivo] Status inativo (${inactivePollCount.current}/${POLLS_TO_CLOSE})`);

        if (
          inactivePollCount.current >= POLLS_TO_CLOSE &&
          closeTimerRef.current === null
        ) {
          const { roomId: rid, programa: prog, duracaoMs } = lastActiveRoom.current;

          if (!closedRooms.current.has(rid)) {
            console.log(
              `[AoVivo] Agendando closeRoom "${rid}" em ${CLOSE_DELAY_MS / 1000}s...`
            );

            // Delay de segurança: garante que mensagens tardias sejam salvas antes de arquivar
            closeTimerRef.current = setTimeout(async () => {
              closeTimerRef.current = null;

              // Verifica novamente se ainda está inativo antes de fechar
              if (!closedRooms.current.has(rid)) {
                closedRooms.current.add(rid);
                lastActiveRoom.current = null;
                inactivePollCount.current = 0;
                console.log(`[AoVivo] Fechando sala "${rid}" após delay de segurança.`);
                closeRoom(rid, prog, null, duracaoMs).catch(err =>
                  console.error("[closeRoom]", err)
                );
              }
            }, CLOSE_DELAY_MS);
          }
        }
      } else {
        // Voltou a ficar ativo — cancela qualquer timer pendente
        if (closeTimerRef.current !== null) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
          console.log(`[AoVivo] Transmissão voltou — timer de fechamento cancelado.`);
        }
        inactivePollCount.current = 0;
      }

      if (c.status === "broadcasting") {
        const rid = c.topicoId || fallbackRoomId(c);
        if (!lastActiveRoom.current || lastActiveRoom.current.roomId !== rid) {
          lastActiveRoom.current = {
            roomId: rid,
            programa: c.programa,
            duracaoMs: (c.duracao ?? 0) * 60_000, // duracao vem em minutos da planilha
          };
          inactivePollCount.current = 0;
        }
      }

      setCurrent(c);

      if (c.status === "upcoming" && c.secondsToStart)
        setCountdown(c.secondsToStart);

      if (c.videoUrl && !c.topicoUrl?.includes("kick.com")) {
        const video = videoRef.current;
        if (!video) return;
        if (currentUrlRef.current !== c.videoUrl) {
          currentUrlRef.current = c.videoUrl;
          video.pause();
          video.addEventListener("loadedmetadata", () => {
            video.currentTime = Math.max(c.seekOffset || 0, 0);
            video.play().catch(() => {
              video.muted = true; setMuted(true);
              video.play().catch(() => {});
            });
          }, { once: true });
          video.src = c.videoUrl;
          video.load();
        } else if (Math.abs(video.currentTime - (c.seekOffset || 0)) > 5) {
          video.currentTime = c.seekOffset || 0;
        }
      }
    } catch (err) {
      console.error("[AoVivo] fetchAndSync:", err);
      setCurrent(prev => prev);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchAndSync();
    const t = setInterval(fetchAndSync, 60_000);
    return () => {
      clearInterval(t);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    };
  }, [fetchAndSync]);

  // ── Countdown ──
  useEffect(() => {
    if (!countdown || countdown <= 0) return;
    const t = setInterval(() => setCountdown(p => {
      if (!p || p <= 1) { clearInterval(t); fetchAndSync(); return 0; }
      return p - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [countdown, fetchAndSync]);

  // ── Online count via Supabase Presence ──
  useEffect(() => {
    if (!roomId) return;
    const ch = sb
      .channel(`chat-broadcast:${roomId}`)
      .on("presence", { event: "sync" }, () => {
        setOnlineCount(Object.keys(ch.presenceState()).length);
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [roomId]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtCountdown = (s: number) =>
    `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;

  return (
    <div className="av-page">
      {/* Header */}
      <header className="av-header">
        <div className="av-logo"><img src={LOGO} alt="Empire TV" /></div>
        <div className="av-header-right">
          {onlineCount > 0 && (
            <span className="av-online">
              <span className="av-online-dot" />
              {onlineCount} online
            </span>
          )}
          <button
            className="av-sync-btn-top"
            onClick={fetchAndSync}
            disabled={isSyncing}
            title="Sincronizar"
          >
            {isSyncing ? "⚡" : "📡"}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {muted && (
          <motion.div
            className="av-muted-bar"
            initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
            onClick={() => {
              const v = videoRef.current;
              if (v) { v.muted = false; setMuted(false); v.play().catch(() => {}); }
            }}
          >
            🔇 Áudio mutado — toque para ativar
          </motion.div>
        )}
      </AnimatePresence>

      {/* Player */}
      <div className="av-player-wrap">
        {playerMode === "loading" && (
          <div className="av-overlay">
            <div className="av-spinner" />
            <p className="av-loading-txt">Sintonizando…</p>
          </div>
        )}
        {playerMode === "upcoming" && (
          <div className="av-overlay av-upcoming">
            {current?.capaUrl && <img src={current.capaUrl} alt="" className="av-upcoming-bg" />}
            <div className="av-upcoming-blur" />
            <div className="av-upcoming-card">
              <span className="av-badge-upcoming">Em breve</span>
              <h2 className="av-upcoming-title">{current?.programa}</h2>
              {current?.tipo && <span className="av-tipo-tag">{current.tipo}</span>}
              <div className="av-timer">{countdown !== null ? fmtCountdown(countdown) : "--:--:--"}</div>
            </div>
          </div>
        )}
        {playerMode === "static" && (
          <div className="av-overlay">
            <canvas ref={canvasRef} className="av-static-canvas" />
            <div className="av-nosignal-card">
              <span className="av-nosignal-icon">📡</span>
              <span className="av-nosignal-title">Sem Transmissão</span>
              <p>Nenhum programa ao vivo no momento.</p>
              <button onClick={fetchAndSync} disabled={isSyncing} className="av-resync-btn">
                {isSyncing ? "⚡ Verificando..." : "🔄 Verificar novamente"}
              </button>
            </div>
          </div>
        )}
        {playerMode === "kick" && (
          <iframe
            className="av-kick-frame"
            src={KICK_PLAYER}
            allowFullScreen
            allow="autoplay; fullscreen"
            title="Empire TV ao vivo"
          />
        )}
        {playerMode === "video" && (
          <video
            ref={videoRef}
            controls
            playsInline
            className="av-video"
            onEnded={fetchAndSync}
            onError={() => {
              errorCountRef.current++;
              if (errorCountRef.current < 3) {
                setTimeout(() => { currentUrlRef.current = ""; fetchAndSync(); }, 2000);
              } else {
                setCurrent({ status: "off", programa: "Empire TV" });
              }
            }}
          />
        )}
      </div>

      {/* Info bar */}
      <AnimatePresence>
        {current && !loading && (playerMode === "kick" || playerMode === "video") && (
          <motion.div
            className="av-infobar"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            <div className="av-infobar-left">
              <span className="av-live-badge">● AO VIVO</span>
              <span className="av-infobar-title">{current.programa}</span>
              {current.tipo && <span className="av-infobar-tipo">{current.tipo}</span>}
            </div>
            {current.buff && <span className="av-infobar-buff">🎮 {current.buff}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat */}
      {showChat && (
        <div className="av-chat-section">
          <Chat roomId={roomId!} programa={current?.programa} />
        </div>
      )}
      {!showChat && !loading && playerMode !== "static" && playerMode !== "upcoming" && (
        <div className="av-chat-placeholder">
          <span>💬</span>
          <p>Chat não disponível para esta transmissão.</p>
        </div>
      )}
    </div>
  );
}
