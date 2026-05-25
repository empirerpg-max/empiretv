/**
 * RPG MUSICAL - SISTEMA DE PROGRAMAÇÃO AUTOMÁTICA EM COMPACT QUEUE (VOD-to-Live)
 * Código COMPLETO para colar no Editor do Google Apps Script (script.google.com)
 * 
 * Este script conecta uma Planilha Google contendo sua "fila de vídeos" (sem limite de quantidade)
 * e calcula a programação exata em tempo real. Se vários vídeos estiverem marcados com o mesmo 
 * horário, eles serão reproduzidos em sequência (Fila / Queue) empilhando suas durações!
 * 
 * Compatível tanto com o player nativo em React quanto com a automação de transmissão!
 * Agora com sistema de auto-limpeza em tempo real para manter a planilha leve e rápida.
 */

// Chave da Planilha. Deixe em branco se o script estiver vinculado à própria planilha
const SPREADSHEET_ID = ""; 

/**
 * Função receptora de GET requests para servir a grade em tempo real para o player do front-end
 */
function doGet(e) {
  try {
    const sheet = getProgramSheet();
    
    // EXCLUSÃO AUTOMÁTICA ESPONTÂNEA: Limpa da planilha itens já concluídos/antigos para manter rapidez e BUFFER ágil!
    limparProgramasVencidosSet(sheet);

    const rows = sheet.getDataRange().getValues();
    
    if (rows.length <= 1) {
      initializeExampleData(sheet);
      return createJsonResponse({
        status: "ok",
        message: "Planilha de programação inicializada com o novo formato de colunas da TV! Por favor, recarregue o painel.",
        current: null,
        fullSchedule: []
      });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    
    // Converte linhas cruas em objetos estruturados
    const rawSchedule = dataRows.map((row, index) => {
      const item = {};
      headers.forEach((header, colIndex) => {
        const key = String(header).trim().toLowerCase();
        if (key) {
          item[key] = row[colIndex];
        }
      });
      
      // Fallbacks resilientes por mapeamento físico de colunas normais de transmissão
      // Colunas requeridas pela automação e pelo visualizador:
      // Drive_Video_ID, Horario, Status, Programa, Tipo, Material_Tocando, Buff_RPG, Duracao_Segundos
      if (item["drive_video_id"] === undefined && row[0] !== undefined) item["drive_video_id"] = row[0];
      if (item["horario"] === undefined && row[1] !== undefined) item["horario"] = row[1];
      if (item["status"] === undefined && row[2] !== undefined) item["status"] = row[2];
      if (item["programa"] === undefined && row[3] !== undefined) item["programa"] = row[3];
      if (item["tipo"] === undefined && row[4] !== undefined) item["tipo"] = row[4];
      if (item["material_tocando"] === undefined && row[5] !== undefined) item["material_tocando"] = row[5];
      if (item["buff_rpg"] === undefined && row[6] !== undefined) item["buff_rpg"] = row[6];
      if (item["duracao_segundos"] === undefined && row[7] !== undefined) item["duracao_segundos"] = row[7];

      item.id = "prog_" + (index + 2); // Linha física na planilha
      item.rowNum = index + 2;
      return item;
    });

    // Filtra e reconstrói a Linha do Tempo Dinâmica (Fila de Vídeos Sequenciais) baseada no fuso de Brasília
    const activeTimeline = buildActiveTimeline(rawSchedule);
    
    // Detecta qual vídeo da fila deve estar rodando AGORA de acordo com o relógio sincronizado
    const currentTransmission = findActiveVideoInTimeline(activeTimeline);

    // Se o programa mudou ou terminou no tempo real e foi sincronizado, atualiza o status na planilha para Concluido
    atualizarLinhasTransmitidas(sheet, activeTimeline, currentTransmission);

    return createJsonResponse({
      status: "success",
      timestamp: new Date().toISOString(),
      current: currentTransmission,
      fullSchedule: activeTimeline
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: error.toString()
    });
  }
}

/**
 * Monta a linha do tempo enfileirada baseada nos horários agendados.
 * Se múltiplos vídeos tiverem o mesmo horário de início ou conflitos, eles tocam sequencialmente enfileirando as durações!
 */
function buildActiveTimeline(schedule) {
  const now = new Date();
  
  // Ajuste padrão e estável para fuso de Brasília (America/Sao_Paulo)
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const todayFormattedYMD = localTime.getFullYear() + "-" + 
                            String(localTime.getMonth() + 1).padStart(2, "0") + "-" + 
                            String(localTime.getDate()).padStart(2, "0"); 

  // Ordenar itens pelo Horário do agendamento (YYYY-MM-DD HH:MM ou apenas HH:MM)
  const sortedItems = schedule.map(item => {
    let horarioStr = String(item["horario"] || "").trim();
    if (!horarioStr) return null;

    let datePart = todayFormattedYMD;
    let timePart = "00:00";

    // Se o horário inserido já contém data (Ex: YYYY-MM-DD HH:MM)
    if (horarioStr.includes(" ") || horarioStr.includes("-") || horarioStr.includes("/")) {
      const parts = horarioStr.split(" ");
      if (parts.length >= 2) {
        datePart = parts[0].replace(/\//g, "-");
        timePart = parts[1];
      } else {
        // Se for apenas a data, coloca a zero hora
        if (horarioStr.includes("-") || horarioStr.includes("/")) {
          datePart = horarioStr.replace(/\//g, "-");
          timePart = "00:00";
        } else {
          timePart = horarioStr;
        }
      }
    } else {
      timePart = horarioStr;
    }

    const tParts = timePart.split(":");
    const hours = parseInt(tParts[0] || "0", 10);
    const minutes = parseInt(tParts[1] || "0", 10);
    const configuredStartInSeconds = (hours * 3600) + (minutes * 60);

    // Duração customizada (em segundos). Padrão do bardo: 600 segundos (10 minutos)
    let duration = parseInt(item["duracao_segundos"] || "600", 10);
    if (isNaN(duration) || duration <= 0) {
      duration = 600; 
    }

    // Cria as strings de data normalizada
    const scheduledDateTimeStr = datePart + " " + timePart;

    return {
      ...item,
      normalizedDate: datePart,
      normalizedTime: timePart,
      scheduledDateTimeStr: scheduledDateTimeStr,
      configuredStartInSeconds: configuredStartInSeconds,
      durationSeconds: duration
    };
  }).filter(item => item !== null)
    .sort((a, b) => {
      // Ordenação cronológica estrita por data e hora do agendamento
      return a.scheduledDateTimeStr.localeCompare(b.scheduledDateTimeStr);
    });

  // Montar a Fila de Transmissão Contínua (VOD-to-Live)
  const timeline = [];
  let currentTimelineInSeconds = 0;

  for (let i = 0; i < sortedItems.length; i++) {
    const current = sortedItems[i];
    
    // Calcula o início real estimado na timeline
    let actualStartInSeconds = current.configuredStartInSeconds;
    if (actualStartInSeconds < currentTimelineInSeconds) {
      // Se acumular por causa do atraso/duração do vídeo anterior na fila, emenda logo em seguida!
      actualStartInSeconds = currentTimelineInSeconds;
    }

    const actualEndInSeconds = actualStartInSeconds + current.durationSeconds;
    
    // Atualiza o ponteiro do fim da fila do player
    currentTimelineInSeconds = actualEndInSeconds;

    // Formatar horário de início estimado no formato HH:MM:SS
    const startHour = Math.floor(actualStartInSeconds / 3600);
    const startMin = Math.floor((actualStartInSeconds % 3600) / 60);
    const startSec = actualStartInSeconds % 60;
    const estimatedStartTimeStr = 
      String(startHour).padStart(2, "0") + ":" + 
      String(startMin).padStart(2, "0") + ":" + 
      String(startSec).padStart(2, "0");

    // Geramos o Link formatado do Google Drive
    const videoIdClean = current["drive_video_id"] || "";
    const originalLinkDrive = videoIdClean.includes("http") ? videoIdClean : "https://docs.google.com/uc?export=download&id=" + videoIdClean;

    timeline.push({
      id: current.id,
      rowNum: current.rowNum,
      horario: current["horario"],
      horarioCalculado: estimatedStartTimeStr,
      startInSeconds: actualStartInSeconds,
      endInSeconds: actualEndInSeconds,
      durationSeconds: current.durationSeconds,
      link_drive: originalLinkDrive,
      drive_video_id: videoIdClean,
      status: current["status"] || "Pendente",
      programa: current["programa"] || "Empire TV",
      tipo: current["tipo"] || "Clipe",
      material_tocando: current["material_tocando"] || "Música em Transmissão",
      buff_rpg: current["buff_rpg"] || "Sem Buff Ativo"
    });
  }

  return timeline;
}

/**
 * Encontra qual vídeo da linha do tempo dinâmica de hoje está rodando AGORA
 */
function findActiveVideoInTimeline(timeline) {
  if (timeline.length === 0) {
    return {
      status: "rotation",
      programa: "Playlist Geral do Bardo",
      tipo: "Geral",
      materialTocando: "Theme Guild Acoustic - Lofi",
      buff: "+10% de Regeneração de Mana",
      videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      seekOffset: 0,
      duration: 600,
      isBackup: true
    };
  }

  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const currentHour = localTime.getHours();
  const currentMinute = localTime.getMinutes();
  const currentSeconds = localTime.getSeconds();
  
  // Total de segundos decorridos hoje na vida real
  const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;

  let activeVideo = null;

  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (nowInSeconds >= item.startInSeconds && nowInSeconds < item.endInSeconds) {
      activeVideo = item;
      break;
    }
  }

  // Se passou de todas as programações cadastradas, nós ciclamo o sinal em loops dos programas
  if (!activeVideo) {
    const lastItem = timeline[timeline.length - 1];
    if (nowInSeconds > lastItem.endInSeconds) {
      const totalTimelineDuration = lastItem.endInSeconds - timeline[0].startInSeconds;
      const secSinceTimelineEnd = nowInSeconds - lastItem.endInSeconds;
      const relativeOffsetInSecs = secSinceTimelineEnd % totalTimelineDuration;
      
      const targetSec = timeline[0].startInSeconds + relativeOffsetInSecs;
      for (let i = 0; i < timeline.length; i++) {
        const item = timeline[i];
        if (targetSec >= item.startInSeconds && targetSec < item.endInSeconds) {
          activeVideo = item;
          const seekOffset = targetSec - item.startInSeconds;
          return buildResponsePayload(activeVideo, seekOffset);
        }
      }
    }
    
    // Se ainda está no começo do dia (antes de sintonizar a primeira transmissão)
    activeVideo = timeline[0];
  }

  if (activeVideo) {
    const seekOffset = nowInSeconds - activeVideo.startInSeconds;
    const clampedOffset = seekOffset > 0 ? seekOffset : 0;
    return buildResponsePayload(activeVideo, clampedOffset);
  }
}

/**
 * Estrutura o retorno final do vídeo ativo para o player
 */
function buildResponsePayload(item, seekOffset) {
  return {
    status: "broadcasting",
    rowNum: item.rowNum,
    programa: item.programa || "Programa do Bardo",
    tipo: item.tipo || "Geral",
    materialTocando: item.material_tocando || "Música no Ar",
    buff: item.buff_rpg || "+15% Stamina",
    videoUrl: item.link_drive,
    drive_video_id: item.drive_video_id,
    startedAt: item.horarioCalculado,
    durationSeconds: item.durationSeconds,
    seekOffset: seekOffset < item.durationSeconds ? seekOffset : (seekOffset % item.durationSeconds),
    isBackup: false
  };
}

/**
 * Rotina automática para marcar as linhas passadas como "Concluido" e a atual como "Transmitindo"
 */
function atualizarLinhasTransmitidas(sheet, timeline, currentVideo) {
  try {
    if (!currentVideo || currentVideo.isBackup) return;

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "status") + 1;
    
    if (statusColIdx <= 0) return;

    const currentIdx = currentVideo.rowNum;
    
    // Atualiza o estado atual na planilha (Transmitindo)
    if (currentIdx && currentIdx <= rows.length) {
      const currentStatus = String(rows[currentIdx - 1][statusColIdx - 1]).trim().toLowerCase();
      if (currentStatus !== "transmitindo" && currentStatus !== "concluido") {
        sheet.getRange(currentIdx, statusColIdx).setValue("Transmitindo");
      }
    }

    // Marca todos os outros vídeos anteriores como "Concluido"
    nowInSeconds = getSecondsToday();
    
    timeline.forEach(item => {
      if (item.rowNum !== currentIdx && item.rowNum <= rows.length) {
        if (nowInSeconds > item.endInSeconds) {
          const itemStatus = String(rows[item.rowNum - 1][statusColIdx - 1]).trim().toLowerCase();
          if (itemStatus !== "concluido") {
            sheet.getRange(item.rowNum, statusColIdx).setValue("Concluido");
          }
        }
      }
    });
  } catch(e) {
    Logger.log("Erro ao atualizar status automáticos: " + e);
  }
}

/**
 * Limpa espontaneamente da planilha itens antigos ou já concluídos, para deixar as consultas leves!
 */
function limparProgramasVencidosSet(sheet) {
  try {
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return;
    
    const headers = rows[0];
    const statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "status") + 1;
    const horarioColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "horario") + 1;
    
    if (statusColIdx <= 0 || horarioColIdx <= 0) return;
    
    const nowInSeconds = getSecondsToday();
    
    // Varre em ordem decrescente para não quebrar os índices de linha ao deletar
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const statusVal = String(row[statusColIdx - 1]).trim().toLowerCase();
      const horarioStr = String(row[horarioColIdx - 1]).trim();
      
      let deveApagar = false;
      
      // 1. Apaga se o status foi explicitamente marcado ou processado como Concluido
      if (statusVal === "concluido" || statusVal === "concluído") {
        deveApagar = true;
      } else if (horarioStr) {
        // 2. Apaga se já passou muito tempo do horário programado de hoje
        try {
          let timePart = "00:00";
          if (horarioStr.includes(" ")) {
            timePart = horarioStr.split(" ")[1];
          } else if (!horarioStr.includes("-") && !horarioStr.includes("/")) {
            timePart = horarioStr;
          }
          
          const tParts = timePart.split(":");
          const hours = parseInt(tParts[0] || "0", 10);
          const minutes = parseInt(tParts[1] || "0", 10);
          const itemStartSeconds = (hours * 3600) + (minutes * 60);
          
          const duracaoSec = parseInt(row[headers.findIndex(h => String(h).trim().toLowerCase() === "duracao_segundos")] || "600", 10);
          
          // Se já passou do final deste vídeo por mais de 30 minutos, exclui da planilha automaticamente
          if (nowInSeconds > (itemStartSeconds + duracaoSec + 1800)) {
            deveApagar = true;
          }
        } catch (err) {}
      }
      
      if (deveApagar) {
        sheet.deleteRow(i + 1);
      }
    }
  } catch(e) {
    Logger.log("Erro na autolimpeza: " + e);
  }
}

function getSecondsToday() {
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return (localTime.getHours() * 3600) + (localTime.getMinutes() * 60) + localTime.getSeconds();
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
 * Popula a planilha com colunas e dados de exemplo modernos para facilitar o entendimento do usuário.
 */
function initializeExampleData(sheet) {
  const ss = sheet.getParent();
  
  // Headers exatos projetados tanto para a automação quanto para o painel de TV
  const headers = ["Drive_Video_ID", "Horario", "Status", "Programa", "Tipo", "Material_Tocando", "Buff_RPG", "Duracao_Segundos"];
  sheet.appendRow(headers);
  
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const todayYMD = localTime.getFullYear() + "-" + 
                   String(localTime.getMonth() + 1).padStart(2, "0") + "-" + 
                   String(localTime.getDate()).padStart(2, "0"); 
  
  const sample1 = [
    "19uW7M0N-m6X9fB9CgI5gYcMhDpJvK9Y0", // ID fictício do Drive ou real compartilhado
    todayYMD + " 00:00", 
    "Pendente",
    "Sinfonia da Alvorada Arcana", 
    "Clipe", 
    "Town Hall Acoustic Theme", 
    "+15 de Agilidade & +10% Regen de MP",
    "600"
  ];
  
  const sample2 = [
    "1W5tK9XyMvZpBoFhG9Rz7cMwPdLkW8g5N", 
    todayYMD + " 00:10",
    "Pendente",
    "Guerra de Clãs", 
    "Heavy Beats", 
    "Tears of Steel Synthwave Remix", 
    "+20 de Foco e +5% Chance Crítica",
    "720"
  ];

  sheet.appendRow(sample1);
  sheet.appendRow(sample2);
  
  // Estética do cabeçalho da planilha
  sheet.getRange(1, 1, 1, 8).setBackground("#8b5cf6").setFontColor("#ffffff").setFontWeight("bold");
  sheet.autoResizeColumns(1, 8);
}

/**
 * Retornos em formato JSON com cabeçalhos CORS livres
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
