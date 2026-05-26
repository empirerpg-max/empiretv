import React, { useEffect, useRef, useState, useCallback } from "react";

const API_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";

interface Transmission {
  status: string;
  programa: string;
  tipo: string;
  materialTocando: string;
  buff: string;
  videoUrl: string;
  seekOffset: number;
  durationSeconds: number;
  startedAt: string;
  isBackup: boolean;
}

export default function AoVivo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentUrlRef = useRef<string>("");
  const [current, setCurrent] = useState<Transmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  const fetchAndSync = useCallback(async () => {
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      if (data.status !== "success" || !data.current) {
        setErro("Nenhuma transmissão no momento.");
        setLoading(false);
        return;
      }
      const c: Transmission = data.current;
      setCurrent(c);
      setErro("");
      const video = videoRef.current;
      if (!video || !c.videoUrl) return;
      if (currentUrlRef.current !== c.videoUrl) {
        currentUrlRef.current = c.videoUrl;
        video.pause();
        video.removeAttribute("src");
        video.load();

        const onMetadataLoaded = () => {
          const seekTo = Math.max(c.seekOffset || 0, 0);
          video.currentTime = seekTo;
          
          video.play().catch((err) => {
            console.warn("[Autoplay] Bloqueado pelo navegador devido a políticas de áudio. Tentando alternar para mutado para manter transmissão fluida...", err);
            video.muted = true;
            video.play().catch((errMuted) => {
              console.error("[Autoplay] Falha persistente ao tentar tocar mesmo mutado:", errMuted);
            });
          });
        };

        video.addEventListener("loadedmetadata", onMetadataLoaded, { once: true });
        video.src = c.videoUrl;
        video.load();
      } else {
        const diff = Math.abs(video.currentTime - (c.seekOffset || 0));
        if (diff > 5) {
          console.log(`[Sync] Resincronizando transmissão. Ajustando posição de ${video.currentTime.toFixed(1)}s para ${c.seekOffset}s`);
          video.currentTime = c.seekOffset || 0;
        }
      }
    } catch (e) {
      setErro("Erro ao conectar com a grade de programação.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAndSync();
    const interval = setInterval(fetchAndSync, 60000);
    return () => clearInterval(interval);
  }, [fetchAndSync]);

  return (
    <div style={styles.page}>
      {loading && (
        <div style={styles.center}>
          <p style={styles.loadingText}>📡 Sintonizando Empire TV...</p>
        </div>
      )}
      <div style={styles.playerWrapper}>
        <video
          ref={videoRef}
          controls
          playsInline
          style={styles.video}
          onEnded={fetchAndSync}
          onError={(e) => {
            const err = (e.target as HTMLVideoElement).error;
            setErro(`Erro ao carregar vídeo (código ${err?.code}). Verifique se o arquivo do Drive está público e se o Worker está ativo.`);
          }}
        />
      </div>
      {current && !loading && (
        <div style={styles.infoBar}>
          <div style={styles.infoLeft}>
            <span style={styles.liveTag}>● AO VIVO</span>
            <span style={styles.programa}>{current.programa}</span>
            <span style={styles.tipo}>{current.tipo}</span>
          </div>
          <div style={styles.infoRight}>
            <span style={styles.material}>🎵 {current.materialTocando}</span>
            {current.buff && <span style={styles.buff}>🎮 {current.buff}</span>}
          </div>
        </div>
      )}
      {!current && !loading && (
        <div style={styles.offAir}>
          <p>📺 Sem transmissão agora. Volte mais tarde!</p>
        </div>
      )}
      {erro && <p style={styles.erro}>⚠️ {erro}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: "#0a0a0a", minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "sans-serif" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", flex: 1 },
  loadingText: { color: "#fff", fontSize: 18 },
  playerWrapper: { width: "100%", background: "#000", aspectRatio: "16/9" },
  video: { width: "100%", height: "100%", display: "block" },
  infoBar: { display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "12px 20px", background: "#111", borderTop: "2px solid #8b5cf6" },
  infoLeft: { display: "flex", alignItems: "center", gap: 10 },
  infoRight: { display: "flex", alignItems: "center", gap: 16 },
  liveTag: { background: "#ef4444", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: "bold" },
  programa: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  tipo: { color: "#8b5cf6", fontSize: 13, background: "#1e1b4b", padding: "2px 8px", borderRadius: 4 },
  material: { color: "#aaa", fontSize: 14 },
  buff: { color: "#a78bfa", fontSize: 13 },
  offAir: { color: "#aaa", textAlign: "center", padding: 40, fontSize: 18 },
  erro: { color: "#ef4444", padding: "8px 20px", fontSize: 14 },
};
