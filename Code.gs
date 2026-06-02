// ============================================================
// EMPIRE TV — GOOGLE APPS SCRIPT
// Estrutura da aba: Agenda_TV
// Colunas: Programa | Tipo | Material | Buff | Data | Horario
//          Capa_URL | Status | Topico_ID | Topico_URL
// ============================================================

const SHEET_NAME     = "Agenda_TV";
const SPREADSHEET_ID = "";

// ── Configurações do GitHub ────────────────────────────────────
// O token NÃO deve ficar aqui no código (arquivo público no GitHub).
// Salve-o nas Propriedades do Script:
//   GAS > Projeto > Configurações (engrenagem) > Propriedades do script
//   Adicione: GITHUB_TOKEN = github_pat_...
function getGithubToken() {
  return PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN") || "";
}

const GITHUB_OWNER       = "empirerpg-max";
const GITHUB_REPO        = "empiretv";
const GITHUB_WORKFLOW_ID = "transmissao.yml";

// Janela de tolerância: quantos minutos antes/depois do horário o GAS ainda dispara
const JANELA_MINUTOS = 10;

// Statuses que indicam linha JÁ PROCESSADA — pula na agenda e no disparo
// IMPORTANTE: "transmitindo" NÃO entra aqui, pois o buildPayload precisa lê-lo
const SKIP_STATUSES_AGENDA   = ["concluido","concluído","finalizado","cancelado","transmitido","arquivado"];
// Para o disparo do GAS, também pula "transmitindo" (já está no ar)
const SKIP_STATUSES_DISPARO  = [...SKIP_STATUSES_AGENDA, "transmitindo"];

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
    let year, month, day;
    if (dataVal instanceof Date) {
      year  = dataVal.getUTCFullYear();
      month = dataVal.getUTCMonth() + 1;
      day   = dataVal.getUTCDate();
    } else {
      const s = String(dataVal).trim();
      const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoM) {
        year = parseInt(isoM[1]); month = parseInt(isoM[2]); day = parseInt(isoM[3]);
      } else {
        const brM = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (brM) {
          day = parseInt(brM[1]); month = parseInt(brM[2]); year = parseInt(brM[3]);
        } else { return null; }
      }
    }
    let hh = 0, mm = 0, ss = 0;
    if (horarioVal instanceof Date) {
      hh = horarioVal.getUTCHours();
      mm = horarioVal.getUTCMinutes();
      ss = horarioVal.getUTCSeconds();
    } else {
      const s = String(horarioVal).trim();
      const isoT = s.match(/T(\d{2}):(\d{2}):(\d{2})/);
      if (isoT) {
        hh = parseInt(isoT[1]); mm = parseInt(isoT[2]); ss = parseInt(isoT[3]);
      } else {
        const timeM = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeM) {
          hh = parseInt(timeM[1]); mm = parseInt(timeM[2]); ss = timeM[3] ? parseInt(timeM[3]) : 0;
        }
      }
    }
    const iso = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}-03:00`;
    return new Date(iso);
  } catch(e) { return null; }
}

function jsonResp(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function jsonpResp(callback, data) {
  return ContentService.createTextOutput(`${callback}(${JSON.stringify(data)})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
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

  const headers  = rows[0].map(h => String(h).trim());
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

  const now      = nowSaoPaulo();
  const schedule = [];

  dataRows.forEach((row, idx) => {
    if (!row[iPrograma] && !row[iData]) return;
    const rowStatus = String(row[iStatus] || "").trim().toLowerCase();
    // Usa SKIP_STATUSES_AGENDA (sem "transmitindo") para não sumir da grade
    if (SKIP_STATUSES_AGENDA.includes(rowStatus)) return;
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
        try { if (iStatus >= 0) sheet.getRange(item.rowNum, iStatus + 1).setValue("Transmitindo"); } catch(e){}
        break;
      } else {
        try { if (iStatus >= 0) sheet.getRange(item.rowNum, iStatus + 1).setValue("Finalizado"); } catch(e){}
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

// ── Disparo automático do GitHub Actions ───────────────────────
function dispararTransmissao() {
  const token = getGithubToken();
  if (!token) {
    Logger.log("[dispararTransmissao] GITHUB_TOKEN não configurado nas Propriedades do Script — abortando.");
    return;
  }

  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) { Logger.log("[dispararTransmissao] Agenda vazia."); return; }

  const headers   = rows[0].map(h => String(h).trim());
  const dataRows  = rows.slice(1);
  const iData     = col(headers, "Data");
  const iHorario  = col(headers, "Horario");
  const iPrograma = col(headers, "Programa");
  const iStatus   = col(headers, "Status");

  const now       = nowSaoPaulo();
  const janela_ms = JANELA_MINUTOS * 60 * 1000;
  const props     = PropertiesService.getScriptProperties();

  for (let i = 0; i < dataRows.length; i++) {
    const row       = dataRows[i];
    const rowStatus = String(row[iStatus] || "").trim().toLowerCase();
    if (SKIP_STATUSES_DISPARO.includes(rowStatus)) continue;

    const startDt = parseDataHora(
      iData    >= 0 ? row[iData]    : "",
      iHorario >= 0 ? row[iHorario] : ""
    );
    if (!startDt) continue;

    const diffMs = now - startDt;
    if (diffMs >= -janela_ms && diffMs <= janela_ms) {
      const programa = String(row[iPrograma] || "Empire TV").trim();
      const chave    = `disparado_${programa}_${Utilities.formatDate(startDt, "America/Sao_Paulo", "yyyyMMdd_HHmm")}`;

      if (props.getProperty(chave)) {
        Logger.log(`[dispararTransmissao] Já disparado: ${chave} — pulando.`);
        continue;
      }

      Logger.log(`[dispararTransmissao] Disparando para "${programa}"...`);

      const url     = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_ID}/dispatches`;
      const options = {
        method: "post",
        contentType: "application/json",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        payload: JSON.stringify({ ref: "main" }),
        muteHttpExceptions: true
      };

      const resp = UrlFetchApp.fetch(url, options);
      const code = resp.getResponseCode();

      if (code === 204) {
        Logger.log(`[dispararTransmissao] ✓ Workflow disparado com sucesso para "${programa}"`);
        props.setProperty(chave, new Date().toISOString());
      } else {
        Logger.log(`[dispararTransmissao] Erro HTTP ${code}: ${resp.getContentText()}`);
      }
      break;
    }
  }
}

// ── Instalar trigger de 5 minutos ─────────────────────────────
// Execute UMA VEZ manualmente no editor do GAS.
function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "dispararTransmissao") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dispararTransmissao").timeBased().everyMinutes(5).create();
  Logger.log("[instalarTrigger] Trigger de 5 minutos instalado!");
}

// ── Debug ──────────────────────────────────────────────────────
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
  const payload = buildPayload();
  Logger.log("fullSchedule count: " + payload.fullSchedule.length);
  Logger.log("Primeiros 3 itens: " + JSON.stringify(payload.fullSchedule.slice(0,3)));
}
