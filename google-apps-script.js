// ============================================================
// EMPIRE TV — GOOGLE APPS SCRIPT
// Estrutura da aba: Agenda_TV
// Colunas: Programa | Tipo | Material | Buff | Data | Horario
//          Capa_URL | Status | Topico_ID | Topico_URL
// ============================================================

// ── Configuração ─────────────────────────────────────────────
const SHEET_NAME     = "Agenda_TV";
const SPREADSHEET_ID = ""; // deixe vazio para usar a planilha ativa

// ── Utilitários ──────────────────────────────────────────────

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

function parseDataHora(dataVal, horarioVal) {
  try {
    let dateStr = "";
    if (dataVal instanceof Date) {
      const local = new Date(dataVal.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const y = local.getFullYear();
      const m = String(local.getMonth() + 1).padStart(2, "0");
      const d = String(local.getDate()).padStart(2, "0");
      dateStr = `${y}-${m}-${d}`;
    } else {
      const s = String(dataVal).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        dateStr = s.substring(0, 10);
      } else if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
        const p = s.split("/");
        dateStr = `${p[2]}-${p[1]}-${p[0]}`;
      } else {
        return null;
      }
    }

    let timeStr = "00:00:00";
    if (horarioVal instanceof Date) {
      const local = new Date(horarioVal.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      timeStr = `${String(local.getHours()).padStart(2,"0")}:${String(local.getMinutes()).padStart(2,"0")}:${String(local.getSeconds()).padStart(2,"0")}`;
    } else {
      const s = String(horarioVal).trim();
      const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m) timeStr = `${m[1].padStart(2,"0")}:${m[2]}:${m[3] ? m[3] : "00"}`;
    }

    return new Date(`${dateStr}T${timeStr}-03:00`);
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

// ── doGet ─────────────────────────────────────────────────────

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

// ── Payload principal ─────────────────────────────────────────

function buildPayload() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();

  if (rows.length <= 1) {
    return {
      status: "ok",
      current: { status: "off", programa: "Empire TV" },
      fullSchedule: []
    };
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
    if (["concluido","concluído","cancelado"].includes(rowStatus)) return;

    const dataVal    = iData    >= 0 ? row[iData]    : "";
    const horarioVal = iHorario >= 0 ? row[iHorario] : "";
    const startDt    = parseDataHora(dataVal, horarioVal);
    if (!startDt) return;

    schedule.push({
      rowNum:    idx + 2,
      startDt:  startDt,
      programa: String(row[iPrograma]  || "Empire TV").trim(),
      tipo:     String(row[iTipo]      || "").trim(),
      material: String(row[iMaterial]  || "").trim(),
      buff:     String(row[iBuff]      || "").trim(),
      capaUrl:  String(row[iCapa]      || "").trim(),
      topicoId: String(row[iTopicoId]  || "").trim(),
      topicoUrl:String(row[iTopicoUrl] || "").trim()
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
          try { sheet.getRange(item.rowNum, iStatus + 1).setValue("Concluido"); } catch(e){}
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

  // fullSchedule — usa horarioStr para bater com home.tsx e grade.tsx
  const fullSchedule = schedule.map(item => ({
    rowNum:     item.rowNum,
    horarioStr: Utilities.formatDate(item.startDt, "America/Sao_Paulo", "HH:mm"),
    data:       Utilities.formatDate(item.startDt, "America/Sao_Paulo", "dd/MM/yyyy"),
    programa:   item.programa,
    tipo:       item.tipo,
    material:   item.material,
    buff:       item.buff,
    capaUrl:    item.capaUrl,
    topicoId:   item.topicoId,
    topicoUrl:  item.topicoUrl
  }));

  // current — usa horarioStr também
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
        horarioStr:     Utilities.formatDate(current.startDt, "America/Sao_Paulo", "HH:mm"),
        data:           Utilities.formatDate(current.startDt, "America/Sao_Paulo", "dd/MM/yyyy"),
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
