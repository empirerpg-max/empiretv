// ============================================================
// EMPIRE TV — GOOGLE APPS SCRIPT
// Estrutura da aba: Agenda_TV
// Colunas: Programa | Tipo | Material | Buff | Data | Horario
//          Capa_URL | Status | Topico_ID | Topico_URL
// ============================================================

const SHEET_NAME     = "Agenda_TV";
const SPREADSHEET_ID = "";

function getSheet() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    initHeaders(sheet);
  }
  return sheet;
}

function initHeaders(sheet) {
  const headers = ["Programa","Tipo","Material","Buff","Data","Horario","Capa_URL","Status","Topico_ID","Topico_URL"];
  sheet.appendRow(headers);
  sheet.getRange(1,1,1,headers.length)
    .setBackground("#7c3aed").setFontColor("#ffffff").setFontWeight("bold");
  sheet.autoResizeColumns(1, headers.length);
}

function col(headers, name) {
  const n = name.trim().toLowerCase();
  return headers.findIndex(h => String(h).trim().toLowerCase() === n);
}

function nowSaoPaulo() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

// Statuses que devem ser ignorados (já encerrados)
const SKIP_STATUSES = ["concluido","concluído","finalizado","cancelado","transmitido"];

function parseDataHora(dataVal, horarioVal) {
  try {
    // ── PARTE 1: extrair data ──
    let year, month, day;

    if (dataVal instanceof Date) {
      // Objeto Date do Sheets — usa UTC pois o Sheets armazena como meia-noite UTC
      year  = dataVal.getUTCFullYear();
      month = dataVal.getUTCMonth() + 1;
      day   = dataVal.getUTCDate();
    } else {
      const s = String(dataVal).trim();
      // ISO: 2026-05-27T03:00:00.000Z
      const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoM) {
        year = parseInt(isoM[1]); month = parseInt(isoM[2]); day = parseInt(isoM[3]);
      } else {
        // dd/MM/yyyy
        const brM = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (brM) {
          day = parseInt(brM[1]); month = parseInt(brM[2]); year = parseInt(brM[3]);
        } else {
          return null;
        }
      }
    }

    // ── PARTE 2: extrair hora ──
    let hh = 0, mm = 0, ss = 0;

    if (horarioVal instanceof Date) {
      // Objeto Date do Sheets para hora: pode vir como 1899-12-30T23:06:28.000Z
      // A hora real está nos componentes UTC
      hh = horarioVal.getUTCHours();
      mm = horarioVal.getUTCMinutes();
      ss = horarioVal.getUTCSeconds();
    } else {
      const s = String(horarioVal).trim();
      // ISO com T: 1899-12-30T23:06:28.000Z — pega após o T
      const isoT = s.match(/T(\d{2}):(\d{2}):(\d{2})/);
      if (isoT) {
        hh = parseInt(isoT[1]); mm = parseInt(isoT[2]); ss = parseInt(isoT[3]);
      } else {
        // HH:MM ou HH:MM:SS
        const timeM = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeM) {
          hh = parseInt(timeM[1]); mm = parseInt(timeM[2]); ss = timeM[3] ? parseInt(timeM[3]) : 0;
        }
      }
    }

    // Monta o Date em Brasília
    const iso = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}-03:00`;
    return new Date(iso);
  } catch(e) {
    return null;
  }
}

function jsonResp(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpResp(callback, data) {
  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(data)})`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;
  try {
    const result = buildPayload();
    return callback ? jsonpResp(callback, result) : jsonResp(result);
  } catch(err) {
    const errObj = { status: "error", message: String(err) };
    return callback ? jsonpResp(callback, errObj) : jsonResp(errObj);
  }
}

function buildPayload() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();

  if (rows.length <= 1) {
    return { status: "ok", current: { status: "off", programa: "Empire TV" }, fullSchedule: [] };
  }

  const headers = rows[0].map(h => String(h).trim());
  const dataRows = rows.slice(1);

  const iPrograma  = col(headers, "Programa");
  const iTipo      = col(headers, "Tipo");
  const iMaterial  = col(headers, "Material");
  const iBuff      = col(headers, "Buff");
  const iData      = col(headers, "Data");
  const iHorario   = col(headers, "Horario");
  const iCapa      = col(headers, "Capa_URL");
  const iStatus    = col(headers, "Status");
  const iTopicoId  = col(headers, "Topico_ID");
  const iTopicoUrl = col(headers, "Topico_URL");

  const now = nowSaoPaulo();
  const schedule = [];

  dataRows.forEach((row, idx) => {
    const rowStatus = String(row[iStatus] || "").trim().toLowerCase();
    // Ignora qualquer status de encerrado
    if (SKIP_STATUSES.includes(rowStatus)) return;

    const dataVal    = iData    >= 0 ? row[iData]    : "";
    const horarioVal = iHorario >= 0 ? row[iHorario] : "";
    const startDt    = parseDataHora(dataVal, horarioVal);
    if (!startDt) return;

    schedule.push({
      rowNum:    idx + 2,
      startDt:   startDt,
      programa:  String(row[iPrograma]  || "Empire TV").trim(),
      tipo:      String(row[iTipo]      || "").trim(),
      material:  String(row[iMaterial]  || "").trim(),
      buff:      String(row[iBuff]      || "").trim(),
      capaUrl:   String(row[iCapa]      || "").trim(),
      topicoId:  String(row[iTopicoId]  || "").trim(),
      topicoUrl: String(row[iTopicoUrl] || "").trim()
    });
  });

  schedule.sort((a, b) => a.startDt - b.startDt);

  const MAX_LIVE_WINDOW = 3 * 60 * 60 * 1000;
  let current = null;

  for (let i = 0; i < schedule.length; i++) {
    const item   = schedule[i];
    const diffMs = now - item.startDt;

    if (diffMs >= 0) {
      const nextStart = schedule[i+1] ? schedule[i+1].startDt : null;
      const liveUntil = nextStart || new Date(item.startDt.getTime() + MAX_LIVE_WINDOW);

      if (now < liveUntil) {
        current = { ...item, status: "broadcasting", seekOffset: Math.floor(diffMs / 1000) };
        if (iStatus >= 0) {
          try { sheet.getRange(item.rowNum, iStatus + 1).setValue("Transmitindo"); } catch(e){}
        }
        break;
      } else {
        if (iStatus >= 0) {
          try { sheet.getRange(item.rowNum, iStatus + 1).setValue("Finalizado"); } catch(e){}
        }
      }
    } else {
      if (!current) {
        current = { ...item, status: "upcoming", secondsToStart: Math.ceil(-diffMs / 1000) };
      }
      break;
    }
  }

  if (!current) current = { status: "off", programa: "Empire TV" };

  const fmt = (dt, pattern) => Utilities.formatDate(dt, "America/Sao_Paulo", pattern);

  const fullSchedule = schedule.map(item => ({
    rowNum:     item.rowNum,
    horarioStr: fmt(item.startDt, "HH:mm"),
    data:       fmt(item.startDt, "dd/MM/yyyy"),
    programa:   item.programa,
    tipo:       item.tipo,
    material:   item.material,
    buff:       item.buff,
    capaUrl:    item.capaUrl,
    topicoId:   item.topicoId,
    topicoUrl:  item.topicoUrl
  }));

  const currentOut = current.status === "off"
    ? { status: "off", programa: "Empire TV" }
    : {
        status:         current.status,
        programa:       current.programa,
        tipo:           current.tipo,
        material:       current.material,
        buff:           current.buff,
        capaUrl:        current.capaUrl,
        topicoId:       current.topicoId   || "",
        topicoUrl:      current.topicoUrl  || "",
        horarioStr:     fmt(current.startDt, "HH:mm"),
        data:           fmt(current.startDt, "dd/MM/yyyy"),
        videoUrl:       "",
        seekOffset:     current.seekOffset     || 0,
        secondsToStart: current.secondsToStart || 0
      };

  return {
    status:       "success",
    timestamp:    new Date().toISOString(),
    current:      currentOut,
    fullSchedule: fullSchedule
  };
}

// ── Debug ─────────────────────────────────────────────────────
function debug() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("Abas: " + ss.getSheets().map(s => s.getName()).join(", "));
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log("ERRO: aba " + SHEET_NAME + " não encontrada!"); return; }
  const rows = sheet.getDataRange().getValues();
  Logger.log("Total de linhas: " + rows.length);
  Logger.log("Cabeçalhos: " + JSON.stringify(rows[0]));
  if (rows[1]) Logger.log("Linha 2 (raw): " + JSON.stringify(rows[1]));
  if (rows[2]) Logger.log("Linha 3 (raw): " + JSON.stringify(rows[2]));
  Logger.log("Payload: " + JSON.stringify(buildPayload()));
}
