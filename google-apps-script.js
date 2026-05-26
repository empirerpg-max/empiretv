// ============================================================
// EMPIRE TV — GOOGLE APPS SCRIPT COMPLETO E DINÂMICO
// ============================================================

const SPREADSHEET_ID = "";
// Nota: O streaming foi migrado para rodar integrado e nativo no próprio servidor Express do Cloud Run.
// O frontend do player de TV faz o redirecionamento automático das requisições de mídia para o servidor de cache local.
// Você não precisa mais do Cloudflare Worker ou do Cloudflare R2! Todo o download e streaming ocorrem na sua hospedagem.
const PROXY_URL = "https://seu-dominio-aqui.run.app"; 
const WORKER_SECRET = "garupapa@123";

// ============================================================
// ENTRY POINT — API para o player
// ============================================================

function doGet(e) {
  try {
    const sheet = getProgramSheet();
    limparProgramasVencidosSet(sheet);

    const rows = sheet.getDataRange().getValues();

    if (rows.length <= 1) {
      initializeExampleData(sheet);
      return createJsonResponse({
        status: "ok",
        message: "Planilha inicializada. Recarregue o painel.",
        current: null,
        fullSchedule: []
      });
    }

    const activeTimeline = buildActiveTimeline(rows);
    const currentTransmission = findActiveVideoInTimeline(activeTimeline);
    atualizarLinhasTransmitidas(sheet, activeTimeline, currentTransmission);

    return createJsonResponse({
      status: "success",
      timestamp: new Date().toISOString(),
      current: currentTransmission,
      fullSchedule: activeTimeline
    });

  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

// ============================================================
// AUXILIADORES DE EXTRAÇÃO INTELIGENTES E RESILIENTES
// ============================================================

function extractDriveId(val) {
  if (!val) return "";
  val = String(val).trim();
  
  if (val.includes("GMT") || val.includes("Time") || val.includes("Standard") || val.includes(":") || val.includes(" ") || val.includes("/")) {
    if (!val.includes("http") && !val.includes("drive.google.com")) {
      return "";
    }
  }
  
  const regexes = [
    /\/d\/([a-zA-Z0-9_-]{25,45})/i,
    /[?&]id=([a-zA-Z0-9_-]{25,45})/i,
    /\/file\/d\/([a-zA-Z0-9_-]{25,45})/i
  ];
  for (var i = 0; i < regexes.length; i++) {
    const match = val.match(regexes[i]);
    if (match && match[1]) {
      return match[1];
    }
  }

  if (/^[a-zA-Z0-9_-]{25,45}$/.test(val)) {
    return val;
  }
  
  return "";
}

function getSecondsFromValue(val) {
  if (val instanceof Date) {
    try {
      const timeStr = Utilities.formatDate(val, "America/Sao_Paulo", "HH:mm:ss");
      const parts = timeStr.split(":");
      return (parseInt(parts[0], 10) * 3600) + (parseInt(parts[1], 10) * 60) + parseInt(parts[2], 10);
    } catch (e) {
      return (val.getHours() * 3600) + (val.getMinutes() * 60) + val.getSeconds();
    }
  }
  
  const str = String(val || "").trim();
  if (!str) return null;

  if (str.includes("T")) {
    const tParts = str.split("T")[1];
    if (tParts) {
      const match = tParts.match(/(\d{1,2}):(\d{2}):(\d{2})/);
      if (match) {
        return (parseInt(match[1], 10) * 3600) + (parseInt(match[2], 10) * 60) + parseInt(match[3], 10);
      }
    }
  }

  const matches = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (matches) {
    const hours = parseInt(matches[1], 10);
    const minutes = parseInt(matches[2], 10);
    const seconds = matches[3] ? parseInt(matches[3], 10) : 0;
    return (hours * 3600) + (minutes * 60) + seconds;
  }
  return null;
}

function findDriveIdInRow(row, headers) {
  const preferredAliases = ["drive video", "link drive", "link do drive", "video", "drive id", "url", "status"];
  for (var j = 0; j < preferredAliases.length; j++) {
    const alias = preferredAliases[j];
    for (var i = 0; i < headers.length; i++) {
      const h = String(headers[i]).trim().toLowerCase().replace(/_/g, " ");
      if (h === alias || h.includes(alias)) {
        const val = String(row[i] || "").trim();
        const id = extractDriveId(val);
        if (id) return id;
      }
    }
  }
  for (var i = 0; i < row.length; i++) {
    const val = String(row[i] || "").trim();
    const id = extractDriveId(val);
    if (id) return id;
  }
  return "";
}

function findHorarioSecondsInRow(row, headers) {
  const aliases = ["horario", "horário", "hora", "data", "schedule", "time"];
  for (var j = 0; j < aliases.length; j++) {
    const alias = aliases[j];
    for (var i = 0; i < headers.length; i++) {
      const h = String(headers[i]).trim().toLowerCase().replace(/_/g, " ");
      if (h === alias || h.includes(alias)) {
        const secs = getSecondsFromValue(row[i]);
        if (secs !== null && !isNaN(secs)) return secs;
      }
    }
  }
  for (var i = 0; i < row.length; i++) {
    const val = row[i];
    const secs = getSecondsFromValue(val);
    if (secs !== null && !isNaN(secs)) return secs;
  }
  return null;
}

function findDurationSecondsInRow(row, headers) {
  const aliases = ["duracao segundos", "duracao", "duraçao", "duration", "tempo", "segundos"];
  for (var j = 0; j < aliases.length; j++) {
    const alias = aliases[j];
    for (var i = 0; i < headers.length; i++) {
      const h = String(headers[i]).trim().toLowerCase().replace(/_/g, " ");
      if (h === alias || h.includes(alias)) {
        const val = parseInt(row[i], 10);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  }
  for (var i = 0; i < row.length; i++) {
    const val = row[i];
    if (val !== "" && !isNaN(val)) {
      const num = parseInt(val, 10);
      if (num > 10 && num < 86400) return num;
    }
  }
  return 600;
}

function findMetadataInRow(row, headers, fieldType) {
  var aliases = [];
  var defaultVal = "";
  if (fieldType === "programa") {
    aliases = ["programa", "show", "titulo", "título"];
    defaultVal = "Empire TV";
  } else if (fieldType === "tipo") {
    aliases = ["tipo", "categoria", "type"];
    defaultVal = "Clipe";
  } else if (fieldType === "material") {
    aliases = ["material tocando", "musica", "música", "faixa", "track", "song"];
    defaultVal = "Música em Transmissão";
  } else if (fieldType === "buff") {
    aliases = ["buff rpg", "buff", "bonus", "bônus"];
    defaultVal = "Sem Buff Ativo";
  }

  for (var j = 0; j < aliases.length; j++) {
    var alias = aliases[j];
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).trim().toLowerCase().replace(/_/g, " ");
      if (h === alias || h.includes(alias)) {
        return String(row[i] || "").trim() || defaultVal;
      }
    }
  }
  return defaultVal;
}

// ============================================================
// TIMELINE — Monta a fila de vídeos estruturada cronologicamente
// ============================================================

function buildActiveTimeline(rows) {
  if (rows.length <= 1) return [];
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const sortedItems = dataRows.map((row, index) => {
    const driveVideoId = findDriveIdInRow(row, headers);
    if (!driveVideoId) return null;

    const configuredStartInSeconds = findHorarioSecondsInRow(row, headers);
    if (configuredStartInSeconds === null || isNaN(configuredStartInSeconds)) return null;

    const durationSeconds = findDurationSecondsInRow(row, headers);

    const programa = findMetadataInRow(row, headers, "programa");
    const tipo = findMetadataInRow(row, headers, "tipo");
    const material_tocando = findMetadataInRow(row, headers, "material");
    const buff_rpg = findMetadataInRow(row, headers, "buff");

    return {
      id: "prog_" + (index + 2),
      rowNum: index + 2,
      drive_video_id: driveVideoId,
      configuredStartInSeconds,
      durationSeconds,
      programa,
      tipo,
      material_tocando,
      buff_rpg
    };
  }).filter(item => item !== null)
    .sort((a, b) => a.configuredStartInSeconds - b.configuredStartInSeconds);

  const timeline = [];
  let currentTimelineInSeconds = 0;

  for (var i = 0; i < sortedItems.length; i++) {
    const current = sortedItems[i];

    let actualStartInSeconds = current.configuredStartInSeconds;
    if (actualStartInSeconds < currentTimelineInSeconds) {
      actualStartInSeconds = currentTimelineInSeconds;
    }

    const actualEndInSeconds = actualStartInSeconds + current.durationSeconds;
    currentTimelineInSeconds = actualEndInSeconds;

    const startHour = Math.floor(actualStartInSeconds / 3600);
    const startMin = Math.floor((actualStartInSeconds % 3600) / 60);
    const startSec = actualStartInSeconds % 60;
    const estimatedStartTimeStr =
      String(startHour).padStart(2, "0") + ":" +
      String(startMin).padStart(2, "0") + ":" +
      String(startSec).padStart(2, "0");

    const videoIdClean = current.drive_video_id;

    // Nota: Esta URL gerada de fallback é substituída de forma transparente por uma rota interna de alta velocidade (/video) pelo player do site,
    // que faz o download do vídeo em segundo plano diretamente para o cache do servidor local, garantindo zero travamentos e buffering.
    const videoUrl = videoIdClean.startsWith("http")
      ? videoIdClean
      : `${PROXY_URL}/video?file=video_${videoIdClean}.mp4&secret=${WORKER_SECRET}`;

    timeline.push({
      id: current.id,
      rowNum: current.rowNum,
      horarioCalculado: estimatedStartTimeStr,
      startInSeconds: actualStartInSeconds,
      endInSeconds: actualEndInSeconds,
      durationSeconds: current.durationSeconds,
      link_drive: videoUrl,
      drive_video_id: videoIdClean,
      programa: current.programa,
      tipo: current.tipo,
      material_tocando: current.material_tocando,
      buff_rpg: current.buff_rpg
    });
  }

  return timeline;
}

// ============================================================
// DETECÇÃO — Qual vídeo está no ar agora
// ============================================================

function findActiveVideoInTimeline(timeline) {
  if (timeline.length === 0) {
    return {
      status: "rotation",
      programa: "Playlist Geral",
      tipo: "Geral",
      materialTocando: "Theme Lofi",
      buff: "+10% Regeneração de Mana",
      videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      seekOffset: 0,
      durationSeconds: 600,
      isBackup: true
    };
  }

  const nowInSeconds = getSecondsToday();
  let activeVideo = null;

  for (var i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (nowInSeconds >= item.startInSeconds && nowInSeconds < item.endInSeconds) {
      activeVideo = item;
      break;
    }
  }

  if (!activeVideo) {
    const lastItem = timeline[timeline.length - 1];
    if (nowInSeconds > lastItem.endInSeconds) {
      const totalDuration = lastItem.endInSeconds - timeline[0].startInSeconds;
      const secSinceEnd = nowInSeconds - lastItem.endInSeconds;
      const relativeOffset = secSinceEnd % totalDuration;
      const targetSec = timeline[0].startInSeconds + relativeOffset;

      for (var i = 0; i < timeline.length; i++) {
        const item = timeline[i];
        if (targetSec >= item.startInSeconds && targetSec < item.endInSeconds) {
          return buildResponsePayload(item, targetSec - item.startInSeconds);
        }
      }
    }
    activeVideo = timeline[0];
  }

  if (activeVideo) {
    const seekOffset = nowInSeconds - activeVideo.startInSeconds;
    return buildResponsePayload(activeVideo, Math.max(seekOffset, 0));
  }
}

function buildResponsePayload(item, seekOffset) {
  return {
    status: "broadcasting",
    rowNum: item.rowNum,
    programa: item.programa || "Empire TV",
    tipo: item.tipo || "Geral",
    materialTocando: item.material_tocando || "Música no Ar",
    buff: item.buff_rpg || "Sem Buff Ativo",
    videoUrl: item.link_drive,
    drive_video_id: item.drive_video_id,
    startedAt: item.horarioCalculado,
    durationSeconds: item.durationSeconds,
    seekOffset: seekOffset < item.durationSeconds ? seekOffset : (seekOffset % item.durationSeconds),
    isBackup: false
  };
}

// ============================================================
// STATUS — Atualiza linhas na planilha
// ============================================================

function atualizarLinhasTransmitidas(sheet, timeline, currentVideo) {
  try {
    if (!currentVideo || currentVideo.isBackup) return;

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "status") + 1;
    if (statusColIdx <= 0) return;

    const currentIdx = currentVideo.rowNum;
    const nowInSeconds = getSecondsToday();

    if (currentIdx && currentIdx <= rows.length) {
      const currentStatus = String(rows[currentIdx - 1][statusColIdx - 1]).trim().toLowerCase();
      if (currentStatus !== "transmitindo" && currentStatus !== "concluido") {
        sheet.getRange(currentIdx, statusColIdx).setValue("Transmitindo");
      }
    }

    timeline.forEach(function(item) {
      if (item.rowNum !== currentIdx && item.rowNum <= rows.length) {
        if (nowInSeconds > item.endInSeconds) {
          const itemStatus = String(rows[item.rowNum - 1][statusColIdx - 1]).trim().toLowerCase();
          if (itemStatus !== "concluido") {
            sheet.getRange(item.rowNum, statusColIdx).setValue("Concluido");
          }
        }
      }
    });
  } catch (e) {
    Logger.log("Erro ao atualizar status: " + e);
  }
}

// ============================================================
// AUTOLIMPEZA — Remove linhas antigas da planilha
// ============================================================

function limparProgramasVencidosSet(sheet) {
  try {
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return;

    const headers = rows[0];
    const statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "status") + 1;
    const horarioColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "horario") + 1;
    if (statusColIdx <= 0 || horarioColIdx <= 0) return;

    const nowInSeconds = getSecondsToday();

    for (var i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const statusVal = String(row[statusColIdx - 1]).trim().toLowerCase();
      let deveApagar = false;

      if (statusVal === "concluido" || statusVal === "concluído") {
        deveApagar = true;
      } else {
        const itemStartSeconds = getSecondsFromValue(row[horarioColIdx - 1]);
        if (itemStartSeconds !== null && !isNaN(itemStartSeconds)) {
          const duracaoIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "duracao_segundos");
          let duracaoSec = 600;
          if (duracaoIdx >= 0) {
            duracaoSec = parseInt(row[duracaoIdx], 10) || 600;
          }
          if (nowInSeconds > (itemStartSeconds + duracaoSec + 1800)) {
            deveApagar = true;
          }
        }
      }

      if (deveApagar) sheet.deleteRow(i + 1);
    }
  } catch (e) {
    Logger.log("Erro na autolimpeza: " + e);
  }
}

// ============================================================
// COMPATIBILIDADE DE PRÉ-CARGA DE WORKERS (OPCIONAL/HISTÓRICO)
// ============================================================

function preCarregarProximosVideos() {
  const sheet = getProgramSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return;

  const headers = rows[0];
  const nowSec = getSecondsToday();
  const limitePreCarga = nowSec + 3600; 
  const statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "status") + 1;
  if (statusColIdx <= 0) return;

  rows.slice(1).forEach((row, i) => {
    const status = String(row[statusColIdx - 1] || "").toLowerCase();
    if (["concluido", "transmitindo", "carregado"].includes(status)) return;

    const itemSec = findHorarioSecondsInRow(row, headers);
    if (itemSec === null || isNaN(itemSec)) return;

    if (itemSec < nowSec || itemSec > limitePreCarga) return;

    const driveId = findDriveIdInRow(row, headers);
    if (!driveId || driveId.startsWith("http")) return;

    const filename = `video_${driveId}.mp4`;

    try {
      const resp = UrlFetchApp.fetch(
        `${PROXY_URL}/preload?id=${driveId}&name=${encodeURIComponent(filename)}&secret=${WORKER_SECRET}`,
        { muteHttpExceptions: true }
      );
      const result = JSON.parse(resp.getContentText());

      if (result.ok) {
        sheet.getRange(i + 2, statusColIdx).setValue("Carregado");
        Logger.log(`✅ Pré-carregado: ${filename}`);
      } else {
        Logger.log(`⚠️ Falha pré-carga: ${filename} — ${resp.getContentText()}`);
      }
    } catch (e) {
      Logger.log(`❌ Erro pré-carga ${driveId}: ${e}`);
    }
  });
}

function deletarVideosTransmitidos() {
  const sheet = getProgramSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return;

  const headers = rows[0];
  const statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "status") + 1;
  if (statusColIdx <= 0) return;

  rows.slice(1).forEach((row) => {
    const status = String(row[statusColIdx - 1] || "").toLowerCase();
    if (status !== "concluido") return;

    const driveId = findDriveIdInRow(row, headers);
    if (!driveId || driveId.startsWith("http")) return;

    const filename = `video_${driveId}.mp4`;

    try {
      UrlFetchApp.fetch(
        `${PROXY_URL}/delete?name=${encodeURIComponent(filename)}&secret=${WORKER_SECRET}`,
        { muteHttpExceptions: true }
      );
      Logger.log(`🗑️ Deletado do R2: ${filename}`);
    } catch (e) {
      Logger.log(`❌ Erro ao deletar ${filename}: ${e}`);
    }
  });
}

function configurarTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  // O novo servidor do Cloud Run faz a pré-carga e cache em background de forma contínua a cada 45 segundos por conta própria.
  // Você não precisa ativar triggers complexos se desejar, mas caso queira, estes são os triggers legados:
  ScriptApp.newTrigger("preCarregarProximosVideos")
    .timeBased().everyMinutes(30).create();

  ScriptApp.newTrigger("deletarVideosTransmitidos")
    .timeBased().everyMinutes(30).create();

  Logger.log("✅ Triggers configurados com sucesso!");
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function getSecondsToday() {
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return (localTime.getHours() * 3600) + (localTime.getMinutes() * 60) + localTime.getSeconds();
}

function getProgramSheet() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Programacao_RPG");
  if (!sheet) sheet = ss.insertSheet("Programacao_RPG");
  return sheet;
}

function initializeExampleData(sheet) {
  const headers = ["Drive_Video_ID", "Horario", "Status", "Programa", "Tipo", "Material_Tocando", "Buff_RPG", "Duracao_Segundos"];
  sheet.appendRow(headers);

  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const todayYMD = localTime.getFullYear() + "-" +
    String(localTime.getMonth() + 1).padStart(2, "0") + "-" +
    String(localTime.getDate()).padStart(2, "0");

  sheet.appendRow(["ID_DO_DRIVE_AQUI", todayYMD + " 20:00", "Pendente", "Empire Hits", "Top 10", "Música Exemplo", "+15 MP", "300"]);
  sheet.appendRow(["ID_DO_DRIVE_AQUI_2", todayYMD + " 20:05", "Pendente", "Empire Hits", "Top 10", "Música 2", "+10 HP", "240"]);

  sheet.getRange(1, 1, 1, 8).setBackground("#8b5cf6").setFontColor("#ffffff").setFontWeight("bold");
  sheet.autoResizeColumns(1, 8);
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
