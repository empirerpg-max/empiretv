import React, { useState, useEffect, useRef, useCallback, ChangeEvent, FormEvent } from "react";
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
  RefreshCw,
  Gift,
  Copy,
  Lock,
  Unlock,
  X
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
  durationSeconds?: number;
  seekOffset?: number;
}

const CHANNELS: StreamChannel[] = [
  {
    id: "principal",
    name: "Transmissão Oficial Empire (Estúdio Principal)",
    url: "https://test-streams.mux.dev/x36xhg/main.m3u8",
    fallbackUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    nowPlaying: "Exibição Especial da Aliança Empire",
    genre: "Geral",
    buffBoost: "XP Extra de Sintonia Ativo"
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
  { id: "1", sender: "Rodrigo_VIP_Gold", role: "player", text: "Alguém aí na sintonia coletando os extras de hoje?", timestamp: "15:40", guild: "Empire Lions" },
  { id: "2", sender: "Empire_Manager", role: "bard", text: "A programação de hoje foi toda atualizada via planilha!", timestamp: "15:41", guild: "Diretoria" },
  { id: "3", sender: "Lucas_Chief", role: "mage", text: "Esse player de transmissão é liso demais pelo celular!", timestamp: "15:42", guild: "Capitães" },
  { id: "4", sender: "Mod_Empire_01", role: "mod", text: "Bem-vindos à Empire TV! Deixem carregando para liberar seu loot extra!", timestamp: "15:42", guild: "Staff" },
  { id: "5", sender: "Nath_VIP", role: "bard", text: "Já sintonizei aqui na TV e no celular para garantir o progresso de 80%!", timestamp: "15:43", guild: "Empire Lions" }
];

// Função utilitária global para converter link do Drive compartilhável em download direto para o player web
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

// Nova função utilitária para converter link do Drive compartilhável em link de visualização em Iframe
const getDriveIframeUrl = (url: string) => {
  if (!url) return "";
  if (url.includes("drive.google.com/file/d/") && url.includes("/preview")) {
    return url;
  }
  const regExp = /\/file\/d\/([^\/?#&]+)|\/open\?id=([^\/?#&]+)|[?&]id=([^\/?#&]+)/;
  const matches = url.match(regExp);
  if (matches) {
    const fileId = matches[1] || matches[2] || matches[3];
    if (fileId) {
      return `https://drive.google.com/file/d/${fileId}/preview`;
    }
  }
  return "";
};

// Helper para construir a linha do tempo enfileirada no modo local (equivalente ao buildActiveTimeline do Apps Script)
const buildLocalTimeline = (programList: any[]) => {
  const sorted = programList.map((item, index) => {
    const timeStr = String(item.horario || "00:00").trim();
    const parts = timeStr.split(":");
    const hours = parseInt(parts[0] || "0", 10);
    const minutes = parseInt(parts[1] || "0", 10);
    const configuredStartInSeconds = (hours * 3600) + (minutes * 60);

    let duration = parseInt(item.duracao_segundos || item.duration || "600", 10);
    if (isNaN(duration) || duration <= 0) {
      duration = 600;
    }

    return {
      ...item,
      configuredStartInSeconds,
      durationSeconds: duration,
      index
    };
  }).sort((a, b) => a.configuredStartInSeconds - b.configuredStartInSeconds);

  const timeline: any[] = [];
  let currentTimelineInSeconds = 0;

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    let actualStartInSeconds = current.configuredStartInSeconds;
    if (actualStartInSeconds < currentTimelineInSeconds) {
      actualStartInSeconds = currentTimelineInSeconds;
    }

    const actualEndInSeconds = actualStartInSeconds + current.durationSeconds;
    currentTimelineInSeconds = actualEndInSeconds;

    const h = Math.floor(actualStartInSeconds / 3600);
    const m = Math.floor((actualStartInSeconds % 3600) / 60);
    const s = actualStartInSeconds % 60;
    const calcTimeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

    timeline.push({
      ...current,
      id: `local_prog_${current.index}`,
      configuredHorario: current.horario,
      horarioCalculado: calcTimeStr,
      startInSeconds: actualStartInSeconds,
      endInSeconds: actualEndInSeconds,
      durationSeconds: current.durationSeconds
    });
  }

  return timeline;
};

// Helper local para encontrar qual transmissão da linha do tempo local está rodando em tempo real (com reprisa cíclica)
const findActiveVideoInTimeline = (timeline: any[]) => {
  if (timeline.length === 0) return null;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentSeconds = now.getSeconds();
  
  const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;

  let activeVideo: any = null;

  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (nowInSeconds >= (item.startInSeconds || 0) && nowInSeconds < (item.endInSeconds || 0)) {
      activeVideo = item;
      break;
    }
  }

  if (!activeVideo) {
    const lastItem = timeline[timeline.length - 1];
    if (nowInSeconds > lastItem.endInSeconds) {
      const totalTimelineDuration = lastItem.endInSeconds - timeline[0].startInSeconds;
      const secSinceTimelineEnd = nowInSeconds - lastItem.endInSeconds;
      const relativeOffsetInSecs = secSinceTimelineEnd % totalTimelineDuration;
      
      const targetSec = timeline[0].startInSeconds + relativeOffsetInSecs;
      for (let i = 0; i < timeline.length; i++) {
        const item = timeline[i];
        if (targetSec >= (item.startInSeconds || 0) && targetSec < (item.endInSeconds || 0)) {
          return { activeVideo: item, seekOffset: targetSec - item.startInSeconds };
        }
      }
    }
    activeVideo = timeline[0];
  }

  if (activeVideo) {
    const seekOffset = Math.max(0, nowInSeconds - (activeVideo.startInSeconds || 0));
    return { activeVideo, seekOffset };
  }

  return null;
};

export default function AoVivoRoute() {
  // Estados para gerenciar o player
  const [currentChannel, setCurrentChannel] = useState<StreamChannel>(CHANNELS[0]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSmartTvMode, setIsSmartTvMode] = useState(false); // Modo Tela Cheia / Theater para Smart TVs
  const [showChat, setShowChat] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isUsingFallback, setIsUsingFallback] = useState(false);

  // Sistema de Recompensa de Sintonia (80% assistido)
  const [videoProgress, setVideoProgress] = useState(0);
  const [claimableCode, setClaimableCode] = useState<string | null>(null);
  const [hasUnlockedReward, setHasUnlockedReward] = useState(false);
  const [copied, setCopied] = useState(false);

  // Configurações do Iframe para Google Drive
  const [useDriveIframe, setUseDriveIframe] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("rpg_sonora_use_drive_iframe");
      return saved === "true"; // Padrão agora é false (usa player nativo MP4 de TV limpo e estético)
    }
    return false;
  });

  // Estados dos Sistemas de Agendamento (Planilha Google & Lista Local)
  const [scriptUrl, setScriptUrl] = useState(() => {
    return localStorage.getItem("rpg_sonora_script_url") || "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";
  });
  const [isGoogleSheetsActive, setIsGoogleSheetsActive] = useState(() => {
    // Default to true so user gets sheets synchronisation out-of-the-box
    const saved = localStorage.getItem("rpg_sonora_use_sheets");
    return saved !== "false"; 
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [sheetsSyncError, setSheetsSyncError] = useState<string | null>(null);
  const [sheetsSyncSuccess, setSheetsSyncSuccess] = useState<boolean>(false);
  const [isDirectorPanelOpen, setIsDirectorPanelOpen] = useState(false);
  const [fullSchedule, setFullSchedule] = useState<any[]>([]);

  // Retorna informações consolidadas do Programa como um todo (agrupando vídeos de mesmo título e horário configurado)
  const getActiveSchedItemAndProgram = useCallback((currentTimeOfDayInSeconds: number) => {
    if (!fullSchedule || fullSchedule.length === 0) return null;

    // Encontra item por horário normal
    let activeSchedItem = fullSchedule.find(item => 
      currentTimeOfDayInSeconds >= (item.startInSeconds || 0) && currentTimeOfDayInSeconds < (item.endInSeconds || 0)
    );

    // Se passou de toda a programação, aplica o cálculo de reprise cíclica idêntico ao do servidor
    if (!activeSchedItem) {
      const lastItem = fullSchedule[fullSchedule.length - 1];
      if (currentTimeOfDayInSeconds > lastItem.endInSeconds) {
        const totalTimelineDuration = lastItem.endInSeconds - fullSchedule[0].startInSeconds;
        const secSinceTimelineEnd = currentTimeOfDayInSeconds - lastItem.endInSeconds;
        const relativeOffsetInSecs = secSinceTimelineEnd % totalTimelineDuration;
        const targetSec = fullSchedule[0].startInSeconds + relativeOffsetInSecs;
        
        activeSchedItem = fullSchedule.find(item => 
          targetSec >= (item.startInSeconds || 0) && targetSec < (item.endInSeconds || 0)
        );
      }
    }

    if (!activeSchedItem) {
      activeSchedItem = fullSchedule[0];
    }

    const currentTitle = (activeSchedItem.titulo || activeSchedItem.title || "").trim().toLowerCase();
    const targetHorario = activeSchedItem.configuredHorario || activeSchedItem.horario;

    // Filtra todas as partes do mesmo programa sintonizadas para o mesmo horário configurado
    const programVideos = fullSchedule.filter(item => 
      String(item.titulo || item.title || "").trim().toLowerCase() === currentTitle &&
      (item.configuredHorario || item.horario) === targetHorario
    );

    const startTimes = programVideos.map(v => v.startInSeconds || 0);
    const endTimes = programVideos.map(v => v.endInSeconds || 0);
    const minStart = Math.min(...startTimes);
    const maxEnd = Math.max(...endTimes);
    const totalDuration = maxEnd - minStart;

    return {
      activeSchedItem,
      programVideos,
      minStart,
      maxEnd,
      totalDuration
    };
  }, [fullSchedule]);

  const [isAdmin] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("admin") === "true";
    }
    return false;
  });
  
  // Estados para integração com Telegram Web App
  const [dynamicLocation, setDynamicLocation] = useState<string>("");
  const [copiedAppUrl, setCopiedAppUrl] = useState(false);
  const [telegramSelectedTab, setTelegramSelectedTab] = useState<"passos" | "mock">("passos");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDynamicLocation(window.location.origin + window.location.pathname);
    }
  }, []);

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

  // Salvar preferência de Iframe no localStorage
  useEffect(() => {
    localStorage.setItem("rpg_sonora_use_drive_iframe", String(useDriveIframe));
  }, [useDriveIframe]);

  // Cronotimer virtual retirado daqui para ser declarado após a inicialização dos métodos agendadores

  // Sincroniza estado de recompensa ao trocar de canal/programa ativo
  useEffect(() => {
    setVideoProgress(0);
    const key = `claim_history_${currentChannel.nowPlaying || currentChannel.name}`;
    const savedCode = localStorage.getItem(key);
    if (savedCode) {
      setClaimableCode(savedCode);
      setHasUnlockedReward(true);
    } else {
      setClaimableCode(null);
      setHasUnlockedReward(false);
    }
  }, [currentChannel]);

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
    // Se for link do Drive e useDriveIframe estiver ativo, o player físico de tag video não é necessário!
    const driveIframeUrl = getDriveIframeUrl(streamUrl);
    if (driveIframeUrl && useDriveIframe) {
      setIsLoading(false);
      setHasError(false);
      setIsPlaying(true);
      setIsUsingFallback(true);
      return;
    }

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

      const onVideoError = () => {
        setIsLoading(false);
        setHasError(true);
        setErrorMessage("Erro de carregamento do vídeo do Google Drive / MP4. Verifique se o link compartilhado no Drive está público ('Qualquer pessoa com o link pode ver') e se a conta do Sheets/Drive não excedeu o limite de requisições do Google.");
      };

      video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
      video.addEventListener("error", onVideoError, { once: true });

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

        if (data && data.status === "success") {
          setSheetsSyncError(null);
          setSheetsSyncSuccess(true);
          
          if (data.fullSchedule) {
            setFullSchedule(data.fullSchedule);
          }
          
          if (data.current) {
            const stream = data.current;
            const finalVideoUrl = convertDriveLinkToDirect(stream.videoUrl);
            const driveIframeUrl = getDriveIframeUrl(stream.videoUrl);
            
            // Para links do Drive, passamos o link original para podermos extrair o ID do iframe no player
            const playerUrl = driveIframeUrl && useDriveIframe ? stream.videoUrl : finalVideoUrl;

            // Sintonizar a transmissão retornada pela planilha com o offset calculado pelo Google Script
            setCurrentChannel({
              id: "sheets_active",
              name: stream.title || "Canal Planilha",
              url: playerUrl,
              fallbackUrl: finalVideoUrl,
              nowPlaying: stream.nowPlaying || "Música em Transmissão",
              genre: stream.description || "Programação Ordenada",
              buffBoost: stream.buff || "Sem Buff Ativo",
              durationSeconds: parseInt(stream.durationSeconds || "600", 10),
              seekOffset: stream.seekOffset || 0
            });

            // Sintoniza com o offset no player de vídeo
            initPlayer(playerUrl, false, stream.seekOffset || 0);

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
          setSheetsSyncError(data.message || "Script retornou status de resposta malformado");
          setSheetsSyncSuccess(false);
          calculateLocalSchedule(isManualRefresh);
        }
      } catch (err: any) {
        console.error("Erro ao sincronizar com Google Sheets. Usando grade local.", err);
        setSheetsSyncError(err?.toString() || "Erro de conexão ao acessar o Google Apps Script. Verifique permissões/CORS.");
        setSheetsSyncSuccess(false);
        calculateLocalSchedule(isManualRefresh);
        if (isManualRefresh) {
          setMessages(prev => [
            ...prev,
            {
              id: Math.random().toString(),
              sender: "Erro_Guilda",
              role: "mod",
              text: "⚠️ Falha ao ler a Planilha Google (verifique se publicou o script como Web App público, 'Qualquer pessoa'). Usando grade de emergência!",
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
  }, [isGoogleSheetsActive, scriptUrl, localProgramList, initPlayer, useDriveIframe]);

  // Lógica local para decidir qual vídeo da lista local rodar com base no horário real de Brasília
  const calculateLocalSchedule = useCallback((isManualRefresh: boolean = false) => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSeconds = now.getSeconds();
    
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

    // Constrói linha do tempo enfileirando durações idênticamente ao Google Script!
    const timeline = buildLocalTimeline(localProgramList);
    setFullSchedule(timeline);

    const activeResult = findActiveVideoInTimeline(timeline);
    if (activeResult) {
      const { activeVideo, seekOffset } = activeResult;

      const originalUrl = activeVideo.link_drive || "";
      const directUrl = convertDriveLinkToDirect(originalUrl);
      const driveIframeUrl = getDriveIframeUrl(originalUrl);
      const playerUrl = driveIframeUrl && useDriveIframe ? originalUrl : directUrl;

      // Sintoniza
      setCurrentChannel({
        id: `local_active_${activeVideo.index}`,
        name: activeVideo.titulo || "Transmissão Sonora",
        url: playerUrl,
        fallbackUrl: directUrl,
        nowPlaying: activeVideo.musica_atual || "Banda do Bardo",
        genre: activeVideo.descricao || "Grade Local",
        buffBoost: activeVideo.buff_rpg || "+5% MP",
        durationSeconds: activeVideo.durationSeconds,
        seekOffset: seekOffset
      });

      // Passar a URL correta (Iframe ou Direct) e o offset para o player inicializar perfeitamente!
      initPlayer(playerUrl, false, seekOffset);

      if (isManualRefresh) {
        setMessages(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            sender: "Guia_Sonora_BOT",
            role: "bard",
            text: `🎯 Sintonizado via Grade Local! Tocando: ${activeVideo.titulo} com ${Math.round(seekOffset / 60)}m de exibição decorrida em tempo real.`,
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            guild: "Sintonia"
          }
        ]);
      }
    }
  }, [localProgramList, initPlayer, useDriveIframe]);

  // Cronômetro virtual de progresso para quando o player de Iframe do Google Drive estiver ativo
  useEffect(() => {
    const driveIframeUrl = getDriveIframeUrl(currentChannel.url);
    const isGoogleDriveLink = !!driveIframeUrl;

    if (isGoogleDriveLink && useDriveIframe && isPlaying) {
      // Duração em segundos recomendada do vídeo: usamos a informada pelo canal ou fallback de 15 minutos (900s) para grandes playlists
      const duration = currentChannel.durationSeconds || 900;
      
      // Começamos o progresso com base na minutagem real (seekOffset) sintonizada via VOD-to-Live!
      const initialSeconds = currentChannel.seekOffset || 0;
      let elapsedSeconds = initialSeconds;

      const interval = setInterval(() => {
        elapsedSeconds += 1;

        // Se o vídeo atual terminou, dispara automaticamente a transição para o próximo da fila!
        if (elapsedSeconds >= duration) {
          console.log("[Virtual Timer] Vídeo finalizado. Sincronizando próximo da fila...");
          clearInterval(interval);
          syncScheduledTransmission(false);
          return;
        }

        // Calcula a hora do dia atual para buscar a consolidação do programa
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentSeconds = now.getSeconds();
        const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;

        const progInfo = getActiveSchedItemAndProgram(nowInSeconds);
        if (progInfo && progInfo.programVideos.length > 1) {
          // Há mais de um vídeo para o mesmo programa!
          // Calculamos o início acumulativo deste vídeo do programa
          const videoStartInProg = (progInfo.activeSchedItem.startInSeconds || 0) - progInfo.minStart;
          const elapsedInProg = videoStartInProg + Math.min(elapsedSeconds, duration);
          const pct = (elapsedInProg / progInfo.totalDuration) * 100;
          setVideoProgress(Math.min(pct, 100));

          if (pct >= 80 && !hasUnlockedReward) {
            const randomNum = Math.floor(1000000 + Math.random() * 9000000);
            const code = `EMP-${randomNum}`;
            setClaimableCode(code);
            setHasUnlockedReward(true);

            try {
              const key = `claim_history_${currentChannel.nowPlaying || currentChannel.name}`;
              localStorage.setItem(key, code);
            } catch (err) {}
          }
        } else {
          // Programa de vídeo único, usa o cálculo clássico
          const pct = (elapsedSeconds / duration) * 100;
          setVideoProgress(Math.min(pct, 100));

          if (pct >= 80 && !hasUnlockedReward) {
            const randomNum = Math.floor(1000000 + Math.random() * 9000000);
            const code = `EMP-${randomNum}`;
            setClaimableCode(code);
            setHasUnlockedReward(true);

            try {
              const key = `claim_history_${currentChannel.nowPlaying || currentChannel.name}`;
              localStorage.setItem(key, code);
            } catch (err) {}
          }
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [
    currentChannel.url, 
    useDriveIframe, 
    isPlaying, 
    currentChannel.durationSeconds, 
    currentChannel.seekOffset, 
    hasUnlockedReward, 
    getActiveSchedItemAndProgram, 
    syncScheduledTransmission
  ]);

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
    const driveIframeUrl = getDriveIframeUrl(currentChannel.url);
    const isGoogleDriveLink = !!driveIframeUrl;

    if (isGoogleDriveLink && useDriveIframe) {
      // Para o iframe do Drive, alternamos o estado de reprodução para guiar o timer do progresso de loot virtual
      setIsPlaying(!isPlaying);
      return;
    }

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
      
      {/* 1. Header do EMPIRE TV (Sutil e Elegante) */}
      {!isSmartTvMode && (
        <header className="border-b border-border bg-card/40 backdrop-blur-md sticky top-0 z-40 px-4 py-3 flex items-center justify-between transition-all">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-primary/20 border border-primary/40 text-primary">
                <Tv2 className="w-5 h-5 animate-pulse" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-black tracking-wider text-white">
                  EMPIRE TV
                </h1>
                <p className="text-[10px] font-mono text-primary font-bold uppercase tracking-widest truncate max-w-[200px]" title={currentChannel.name}>
                  🟢 {currentChannel.name}
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

            {/* Painel do Diretor - Controle de Sincronia discreto (Apenas visível se for admin) */}
            {isAdmin && (
              <button 
                onClick={() => setIsDirectorPanelOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#1d1e3d] hover:border-zinc-700 bg-[#161a2b] text-zinc-300 hover:text-white transition-all cursor-pointer shadow-lg hover:shadow-primary/15"
                title="Painel do Diretor (Configuração de Planilha e Integração)"
              >
                <Settings className="w-4 h-4 text-[#229ED9]" />
                <span className="hidden md:inline font-mono">Sincronia ⚙️</span>
              </button>
            )}
          </div>
        </header>
      )}

      {/* Faixa de Alerta - Conexão com Script do Usuário ou Script Padrão (Apenas visível se for admin) */}
      {isAdmin && !isSmartTvMode && isGoogleSheetsActive && scriptUrl.includes("AKfycby7OeFYuai1QoTEXD427-Kn") && (
        <div className="bg-[#1e140d]/80 border-b border-amber-500/20 px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between text-xs text-amber-200/95 gap-3 transition-all animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            <span>
              <strong>📡 Sinal modo Demonstração:</strong> Você está vendo a programação de simulação. Clique no botão ao lado ou na engrenagem de <strong>Sincronia ⚙️</strong> para salvar o link do seu próprio <strong>Google Apps Script</strong> e sintonizar os vídeos da sua planilha!
            </span>
          </div>
          <button 
            onClick={() => setIsDirectorPanelOpen(true)}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold uppercase rounded-lg text-[10px] cursor-pointer transition-all hover:scale-105 active:scale-95 shrink-0 animate-pulse"
          >
            Configurar Planilha ⚙️
          </button>
        </div>
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
            {/* Player de Vídeo clássico de mídias ou Iframe integrado do Google Drive */}
            {getDriveIframeUrl(currentChannel.url) && useDriveIframe ? (
              <iframe
                id="drive-iframe-player"
                src={`${getDriveIframeUrl(currentChannel.url)}${getDriveIframeUrl(currentChannel.url).includes("?") ? "&" : "?"}autoplay=1&mute=${isMuted ? 1 : 0}`}
                className={`w-full h-full border-0 absolute inset-0 bg-black ${isSmartTvMode ? "h-screen" : "aspect-video"}`}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                referrerPolicy="no-referrer"
              />
            ) : (
              <video
                ref={videoRef}
                className={`w-full h-full object-contain ${isSmartTvMode ? "h-screen" : "aspect-video"}`}
                playsInline
                autoPlay
                muted={isMuted}
                onClick={togglePlay}
                onTimeUpdate={(e) => {
                  const video = e.currentTarget;
                  if (video.duration && video.duration > 0) {
                    const now = new Date();
                    const currentHour = now.getHours();
                    const currentMinute = now.getMinutes();
                    const currentSeconds = now.getSeconds();
                    const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;

                    const progInfo = getActiveSchedItemAndProgram(nowInSeconds);
                    if (progInfo && progInfo.programVideos.length > 1) {
                      const videoStartInProg = (progInfo.activeSchedItem.startInSeconds || 0) - progInfo.minStart;
                      const elapsedInProg = videoStartInProg + Math.min(video.currentTime, video.duration);
                      const pct = (elapsedInProg / progInfo.totalDuration) * 100;
                      setVideoProgress(Math.min(pct, 100));

                      if (pct >= 80 && !hasUnlockedReward) {
                        const randomNum = Math.floor(1000000 + Math.random() * 9000000);
                        const code = `EMP-${randomNum}`;
                        setClaimableCode(code);
                        setHasUnlockedReward(true);
                        
                        try {
                          const key = `claim_history_${currentChannel.nowPlaying || currentChannel.name}`;
                          localStorage.setItem(key, code);
                        } catch(err) {}
                      }
                    } else {
                      const pct = (video.currentTime / video.duration) * 100;
                      setVideoProgress(pct);
                      
                      if (pct >= 80 && !hasUnlockedReward) {
                        const randomNum = Math.floor(1000000 + Math.random() * 9000000);
                        const code = `EMP-${randomNum}`;
                        setClaimableCode(code);
                        setHasUnlockedReward(true);
                        
                        try {
                          const key = `claim_history_${currentChannel.nowPlaying || currentChannel.name}`;
                          localStorage.setItem(key, code);
                        } catch(err) {}
                      }
                    }
                  }
                }}
                onEnded={() => {
                  console.log("[Video Player] Vídeo finalizado. Sincronizando próximo da fila...");
                  syncScheduledTransmission(false);
                }}
              />
            )}

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
                  className="mt-4 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-mono font-bold transition-all cursor-pointer"
                >
                  TENTAR RECONECTAR
                </button>
              </div>
            )}

            {/* Overlay de Clique para Jogar/Play (Garante sintonia mesmo com autoplay bloqueado pelo navegador) */}
            {!isPlaying && !isLoading && !hasError && (
              <div 
                onClick={togglePlay}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70 hover:bg-black/55 transition-colors cursor-pointer group"
              >
                <div className="p-5 bg-primary/95 hover:bg-primary text-white rounded-full transition-all group-hover:scale-110 active:scale-95 shadow-2xl shadow-primary/40 flex items-center justify-center animate-bounce">
                  <Play className="w-8 h-8 fill-current" />
                </div>
                <p className="text-sm font-semibold text-white mt-4 font-mono uppercase tracking-wider text-center px-4 drop-shadow">
                  Clique para iniciar a sintonia e coletar loot de RPG!
                </p>
                <p className="text-[10px] text-zinc-400 mt-1.5 font-mono">
                  Seu progresso de visualização começará a contar automaticamente
                </p>
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

            {/* Aviso de Transmissão Silenciada com Autoplay Ativo */}
            {isMuted && isPlaying && !isLoading && !hasError && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold font-sans text-xs px-3 py-1.5 rounded-full shadow-lg border border-amber-400 transition-all cursor-pointer hover:scale-105 active:scale-95 animate-pulse"
              >
                <VolumeX className="w-4 h-4 text-black animate-bounce" />
                <span>🔇 Transmissão Ativa (Toque p/ Ouvir Som) 🔊</span>
              </button>
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
                  {/* Badge de sinal ativo da planilha */}
                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-mono">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
                    <span>SINAL PLANILHA ONLINE</span>
                  </div>

                  {/* Tela Cheia Nativa */}
                  <button 
                    onClick={toggleFullscreen}
                    className="p-5 text-gray-300 hover:text-white transition-all cursor-pointer"
                    title="Tela Cheia"
                  >
                    <Maximize className="w-5 h-5" />
                  </button>
                </div>
              </div>

            </div>

          </div>

          {/* Caixa de Diagnóstico e Compatibilidade de Google Drive (Sintonia Iframe Inteligente - Visível apenas para o Admin) */}
          {isAdmin && getDriveIframeUrl(currentChannel.url) && !isSmartTvMode && (
            <div className="bg-[#0f111e]/90 border border-primary/20 backdrop-blur-md p-3.5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 text-xs w-full shadow-lg shadow-primary/5 transition-all text-left">
              <div className="flex items-start gap-2.5">
                <div className="p-2.5 bg-primary/10 border border-primary/20 text-primary rounded-xl shrink-0">
                  <Tv className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="font-bold text-white flex items-center gap-1.5 font-display text-[13px]">
                    🛡️ Assistindo via Modo Compatibilidade do Google Drive
                  </h4>
                  <p className="text-zinc-400 text-[11px] leading-relaxed mt-0.5">
                    Seu arquivo de vídeo é sintonizado via <strong>Player Oficial do Google Drive (Iframe)</strong>. Ele evita o aviso de vírus de arquivos grandes (&gt;100MB) de forma gratuita! Seu bônus de loot continua contando em segundo plano!
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-[10px] bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1 text-zinc-300 font-bold">
                  {useDriveIframe ? "Iframe do Drive Ativo" : "Nativo MP4 (Download)"}
                </span>
                <button
                  onClick={() => setUseDriveIframe(!useDriveIframe)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-lg font-mono text-[10px] uppercase cursor-pointer transition-all active:scale-95 shadow-md shadow-amber-500/10 hover:scale-105"
                >
                  {useDriveIframe ? "Mudar p/ Nativo" : "Ativar Modo Iframe"}
                </button>
              </div>
            </div>
          )}

          {/* Dados do Canal Abaixo do Player */}
          {!isSmartTvMode && (
            <div className="flex flex-col gap-4">
              <div className="bg-card border border-border p-4 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="font-mono text-xs text-primary font-bold tracking-wider uppercase">
                      Programa Atual: {currentChannel.genre}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold font-display tracking-tight text-white mb-1">
                    {currentChannel.name}
                  </h2>
                </div>
              </div>

              {/* Novo Sistema de Recompensa RPG (80% assistido) */}
              <div className="relative overflow-hidden bg-gradient-to-r from-card to-card/90 border border-border rounded-2xl p-5 shadow-lg">
                <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className={`p-3 rounded-xl flex items-center justify-center transition-all ${
                      hasUnlockedReward 
                        ? "bg-amber-500/20 border border-amber-500/40 text-amber-400 animate-pulse shadow-lg shadow-amber-500/10" 
                        : "bg-zinc-800/80 border border-border text-zinc-400"
                    }`}>
                      {hasUnlockedReward ? <Gift className="w-6 h-6 animate-bounce" /> : <Lock className="w-5 h-5 z-10" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
                        {hasUnlockedReward ? "🎉 Recompensa de Sintonia Disponível!" : "🎁 Vem pegar seu extra"}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {hasUnlockedReward 
                          ? "Você sintonizou a rádio por bastante tempo e desbloqueou seu loot lendário!" 
                          : (() => {
                              const now = new Date();
                              const currentHour = now.getHours();
                              const currentMinute = now.getMinutes();
                              const currentSeconds = now.getSeconds();
                              const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;
                              const progInfo = getActiveSchedItemAndProgram(nowInSeconds);
                              if (progInfo && progInfo.programVideos.length > 1) {
                                return `Assista pelo menos 80% do programa total (${progInfo.programVideos.length} vídeos agrupados) para liberar seu bônus de sintonismo.`;
                              }
                              return "Assista pelo menos 80% da transmissão ativa para liberar seu código especial de recompensa.";
                            })()}
                      </p>
                    </div>
                  </div>

                  {/* Mostrador do Progresso ou do Código */}
                  <div className="min-w-[180px] flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                      <span>{hasUnlockedReward ? "Código Disponível" : "Progresso"}</span>
                      <span className="font-bold text-foreground">
                        {videoProgress.toFixed(0)}% / 80%
                      </span>
                    </div>

                    {/* Barra de Progresso */}
                    <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden border border-border p-[1px]">
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${
                          hasUnlockedReward 
                            ? "bg-gradient-to-r from-amber-500 to-yellow-400 animate-pulse" 
                            : "bg-primary"
                        }`}
                        style={{ width: `${Math.min((videoProgress / 80) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Exibição do Código Desbloqueado */}
                {hasUnlockedReward && claimableCode && (
                  <div className="mt-4 pt-4 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 bg-amber-500/5 -mx-5 -mb-5 p-5 rounded-b-2xl border-amber-500/10">
                    <div className="flex items-center gap-2.5">
                      <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded text-[10px] uppercase font-mono font-bold tracking-wider">
                        LOOT EXCLUSIVO
                      </span>
                      <div className="text-sm font-mono font-bold tracking-widest text-amber-300 bg-black/45 px-3 py-1.5 rounded-xl border border-amber-500/25 select-all">
                        {claimableCode}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        try {
                          navigator.clipboard.writeText(claimableCode);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch(err) {
                          alert(`Código: ${claimableCode}`);
                        }
                      }}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold font-mono text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-500/20 hover:scale-105 active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copied ? "Copiado! 📋" : "Copiar Código"}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

      </main>

      {/* 3. MODAL DE CONFIGURAÇÃO DO DIRETOR (SÓ ABRE QUANDO CLICADO NO BOTÃO SINC DA DIRETORIA E SE FOR ADMIN) */}
      {isAdmin && isDirectorPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <section className="bg-[#0b0c16] border border-[#1d1e3d] rounded-3xl p-6 shadow-2xl relative max-w-xl w-full text-left font-sans animate-in fade-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh]">
            <div className="bg-card p-2 relative overflow-hidden">
              {/* Botão Fechar Modal */}
              <button 
                onClick={() => setIsDirectorPanelOpen(false)}
                className="absolute top-2 right-2 z-10 text-zinc-400 hover:text-white p-1.5 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-secondary/5 rounded-full blur-3xl pointer-events-none" />

            {/* Cabeçalho do Painel */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/20 border border-primary/30 rounded-xl text-primary font-bold">
                  <Settings className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white font-display">
                    ⚙️ Sincronização & Central de Controle Empire
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Sua transmissão de TV é totalmente automatizada a partir da planilha. Configure o sinal e acesse o guia de colunas abaixo.
                  </p>
                </div>
              </div>

              {/* Botão de força-sincronia */}
              <div className="flex items-center gap-2 font-mono">
                <button
                  onClick={() => syncScheduledTransmission(true)}
                  disabled={isSyncing}
                  className="px-5 py-2.5 text-xs font-bold rounded-xl cursor-pointer bg-primary text-white hover:bg-primary-hover active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-primary/20"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
                  <span>{isSyncing ? "Sincronizando..." : "Sincronizar Planilha Agora"}</span>
                </button>
              </div>
            </div>

            {/* Configurações de Transmissão por Planilha e Telegram */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

              {/* Bloco do Integrador Planilha Google */}
              <div className="bg-muted/45 border border-[#1d1e3d] p-5 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2.5 mb-3">
                    <Database className="text-primary w-5 h-5 animate-pulse" />
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-gray-200">
                      Sincronização Ativa da Planilha (Google Apps Script)
                    </h4>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4 leading-relaxed font-sans">
                    Insira o link gerado após hospedar e publicar o seu <strong>Google Apps Script</strong> (Web App). O sistema lerá os vídeos, horários e títulos agendados em tempo real de forma síncrona:
                  </p>

                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-mono text-muted-foreground uppercase">Link do Web App:</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://script.google.com/macros/s/.../exec"
                        value={scriptUrl}
                        onChange={(e) => {
                          setScriptUrl(e.target.value);
                          localStorage.setItem("rpg_sonora_script_url", e.target.value);
                        }}
                        className="flex-1 bg-zinc-900/95 text-xs rounded-xl px-3.5 py-2.5 border border-border focus:border-primary text-white outline-none font-mono"
                      />
                      <button
                        onClick={() => {
                          localStorage.setItem("rpg_sonora_script_url", scriptUrl);
                          setMessages(prev => [
                            ...prev,
                            {
                              id: Math.random().toString(),
                              sender: "Empire_System",
                              role: "mod",
                              text: "💾 Endpoint de sincronização salvo! Atualizando canais e tocando programação...",
                              timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                              guild: "Sistema"
                            }
                          ]);
                          syncScheduledTransmission(true);
                        }}
                        className="px-4 bg-zinc-805 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold border border-border cursor-pointer transition-all hover:scale-105 active:scale-95"
                      >
                        Salvar
                      </button>
                    </div>

                    {/* Exibe status da última sincronia com o Sheets */}
                    <div className="mt-2 text-[11px] font-mono">
                      {isSyncing ? (
                        <div className="text-zinc-400 flex items-center gap-1.5 animate-pulse">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Consultando sinal do servidor da Planilha...</span>
                        </div>
                      ) : sheetsSyncError ? (
                        <div className="text-red-400 bg-red-950/20 border border-red-900/40 rounded-lg p-2.5 flex items-start gap-1.5">
                          <span className="shrink-0 mt-0.5">⚠️</span>
                          <span className="leading-snug">
                            <strong>Erro de Sinal:</strong> {sheetsSyncError}. <br />
                            <span className="text-[10.5px] text-zinc-400 leading-normal block mt-1">
                              Isso geralmente ocorre por CORS ou se a URL do Script está incorreta. Publique o Apps Script clicando no botão <strong>Implantar &gt; Nova Implantação &gt; Tipo: Web App (Executar como: Mim / Quem tem acesso: Qualquer pessoa)</strong>.
                            </span>
                          </span>
                        </div>
                      ) : sheetsSyncSuccess ? (
                        <div className="text-emerald-400 bg-emerald-950/20 border border-emerald-950/35 rounded-lg p-2.5 flex items-center gap-2">
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                          <span>📶 Conexão de Sinal sintonizada e ativa com sucesso!</span>
                        </div>
                      ) : (
                        <div className="text-zinc-500 text-[10px] italic">
                          Frequência em monitoramento. Aguardando comando ou troca agendada de horas.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info Box */}
                <div className="mt-4 p-3.5 bg-primary/5 border border-primary/20 rounded-xl flex flex-col gap-2.5 text-xs">
                  <div className="flex items-start gap-2 text-left">
                    <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div className="text-muted-foreground space-y-1.5">
                      <p>
                        ⚔️ <strong>Configuração da Planilha:</strong> Certifique-se de que a sua planilha possua uma aba renomeada exatamente como <code className="text-primary font-mono select-all">Programacao_RPG</code>.
                      </p>
                      <p>
                        💾 O código Apps Script completo para implantar está no arquivo <code className="text-white select-all font-bold">/google-apps-script.js</code> do seu projeto. Lembre-se de publicar o script como <strong>Web App (Executar como: Você / Quem tem acesso: Qualquer um)</strong> para evitar bloqueios de CORS!
                      </p>
                    </div>
                  </div>

                  {/* Alerta de Vídeo do Google Drive com Nova Tecnologia Iframe */}
                  <div className="border-t border-border/60 pt-3 mt-1.5 text-[11.5px] text-amber-200/90 leading-relaxed text-left space-y-1.5">
                    <p className="font-bold uppercase text-amber-400 flex items-center gap-1.5">
                      ⚔️ NOVIDADE: ASSISTA FILMES GRANDES DE GRAÇA!
                    </p>
                    <p>
                      Com o novo <strong>Modo Compatibilidade Iframe do Google Drive</strong>, arquivos maiores que 100MB são assistidos sem restrições de antivírus, de graça e sem custos adicionais!
                    </p>
                    <p>
                      O player detecta o formato automaticamente. Apenas certifique-se de definir o compartilhamento do vídeo no Drive para: <strong>"Qualquer pessoa com o link pode ver"</strong>!
                    </p>
                  </div>
                </div>
              </div>

              {/* Bloco de Integração com Telegram Web App */}
              <div className="bg-muted/45 border border-[#1d1e3d] p-5 rounded-2xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <Send className="text-[#229ED9] w-5 h-5" />
                      <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-gray-200">
                        Hospedar como Telegram Web App (Mini App)
                      </h4>
                    </div>
                    
                    {/* Tabs do Telegram */}
                    <div className="flex bg-zinc-900 border border-border p-0.5 rounded-lg text-[10px]">
                      <button
                        onClick={() => setTelegramSelectedTab("passos")}
                        className={`px-2 py-1 rounded font-mono font-bold cursor-pointer transition-all ${
                          telegramSelectedTab === "passos" 
                            ? "bg-[#229ED9] text-white" 
                            : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        Passos
                      </button>
                      <button
                        onClick={() => setTelegramSelectedTab("mock")}
                        className={`px-2 py-1 rounded font-mono font-bold cursor-pointer transition-all ${
                          telegramSelectedTab === "mock" 
                            ? "bg-[#229ED9] text-white" 
                            : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        Simulador
                      </button>
                    </div>
                  </div>

                  {telegramSelectedTab === "passos" ? (
                    <div className="space-y-3.5 text-xs text-left">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Qualquer pessoa pode sintonizar sua TV/Rádio do Empire diretamente **dentro do próprio aplicativo do Telegram**! Siga o tutorial abaixo para linkar este app ao seu bot:
                      </p>

                      <div className="space-y-2 border-l border-[#229ED9]/30 pl-3">
                        <div className="relative">
                          <span className="absolute -left-[19.5px] top-0.5 w-3 h-3 rounded-full bg-[#229ED9] border border-black" />
                          <p className="font-bold text-white text-[11px]">1. Criar o Robô no BotFather</p>
                          <p className="text-muted-foreground text-[10.5px]">Abra o Telegram, busque por <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-[#229ED9] hover:underline">@BotFather</a> e envie <code className="bg-black/50 px-1 py-0.5 rounded text-amber-400 text-[10px]">/newbot</code> para criar seu robô.</p>
                        </div>

                        <div className="relative pt-1">
                          <span className="absolute -left-[19.5px] top-1.5 w-3 h-3 rounded-full bg-[#229ED9] border border-black" />
                          <p className="font-bold text-white text-[11px]">2. Criar mini-aplicativo</p>
                          <p className="text-muted-foreground text-[10.5px]">Envie o comando <code className="bg-black/50 px-1 py-0.5 rounded text-amber-400 text-[10px]">/newapp</code> para associar um Mini App ao bot recém-criado.</p>
                        </div>

                        <div className="relative pt-1">
                          <span className="absolute -left-[19.5px] top-1.5 w-3 h-3 rounded-full bg-[#229ED9] border border-black" />
                          <p className="font-bold text-white text-[11px]">3. Linkar a URL do Web App</p>
                          <p className="text-muted-foreground text-[10.5px]">Quando o BotFather pedir a **Web App URL**, use este link abaixo:</p>
                          
                          {/* Campo de link do projeto */}
                          <div className="flex gap-2 mt-1.5">
                            <input
                              type="text"
                              readOnly
                              value={dynamicLocation || "https://carregando-link..."}
                              className="flex-1 bg-zinc-900/95 text-[10.5px] rounded-lg px-2.5 py-1.5 border border-border text-[#229ED9] outline-none font-mono select-all"
                            />
                            <button
                              onClick={() => {
                                try {
                                  navigator.clipboard.writeText(dynamicLocation);
                                  setCopiedAppUrl(true);
                                  setTimeout(() => setCopiedAppUrl(false), 2000);
                                } catch(err) {
                                  alert(dynamicLocation);
                                }
                              }}
                              className="px-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-[10px] font-bold border border-border cursor-pointer transition-all shrink-0 active:scale-95"
                            >
                              {copiedAppUrl ? "Copiado!" : "Copiar"}
                            </button>
                          </div>
                        </div>

                        <div className="relative pt-1">
                          <span className="absolute -left-[19.5px] top-1.5 w-3 h-3 rounded-full bg-[#229ED9] border border-black" />
                          <p className="font-bold text-white text-[11px]">4. Definir Link Curto</p>
                          <p className="text-muted-foreground text-[10.5px]">Crie o apelido de chamada (ex: <code className="text-amber-400 text-[10px]">aovivo</code>). Pronto! Você receberá o link para compartilhar no clã (<code className="text-[#229ED9] text-[10px] font-bold">t.me/SeuBot/aovivo</code>).</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Mockup de Telefone Simulando o Telegram Web App */
                    <div className="flex flex-col items-center py-2">
                      <div className="w-full max-w-[280px] bg-[#17212b] rounded-2xl border-4 border-slate-700 overflow-hidden shadow-2xl text-left font-sans">
                        
                        {/* Telegram Header */}
                        <div className="bg-[#24303f] p-2.5 border-b border-zinc-900 flex items-center justify-between text-xs text-white">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-[#229ED9] flex items-center justify-center font-bold text-[10px] text-white">
                              ETV
                            </div>
                            <div>
                              <div className="font-bold text-[11px] leading-tight">Empire TV Bot</div>
                              <div className="text-[9px] text-[#229ED9] leading-tight">bot</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-zinc-400 text-[11px]">
                            <span>•••</span>
                          </div>
                        </div>

                        {/* Telegram Chat Area */}
                        <div className="p-3 space-y-3 min-h-[140px] bg-[#17212b] relative text-[10px] flex flex-col justify-between">
                          {/* Mensagem do Bot */}
                          <div className="p-2.5 bg-[#182533] border border-zinc-800 rounded-xl text-white max-w-[85%] space-y-1">
                            <p className="font-bold text-[#4495e8] text-[9.5px]">⚔️ Aliança Empire TV</p>
                            <p className="text-zinc-350 leading-relaxed text-[10px]">
                              Saudações, Nobre Guerreiro! Clique no botão abaixo para sintonizar a transmissão do clã com buffs ativos de RPG ao vivo!
                            </p>
                          </div>

                          {/* Botão de abrir Web App no chat */}
                          <div className="flex justify-start">
                            <button className="flex items-center gap-2 px-4 py-2 bg-[#4295e8] hover:bg-[#348ae6] text-white font-bold text-[10px] rounded-lg shadow-lg shadow-black/35 animate-bounce transition-all">
                              <Tv className="w-3.5 h-3.5 animate-pulse" />
                              <span>🎮 Assistir TV Empire</span>
                            </button>
                          </div>
                        </div>

                        {/* Footer simulado */}
                        <div className="bg-[#24303f] p-2 border-t border-zinc-900 flex items-center justify-center text-[9px] text-zinc-400">
                          Integração Oficial com Telegram Mini Apps
                        </div>

                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 p-2.5 bg-sky-500/5 border border-sky-500/10 rounded-xl flex items-center gap-2.5 text-[11px]">
                  <Send className="w-4 h-4 text-[#229ED9] shrink-0" />
                  <span className="text-zinc-400 text-left">O player deste projeto é 100% responsivo e se encaixa perfeitamente na janela nativa do Telegram!</span>
                </div>
              </div>

            </div>

            {/* Informação sobre a realocação do Guia para a planilha */}
            <div className="mt-5 border-t border-[#1d1e3d] pt-4 text-center">
              <p className="text-[10.5px] text-zinc-400 font-mono">
                💡 Toda a documentação e instruções das colunas agora foram integradas no seu Sheets (aba <code className="text-[#229ED9] font-bold">Manual_Empire_TV</code>) gerada pelo script!
              </p>
            </div>

          </div>
        </section>
      </div>
      )}

    </div>
  );
}
