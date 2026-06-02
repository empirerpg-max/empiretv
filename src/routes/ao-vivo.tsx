import React, { useEffect, useRef, useState, useCallback } from "react";
import Chat from "../components/Chat";

const GAS_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3b7sK8DD59BHRBRc5Ow1YB/exec";
const CHAT_URL = "https://empiretv-chat-backend.onrender.com";
const LOGO = "https://i.imgur.com/6cL3Ca9.png";

interface Transmission {
  status: string; programa: string; tipo: string;
  materialTocando?: string; buff?: string;
  videoUrl: string; seekOffset: number;
  durationSeconds?: number; isBackup: boolean;
  rowNum?: number; topicoId?: string; capaUrl?: string;
  secondsToStart?: number;
}

function genUid()  { let id = localStorage.getItem("etv_uid");  if (!id) { id = "u_" + Date.now().toString(36); localStorage.setItem("etv_uid", id); } return id; }

export default function AoVivo() {
  const videoRef        = useRef<HTMLVideoElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentUrlRef   = useRef("");
  const errorCountRef   = useRef(0);

  const [current,   setCurrent]   = useState<Transmission | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [useStatic, setUseStatic] = useState(false);
  const [muted,     setMuted]     = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);

  // Estática analógica
  useEffect(() => {
    if (!useStatic) return;
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = canvas.parentElement?.clientWidth || 640; canvas.height = canvas.parentElement?.clientHeight || 360; };
    resize(); window.addEventListener("resize", resize);
    const draw = () => {
      const { width: w, height: h } = canvas;
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.floor(Math.random() * 255); img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255; }
      ctx.putImageData(img, 0, 0);
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
      if (data.status !== "success" || !data.current) { setUseStatic(true); setLoading(false); setIsSyncing(false); return; }
      const c: Transmission = data.current;
      setCurrent(c); setUseStatic(false);
      if (c.status === "upcoming" && c.secondsToStart) setCountdown(c.secondsToStart);
      const video = videoRef.current;
      if (!video || !c.videoUrl) { setIsSyncing(false); return; }
      if (currentUrlRef.current !== c.videoUrl) {
        currentUrlRef.current = c.videoUrl; video.pause();
        video.addEventListener("loadedmetadata", () => {
          video.currentTime = Math.max(c.seekOffset || 0, 0);
          video.play().catch(() => { video.muted = true; setMuted(true); video.play().catch(() => {}); });
        }, { once: true });
        video.src = c.videoUrl; video.load();
      } else {
        if (Math.abs(video.currentTime - (c.seekOffset || 0)) > 5) video.currentTime = c.seekOffset || 0;
      }
    } catch { setUseStatic(true); }
    finally { setLoading(false); setIsSyncing(false); }
  }, []);

  useEffect(() => { fetchAndSync(); const t = setInterval(fetchAndSync, 60000); return () => clearInterval(t); }, [fetchAndSync]);

  useEffect(() => {
    if (!countdown || countdown <= 0) return;
    const t = setInterval(() => setCountdown(p => { if (!p || p <= 1) { clearInterval(t); fetchAndSync(); return 0; } return p - 1; }), 1000);
    return () => clearInterval(t);
  }, [countdown, fetchAndSync]);

  useEffect(() => {
    if (!current?.topicoId) return;
    const poll = async () => { try { const r = await fetch(`${CHAT_URL}/online/${current.topicoId}`); const d = await r.json(); if (d.count !== undefined) setOnlineCount(d.count); } catch {} };
    poll(); const t = setInterval(poll, 15000); return () => clearInterval(t);
  }, [current?.topicoId]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtCountdown = (s: number) => `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;

  return (
    <div className="ao-vivo-page">
      {/* Header */}
      <header className="av-header">
        <div className="av-logo"><img src={LOGO} alt="Empire TV" /></div>
        <div className="av-header-right">
          {onlineCount > 0 && <span className="av-online">👁 {onlineCount}</span>}
        </div>
      </header>

      {/* Mudo */}
      {muted && (
        <div className="av-muted-bar" onClick={() => { const v = videoRef.current; if (v) { v.muted = false; setMuted(false); v.play().catch(()=>{}); } }}>
          🔇 Áudio mutado — toque para ativar o som
        </div>
      )}

      {/* Player */}
      <div className="av-player-wrap">
        {loading && <div className="av-overlay"><p className="av-loading">Sintonizando…</p></div>}

        {current?.status === "upcoming" && !loading && (
          <div className="av-overlay av-countdown">
            <span className="av-countdown-label">Próxima atração</span>
            <h2 className="av-countdown-title">{current.programa}</h2>
            {current.tipo && <span className="av-badge">{current.tipo}</span>}
            <div className="av-timer">{countdown !== null ? fmtCountdown(countdown) : "--:--:--"}</div>
          </div>
        )}

        {useStatic && (
          <div className="av-overlay">
            <canvas ref={staticCanvasRef} className="av-static-canvas" />
            <div className="av-static-card">
              <span className="av-static-title">Sem Sinal</span>
              <p>Nenhuma transmissão no momento.</p>
              <button onClick={fetchAndSync} disabled={isSyncing} className="av-sync-btn">
                {isSyncing ? "⚡ Sincronizando..." : "🔄 Re-sintonizar"}
              </button>
            </div>
          </div>
        )}

        <video
          ref={videoRef} controls playsInline className="av-video"
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

      {/* Chat — sempre visível quando há topicoId */}
      {current?.topicoId && (
        <Chat roomId={current.topicoId} backendUrl={CHAT_URL} />
      )}
    </div>
  );
}
