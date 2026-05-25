import { useEffect, useRef, useState, useCallback } from "react";

const API_URL = "https://script.google.com/macros/s/SEU_ID_DO_APPS_SCRIPT/exec";

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

      // Se for um vídeo diferente do atual, troca e sincroniza
      if (currentUrlRef.current !== c.videoUrl) {
        currentUrlRef.current = c.videoUrl;
        video.src = c.videoUrl;
        video.load();

        video.oncanplay = () => {
          video.currentTime = Math.max(c.seekOffset || 0, 0);
          video.play().catch(() => {
            // Autoplay bloqueado pelo navegador — usuário precisa clicar
          });
        };
      } else {
        // Mesmo vídeo: verifica se está muito dessincronizado (> 5 segundos)
        const diff = Math.abs(video.currentTime - (c.seekOffset || 0));
        if (diff > 5) {
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
    // Sincroniza a cada 60 segundos para pegar próximo vídeo da fila
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
          onEnded={fetchAndSync} // quando terminar, busca o próximo
          onError={() => setErro("Erro ao carregar o vídeo. Verifique se o arquivo do Drive está público.")}
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
            {current.buff && (
              <span style={styles.buff}>🎮 {current.buff}</span>
            )}
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
  page: {
    background: "#0a0a0a",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    fontFamily: "sans-serif",
  },
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  loadingText: {
    color: "#fff",
    fontSize: 18,
  },
  playerWrapper: {
    width: "100%",
    background: "#000",
    aspectRatio: "16/9",
  },
  video: {
    width: "100%",
    height: "100%",
    display: "block",
  },
  infoBar: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    padding: "12px 20px",
    background: "#111",
    borderTop: "2px solid #8b5cf6",
  },
  infoLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  infoRight: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  liveTag: {
    background: "#ef4444",
    color: "#fff",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: "bold",
  },
  programa: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  tipo: {
    color: "#8b5cf6",
    fontSize: 13,
    background: "#1e1b4b",
    padding: "2px 8px",
    borderRadius: 4,
  },
  material: {
    color: "#aaa",
    fontSize: 14,
  },
  buff: {
    color: "#a78bfa",
    fontSize: 13,
  },
  offAir: {
    color: "#aaa",
    textAlign: "center",
    padding: 40,
    fontSize: 18,
  },
  erro: {
    color: "#ef4444",
    padding: "8px 20px",
    fontSize: 14,
  },
};
