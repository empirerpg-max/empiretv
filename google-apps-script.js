/**
 * RPG MUSICAL - SISTEMA DE PROGRAMAÇÃO AUTOMÁTICA EM COMPACT QUEUE (VOD-to-Live)
 * Código COMPLETO para colar no Editor do Google Apps Script (script.google.com)
 * 
 * Este script conecta uma Planilha Google contendo sua "fila de vídeos" (sem limite de quantidade)
 * e calcula a programação exata em tempo real. Se vários vídeos estiverem marcados com o mesmo 
 * horário, eles serão reproduzidos em sequência (Fila / Queue) empilhando suas durações!
 */

// Chave da Planilha. Deixe em branco se o script estiver vinculado à própria planilha
const SPREADSHEET_ID = ""; 

/**
 * Função receptora de GET requests para servir a grade em tempo real para o player
 */
function doGet(e) {
  try {
    const sheet = getProgramSheet();
    const rows = sheet.getDataRange().getValues();
    
    if (rows.length <= 1) {
      initializeExampleData(sheet);
      return createJsonResponse({
        status: "ok",
        message: "Planilha de programação inicializada! Por favor, recarregue a página.",
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
      
      // Fallbacks resilientes por ordem física de coluna caso o usuário mexcle ou erre os cabeçalhos
      // Ordem padrão: 0: Dia, 1: Horario, 2: Link_Drive, 3: Duracao_Segundos, 4: Titulo, 5: Descricao, 6: Musica_Atual, 7: Buff_RPG
      if (item["dia"] === undefined && row[0] !== undefined) item["dia"] = row[0];
      if (item["horario"] === undefined && row[1] !== undefined) item["horario"] = row[1];
      if (item["link_drive"] === undefined && row[2] !== undefined) item["link_drive"] = row[2];
      if (item["duracao_segundos"] === undefined && row[3] !== undefined) item["duracao_segundos"] = row[3];
      if (item["titulo"] === undefined && row[4] !== undefined) item["titulo"] = row[4];
      if (item["descricao"] === undefined && row[5] !== undefined) item["descricao"] = row[5];
      if (item["musica_atual"] === undefined && row[6] !== undefined) item["musica_atual"] = row[6];
      if (item["buff_rpg"] === undefined && row[7] !== undefined) item["buff_rpg"] = row[7];

      item.id = "prog_" + (index + 2); // Linha real correspondente na planilha
      item.rowNum = index + 2;
      return item;
    });

    // Filtra e reconstrói a Linha do Tempo Dinâmica do dia de Hoje (Fila de Vídeos Sequenciais)
    const activeTimeline = buildActiveTimeline(rawSchedule);
    
    // Detecta qual vídeo da fila deve estar rodando AGORA
    const currentTransmission = findActiveVideoInTimeline(activeTimeline);

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
 * Monta uma linha do tempo enfileirada para o dia de hoje.
 * Se múltiplos vídeos tiverem a mesma hora de início, eles são tocados em sequência!
 */
function buildActiveTimeline(schedule) {
  const now = new Date();
  
  // Ajuste padrão para fuso de Brasília (America/Sao_Paulo)
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dd = String(localTime.getDate()).padStart(2, "0");
  const mm = String(localTime.getMonth() + 1).padStart(2, "0");
  const yyyy = localTime.getFullYear();
  const todayFormatted = dd + "/" + mm + "/" + yyyy; // "25/05/2026"

  const currentDayOfWeek = localTime.getDay(); // 0-6
  const dayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const currentDayName = dayNames[currentDayOfWeek];

  // 1. Filtrar programação do dia de hoje (suportando data em formato DD/MM/YYYY ou "Todos")
  const todaysItems = schedule.filter(item => {
    let dayConfigStr = "";
    
    if (item["dia"] instanceof Date) {
      const d = item["dia"];
      const itemDd = String(d.getDate()).padStart(2, "0");
      const itemMm = String(d.getMonth() + 1).padStart(2, "0");
      const itemYyyy = d.getFullYear();
      dayConfigStr = itemDd + "/" + itemMm + "/" + itemYyyy;
    } else {
      dayConfigStr = String(item["dia"] || "").trim();
    }

    dayConfigStr = dayConfigStr.replace(/-/g, "/").toLowerCase();
    
    // Suporta data específica (ex: 25/05/2026), "todos" ou os dias da semana normais como fallback
    return dayConfigStr === "todos" || 
           dayConfigStr === todayFormatted || 
           dayConfigStr === currentDayName || 
           dayConfigStr.includes(currentDayName);
  });

  // 2. Ordenar itens inicialmente pelo Horário de início informado na célula
  const sortedItems = todaysItems.map(item => {
    const timeStr = String(item["horario"] || "00:00").trim();
    const parts = timeStr.split(":");
    const hours = parseInt(parts[0] || "0", 10);
    const minutes = parseInt(parts[1] || "0", 10);
    const configuredStartInSeconds = (hours * 3600) + (minutes * 60);

    // Duração customizada (em segundos). Padrão do bardo: 600 segundos (10 minutos)
    let duration = parseInt(item["duracao_segundos"] || "600", 10);
    if (isNaN(duration) || duration <= 0) {
      duration = 600; 
    }

    return {
      ...item,
      configuredStartInSeconds: configuredStartInSeconds,
      durationSeconds: duration
    };
  }).sort((a, b) => a.configuredStartInSeconds - b.configuredStartInSeconds);

  // 3. Montar a Fila Sequencial Real (Encadeamento de durações)
  const timeline = [];
  let currentTimelineInSeconds = 0;

  for (let i = 0; i < sortedItems.length; i++) {
    const current = sortedItems[i];
    
    // Se o horário estipulado para esse vídeo for menor que o fim do vídeo anterior, 
    // ele entra na FILA IMEDIATAMENTE após o término do anterior (VOD encadeado)
    let actualStartInSeconds = current.configuredStartInSeconds;
    if (actualStartInSeconds < currentTimelineInSeconds) {
      actualStartInSeconds = currentTimelineInSeconds;
    }

    const actualEndInSeconds = actualStartInSeconds + current.durationSeconds;
    
    // Atualiza o marcador do final da fila de transmissão
    currentTimelineInSeconds = actualEndInSeconds;

    // Formatar horário real estimado de início para o bardo ler na planilha
    const startHour = Math.floor(actualStartInSeconds / 3600);
    const startMin = Math.floor((actualStartInSeconds % 3600) / 60);
    const startSec = actualStartInSeconds % 60;
    const estimatedStartTimeStr = 
      String(startHour).padStart(2, "0") + ":" + 
      String(startMin).padStart(2, "0") + ":" + 
      String(startSec).padStart(2, "0");

    timeline.push({
      id: current.id,
      rowNum: current.rowNum,
      dia: current["dia"],
      configuredHorario: current["horario"],
      horarioCalculado: estimatedStartTimeStr,
      startInSeconds: actualStartInSeconds,
      endInSeconds: actualEndInSeconds,
      durationSeconds: current.durationSeconds,
      link_drive: current["link_drive"],
      titulo: current["titulo"],
      descricao: current["descricao"],
      musica_atual: current["musica_atual"],
      buff_rpg: current["buff_rpg"]
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
      title: "Playlist Geral do Bardo",
      description: "Música de fundo padrão (Nenhuma transmissão ativa)",
      nowPlaying: "Theme Guild Acoustic - Lofi",
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
  
  // Total de segundos decorridos hoje
  const nowInSeconds = (currentHour * 3600) + (currentMinute * 60) + currentSeconds;

  let activeVideo = null;

  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (nowInSeconds >= item.startInSeconds && nowInSeconds < item.endInSeconds) {
      activeVideo = item;
      break;
    }
  }

  // Se passou de todas as programações cadastradas, ou se ainda não começou a primeira, 
  // nós colocamos rodando o primeiro vídeo ciclado (Loop do Bardo) ou o último para que a rádio nunca fique offline!
  if (!activeVideo) {
    // Roda em modo de reprise cíclica do último slot cadastrado
    const lastItem = timeline[timeline.length - 1];
    if (nowInSeconds > lastItem.endInSeconds) {
      // Repetir ciclo das músicas cadastradas
      const totalTimelineDuration = lastItem.endInSeconds - timeline[0].startInSeconds;
      const secSinceTimelineEnd = nowInSeconds - lastItem.endInSeconds;
      const relativeOffsetInSecs = secSinceTimelineEnd % totalTimelineDuration;
      
      const targetSec = timeline[0].startInSeconds + relativeOffsetInSecs;
      for (let i = 0; i < timeline.length; i++) {
        const item = timeline[i];
        if (targetSec >= item.startInSeconds && targetSec < item.endInSeconds) {
          activeVideo = item;
          // Retorna com offset relativo
          const seekOffset = targetSec - item.startInSeconds;
          return buildResponsePayload(activeVideo, seekOffset);
        }
      }
    }
    
    // Se ainda está antes do primeiro evento do dia
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
  // Ajustar link do download do drive
  const directUrl = getDirectDriveUrl(item.link_drive);

  return {
    status: "broadcasting",
    title: item.titulo || "Transmissão da Divina Guilda",
    description: item.descricao || "Grade de Programação Automática",
    nowPlaying: item.musica_atual || "Música em Execução",
    buff: item.buff_rpg || "+15% Stamina",
    videoUrl: directUrl,
    startedAt: item.horarioCalculado,
    durationSeconds: item.durationSeconds,
    seekOffset: clampedOffsetForVideo(seekOffset, item.durationSeconds),
    isBackup: false
  };
}

/**
 * Garante que o offset de tempo não ultrapasse a duração configurada do vídeo
 */
function clampedOffsetForVideo(offset, duration) {
  if (offset >= duration) {
    return offset % duration; // Reinicia em loop
  }
  return offset;
}

/**
 * Converte links públicos de compartilhamento do Drive em links diretos para streaming sem bloqueios no player
 */
function getDirectDriveUrl(url) {
  if (!url) return "";
  if (url.includes("docs.google.com/uc") || url.includes("drive.usercontent.google.com")) {
    return url;
  }
  const regExp = /\/file\/d\/([^\/]+)|\/open\?id=([^\/&]+)|id=([^\/&]+)/;
  const matches = url.match(regExp);
  if (matches) {
    const fileId = matches[1] || matches[2] || matches[3];
    if (fileId) {
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
 * Popula a planilha com colunas e dados de exemplo modernos para facilitar o entendimento do usuário
 */
/**
 * Popula a planilha com colunas e dados de exemplo modernos para facilitar o entendimento do usuário.
 * Também cria de forma inovadora uma aba exclusiva de Documentação no Google Sheets.
 */
function initializeExampleData(sheet) {
  const ss = sheet.getParent();
  
  // 1. Criar e preencher a aba de programação principal
  const headers = ["Dia", "Horario", "Link_Drive", "Duracao_Segundos", "Titulo", "Descricao", "Musica_Atual", "Buff_RPG"];
  sheet.appendRow(headers);
  
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dd = String(localTime.getDate()).padStart(2, "0");
  const mm = String(localTime.getMonth() + 1).padStart(2, "0");
  const yyyy = localTime.getFullYear();
  const todayFormatted = dd + "/" + mm + "/" + yyyy; // "25/05/2026"
  
  const sample1 = [
    todayFormatted, 
    "00:00", 
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", 
    "600",
    "Sinfonia da Alvorada Arcana (Fila Item 1)", 
    "Primeiro vídeo da nossa Fila de Reprodução Automática do dia inteiro de missões.", 
    "Town Hall Acoustic Theme", 
    "+15 de Agilidade & +10% Regen de MP"
  ];
  
  const sample2 = [
    todayFormatted, 
    "00:00", // Notar: Têm o MESMO horário, então eles se enfileiram automaticamente!
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4", 
    "720",
    "Estágio 2: Heavy Beats de Masmorra (Fila Item 2)", 
    "Segundo vídeo da fila automática! Roda imediatamente depois do item 1 acabar.", 
    "Tears of Steel Synthwave Remix", 
    "+20 de Foco e +5% Chance Crítica"
  ];

  sheet.appendRow(sample1);
  sheet.appendRow(sample2);
  
  // Estética para a de programação
  sheet.getRange(1, 1, 1, 8).setBackground("#8b5cf6").setFontColor("#ffffff").setFontWeight("bold");
  sheet.autoResizeColumns(1, 8);

  // 2. Criar aba de Documentação e Manual (se ela ainda não existir)
  let docSheet = ss.getSheetByName("Manual_Empire_TV");
  if (!docSheet) {
    docSheet = ss.insertSheet("Manual_Empire_TV");
    
    // Configurar o visual da Documentação
    docSheet.getRange("A1:C1").merge().setValue("⚔️ MANUAL DE CONFIGURAÇÃO E INTEGRAÇÃO - EMPIRE TV & RÁDIO")
      .setFontSize(14).setFontWeight("bold").setBackground("#229ED9").setFontColor("#ffffff").setHorizontalAlignment("center");
    
    docSheet.appendRow(["", "", ""]); // Linha vazia
    docSheet.appendRow(["CÓDIGO DE COLUNA", "MANUAL DE CONFIGURAÇÃO: O QUE INSERIR NAS COLUNAS", "DICA DE OURO"]);
    
    // Guia das colunas
    docSheet.appendRow(["A) Dia", "Define quando o programa vai rodar. Use a data exata DD/MM/YYYY (ex: " + todayFormatted + ") ou 'Todos' para repetir diariamente.", "Se colocar algum dia da semana (ex: 'segunda', 'terça'), rodará apenas neste respectivo dia."]);
    docSheet.appendRow(["B) Horario", "Hora de início no formato de 24h HH:MM (ex: 14:00, 20:30, 00:00).", "Se cadastrar vários itens no mesmo horário, o sistema monta uma FILA sequencial empilhando as durações!"]);
    docSheet.appendRow(["C) Link_Drive", "Link de visualização compartilhado do Google Drive ('Qualquer pessoa com o link pode ver') ou URL direta de um vídeo MP4.", "O player resolve links do Google Drive nativamente convertendo em streaming em tempo real!"]);
    docSheet.appendRow(["D) Duracao_Segundos", "A duração exata do vídeo em segundos (ex: 600 para 10 minutos, 3600 para 1 hora).", "Importante colocar a duração correta para o alinhamento da fila e cálculo de sincronização perfeito."]);
    docSheet.appendRow(["E) Titulo", "O título do programa que substitui o cabeçalho superior na tela durante a exibição.", "Fica destacado no player, informando aos membros a atração ativa."]);
    docSheet.appendRow(["F) Descricao", "Pequeno resumo explicativo do conteúdo de transmissão ativo.", "Aparece com texto elegante e polido na barra de informações."]);
    docSheet.appendRow(["G) Musica_Atual", "Texto informativo indicando a trilha de fundo, o som ou o bardo atual.", "Atualizado em tempo real na barra de player em execução."]);
    docSheet.appendRow(["H) Buff_RPG", "O buff de RPG que os membros ganham ao assistir à transmissão (ex: '+15% EXP').", "Alimenta a imersão temática e dá bônus virtuais destacados em verde piscante no player!"]);

    docSheet.appendRow(["", "", ""]); // Linha vazia
    docSheet.appendRow(["INTEGRAÇÃO TELEGRAM", "COMO CONFIGURAR SEU COMPATÍVEL TELEGRAM WEB APP (MINI APP)", "DETALHADO"]);
    docSheet.appendRow(["Passo 1", "Abra o Telegram, procure pelo robô oficial @BotFather e envie o comando '/newbot' para criar o seu robô.", "Guarde o token HTTP de acesso fornecido por ele."]);
    docSheet.appendRow(["Passo 2", "Agora envie o comando '/newapp' no chat com o BotFather.", "Ele perguntará qual bot gerenciará o app, selecione o robô recém-criado."]);
    docSheet.appendRow(["Passo 3", "Insira o título e uma descrição rápida para o seu app de TV/Rádio do clã.", "Escolha e faça upload de uma foto de capa para o Mini App."]);
    docSheet.appendRow(["Passo 4", "Quando o BotFather pedir a 'Web App URL', informe o link HTTPS gerado por este aplicativo de sintonia.", "DICA: O player é responsivo e encaixa de forma deslumbrante na janela nativa do celular pelo Telegram!"]);
    docSheet.appendRow(["Passo 5", "Escolha um link curto de chamada (ex: aovivo). Pronto! Use o endereço t.me/SeuBot/aovivo para enviar nos clãs e grupos.", "Os guerreiros assistem à TV com buffet em alta fidelidade instantaneamente dentro do próprio Telegram!"]);

    // Formatação visual do Manual
    docSheet.getRange("A3:C3").setFontWeight("bold").setBackground("#e2e8f0").setHorizontalAlignment("left");
    docSheet.getRange("A13:C13").setFontWeight("bold").setBackground("#e2e8f0").setHorizontalAlignment("left");
    docSheet.getRange("A4:A11").setFontWeight("bold").setFontColor("#8b5cf6");
    docSheet.getRange("A14:A18").setFontWeight("bold").setFontColor("#229ED9");
    
    docSheet.setColumnWidth(1, 150);
    docSheet.setColumnWidth(2, 450);
    docSheet.setColumnWidth(3, 400);
  }
}

/**
 * Retornos em formato JSON com cabeçalhos CORS livres
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
