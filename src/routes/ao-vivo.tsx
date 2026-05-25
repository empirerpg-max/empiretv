import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Tv, 
  Users, 
  MessageSquare, 
  Send, 
  Radio, 
  Sparkles, 
  Volume1,
  Music,
  Maximize,
  ArrowLeft,
  ChevronRight,
  Tv2,
  Calendar,
  Clock,
  Link,
  Save,
  Settings,
  Database,
  Plus,
  Trash,
  Shield,
  Info,
  ExternalLink,
  HelpCircle,
  RefreshCw
} from "lucide-react";

// Mock de canais de streaming de código aberto (HLS)
interface StreamChannel {
  id: string;
  name: string;
  url: string;
  fallbackUrl: string;
  nowPlaying: string;
  genre: string;
  buffBoost: string; // RPG status buff
}

const CHANNELS: StreamChannel[] = [
  {
    id: "principal",
    name: "Rádio Eldoria FM (Canal Principal)",
    url: "https://test-streams.mux.dev/x36xhg/main.m3u8",
    fallbackUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    nowPlaying: "Big Buck Bunny Orchestral Theme - Bardic Edition",
    genre: "Sinfônico RPG",
    buffBoost: "+15 de Agilidade & +10% Regen de MP"
  },
  {
    id: "coruja",
    name: "Estúdio Tears of Steel (Canal Secundário)",
    url: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
    fallbackUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    nowPlaying: "Sci-Fi Synth Beats to Grind EXP To",
    genre: "Retro Synth / Cyberpunk RPG",
    buffBoost: "+20 de Foco & +5% de Chance de Acerto Crítico"
  }
];

interface ChatMessage {
  id: string;
  sender: string;
  role: "player" | "bard" | "mod" | "mage";
  text: string;
  timestamp: string;
  guild: string;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  { id: "1", sender: "Valen_LâminaNegra", role: "player", text: "Alguém farmando na dungeon do Leste ouvindo essa rádio?", timestamp: "15:40", guild: "Fallen Kings" },
  { id: "2", sender: "Bardo_Eldoriano", role: "bard", text: "Essa track de agora aumenta nossa agilidade! Sinto os bônus ativos!", timestamp: "15:41", guild: "Harpejos Dourados" },
  { id: "3", sender: "Mago_Arcanista", role: "mage", text: "Estou recuperando MP 2x mais rápido com esse som. Incrível!", timestamp: "15:42", guild: "Ordem de Ferro" },
  { id: "4", sender: "GM_Kael", role: "mod", text: "Bem-vindos à transmissão da emissora ao vivo! Hoje temos drop duplo para quem estiver na sintonia!", timestamp: "15:42", guild: "Staff" },
  { id: "5", sender: "Lyra_VozSuave", role: "bard", text: "Lindo arranjo! Já salvei no meu grimório de partituras.", timestamp: "15:43", guild: "Harpejos Dourados" }
];

export default function AoVivoRoute() {
  // Estados para gerenciar o player
  const [currentChannel, setCurrentChannel] = useState<StreamChannel>(CHANNELS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSmartTvMode, setIsSmartTvMode] = useState(false); // Modo Tela Cheia / Theater para Smart TVs
  const [showChat, setShowChat] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isUsingFallback, setIsUsingFallback] = useState(false);

  // Estados dos Sistemas de Agendamento (Planilha Google & Lista Local)
  const [scriptUrl, setScriptUrl] = useState(() => {
    return localStorage.getItem("rpg_sonora_script_url") || "";
  });
  const [isGoogleSheetsActive, setIsGoogleSheetsActive] = useState(() => {
    return localStorage.getItem("rpg_sonora_use_sheets") === "true";
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDirectorPanelOpen, setIsDirectorPanelOpen] = useState(false);

  // Lista de grade de programação local para gerenciamento rápido (Salva no localStorage)
  const [localProgramList, setLocalProgramList] = useState<any[]>(() => {
    const saved = localStorage.getItem("rpg_sonora_local_program");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { }
    }
    return [
      {
        dia: "Todos",
        horario: "00:00",
        link_drive: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        titulo: "Sinfonia da Alvorada Arcana",
        descricao: "Música épica matinal para buff de stamina na guilda.",
        musica_atual: "Orchestra of Dawn - Level 1",
        buff_rpg: "+15 de Agilidade & +10% Regen de MP"
      },
      {
        dia: "Todos",
        horario: "12:00",
        link_drive: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
        titulo: "Heavy Beats Guerra de Clãs",
        descricao: "Sintonia pesada para lutas PVP extremas.",
        musica_atual: "Synth Remake of Steel - PVP Mode",
        buff_rpg: "+20 de Foco & +5% Crítico"
      }
    ];
  });

  // Salvar programação local sempre que mudar
  useEffect(() => {
    localStorage.setItem("rpg_sonora_local_program", JSON.stringify(localProgramList));
  }, [localProgramList]);

  // Referências para DOM
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsRetryCountRef = useRef<number>(0);

  // Sistema de Chat RPG
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [newMessage, setNewMessage] = useState("");
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Relógio do Servidor RPG atualizado em tempo real
  const [serverTime, setServerTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setServerTime(now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Rolagem automática do chat
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Mensagens simuladas aparecendo no chat
  useEffect(() => {
    const activeGuilds = ["Estrelas de Prata", "Clã da Lira", "Shadow Guild", "Bravos de Bronze", "Aliança Musical"];
    const activeNames = ["Aragorn_Piano", "LuteHero", "DrumMaster", "BeatNecro", "Valkyria_Riffs", "HealerOcarina"];
    const activeTexts = [
      "Queria essa música de boss fight no meu clã!",
      "Buff de regeneração de stamina ativado com sucesso!",
      "Aumenta o volume que essa é das boas!",
      "Qual é o level mínimo pra solar o Boss com esse tema tocando?",
      "Estação excelente para deixar rodando na TV no fundo do quarto.",
      "Tô curtindo pelo celular enquanto viajo no grifo!",
      "Os efeitos de reverbação são épicos!"
    ];

    const interval = setInterval(() => {
      const randomSender = activeNames[Math.floor(Math.random() * activeNames.length)];
      const randomText = activeTexts[Math.floor(Math.random() * activeTexts.length)];
      const randomGuild = activeGuilds[Math.floor(Math.random() * activeGuilds.length)];
      const now = new Date();
      const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      const newMsg: ChatMessage = {
        id: Math.random().toString(),
        sender: randomSender,
        role: "player",
        text: randomText,
        timestamp: timeStr,
        guild: randomGuild
      };

      setMessages((prev) => [...prev, newMsg]);
    }, 12000); // Nova mensagem a cada 12 segundos

    return () => clearInterval(interval);
  }, []);

  // Função para inicializar o HLS Player com suporte a VOD-to-Live e offset de tempo
  const initPlayer = useCallback((streamUrl: string, forceFallback: boolean = false, seekOffset: number = 0) => {
    const video = videoRef.current;
    if (!video) return;

    setIsLoading(true);
    setHasError(false);

    // Destruir instância anterior, se existir
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Configurar se é arquivo MP4 comum/Google Drive ou stream M3U8
    const isMp4 = streamUrl.endsWith(".mp4") || streamUrl.includes("google.com") || forceFallback;

    if (isMp4) {
      setIsUsingFallback(true);
      video.src = streamUrl;
      video.loop = true;
      video.muted = isMuted;
      video.volume = volume;
      video.load();

      // Quando carregar os metadados do vídeo MP4, pula para o offset do ao-vivo
      const onLoadedMetadata = () => {
        if (seekOffset > 0 && video.duration) {
          // Se o offset passar da duração do vídeo, faz looping usando resto da divisão
          const targetTime = seekOffset % video.duration;
          video.currentTime = targetTime;
          console.log(`[Programador Live] Aplicando avanço de ${Math.round(targetTime)}s em vídeo de ${Math.round(video.duration)}s`);
        }
        setIsLoading(false);
      };

      video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });

      video.play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          setIsPlaying(false);
        });

      return;
    }

    setIsUsingFallback(false);

    // Caso o Hls.js seja suportado pela biblioteca
    if (Hls.isSupported()) {
      const hls = new Hls({
        maxMaxBufferLength: 10,
        enableWorker: true,
        lowLatencyMode: true,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        hlsRetryCountRef.current = 0;
        
        // Aplica offset se houver
        if (seekOffset > 0) {
          video.currentTime = seekOffset;
        }

        video.play()
          .then(() => setIsPlaying(true))
          .catch(() => {
            setIsPlaying(false);
          });
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn("Instabilidade de rede na stream. Tentativa de reconectar...");
              if (hlsRetryCountRef.current < 2) {
                hlsRetryCountRef.current += 1;
                hls.startLoad();
              } else {
                console.error("Retries de rede HLS excedidos. Alternando para o fallback.");
                initPlayer(streamUrl, true, seekOffset);
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error("Erro fatal de mídia. Tentando recuperar...");
              hls.recoverMediaError();
              break;
            default:
              console.error("Erro fatal. Alternando para fallback.");
              initPlayer(streamUrl, true, seekOffset);
              break;
          }
        }
      });

      hlsRef.current = hls;
    } 
    // Suporte Nativo a HLS (importante para Smart TVs, iPhones, Safari)
    else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", () => {
        setIsLoading(false);
        hlsRetryCountRef.current = 0;
        
        if (seekOffset > 0) {
          video.currentTime = seekOffset;
        }

        video.play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      });
      video.onplay = () => setIsPlaying(true);
      video.onpause = () => setIsPlaying(false);
      video.addEventListener("error", () => {
        console.error("Erro nativo de reprodução. Iniciando fallback.");
        initPlayer(streamUrl, true, seekOffset);
      });
    } else {
      initPlayer(streamUrl, true, seekOffset);
    }
  }, [isMuted, volume]);

  // Sincronizar transmissão agendada (Planilha do Google Sheets ou Grade Local)
  const syncScheduledTransmission = useCallback(async (isManualRefresh: boolean = false) => {
    if (isGoogleSheetsActive && scriptUrl) {
      setIsSyncing(true);
      try {
        const response = await fetch(scriptUrl);
        const data = await response.json();

        if (data && data.status === "success" && data.current) {
          const stream = data.current;
          if (stream.status === "broadcasting" && stream.videoUrl) {
            // Sintonizar a transmissão retornada pela planilha com o offset calculado pelo Google Script
            setCurrentChannel({
              id: "sheets_active",
              name: stream.title || "Canal Planilha",
              url: stream.videoUrl,
              fallbackUrl: stream.videoUrl,
              nowPlaying: stream.nowPlaying || "Música em Transmissão",
              genre: stream.description || "Programação Ordenada",
              buffBoost: stream.buff || "Sem Buff Ativo"
            });

            // Sintoniza com o offset no player de vídeo
            initPlayer(stream.videoUrl, false, stream.seekOffset || 0);

            if (isManualRefresh) {
              setMessages(prev => [
                ...prev,
                {
                  id: Math.random().toString(),
                  sender: "Sistema_Sintonia",
                  role: "mod",
                  text: `📡 Sintonizado na Planilha! Tocando agora: ${stream.title} (${stream.nowPlaying})`,
                  timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                  guild: "Sintonia"
                }
              ]);
            }
          } else {
            // Se a planilha respondeu mas não há transmissão ativa, usa o fallback local
            calculateLocalSchedule(isManualRefresh);
          }
        } else {
          calculateLocalSchedule(isManualRefresh);
        }
      } catch (err) {
        console.error("Erro ao sincronizar com Google Sheets. Usando grade local.", err);
        calculateLocalSchedule(isManualRefresh);
        if (isManualRefresh) {
          setMessages(prev => [
            ...prev,
            {
              id: Math.random().toString(),
              sender: "Erro_Guilda",
              role: "mod",
              text: "⚠️ Falha ao ler a Planilha Google (verifique se publicou o script como Web App público). Usando grade local de emergência!",
              timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
              guild: "Erro"
            }
          ]);
        }
      } finally {
        setIsSyncing(false);
      }
    } else {
      // Caso não esteja com a planilha ativa, roda a lógica do Calendário/Grade Local de Horários
      calculateLocalSchedule(isManualRefresh);
    }
  }, [isGoogleSheetsActive, scriptUrl, localProgramList, initPlayer]);

  // Lógica local para decidir qual vídeo da lista local rodar com base no horário real de Brasília
  const calculateLocalSchedule = useCallback((isManualRefresh: boolean = false) => {
    const now = new Date();
    // Forçar cálculo baseado no fuso horário do Brasil se necessário, ou usar local
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSeconds = now.getSeconds();
    
    // Segundos decorridos desde a meia-noite
    const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;

    // Se a lista estiver vazia, usa os canais HLS padrão
    if (localProgramList.length === 0) {
      if (isManualRefresh) {
        setMessages(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            sender: "Bardo_Local",
            role: "bard",
            text: "O repertório local está vazio! Sintonizando Rádios HLS de demonstração.",
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            guild: "Aviso"
          }
        ]);
      }
      initPlayer(currentChannel.url);
      return;
    }

    // Mapear horários de início e ordenar
    const sortedPrograms = localProgramList.map((item, index) => {
      const parts = (item.horario || "00:00").split(":");
      const h = parseInt(parts[0] || "0", 10);
      const m = parseInt(parts[1] || "0", 10);
      const startSecs = (h * 3600) + (m * 60);

      return {
        ...item,
        startSecs,
        index
      };
    }).sort((a, b) => a.startSecs - b.startSecs);

    // Encontrar qual transmissão cabe no horário atual
    let activeItem = null;
    for (let i = 0; i < sortedPrograms.length; i++) {
      const current = sortedPrograms[i];
      const next = sortedPrograms[i + 1];

      if (nowInSeconds >= current.startSecs) {
        if (!next || nowInSeconds < next.startSecs) {
          activeItem = current;
          break;
        }
      }
    }

    // Se nenhum item bater (por exemplo, meia noite e a primeira transmissão é às 08:00), usa o último item do dia (reprise)
    if (!activeItem && sortedPrograms.length > 0) {
      activeItem = sortedPrograms[sortedPrograms.length - 1];
    }

    if (activeItem) {
      // Calcular offset de segundos
      let elapsed = nowInSeconds - activeItem.startSecs;
      if (elapsed < 0) {
        // Se pegou a transmissão do fim do dia anterior para rodar antes do primeiro do dia
        elapsed = (24 * 3600) - activeItem.startSecs + nowInSeconds;
      }

      // Sintoniza
      setCurrentChannel({
        id: `local_active_${activeItem.index}`,
        name: activeItem.titulo || "Transmissão Sonora",
        url: activeItem.link_drive || "",
        fallbackUrl: activeItem.link_drive || "",
        nowPlaying: activeItem.musica_atual || "Banda do Bardo",
        genre: activeItem.descricao || "Grade Local",
        buffBoost: activeItem.buff_rpg || "+5% MP"
      });

      // Passar o link direto e o offset para o player inicializar exatamente na minutagem certa!
      // Se for link do Drive de compartilhamento, convertemos amigavelmente:
      const directUrl = convertDriveLinkToDirect(activeItem.link_drive || "");
      initPlayer(directUrl, false, elapsed);

      if (isManualRefresh) {
        setMessages(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            sender: "Guia_Sonora_BOT",
            role: "bard",
            text: `🎯 Sintonizado via Grade Local! Tocando: ${activeItem.titulo} com ${Math.round(elapsed / 60)}m de exibição decorrida em tempo real.`,
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            guild: "Sintonia"
          }
        ]);
      }
    }
  }, [localProgramList, initPlayer, currentChannel.url]);

  // Função utilitária para converter link do Drive compartilhável em download direto para o player web
  const convertDriveLinkToDirect = (url: string) => {
    if (!url) return "";
    if (url.includes("docs.google.com/uc") || url.includes("drive.usercontent.google.com")) {
      return url;
    }
    const regExp = /\/file\/d\/([^\/]+)|\/open\?id=([^\/&]+)|id=([^\/&]+)/;
    const matches = url.match(regExp);
    if (matches) {
      const fileId = matches[1] || matches[2] || matches[3];
      if (fileId) {
        return `https://docs.google.com/uc?export=download&id=${fileId}`;
      }
    }
    return url;
  };

  // Carregar transmissão correta na montagem do componente
  useEffect(() => {
    syncScheduledTransmission(false);
  }, [isGoogleSheetsActive]); // Re-sincroniza se o usuário trocar a chave/interruptor da planilha!

  // Loop de monitoramento de horários: Verifica a cada 20 segundos se precisamos trocar o vídeo por conta de um novo programa agendado começar
  useEffect(() => {
    const timer = setInterval(() => {
      // Re-calcula a transmissão atual e atualiza delicadamente se o programa do horário mudar
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const timeStr = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;

      // Se o horário atual bate perfeitamente com um horário de início da programação local ou externa (minuto zero), faz refresh!
      const isStartOfProgram = localProgramList.some(item => item.horario === timeStr && now.getSeconds() < 25);
      
      if (isStartOfProgram) {
        console.log(`[Agendador] Troca de programa agendado executando em ${timeStr}`);
        syncScheduledTransmission(false);
      }
    }, 20000);

    return () => clearInterval(timer);
  }, [localProgramList, syncScheduledTransmission]);

  // Controles manuais
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play()
        .then(() => setIsPlaying(true))
        .catch(err => console.log("Erro ao reproduzir: ", err));
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (video) {
      video.volume = val;
      video.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    const newMute = !isMuted;
    setIsMuted(newMute);
    video.muted = newMute;
  };

  const toggleFullscreen = () => {
    const container = playerContainerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(err => console.error("Erro ao ativar tela cheia: ", err));
    } else {
      document.exitFullscreen()
        .then(() => setIsFullscreen(false));
    }
  };

  // Monitorar mudança externa de Fullscreen (ex: tecla ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Enviar Mensagem no Chat
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const msg: ChatMessage = {
      id: Math.random().toString(),
      sender: "Você_ProBardo",
      role: "player",
      text: newMessage,
      timestamp: timeStr,
      guild: "Herói Lendário"
    };

    setMessages((prev) => [...prev, msg]);
    setNewMessage("");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans transition-colors duration-300">
      
      {/* 1. Header do RPG Musical (Sutil e Elegante) */}
      {!isSmartTvMode && (
        <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40 px-4 py-3 flex items-center justify-between transition-all">
          <div className="flex items-center gap-3">
            {/* Logo do Musical RPG com Fallback SVG de Altíssima Qualidade */}
            <div className="flex items-center gap-2">
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 text-primary">
                <Music className="w-5 h-5 animate-bounce" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full animate-ping" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold font-display tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
                  SONORA RPG
                </h1>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  Transmissão ao Vivo do Reino
                </p>
              </div>
            </div>
          </div>

          {/* Logo do Repositório original */}
          <div className="absolute left-1/2 -translate-x-1/2 hidden md:block">
            <img 
              src="/src/assets/logo-full.png" 
              alt="RPG Musical Logo" 
              className="h-9 object-contain" 
              onError={(e) => {
                // Remove a tag de imagem com erro para evitar ícone quebrado
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          {/* Informações Auxiliares (Servidor / Relógio do RPG) */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-muted/60 rounded-lg border border-border">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono text-muted-foreground">SERVER TIME:</span>
              <span className="text-xs font-mono font-bold text-foreground">{serverTime}</span>
            </div>

            {/* TV Mode Switcher - Ótimo para Smart TVs */}
            <button 
              onClick={() => setIsSmartTvMode(!isSmartTvMode)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-primary/30 hover:border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer"
              title="Ativar Modo Foco Smart TV (Oculta cabeçalhos e expande o vídeo)"
            >
              <Tv className="w-4 h-4" />
              <span className="hidden md:inline">Modo Smart TV</span>
            </button>
          </div>
        </header>
      )}

      {/* 2. ÁREA CENTRAL (Layout Theater de TV) */}
      <main className={`flex-1 flex flex-col lg:flex-row ${isSmartTvMode ? "p-0" : "p-2 sm:p-4"} gap-4 overflow-hidden`}>
        
        {/* Lado Esquerdo: Player Principal e Informações */}
        <div className={`flex-1 flex flex-col justify-center ${isSmartTvMode ? "h-screen w-screen p-0" : "gap-4"} h-full`}>
          
          {/* Container do Player com Proporção 16:9 Estrita usando aspect-video */}
          <div 
            id="musical-rpg-player"
            ref={playerContainerRef}
            className={`relative w-full bg-black group overflow-hidden ${
              isSmartTvMode 
                ? "h-full w-full max-h-screen" 
                : "rounded-2xl border border-border/80 shadow-2xl aspect-video"
            }`}
          >
            {/* O element video nativo */}
            <video
              ref={videoRef}
              className={`w-full h-full object-cover ${isSmartTvMode ? "h-screen" : "aspect-video"}`}
              playsInline
              onClick={togglePlay}
            />

            {/* Overlay de Loading */}
            {isLoading && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-sm font-mono text-primary animate-pulse tracking-wide uppercase">
                  Sintonizando Estação HLS...
                </p>
                <p className="text-xs text-muted-foreground mt-2 font-mono">
                  Buscando frequência do Reino
                </p>
              </div>
            )}

            {/* Overlay de Erro */}
            {hasError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950 px-6 text-center">
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-full text-red-500 mb-4 animate-bounce">
                  <VolumeX className="w-10 h-10" />
                </div>
                <h3 className="text-lg font-bold text-red-400">Falha na Sintonia</h3>
                <p className="text-sm text-zinc-400 max-w-md mt-2">
                  {errorMessage || "Não foi possível carregar a stream (.m3u8). Verifique se o link de teste está online ou use outro canal."}
                </p>
                <button
                  onClick={() => initPlayer(currentChannel.url)}
                  className="mt-4 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-mono font-bold transition-all"
                >
                  TENTAR RECONECTAR
                </button>
              </div>
            )}

            {/* BADGES DO CANTO SUPERIOR (Transmissão ao Vivo e Audiência) */}
            <div className="absolute top-4 left-4 z-10 flex items-center gap-2 pointer-events-none">
              
              {/* Badge de STATUS AO VIVO (Piscando Vermelho estilo shadcn/ui) */}
              <div className="flex items-center gap-2 bg-red-600/90 backdrop-blur text-white font-mono text-xs font-black uppercase px-2.5 py-1 rounded-full shadow-lg border border-red-500/50 live-badge-glow">
                <span className="w-2.5 h-2.5 bg-white rounded-full animate-ping" />
                <span>AO VIVO</span>
              </div>

              {/* Badge de Assistindo / Audiência */}
              <div className="flex items-center gap-1.5 bg-black/75 backdrop-blur text-gray-200 px-2.5 py-1 rounded-full text-xs font-mono border border-border shadow-md">
                <Users className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold">4.2K</span>
              </div>

              {/* Buff do RPG Ativo */}
              <div className="hidden sm:flex items-center gap-1.5 bg-black/75 backdrop-blur text-emerald-400 px-2.5 py-1 rounded-full text-[10px] font-mono border border-emerald-500/30 shadow-md">
                <Sparkles className="w-3 h-3 text-emerald-400 animate-spin" />
                <span>BUFF: RUNNING ({currentChannel.buffBoost})</span>
              </div>
            </div>

            {/* SMART TV / HEADER SUPERIOR QUE ESCONDE (Modo Smart TV) */}
            {isSmartTvMode && (
              <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <button 
                  onClick={() => setIsSmartTvMode(false)}
                  className="flex items-center gap-2 px-3 py-2 bg-black/80 hover:bg-zinc-900 text-white border border-border rounded-xl text-xs font-mono transition-all cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4 text-primary" />
                  <span>Sair do Modo TV</span>
                </button>
              </div>
            )}

            {/* CONTROLES DO VIDEO (Estilo Gamer/RPG Avançado, somem se inativo ou no Modo TV automática) */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-4 flex flex-col gap-3 group-hover:translate-y-0 translate-y-1 sm:translate-y-2 opacity-0 group-hover:opacity-100 transition-all duration-300 z-10">
              
              {/* Informação Flutuante da Faixa Atual */}
              <div className="flex items-center justify-between text-xs font-mono text-gray-300 mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-white font-medium text-xs sm:text-sm truncate max-w-xs sm:max-w-md">
                    Tocando: <span className="text-primary font-bold">{currentChannel.nowPlaying}</span>
                  </span>
                </div>
                <span className="text-[10px] hidden sm:block font-mono">
                  {isUsingFallback ? (
                    <span className="text-amber-400 font-bold">⚠️ SINAL BACKUP ATIVO (CORS/Fallback)</span>
                  ) : (
                    <span className="text-emerald-400 font-bold">🟢 SINAL PRINCIPAL (HLS M3U8)</span>
                  )}
                </span>
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Play e Pause */}
                  <button 
                    onClick={togglePlay}
                    className="p-3 bg-primary hover:bg-primary-hover text-white rounded-full transition-all hover:scale-110 active:scale-95 shadow-md shadow-primary/30 cursor-pointer"
                    aria-label={isPlaying ? "Pausar" : "Reproduzir"}
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                  </button>

                  {/* Som e Volume */}
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={toggleMute}
                      className="p-2 text-gray-300 hover:text-white transition-all cursor-pointer"
                      aria-label="Mutar"
                    >
                      {isMuted ? (
                        <VolumeX className="w-5 h-5 text-red-500" />
                      ) : volume > 0.5 ? (
                        <Volume2 className="w-5 h-5 text-primary" />
                      ) : (
                        <Volume1 className="w-5 h-5" />
                      )}
                    </button>
                    <input 
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-16 sm:w-24 accent-primary hover:accent-pink-400 cursor-pointer"
                    />
                  </div>

                  {/* Canal de Som Ativo */}
                  <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 bg-zinc-900 border border-border rounded text-[10px] font-mono text-gray-300">
                    <Radio className="w-3 h-3 text-primary animate-pulse" />
                    <span>STÉREO 320KBPS</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Seletor de Transmissões / Qualidades no rodapé */}
                  <div className="flex items-center gap-1 bg-zinc-900 border border-border rounded-lg p-1">
                    {CHANNELS.map((chan) => (
                      <button
                        key={chan.id}
                        onClick={() => setCurrentChannel(chan)}
                        className={`px-2.5 py-1 text-[10px] font-mono rounded cursor-pointer transition-all ${
                          currentChannel.id === chan.id
                            ? "bg-primary text-white font-bold"
                            : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                        }`}
                      >
                        {chan.id === "principal" ? "Estúdio A" : "Estúdio B"}
                      </button>
                    ))}
                  </div>

                  {/* Tela Cheia Nativa */}
                  <button 
                    onClick={toggleFullscreen}
                    className="p-2 text-gray-300 hover:text-white transition-all cursor-pointer"
                    title="Tela Cheia"
                  >
                    <Maximize className="w-5 h-5" />
                  </button>
                </div>
              </div>

            </div>

          </div>

          {/* Dados do Canal Abaixo do Player */}
          {!isSmartTvMode && (
            <div className="bg-card border border-border p-4 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  <span className="font-mono text-xs text-primary font-bold tracking-wider uppercase">
                    Estação Atual: {currentChannel.genre}
                  </span>
                </div>
                <h2 className="text-xl font-bold font-display tracking-tight text-white mb-1">
                  {currentChannel.name}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Alimentado por servidores de streaming HLS fluidos. Desfrute de transmissões musicais contínuas para guiar suas missões de RPG em qualquer dispositivo.
                </p>
              </div>

              {/* RPG Stats Buff Info Card */}
              <div className="w-full md:w-auto bg-muted border border-border p-3 rounded-xl flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Bônus de Sintonia
                  </h4>
                  <p className="text-sm font-bold text-emerald-400 font-mono">
                    {currentChannel.buffBoost}
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Lado Direito: Live Chat e Feed RPG */}
        {!isSmartTvMode && showChat && (
          <div className="w-full lg:w-80 bg-card border border-border rounded-2xl flex flex-col h-[400px] lg:h-auto overflow-hidden">
            {/* Header do Chat */}
            <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold uppercase tracking-wider font-mono">
                  Chat da Guilda Geral
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded text-[9px] font-mono">
                LIVE RELAY
              </div>
            </div>

            {/* Feed de Mensagens Rolável */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-[290px] lg:max-h-none">
              {messages.map((msg) => (
                <div key={msg.id} className="text-xs flex flex-col gap-0.5 bg-muted/40 p-2 rounded-xl border border-border/40 hover:border-border/80 transition-all">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {msg.role === "mod" ? (
                        <span className="px-1.5 py-0.2 bg-red-600 text-white rounded text-[8px] font-black uppercase tracking-widest leading-normal">
                          MOD
                        </span>
                      ) : msg.role === "bard" ? (
                        <span className="px-1.5 py-0.2 bg-primary text-white rounded text-[8px] font-bold uppercase tracking-widest leading-normal">
                          BARDO
                        </span>
                      ) : (
                        <span className="px-1 py-0.2 bg-zinc-850 text-muted-foreground rounded text-[8px] font-mono">
                          {msg.guild}
                        </span>
                      )}
                      <span className="font-bold text-foreground font-mono truncate max-w-[120px]">
                        {msg.sender}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">{msg.timestamp}</span>
                  </div>
                  <p className="text-gray-300 break-words mt-1 leading-relaxed">
                    {msg.text}
                  </p>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>

            {/* Input Form do Chat */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-border bg-muted/20">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Escreva sua mensagem na guilda..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="w-full bg-zinc-910 outline-none text-xs rounded-xl pl-3 pr-10 py-2.5 border border-border focus:border-primary text-white font-sans transition-all"
                />
                <button
                  type="submit"
                  className="absolute right-1 top-1 bottom-1 px-3 bg-primary hover:bg-primary-hover text-white rounded-lg transition-all flex items-center justify-center cursor-pointer"
                  title="Enviar"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        )}

      </main>

      {/* 3. PAINEL DO DIRETOR: GRADE DE TRANSMISSÃO E AGENDAMENTO (OCULTO NO MODO SMART TV) */}
      {!isSmartTvMode && (
        <section className="max-w-7xl mx-auto w-full px-4 pb-12 mt-4">
          <div className="bg-card border border-border rounded-3xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

            {/* Cabeçalho do Painel */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/20 border border-primary/30 rounded-xl text-primary">
                  <Settings className="w-5 h-5 animate-spin-slow" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white font-display">
                    ⚙️ Painel do Diretor de Transmissão (VOD-to-Live)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Gerencie os horários, dias e links de vídeos para que a rádio mude de vídeo sozinha e em tempo real!
                  </p>
                </div>
              </div>

              {/* Botões do Painel Principal */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsGoogleSheetsActive(!isGoogleSheetsActive);
                    localStorage.setItem("rpg_sonora_use_sheets", String(!isGoogleSheetsActive));
                  }}
                  className={`px-4 py-2 text-xs font-bold font-mono rounded-xl cursor-pointer border transition-all flex items-center gap-2 ${
                    isGoogleSheetsActive
                      ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/50 hover:bg-emerald-600/30"
                      : "bg-muted text-muted-foreground border-border hover:text-white"
                  }`}
                >
                  <Database className="w-4 h-4" />
                  <span>PLANILHA: {isGoogleSheetsActive ? "SINCRO_ON" : "LOCAL_ON"}</span>
                </button>

                <button
                  onClick={() => syncScheduledTransmission(true)}
                  disabled={isSyncing}
                  className="px-4 py-2 text-xs font-bold font-mono rounded-xl cursor-pointer bg-primary text-white hover:bg-primary-hover active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
                  <span>{isSyncing ? "Sincronizando..." : "Atualizar Sinal"}</span>
                </button>
              </div>
            </div>

            {/* Abas e Configuração de Planilha do Google */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Esquerda: Configurações Técnicas e Adição de Item */}
              <div className="lg:col-span-5 flex flex-col gap-6">

                {/* Bloco do Integrador Planilha Google */}
                <div className="bg-muted/40 border border-border p-5 rounded-2xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="text-primary w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-gray-200">
                      Integração com Planilha de Horérios (Google Sheets)
                    </h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                    Selecione esta opção para ler a grade de vídeos compartilhados do Drive de forma dinâmica. Para ativar, cole o endpoint gerado por seu <strong>Google Apps Script</strong>:
                  </p>

                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-mono text-muted-foreground uppercase">Link do Web App do Scripts:</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://script.google.com/macros/s/.../exec"
                        value={scriptUrl}
                        onChange={(e) => {
                          setScriptUrl(e.target.value);
                          localStorage.setItem("rpg_sonora_script_url", e.target.value);
                        }}
                        className="flex-1 bg-zinc-910 text-xs rounded-xl px-3 py-2 border border-border focus:border-primary text-white outline-none"
                      />
                      <button
                        onClick={() => {
                          localStorage.setItem("rpg_sonora_script_url", scriptUrl);
                          setMessages(prev => [
                            ...prev,
                            {
                              id: Math.random().toString(),
                              sender: "Diretor_Bardo",
                              role: "mod",
                              text: "💾 Link do Google Apps Script salvo com sucesso! Reiniciando rádio...",
                              timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                              guild: "Sistema"
                            }
                          ]);
                          syncScheduledTransmission(true);
                        }}
                        className="px-3 bg-zinc-800 hover:bg-zinc-750 text-white rounded-xl text-xs font-bold border border-border cursor-pointer transition-all"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>

                  {/* Alerta de status da Planilha */}
                  <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-xl flex items-start gap-2.5 text-xs">
                    <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div className="text-muted-foreground space-y-1">
                      <span>Para usar o método da planilha, criamos o arquivo completo <code className="text-primary font-mono select-all">/google-apps-script.js</code> no seu projeto. Copie-o e cole no script.google.com!</span>
                    </div>
                  </div>
                </div>

                {/* Form para Adicionar Vídeo Manual na Grade Local */}
                <div className="bg-muted/40 border border-border p-5 rounded-2xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Plus className="text-primary w-4 h-4 animate-bounce" />
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-gray-200">
                      Adicionar Programa à Grade Local (Offline)
                    </h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    Cadastre vídeos para rodar de forma síncrona diretamente no navegador!
                  </p>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const day = (form.elements.namedItem("progDay") as HTMLSelectElement).value;
                      const time = (form.elements.namedItem("progTime") as HTMLInputElement).value;
                      const driveLink = (form.elements.namedItem("progLink") as HTMLInputElement).value;
                      const title = (form.elements.namedItem("progTitle") as HTMLInputElement).value;
                      const desc = (form.elements.namedItem("progDesc") as HTMLInputElement).value;
                      const song = (form.elements.namedItem("progSong") as HTMLInputElement).value;
                      const buff = (form.elements.namedItem("progBuff") as HTMLInputElement).value;

                      if (!time || !driveLink || !title) {
                        alert("Por favor, preencha o Horário de Início, o Título e o Link do Vídeo!");
                        return;
                      }

                      const newItem = {
                        dia: day,
                        horario: time,
                        link_drive: driveLink,
                        titulo: title,
                        descricao: desc || "Transmissão sem descrição descrita pelo clã",
                        musica_atual: song || "Faixa Padrão",
                        buff_rpg: buff || "+5 de EXP Passivo"
                      };

                      setLocalProgramList(prev => [...prev, newItem].sort((a, b) => a.horario.localeCompare(b.horario)));
                      form.reset();

                      setMessages(prev => [
                        ...prev,
                        {
                          id: Math.random().toString(),
                          sender: "Guia_Sonora_BOT",
                          role: "bard",
                          text: `🎮 Nova transmissão '${title}' agendada com sucesso para as ${time}!`,
                          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                          guild: "Agenda"
                        }
                      ]);

                      // Recalcula horário e sintoniza
                      setTimeout(() => syncScheduledTransmission(false), 200);
                    }}
                    className="flex flex-col gap-3.5 text-xs text-left"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-mono text-muted-foreground uppercase">Dia da Semana:</label>
                        <select
                          name="progDay"
                          className="bg-zinc-910 p-2 rounded-xl border border-border focus:border-primary text-white outline-none"
                        >
                          <option value="Todos">Todos os Dias</option>
                          <option value="segunda">Segunda-feira</option>
                          <option value="terça">Terça-feira</option>
                          <option value="quarta">Quarta-feira</option>
                          <option value="quinta">Quinta-feira</option>
                          <option value="sexta">Sexta-feira</option>
                          <option value="sábado">Sábado</option>
                          <option value="domingo">Domingo</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-mono text-muted-foreground uppercase">Horário de Início (HH:MM):</label>
                        <input
                          type="time"
                          name="progTime"
                          required
                          className="bg-zinc-910 p-2 rounded-xl border border-border focus:border-primary text-white outline-none font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-mono text-muted-foreground uppercase font-semibold">Link do Vídeo (Google Drive ou MP4 Direto):</label>
                      <input
                        type="url"
                        name="progLink"
                        required
                        placeholder="https://drive.google.com/file/d/.../view"
                        className="bg-zinc-910 p-2 rounded-xl border border-border focus:border-primary text-white outline-none font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-mono text-muted-foreground uppercase">Título do Vídeo/Programa:</label>
                        <input
                          type="text"
                          name="progTitle"
                          required
                          placeholder="Masmorra de Fogo Ep. 01"
                          className="bg-zinc-910 p-2 rounded-xl border border-border focus:border-primary text-white outline-none"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-mono text-muted-foreground uppercase">Música Exibida na Tela:</label>
                        <input
                          type="text"
                          name="progSong"
                          placeholder="Volcano Bass Theme"
                          className="bg-zinc-910 p-2 rounded-xl border border-border focus:border-primary text-white outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-mono text-muted-foreground uppercase">Buff RPG Concedido:</label>
                        <input
                          type="text"
                          name="progBuff"
                          placeholder="+20 de Ataque de Fogo"
                          className="bg-zinc-910 p-2 rounded-xl border border-border focus:border-primary text-white outline-none"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-mono text-muted-foreground uppercase">Pequena Descrição:</label>
                        <input
                          type="text"
                          name="progDesc"
                          placeholder="Aquecimento na taverna de lava."
                          className="bg-zinc-910 p-2 rounded-xl border border-border focus:border-primary text-white outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-primary hover:bg-primary-hover font-bold tracking-wide rounded-xl cursor-pointer shadow-lg shadow-primary/20 text-white transition-all text-xs"
                    >
                      ADICIONAR À PROGRAMAÇÃO 🎮
                    </button>
                  </form>
                </div>

              </div>

              {/* Direita: Lista / Grade de Transmissão Configurada Ativa */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                
                {/* Visualizador da Grade Ativa */}
                <div className="bg-muted/40 border border-border p-5 rounded-2xl flex flex-col h-full">
                  <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="text-primary w-4 h-4" />
                      <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-gray-200">
                        Grade de Programação Programada ({isGoogleSheetsActive ? "Nuvem Planilha" : "Local do Navegador"})
                      </h4>
                    </div>
                    
                    <span className="text-[10px] bg-primary/10 border border-primary/20 p-1.5 rounded-lg text-primary font-mono font-bold animate-pulse">
                      STATUS: TRANSMISSÃO AUTOMÁTICA
                    </span>
                  </div>

                  {/* Tabela de Horários */}
                  <div className="flex-1 overflow-x-auto min-h-[250px]">
                    {isGoogleSheetsActive ? (
                      <div className="h-full flex flex-col items-center justify-center p-6 text-center border-2 border-dashed border-border rounded-xl">
                        <Database className="w-10 h-10 text-primary mb-3 animate-ping-slow" />
                        <h5 className="text-sm font-bold text-white mb-1">Grade Integrada ao Google Cloud</h5>
                        <p className="text-xs text-muted-foreground max-w-md">
                          Sua programação está sendo controlada pela Planilha do Google online. Todas as datas, dias da semana e links cadastrados lá estão governando a rádio automaticamente a partir da nossa API em tempo real!
                        </p>
                        <a 
                          href="https://script.google.com" 
                          target="_blank" 
                          rel="noreferrer" 
                          className="mt-4 px-3.5 py-1.5 bg-zinc-800 border border-border hover:bg-zinc-750 text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-all cursor-pointer"
                        >
                          <span>Abrir Editor do Apps Script</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    ) : (
                      <table className="w-full text-left text-xs text-muted-foreground border-collapse">
                        <thead>
                          <tr className="border-b border-border/80 text-[10px] font-mono uppercase tracking-wider text-gray-400">
                            <th className="pb-2.5">Dia</th>
                            <th className="pb-2.5">Horário</th>
                            <th className="pb-2.5">Título / Atração</th>
                            <th className="pb-2.5">Efeito RPG Concedido</th>
                            <th className="pb-2.5 text-right font-medium">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {localProgramList.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-8 text-center text-muted-foreground">
                                Nenhuma atração agendada. Adicione uma transmissão no formulário ao lado!
                              </td>
                            </tr>
                          ) : (
                            localProgramList.map((item, index) => (
                              <tr key={index} className="border-b border-border/40 hover:bg-muted/10 transition-colors">
                                <td className="py-3 font-mono font-bold text-white">{item.dia}</td>
                                <td className="py-3 font-mono font-black text-primary">{item.horario}</td>
                                <td className="py-3">
                                  <div className="font-semibold text-white truncate max-w-[150px]" title={item.titulo}>{item.titulo}</div>
                                  <div className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={item.descricao}>{item.descricao}</div>
                                </td>
                                <td className="py-3">
                                  <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-mono">
                                    {item.buff_rpg}
                                  </span>
                                </td>
                                <td className="py-3 text-right">
                                  <button
                                    onClick={() => {
                                      const filtered = localProgramList.filter((_, i) => i !== index);
                                      setLocalProgramList(filtered);
                                      setMessages(prev => [
                                        ...prev,
                                        {
                                          id: Math.random().toString(),
                                          sender: "Guia_Sonora_BOT",
                                          role: "bard",
                                          text: `🗑️ Atração de horário '${item.horario}' removida da grade de transmissão local.`,
                                          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                                          guild: "Agenda"
                                        }
                                      ]);
                                      setTimeout(() => syncScheduledTransmission(false), 200);
                                    }}
                                    className="p-1.5 hover:bg-red-500/15 hover:text-red-500 rounded-lg transition-all text-muted-foreground cursor-pointer"
                                    title="Excluir Horário"
                                  >
                                    <Trash className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Aba Informativa de Guia */}
                  <div className="mt-4 p-4 bg-[#8b5cf6]/5 border border-[#8b5cf6]/20 rounded-2xl flex gap-3 text-left">
                    <HelpCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <h5 className="text-xs font-bold text-white mb-1">Como hospedar os vídeos no Google Drive?</h5>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        1. Certifique-se de fazer o upload do vídeo em MP4 na sua conta do Google Drive.<br />
                        2. Clique com o botão direito no vídeo, vá em <strong>Compartilhar &gt; Qualquer pessoa com o link pode abrir</strong> (como Leitor).<br />
                        3. Copie o link gerado e cole na nossa ferramenta! Nós cuidaremos da conversão do link para streaming direto e cálculo do tempo sincronizado automaticamente para todos os seus ouvintes, sem que você de fato precise transmitir algo do seu computador!
                      </p>
                    </div>
                  </div>

                </div>

              </div>
              
            </div>

          </div>
        </section>
      )}

    </div>
  );
}
