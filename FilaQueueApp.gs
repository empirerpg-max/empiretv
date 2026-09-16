// ============================================================
// EMPIRE TV — PAINEL DE FILA (Apps Script Web App)
// Planilha própria: "Empire TV — Fila de Transmissão"
// Aba: Fila
// Colunas: Ordem | Programa | Data | Horario | Status | Link
//          Duracao_Seg | Label | Tipo | Titulo | Topico_ID
//
// COMO INSTALAR:
// 1. Abra a planilha nova no Sheets.
// 2. Extensões > Apps Script.
// 3. Apague o conteúdo padrão e cole este arquivo inteiro.
// 4. Em "Propriedades do projeto" (ícone de engrenagem) > Propriedades
//    do script, adicione: FILA_TOKEN = uma senha qualquer que só você
//    e o painel vão saber (ex: um texto aleatório grande).
// 5. Rode a função "instalarPlanilha" uma vez (menu Executar > instalarPlanilha)
//    pra criar o cabeçalho da aba "Fila". Autorize o script quando pedir.
// 6. Implantar > Nova implantação > tipo "App da Web".
//    - Executar como: Eu
//    - Quem pode acessar: Qualquer pessoa
// 7. Copie a URL do App da Web gerada — é ela + o FILA_TOKEN que o
//    painel (a página de fila) vai pedir na primeira vez que abrir.
// ============================================================

const FILA_SHEET_NAME = "Fila";
const FILA_HEADERS = [
  "Ordem", "Programa", "Data", "Horario", "Status", "Link",
  "Duracao_Seg", "Label", "Tipo", "Titulo", "Topico_ID"
];

function getFilaToken() {
  return PropertiesService.getScriptProperties().getProperty("FILA_TOKEN") || "";
}

function getFilaSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FILA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(FILA_SHEET_NAME);
  }
  return sheet;
}

function instalarPlanilha() {
  const sheet = getFilaSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(FILA_HEADERS);
    sheet.getRange(1, 1, 1, FILA_HEADERS.length)
      .setBackground("#8a4ef0").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, FILA_HEADERS.length);
  }
  Logger.log("Pronto. Aba 'Fila' criada/verificada com o cabeçalho certo.");
}

function filaCol(headers, name) {
  return headers.findIndex(h => String(h).trim().toLowerCase() === name.toLowerCase());
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken(token) {
  const real = getFilaToken();
  return real && token && token === real;
}

// ── Leitura: devolve a fila inteira, ordenada por "Ordem" ──────
function doGet(e) {
  try {
    const token = e && e.parameter && e.parameter.token;
    if (!checkToken(token)) return jsonOut({ status: "error", message: "token inválido" });

    const sheet = getFilaSheet();
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return jsonOut({ status: "ok", items: [] });

    const headers = rows[0].map(h => String(h).trim());
    const iOrdem = filaCol(headers, "Ordem");
    const iPrograma = filaCol(headers, "Programa");
    const iData = filaCol(headers, "Data");
    const iHorario = filaCol(headers, "Horario");
    const iStatus = filaCol(headers, "Status");
    const iLink = filaCol(headers, "Link");
    const iDuracao = filaCol(headers, "Duracao_Seg");
    const iLabel = filaCol(headers, "Label");
    const iTipo = filaCol(headers, "Tipo");
    const iTitulo = filaCol(headers, "Titulo");
    const iTopico = filaCol(headers, "Topico_ID");

    const items = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[iPrograma] && !row[iLink]) continue;
      items.push({
        row: i + 1,
        ordem: Number(row[iOrdem]) || (i + 1),
        programa: String(row[iPrograma] || ""),
        data: row[iData] ? String(row[iData]) : "",
        horario: row[iHorario] ? String(row[iHorario]) : "",
        status: String(row[iStatus] || "Pendente"),
        link: String(row[iLink] || ""),
        duracaoSeg: Number(row[iDuracao]) || 0,
        label: String(row[iLabel] || ""),
        tipo: String(row[iTipo] || ""),
        titulo: String(row[iTitulo] || ""),
        topicoId: String(row[iTopico] || "")
      });
    }
    items.sort((a, b) => a.ordem - b.ordem);
    return jsonOut({ status: "ok", items: items });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
}

// ── Escrita: reordenar, adicionar ou mudar status ───────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (!checkToken(body.token)) return jsonOut({ status: "error", message: "token inválido" });

    const sheet = getFilaSheet();
    const headers = sheet.getDataRange().getValues()[0].map(h => String(h).trim());
    const iOrdem = filaCol(headers, "Ordem");

    if (body.action === "reorder") {
      // body.rows = [rowNum, rowNum, ...] na nova ordem desejada
      const rows = body.rows || [];
      rows.forEach((rowNum, idx) => {
        sheet.getRange(rowNum, iOrdem + 1).setValue(idx + 1);
      });
      return jsonOut({ status: "ok" });
    }

    if (body.action === "add") {
      const lastRow = sheet.getLastRow();
      const maxOrdem = lastRow > 1
        ? Math.max(0, ...sheet.getRange(2, iOrdem + 1, lastRow - 1, 1).getValues().map(r => Number(r[0]) || 0))
        : 0;
      const newRow = FILA_HEADERS.map(h => {
        const key = h.toLowerCase();
        if (key === "ordem") return maxOrdem + 1;
        if (key === "status") return "Pendente";
        if (key === "programa") return body.programa || "Empire TV";
        if (key === "link") return body.link || "";
        if (key === "duracao_seg") return body.duracaoSeg || "";
        if (key === "label") return body.label || "";
        if (key === "tipo") return body.tipo || "";
        if (key === "titulo") return body.titulo || "";
        if (key === "data") return body.data || "";
        if (key === "horario") return body.horario || "";
        if (key === "topico_id") return body.topicoId || "";
        return "";
      });
      sheet.appendRow(newRow);
      return jsonOut({ status: "ok", row: sheet.getLastRow() });
    }

    if (body.action === "setStatus") {
      const iStatus = filaCol(headers, "Status");
      sheet.getRange(body.row, iStatus + 1).setValue(body.status);
      return jsonOut({ status: "ok" });
    }

    if (body.action === "remove") {
      sheet.deleteRow(body.row);
      return jsonOut({ status: "ok" });
    }

    return jsonOut({ status: "error", message: "ação desconhecida" });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  }
}
