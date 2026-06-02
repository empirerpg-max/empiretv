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
  // Retorna índice (0-based) de forma case-insensitive
  const n = name.trim().toLowerCase();
  return headers.findIndex(h => String(h).trim().toLowerCase() === n);
}

function nowSaoPaulo() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function parseDataHora(dataVal, horarioVal) {
  // Aceita Data como Date object, string "YYYY-MM-DD", "DD/MM/YYYY"
  // Horario como Date object (hora do Sheets), string "HH:MM" ou "HH:MM:SS"
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
  const cb = arguments.callee.caller; // não usado; JSONP tratado em doGet
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

  // Índices das colunas
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

    const programa  = String(row[iPrograma]  || "Empire TV").trim();
    const tipo      = String(row[iTipo]      || "").trim();
    const material  = String(row[iMaterial]  || "").trim();
    const buff      = String(row[iBuff]      || "").trim();
    const capaUrl   = String(row[iCapa]      || "").trim();
    const topicoId  = String(row[iTopicoId]  || "").trim();
    const topicoUrl = String(row[iTopicoUrl] || "").trim();

    schedule.push({
      rowNum:     idx + 2,
      startDt:    startDt,
      programa,tipo,material,buff,capaUrl,topicoId,topicoUrl
    });
  });

  // Ordenar por data/hora
  schedule.sort((a, b) => a.startDt - b.startDt);

  // Achar o que está ao vivo agora (dentro de 3h após o horário de início)
  const MAX_LIVE_WINDOW = 3 * 60 * 60 * 1000; // 3 horas em ms
  let current = null;

  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];
    const diffMs = now - item.startDt;

    if (diffMs >= 0) {
      // Já começou — está ao vivo se ainda dentro da janela
      // Ou até o próximo item começar
      const nextStart = schedule[i+1] ? schedule[i+1].startDt : null;
      const liveUntil = nextStart || new Date(item.startDt.getTime() + MAX_LIVE_WINDOW);

      if (now < liveUntil) {
        current = { ...item, status: "broadcasting", seekOffset: Math.floor(diffMs / 1000) };
        // Marca na planilha
        if (iStatus >= 0) {
          try { sheet.getRange(item.rowNum, iStatus + 1).setValue("Transmitindo"); } catch(e){}
        }
        break;
      } else {
        // Já passou — marca concluído
        if (iStatus >= 0) {
          try { sheet.getRange(item.rowNum, iStatus + 1).setValue("Concluido"); } catch(e){}
        }
      }
    } else {
      // Ainda não começou — upcoming se for o mais próximo no futuro
      if (!current) {
        const secondsToStart = Math.ceil(-diffMs / 1000);
        current = { ...item, status: "upcoming", secondsToStart };
      }
      break;
    }
  }

  if (!current) {
    current = { status: "off", programa: "Empire TV" };
  }

  // Formatar fullSchedule para o front
  const fullSchedule = schedule.map(item => ({
    rowNum:    item.rowNum,
    horario:   Utilities.formatDate(item.startDt, "America/Sao_Paulo", "HH:mm"),
    data:      Utilities.formatDate(item.startDt, "America/Sao_Paulo", "dd/MM/yyyy"),
    programa:  item.programa,
    tipo:      item.tipo,
    material:  item.material,
    buff:      item.buff,
    capaUrl:   item.capaUrl,
    topicoId:  item.topicoId,
    topicoUrl: item.topicoUrl
  }));

  // Formatar current para o front
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
        videoUrl:       "",           // Drive não usado nesta estrutura
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
