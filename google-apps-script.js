/**
 * RPG MUSICAL - SISTEMA DE PROGRAMAÇÃO AUTOMÁTICA (VOD-to-Live)
 * Código completo para colar no Editor do Google Apps Script (script.google.com)
 * 
 * Este script conecta uma Planilha Google contendo sua grade de horários de vídeos do Google Drive 
 * e fornece uma API segura para o seu Web Player reproduzir no horário exato de forma sincronizada!
 */

// Chave ou ID da Planilha que controla os horários. Se deixar vazio, o script usará a planilha ativa
const SPREADSHEET_ID = ""; 

/**
 * Função principal para responder Requisições HTTP GET da aplicação
 */
function doGet(e) {
  try {
    const sheet = getProgramSheet();
    const rows = sheet.getDataRange().getValues();
    
    // Se a planilha estiver vazia, cria uma estrutura de exemplo para facilitar a vida do usuário
    if (rows.length <= 1) {
      initializeExampleData(sheet);
      return createJsonResponse({
        status: "ok",
        message: "Planilha inicializada com dados de exemplo! Por favor, recarregue para ver os dados coordenados.",
        channels: []
      });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    
    // Converte as linhas da planilha em uma lista estruturada de programação de vídeos
    const schedule = dataRows.map((row, index) => {
      const item = {};
      headers.forEach((header, colIndex) => {
        const key = String(header).trim().toLowerCase();
        item[key] = row[colIndex];
      });
      item.id = "prog_" + (index + 1);
      return item;
    });

    // Detecta qual vídeo deve estar transmitindo AGORA com base no dia e hora atual do servidor
    const currentTransmission = findCurrentVideo(schedule);

    return createJsonResponse({
      status: "success",
      timestamp: new Date().toISOString(),
      current: currentTransmission,
      fullSchedule: schedule
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: error.toString()
    });
  }
}

/**
 * Encontra o vídeo que deve estar rodando exatamente neste momento
 */
function findCurrentVideo(schedule) {
  const now = new Date();
  
  // Ajuste para Horário de Brasília (BR-3) se a planilha for operada no Brasil
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const currentDayOfWeek = localTime.getDay(); // 0 (Domingo) a 6 (Sábado)
  const currentHour = localTime.getHours();
  const currentMinute = localTime.getMinutes();
  const currentSeconds = localTime.getSeconds();
  
  // Total de segundos decorridos desde a meia-noite
  const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;

  // Dias da semana mapeados
  const dayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const currentDayName = dayNames[currentDayOfWeek];
  
  // 1. Filtrar programação do dia de hoje (ou configurado como "todos" os dias)
  const todaysSchedule = schedule.filter(item => {
    const dayConfig = String(item["dia"] || "").toLowerCase().trim();
    return dayConfig === "todos" || dayConfig === currentDayName || dayConfig.includes(currentDayName);
  });

  if (todaysSchedule.length === 0) {
    return {
      status: "offline",
      message: "Nenhuma transmissão programada para o dia de hoje.",
      videoUrl: ""
    };
  }

  // Ordenar transmissões por hora de início (convertendo de HH:MM para segundos)
  const sortedRuns = todaysSchedule.map(item => {
    const timeStr = String(item["horario"] || "00:00").trim();
    const parts = timeStr.split(":");
    const hours = parseInt(parts[0] || "0", 10);
    const minutes = parseInt(parts[1] || "0", 10);
    const startInSeconds = (hours * 3600) + (minutes * 60);
    
    // Obter URL direta do Google Drive
    const rawDriveUrl = String(item["link_drive"] || "");
    const videoUrl = getDirectDriveUrl(rawDriveUrl);

    return {
      ...item,
      startInSeconds: startInSeconds,
      videoUrl: videoUrl
    };
  }).sort((a, b) => a.startInSeconds - b.startInSeconds);

  // Encontrar o vídeo ativo
  let activeVideo = null;
  for (let i = 0; i < sortedRuns.length; i++) {
    const current = sortedRuns[i];
    const next = sortedRuns[i + 1];
    
    // Se o horário de início for menor ou igual a agora
    if (nowInSeconds >= current.startInSeconds) {
      if (!next || nowInSeconds < next.startInSeconds) {
        activeVideo = current;
        break;
      }
    }
  }

  // Se nenhum vídeo começou ainda no dia de hoje, pega o último do dia anterior ou o primeiro do dia de hoje
  if (!activeVideo && sortedRuns.length > 0) {
    activeVideo = sortedRuns[0]; // Volta para o primeiro vídeo como reprise rotação
  }

  if (activeVideo) {
    // Calcula o offset do vídeo: quantos segundos ele já deveria estar rodando
    const elapsedSeconds = nowInSeconds - activeVideo.startInSeconds;
    // Garante que o offset não seja negativo
    const seekOffset = elapsedSeconds > 0 ? elapsedSeconds : 0;

    return {
      status: "broadcasting",
      title: activeVideo["titulo"] || "Transmissão RPG",
      description: activeVideo["descricao"] || "Grade de programação automática",
      nowPlaying: activeVideo["musica_atual"] || "Tema Épico de Fundo",
      buff: activeVideo["buff_rpg"] || "+5 de EXP passivo",
      videoUrl: activeVideo.videoUrl,
      startedAt: activeVideo["horario"],
      seekOffset: seekOffset,
      isBackup: false
    };
  }

  return {
    status: "rotation",
    title: "Playlist Geral do Bardo",
    description: "Música ambiental padrão de guilda",
    nowPlaying: "Geral Guild Theme",
    buff: "+10% de Regeneração de HP",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    seekOffset: 0,
    isBackup: true
  };
}

/**
 * Converte o link de compartilhamento comum do Google Drive em um stream de link direto para o Player rodar
 */
function getDirectDriveUrl(url) {
  if (!url) return "";
  
  // Se já for link direto, mantém
  if (url.includes("docs.google.com/uc") || url.includes("drive.usercontent.google.com")) {
    return url;
  }

  // Capturar IDs de arquivos do Google Drive
  const regExp = /\/file\/d\/([^\/]+)|\/open\?id=([^\/&]+)|id=([^\/&]+)/;
  const matches = url.match(regExp);
  
  if (matches) {
    const fileId = matches[1] || matches[2] || matches[3];
    if (fileId) {
      // Retorna a URL otimizada do CDN público do Google Drive para reprodução de vídeo nativo
      return "https://docs.google.com/uc?export=download&id=" + fileId;
    }
  }
  
  return url;
}

/**
 * Obtém ou cria a aba correta na planilha
 */
function getProgramSheet() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Programacao_RPG");
  if (!sheet) {
    sheet = ss.insertSheet("Programacao_RPG");
  }
  return sheet;
}

/**
 * Popula a planilha com uma grade padrão fantástica para o usuário não se perder
 */
function initializeExampleData(sheet) {
  const headers = ["Dia", "Horario", "Link_Drive", "Titulo", "Descricao", "Musica_Atual", "Buff_RPG"];
  sheet.appendRow(headers);
  
  const sample1 = [
    "Todos", 
    "00:00", 
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", 
    "Sinfonia da Alvorada Arcana", 
    "Transmissão matinal de ambientação épica para bônus de foco e leitura de magias.", 
    "Town Hall Acoustic Theme", 
    "+15 Resistência Mágica & +10% EXP"
  ];
  const sample2 = [
    "Todos", 
    "12:00", 
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4", 
    "Heavy Beats para PVP / Guild Wars", 
    "Sintonia pesada e ritmada para batalhas intensas de boss do servidor e guerra de castelos.", 
    "Tears of Steel Synthwave Remix", 
    "+10% Chance de Crítico & +20 Ataque"
  ];

  sheet.appendRow(sample1);
  sheet.appendRow(sample2);
  
  // Estilizar planilha para o usuário se sentir em casa
  sheet.getRange(1, 1, 1, 7).setBackground("#8b5cf6").setFontColor("#ffffff").setFontWeight("bold");
  sheet.autoResizeColumns(1, 7);
}

/**
 * Ajuda a construir retornos JSON amigáveis com cabeçalhos de CORS livres para o player ler
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
