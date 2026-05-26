// ============================================================
// EMPIRE TV — GOOGLE APPS SCRIPT COMPLETO
// ============================================================

const SPREADSHEET_ID = "";
const PROXY_URL = "https://empiretv.empirerpg-forum.workers.dev";
const WORKER_SECRET = "coloque-uma-senha-forte-aqui"; // mesma do wrangler.toml

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

    const headers = rows[0];
    const dataRows = rows.slice(1);

    const rawSchedule = dataRows.map((row, index) => {
      const item = {};
      headers.forEach((header, colIndex) => {
        const key = String(header).trim().toLowerCase();
        if (key) item[key] = row[colIndex];
      });

      if (item["drive_video_id"] === undefined && row[0] !== undefined) item["drive_video_id"] = row[0];
      if (item["horario"] === undefined && row[1] !== undefined) item["horario"] = row[1];
      if (item["status"] === undefined && row[2] !== undefined) item["status"] = row[2];
      if (item["programa"] === undefined && row[3] !== undefined) item["programa"] = row[3];
      if (item["tipo"] === undefined && row[4] !== undefined) item["tipo"] = row[4];
      if (item["material_tocando"] === undefined && row[5] !== undefined) item["material_tocando"] = row[5];
      if (item["buff_rpg"] === undefined && row[6] !== undefined) item["buff_rpg"] = row[6];
      if (item["duracao_segundos"] === undefined && row[7] !== undefined) item["duracao_segundos"] = row[7];

      item.id = "prog_" + (index + 2);
      item.rowNum = index + 2;
      return item;
    });

    const activeTimeline = buildActiveTimeline(rawSchedule);
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
// TIMELINE — Monta a fila de vídeos
// ============================================================

function buildActiveTimeline(schedule) {
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const todayFormattedYMD = localTime.getFullYear() + "-" +
    String(localTime.getMonth() + 1).padStart(2, "0") + "-" +
    String(localTime.getDate()).padStart(2, "0");

  const sortedItems = schedule.map(item => {
    let horarioStr = String(item["horario"] || "").trim();
    if (!horarioStr) return null;

    let datePart = todayFormattedYMD;
    let timePart = "00:00";

    if (horarioStr.includes(" ") || horarioStr.includes("-") || horarioStr.includes("/")) {
      const parts = horarioStr.split(" ");
      if (parts.length >= 2) {
        datePart = parts[0].replace(/\//g, "-");
        timePart = parts[1];
      } else {
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

    let duration = parseInt(item["duracao_segundos"] || "600", 10);
    if (isNaN(duration) || duration <= 0) duration = 600;

    return {
      ...item,
      normalizedDate: datePart,
      normalizedTime: timePart,
      scheduledDateTimeStr: datePart + " " + timePart,
      configuredStartInSeconds,
      durationSeconds: duration
    };
  }).filter(item => item !== null)
    .sort((a, b) => a.scheduledDateTimeStr.localeCompare(b.scheduledDateTimeStr));

  const timeline = [];
  let currentTimelineInSeconds = 0;

  for (let i = 0; i < sortedItems.length; i++) {
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

    const videoIdClean = String(current["drive_video_id"] || "").trim();

    // URL do vídeo: usa o R2 via Worker se for ID do Drive,
    // ou usa direto se já vier como URL completa
    const videoUrl = videoIdClean.startsWith("http")
      ? videoIdClean
      : `${PROXY_URL}/video?file=video_${videoIdClean}.mp4&secret=${WORKER_SECRET}`;

    timeline.push({
      id: current.id,
      rowNum: current.rowNum,
      horario: current["horario"],
      horarioCalculado: estimatedStartTimeStr,
      startInSeconds: actualStartInSeconds,
      endInSeconds: actualEndInSeconds,
      durationSeconds: current.durationSeconds,
      link_drive: videoUrl,
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
      duration: 600,
      isBackup: true
    };
  }

  const nowInSeconds = getSecondsToday();
  let activeVideo = null;

  for (let i = 0; i < timeline.length; i++) {
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

      for (let i = 0; i < timeline.length; i++) {
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
    buff: item.buff_rpg || "+15 Stamina",
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

    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const statusVal = String(row[statusColIdx - 1]).trim().toLowerCase();
      const horarioStr = String(row[horarioColIdx - 1]).trim();
      let deveApagar = false;

      if (statusVal === "concluido" || statusVal === "concluído") {
        deveApagar = true;
      } else if (horarioStr) {
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
          const duracaoIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "duracao_segundos");
          const duracaoSec = parseInt(row[duracaoIdx] || "600", 10);

          if (nowInSeconds > (itemStartSeconds + duracaoSec + 1800)) {
            deveApagar = true;
          }
        } catch (err) {}
      }

      if (deveApagar) sheet.deleteRow(i + 1);
    }
  } catch (e) {
    Logger.log("Erro na autolimpeza: " + e);
  }
}

// ============================================================
// PRÉ-CARGA — Baixa do Drive e salva no R2 automaticamente
// ============================================================

function preCarregarProximosVideos() {
  const sheet = getProgramSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return;

  const headers = rows[0];
  const nowSec = getSecondsToday();
  const limitePreCarga = nowSec + 3600; // janela de 1 hora à frente
  const statusColIdx = headers.findIndex(h => String(h).trim().toLowerCase() === "status") + 1;

  rows.slice(1).forEach((row, i) => {
    const item = {};
    headers.forEach((h, ci) => item[String(h).trim().toLowerCase()] = row[ci]);

    const status = String(item["status"] || "").toLowerCase();
    if (["concluido", "transmitindo", "carregado"].includes(status)) return;

    const horarioStr = String(item["horario"] || "").trim();
    if (!horarioStr) return;

    const timePart = horarioStr.includes(" ") ? horarioStr.split(" ")[1] : horarioStr;
    const [h, m] = timePart.split(":").map(Number);
    const itemSec = (h * 3600) + (m * 60);

    if (itemSec < nowSec || itemSec > limitePreCarga) return;

    const driveId = String(item["drive_video_id"] || "").trim();
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

// ============================================================
// PÓS-TRANSMISSÃO — Deleta do R2 após concluir
// ============================================================

function deletarVideosTransmitidos() {
  const sheet = getProgramSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return;

  const headers = rows[0];

  rows.slice(1).forEach((row) => {
    const item = {};
    headers.forEach((h, ci) => item[String(h).trim().toLowerCase()] = row[ci]);

    const status = String(item["status"] || "").toLowerCase();
    if (status !== "concluido") return;

    const driveId = String(item["drive_video_id"] || "").trim();
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

// ============================================================
// TRIGGERS — Rode configurarTriggers() UMA VEZ manualmente
// ============================================================

function configurarTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

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
