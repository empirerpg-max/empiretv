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
  rowNum?: number;
  drive_video_id?: string;
}

export default function AoVivo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentUrlRef = useRef<string>("");
  const errorCountRef = useRef<number>(0);
  const [current, setCurrent] = useState<Transmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  
  // Estados para contornar limitações do navegador e queda de rede
  const [useAnalogStatic, setUseAnalogStatic] = useState(false);
  const [isBrowserAutoplayMuted, setIsBrowserAutoplayMuted] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Efeito de estática de TV analógica procedural (chuvisco de TV clássica)
  useEffect(() => {
    if (!useAnalogStatic) return;
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const resize = () => {
      if (canvas.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
      } else {
        canvas.width = 640;
        canvas.height = 360;
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const renderNoise = () => {
      const w = canvas.width;
      const h = canvas.height;
      try {
        const imgData = ctx.createImageData(w, h);
        const data = imgData.data;
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
          const value = Math.floor(Math.random() * 255);
          data[i] = value;     // R
          data[i+1] = value;   // G
          data[i+2] = value;   // B
          data[i+3] = 255;     // A
        }
        ctx.putImageData(imgData, 0, 0);

        // Adiciona um letreiro retrô piscando sutilmente de "SEM COR / SINTONIA"
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(20, 20, 240, 50);
        ctx.strokeStyle = "#8b5cf6";
        ctx.lineWidth = 2;
        ctx.strokeRect(20, 20, 240, 50);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px monospace";
        ctx.fillText("📡 PROCURANDO SINAL...", 35, 50);
      } catch (err) {
        // Fallback rápido se falhar por canvas invisivel
      }
      animId = requestAnimationFrame(renderNoise);
    };
    renderNoise();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [useAnalogStatic]);

  const fetchAndSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      if (data.status !== "success" || !data.current) {
        setErro("Nenhuma transmissão no momento.");
        setUseAnalogStatic(true);
        setLoading(false);
        setIsSyncing(false);
        return;
      }
      const c: Transmission = data.current;
      
      // Inteligência de Autoreparo: Se a URL do vídeo estiver vazia ou contiver uma data residual,
      // extraímos o ID do Drive a partir de qualquer campo exposto no schedule (como "status" que tem o link real do drive)
      let correctedUrl = c.videoUrl;
      const fullSchedule = data.fullSchedule || [];
      const scheduleItem = fullSchedule.find((item: any) => Number(item.rowNum) === Number(c.rowNum));
      
      const regexDriveId = [
        /\/d\/([a-zA-Z0-9_-]{25,45})/i,
        /[?&]id=([a-zA-Z0-9_-]{25,45})/i,
        /\/file\/d\/([a-zA-Z0-9_-]{25,45})/i
      ];

      const extractId = (val: string): string => {
        if (!val) return "";
        val = String(val).trim();
        for (const regex of regexDriveId) {
          const match = val.match(regex);
          if (match && match[1]) return match[1];
        }
        if (/^[a-zA-Z0-9_-]{25,45}$/.test(val) && !val.includes("GMT") && !val.includes("Standard") && !val.includes(":") && !val.includes(" ")) {
          return val;
        }
        return "";
      };

      let realId = "";
      if (scheduleItem) {
        const checkFields = ["status", "link_drive", "drive_video_id", "linkDoDrive", "link_do_drive", "videoUrl"];
        for (const field of checkFields) {
          const val = scheduleItem[field];
          if (val) {
            const foundId = extractId(val);
            if (foundId) {
              realId = foundId;
              break;
            }
          }
        }
      }

      if (!realId) {
        const checkFields = ["videoUrl", "drive_video_id", "status"];
        for (const field of checkFields) {
          const val = (c as any)[field];
          if (val) {
            const foundId = extractId(val);
            if (foundId) {
              realId = foundId;
              break;
            }
          }
        }
      }

      // Forçamos o redirecionamento de TODAS as transmissões para o nosso servidor Express local
      // que faz o download do vídeo do Drive em background para cachear no disco local e evitar travamentos.
      if (realId) {
        correctedUrl = `/video?file=video_${realId}.mp4`;
        console.log(`[Autoreparo Express] Redirecionando transmissão do Drive "${realId}" para o servidor local: "${correctedUrl}"`);
        c.videoUrl = correctedUrl;
      }

      setCurrent(c);
      setErro("");
      setUseAnalogStatic(false);

      const video = videoRef.current;
      if (!video || !c.videoUrl) {
        setIsSyncing(false);
        return;
      }

      if (currentUrlRef.current !== c.videoUrl) {
        currentUrlRef.current = c.videoUrl;
        video.pause();

        const onMetadataLoaded = () => {
          const seekTo = Math.max(c.seekOffset || 0, 0);
          video.currentTime = seekTo;
          
          video.play()
            .then(() => {
              setIsBrowserAutoplayMuted(false);
              errorCountRef.current = 0;
            })
            .catch((err) => {
              console.warn("[Autoplay] Bloqueado pelo navegador devido a políticas de áudio. Mutando para iniciar...", err);
              video.muted = true;
              setIsBrowserAutoplayMuted(true);
              video.play()
                .then(() => {
                  errorCountRef.current = 0;
                })
                .catch((errMuted) => {
                  console.error("[Autoplay] Falha persistente ao tentar tocar mesmo mutado:", errMuted);
                  // Não entra em estática imediatamente, deixa o onError lidar ou tenta o retry automático
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
      console.error(e);
      setErro("Houve uma instabilidade temporária ao conectar com a grade de programação. Forçando estática do receptor...");
      setUseAnalogStatic(true);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchAndSync();
    const interval = setInterval(fetchAndSync, 60000);
    return () => clearInterval(interval);
  }, [fetchAndSync]);

  const handleUnmute = () => {
    const video = videoRef.current;
    if (video) {
      video.muted = false;
      setIsBrowserAutoplayMuted(false);
      // Força play caso estivesse parado
      video.play().catch(() => {});
    }
  };

  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (current && current.status === "upcoming" && typeof (current as any).secondsToStart === "number") {
      setCountdownSeconds((current as any).secondsToStart);
    } else {
      setCountdownSeconds(null);
    }
  }, [current]);

  useEffect(() => {
    if (countdownSeconds === null || countdownSeconds <= 0) return;
    const t = setInterval(() => {
      setCountdownSeconds(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(t);
          // Forçar resincronização automática para puxar o player quando o relógio zerar
          fetchAndSync();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [countdownSeconds, fetchAndSync]);

  return (
    <div style={styles.page}>
      {/* Barra de Notificações / Alertas Inteligentes */}
      {isBrowserAutoplayMuted && (
        <div className="bg-amber-600 text-white font-medium text-center px-4 py-2 flex items-center justify-center gap-3 animate-pulse cursor-pointer transition hover:bg-amber-500" onClick={handleUnmute}>
          <span>🔇 O Áudio foi mutado para permitir a sintonia automática no seu navegador.</span>
          <button className="bg-white text-amber-950 font-bold px-3 py-1 rounded text-xs uppercase shadow hover:scale-105 active:scale-95 transition">
            🔈 Ativar Som
          </button>
        </div>
      )}

      {loading && (
        <div style={styles.center}>
          <p style={styles.loadingText}>📡 Sintonizando Empire TV...</p>
        </div>
      )}

      <div style={styles.playerWrapper} className="relative group">
        {/* Painel Profissional de Contagem Regressiva para Próxima Atração */}
        {current && current.status === "upcoming" ? (
          <div className="absolute inset-0 z-20 w-full h-full bg-zinc-950 flex flex-col items-center justify-center p-6 border-b border-violet-600/30 overflow-hidden select-none">
            {/* Ambient Background Glow grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f1a3a_1px,transparent_1px),linear-gradient(to_bottom,#1f1a3a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30" />
            
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-zinc-900/80 px-3 py-1 rounded border border-zinc-800">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse" />
              <span className="text-zinc-400 font-mono text-xs font-semibold tracking-wider uppercase">Sinal Estabelecido</span>
            </div>

            <div className="absolute top-4 right-4 bg-violet-950/60 border border-violet-500/30 text-violet-300 font-mono text-xs px-3 py-1 rounded font-semibold uppercase tracking-widest">
              PRÉ-SHOW
            </div>

            <div className="z-10 text-center max-w-xl">
              <span className="text-violet-500 font-bold tracking-wider text-sm uppercase block mb-1 drop-shadow-[0_0_8px_rgba(139,92,246,0.3)]">
                📺 Próxima Atração Programada
              </span>
              <h2 className="text-white text-3xl font-extrabold tracking-tight mb-2 sm:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-white via-zinc-200 to-violet-300">
                {current.programa}
              </h2>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-900/90 rounded-full border border-zinc-800 text-xs text-zinc-400 mb-6 font-mono">
                <span className="bg-violet-950 text-violet-300 px-2 py-0.5 rounded-full font-semibold uppercase">{current.tipo}</span>
                <span>•</span>
                <span>Inicia às {current.startedAt || "--:--"}</span>
              </div>

              {/* Contador com visores nixie digitais retro-estilizados */}
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 mb-6 inline-block backdrop-blur-md shadow-2xl relative">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-violet-600 to-indigo-600 rounded-2xl opacity-10 blur" />
                
                <div className="relative flex justify-center items-center gap-4 text-white">
                  <div className="flex flex-col items-center">
                    <span className="text-4xl sm:text-6xl font-mono font-bold tracking-widest bg-zinc-950 text-violet-400 px-4 py-2 rounded-lg border border-zinc-800 shadow-inner min-w-[3.5rem] sm:min-w-[5rem] block">
                      {countdownSeconds !== null ? String(Math.floor(countdownSeconds / 3600)).padStart(2, "0") : "00"}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1.5 font-bold font-mono">Horas</span>
                  </div>
                  <span className="text-3xl sm:text-5xl font-mono font-bold text-violet-500 animate-pulse pb-5">:</span>
                  <div className="flex flex-col items-center">
                    <span className="text-4xl sm:text-6xl font-mono font-bold tracking-widest bg-zinc-950 text-violet-400 px-4 py-2 rounded-lg border border-zinc-800 shadow-inner min-w-[3.5rem] sm:min-w-[5rem] block">
                      {countdownSeconds !== null ? String(Math.floor((countdownSeconds % 3600) / 60)).padStart(2, "0") : "00"}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1.5 font-bold font-mono">Minutos</span>
                  </div>
                  <span className="text-3xl sm:text-5xl font-mono font-bold text-violet-500 animate-pulse pb-5">:</span>
                  <div className="flex flex-col items-center">
                    <span className="text-4xl sm:text-6xl font-mono font-bold tracking-widest bg-zinc-950 text-violet-400 px-4 py-2 rounded-lg border border-zinc-800 shadow-inner min-w-[3.5rem] sm:min-w-[5rem] block">
                      {countdownSeconds !== null ? String(countdownSeconds % 60).padStart(2, "0") : "00"}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1.5 font-bold font-mono">Segundos</span>
                  </div>
                </div>
              </div>

              {current.materialTocando && (
                <p className="text-zinc-500 text-xs font-mono">
                  🎵 Trilha selecionada de introdução: <span className="text-zinc-400 font-medium">{current.materialTocando}</span>
                </p>
              )}
            </div>
          </div>
        ) : null}

        {/* Renderiza estática analógica retrô se houver falhas com o arquivo */}
        {useAnalogStatic ? (
          <div className="absolute inset-0 z-10 w-full h-full bg-black flex flex-col items-center justify-center">
            <canvas ref={staticCanvasRef} className="absolute inset-0 w-full h-full object-cover opacity-80" />
            <div className="z-20 bg-zinc-950/90 border border-violet-500 p-6 rounded-lg text-center max-w-md mx-4 shadow-2xl">
              <span className="text-red-500 font-bold tracking-wider text-xs block mb-1">🚨 QUEDA DE SINAL</span>
              <h3 className="text-white font-bold text-lg mb-2">Aguardando Transmissão de Vídeo</h3>
              <p className="text-zinc-400 text-sm mb-4">
                O sinal falhou ou não há vídeos programados tocando no momento. O receptor de TV continuará tentando reconectar de forma automática.
              </p>
              <button 
                onClick={fetchAndSync}
                disabled={isSyncing}
                className="bg-violet-600 hover:bg-violet-500 text-white font-bold px-4 py-2 rounded text-sm uppercase transition active:scale-95 disabled:opacity-50 flex items-center gap-2 mx-auto"
              >
                {isSyncing ? "⚡ Sincronizando..." : "🔄 Forçar Re-sintonia"}
              </button>
            </div>
          </div>
        ) : null}

        <video
          ref={videoRef}
          controls
          playsInline
          style={styles.video}
          onEnded={fetchAndSync}
          onError={(e) => {
            const video = videoRef.current;
            if (!video) return;

            const mediaError = video.error;

            // Ignora se for o erro de Aborto do HTML5 (código 1). Esse erro ocorre quando limpamos ou redefinimos a transmissão
            if (mediaError && mediaError.code === 1) {
              console.log("[Player] Ignorando evento de carregamento abortado (comportamento de transição natural de mídias).");
              return;
            }

            // Ignorar erros temporários se o player estiver limpando o src ou durante transição de mídias
            if (!video.src || video.src === "" || video.src === window.location.href) {
              console.log("[Player] Ignorando evento de erro temporário durante transição ou limpeza de fonte.");
              return;
            }

            const errorDetails = mediaError ? ` Código: ${mediaError.code} - Mensagem: ${mediaError.message || ""}` : "";
            console.error(`Erro de carregamento capturado no player HTML5. Tentativa ${errorCountRef.current + 1}/3.${errorDetails}`);
            
            errorCountRef.current += 1;
            if (errorCountRef.current < 3) {
              // Tenta re-sintonizar após 2 segundos limpando o cache de URL para forçar recarregamento revigorado
              setTimeout(() => {
                currentUrlRef.current = "";
                fetchAndSync();
              }, 2000);
            } else {
              console.error("Falhas consecutivas de carregamento de mídia. Entrando em modo de estática analógica de contingência.");
              setUseAnalogStatic(true);
            }
          }}
        />
      </div>

      {/* Barra de Controle de Sincronia Rápida */}
      {!loading && (
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between text-xs text-zinc-400 gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Sincronia automática ativa (Atualiza a cada 60s)</span>
          </div>
          <button 
            onClick={fetchAndSync}
            disabled={isSyncing}
            className="text-violet-400 hover:text-violet-300 transition font-bold uppercase tracking-wider flex items-center gap-1 disabled:opacity-50"
          >
            {isSyncing ? "⚡ Sincronizando..." : "📡 Sincronizar Agora"}
          </button>
        </div>
      )}

      {current && !loading && !useAnalogStatic && (
        <div style={styles.infoBar}>
          <div style={styles.infoLeft}>
            {current.status === "upcoming" ? (
              <span className="bg-violet-600 text-white font-bold px-2 py-0.5 rounded text-xs uppercase tracking-wider animate-pulse">📡 BREVEMENTE</span>
            ) : (
              <span style={styles.liveTag}>● AO VIVO</span>
            )}
            <span style={styles.programa}>{current.programa}</span>
            <span style={styles.tipo}>{current.tipo}</span>
          </div>
          <div style={styles.infoRight}>
            <span style={styles.material}>🎵 {current.materialTocando}</span>
            {current.buff && <span style={styles.buff}>🎮 {current.buff}</span>}
          </div>
        </div>
      )}

      {!current && !loading && !useAnalogStatic && (
        <div style={styles.offAir}>
          <p>📺 Sem transmissão agora. Volte mais tarde!</p>
        </div>
      )}

      {erro && !useAnalogStatic && <p style={styles.erro}>⚠️ {erro}</p>}
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
