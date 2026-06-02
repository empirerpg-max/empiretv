import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import Chat from "../components/Chat";
import { fetchGAS } from "../lib/gas";

const CHAT_URL      = "https://empiretv-chat-backend.onrender.com";
const LOGO          = "https://i.imgur.com/6cL3Ca9.png";
const KICK_CHANNEL  = "empiretvoficial";
const KICK_PLAYER   = `https://player.kick.com/${KICK_CHANNEL}?muted=false`;

interface Transmission {
  status: string; programa: string; tipo?: string;
  material?: string; buff?: string;
  videoUrl?: string; seekOffset?: number; duracao?: number;
  isBackup?: boolean; rowNum?: number;
  topicoId?: string; topicoUrl?: string; capaUrl?: string;
  secondsToStart?: number;
}

function resolveMode(c: Transmission | null, loading: boolean): "loading"|"kick"|"video"|"upcoming"|"static" {
  if (loading)                             return "loading";
  if (!c || c.status === "off")            return "static";
  if (c.status === "upcoming")             return "upcoming";
  const isKick = !!c.topicoUrl?.includes("kick.com") || !c.videoUrl;
  return isKick ? "kick" : "video";
}

// Gera um roomId de fallback baseado na data+programa quando topicoId não vem do GAS
function fallbackRoomId(c: Transmission): string {
  const hoje = new Date().toISOString().slice(0, 10);
  return `room-${hoje}-${(c.programa || "live").toLowerCase().replace(/\s+/g, "-")}`;
}

export default function AoVivo() {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const currentUrlRef = useRef("");
  const errorCountRef = useRef(0);

  const [current,     setCurrent]     = useState<Transmission | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [muted,       setMuted]       = useState(false);
  const [isSyncing,   setIsSyncing]   = useState(false);
  const [countdown,   setCountdown]   = useState<number | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);

  const playerMode = resolveMode(current, loading);

  // Chat aparece sempre que estiver broadcasting (kick ou video),
  // usando topicoId do GAS ou fallback gerado localmente
  const roomId  = current?.topicoId || (current ? fallbackRoomId(current) : null);
  const showChat = (playerMode === "kick" || playerMode === "video") && !!roomId;

  // ── Estática analógica ──────────────────────────────────────
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

  // ── Fetch principal ─────────────────────────────────────────
  const fetchAndSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const data = await fetchGAS();
      const c: Transmission = data?.current || { status: "off", programa: "Empire TV" };
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
      setCurrent({ status: "off", programa: "Empire TV" });
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchAndSync();
    const t = setInterval(fetchAndSync, 60000);
    return () => clearInterval(t);
  }, [fetchAndSync]);

  // ── Countdown ───────────────────────────────────────────────
  useEffect(() => {
    if (!countdown || countdown <= 0) return;
    const t = setInterval(() => setCountdown(p => {
      if (!p || p <= 1) { clearInterval(t); fetchAndSync(); return 0; }
      return p - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [countdown, fetchAndSync]);

  // ── Polling online ──────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const poll = async () => {
      try {
        const r = await fetch(`${CHAT_URL}/online/${roomId}`);
        const d = await r.json();
        if (d.count !== undefined) setOnlineCount(d.count);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, [roomId]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtCountdown = (s: number) =>
    `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

  return (
    <div className="av-page">

      {/* ── Header ── */}
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

      {/* ── Mudo warning ── */}
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

      {/* ── Player ── */}
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

      {/* ── Info bar ── */}
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

      {/* ── Chat ── */}
      {showChat && (
        <div className="av-chat-section">
          <Chat roomId={roomId!} backendUrl={CHAT_URL} />
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
