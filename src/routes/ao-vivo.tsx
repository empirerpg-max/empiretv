import React, { useEffect, useRef, useState, useCallback } from "react";
import Chat from "../components/Chat";

const GAS_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";
const CHAT_URL = "https://empiretv-chat-backend.onrender.com";

interface Transmission {
  status: string;
  programa: string;
  tipo: string;
  materialTocando?: string;
  buff?: string;
  videoUrl: string;
  seekOffset: number;
  durationSeconds?: number;
  startedAt?: string;
  isBackup: boolean;
  rowNum?: number;
  topicoId?: string;
  capaUrl?: string;
  secondsToStart?: number;
}

function genUserId() {
  let id = localStorage.getItem("etv_uid");
  if (!id) { id = "u_" + Date.now().toString(36); localStorage.setItem("etv_uid", id); }
  return id;
}
function getNome() {
  return localStorage.getItem("etv_nome") || "Espectador";
}

export default function AoVivo() {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentUrlRef  = useRef("");
  const errorCountRef  = useRef(0);

  const [current,   setCurrent]   = useState<Transmission | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [erro,      setErro]      = useState("");
  const [useStatic, setUseStatic] = useState(false);
  const [muted,     setMuted]     = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showChat,  setShowChat]  = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);

  // Estática analógica
  useEffect(() => {
    if (!useStatic) return;
    const canvas = staticCanvasRef.current;
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
        img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(16,16,220,44);
      ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1.5;
      ctx.strokeRect(16,16,220,44);
      ctx.fillStyle = "#fff"; ctx.font = "bold 13px monospace";
      ctx.fillText("📡 PROCURANDO SINAL...", 28, 43);
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [useStatic]);

  const fetchAndSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res  = await fetch(GAS_URL);
      const data = await res.json();
      if (data.status !== "success" || !data.current) {
        setErro("Nenhuma transmissão no momento."); setUseStatic(true); setLoading(false); setIsSyncing(false); return;
      }
      const c: Transmission = data.current;
      setCurrent(c); setErro(""); setUseStatic(false);
      if (c.status === "upcoming" && c.secondsToStart) setCountdown(c.secondsToStart);
      const video = videoRef.current;
      if (!video || !c.videoUrl) { setIsSyncing(false); return; }
      if (currentUrlRef.current !== c.videoUrl) {
        currentUrlRef.current = c.videoUrl;
        video.pause();
        video.addEventListener("loadedmetadata", () => {
          video.currentTime = Math.max(c.seekOffset || 0, 0);
          video.play().catch(() => { video.muted = true; setMuted(true); video.play().catch(() => {}); });
        }, { once: true });
        video.src = c.videoUrl; video.load();
      } else {
        const diff = Math.abs(video.currentTime - (c.seekOffset || 0));
        if (diff > 5) video.currentTime = c.seekOffset || 0;
      }
    } catch {
      setUseStatic(true);
    } finally {
      setLoading(false); setIsSyncing(false);
    }
  }, []);

  useEffect(() => { fetchAndSync(); const t = setInterval(fetchAndSync, 60000); return () => clearInterval(t); }, [fetchAndSync]);

  useEffect(() => {
    if (!countdown || countdown <= 0) return;
    const t = setInterval(() => setCountdown(p => { if (!p || p <= 1) { clearInterval(t); fetchAndSync(); return 0; } return p - 1; }), 1000);
    return () => clearInterval(t);
  }, [countdown, fetchAndSync]);

  // Fetch contagem online via polling leve
  useEffect(() => {
    if (!current?.topicoId) return;
    const poll = async () => {
      try {
        const r = await fetch(`${CHAT_URL}/online/${current.topicoId}`);
        const d = await r.json();
        if (d.count !== undefined) setOnlineCount(d.count);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, [current?.topicoId]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtCountdown = (s: number) => `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;

  return (
    <div className="ao-vivo-page">
      {/* Header */}
      <header className="av-header">
        <span className="av-logo">📺 Empire TV</span>
        <div className="av-header-right">
          {onlineCount > 0 && <span className="av-online">👁 {onlineCount}</span>}
          {current?.topicoId && (
            <button className="av-chat-btn" onClick={() => setShowChat(v => !v)}>
              {showChat ? "✕ Chat" : "💬 Chat"}
            </button>
          )}
        </div>
      </header>

      {/* Mudo alert */}
      {muted && (
        <div className="av-muted-bar" onClick={() => { const v = videoRef.current; if (v) { v.muted = false; setMuted(false); v.play().catch(()=>{}); } }}>
          🔇 Áudio mutado — toque aqui para ativar o som
        </div>
      )}

      {/* Player */}
      <div className="av-player-wrap">
        {loading && <div className="av-overlay"><p className="av-loading">📡 Sintonizando...</p></div>}

        {/* Countdown */}
        {current?.status === "upcoming" && !loading && (
          <div className="av-overlay av-countdown">
            <span className="av-countdown-label">📺 Próxima Atração</span>
            <h2 className="av-countdown-title">{current.programa}</h2>
            {current.tipo && <span className="av-badge">{current.tipo}</span>}
            <div className="av-timer">{countdown !== null ? fmtCountdown(countdown) : "--:--:--"}</div>
          </div>
        )}

        {/* Estática */}
        {useStatic && (
          <div className="av-overlay av-static-wrap">
            <canvas ref={staticCanvasRef} className="av-static-canvas" />
            <div className="av-static-card">
              <span className="av-static-title">🚨 Sem Sinal</span>
              <p>Sem transmissão no momento.</p>
              <button onClick={fetchAndSync} disabled={isSyncing} className="av-sync-btn">
                {isSyncing ? "⚡ Sincronizando..." : "🔄 Re-sintonizar"}
              </button>
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          controls
          playsInline
          className="av-video"
          onEnded={fetchAndSync}
          onError={() => {
            const v = videoRef.current;
            if (!v?.src || v.error?.code === 1) return;
            errorCountRef.current++;
            if (errorCountRef.current < 3) { setTimeout(() => { currentUrlRef.current = ""; fetchAndSync(); }, 2000); }
            else setUseStatic(true);
          }}
        />
      </div>

      {/* Info bar */}
      {current && !loading && !useStatic && current.status !== "upcoming" && (
        <div className="av-info">
          <div className="av-info-left">
            <span className="av-live-tag">● AO VIVO</span>
            <span className="av-programa">{current.programa}</span>
            {current.tipo && <span className="av-tipo">{current.tipo}</span>}
          </div>
          {current.buff && <span className="av-buff">🎮 {current.buff}</span>}
        </div>
      )}

      {/* Sync bar */}
      {!loading && (
        <div className="av-sync-bar">
          <span className="av-sync-dot" />
          <span>Sincronia automática ativa</span>
          <button onClick={fetchAndSync} disabled={isSyncing} className="av-sync-link">
            {isSyncing ? "⚡ Atualizando..." : "📡 Sincronizar"}
          </button>
        </div>
      )}

      {/* Chat drawer */}
      {showChat && current?.topicoId && (
        <Chat roomId={current.topicoId} backendUrl={CHAT_URL} />
      )}
    </div>
  );
}
