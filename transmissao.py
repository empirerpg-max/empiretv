import os
import sys
import json
import subprocess
import shutil
import re
from datetime import datetime
import pytz
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import requests

TZ_SP = pytz.timezone("America/Sao_Paulo")

MODO_TESTE = "--teste" in sys.argv

def log(msg):
    print(f"[{datetime.now(TZ_SP).strftime('%H:%M:%S')}] {msg}", flush=True)

def setup_gspread():
    log("Autenticando no Google Sheets...")
    creds_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if not creds_json:
        log("ERRO: GOOGLE_APPLICATION_CREDENTIALS_JSON ausente!")
        sys.exit(1)
    creds_data = json.loads(creds_json)
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_data, scope)
    client = gspread.authorize(creds)
    log("Autenticado com sucesso!")
    return client

# ── DETECÇÃO DE FONTE DO VÍDEO ──────────────────────────────────────────────

def extract_source(val):
    """
    Retorna (tipo, valor):
      - ('youtube', url)   → URL do YouTube (youtube.com ou youtu.be)
      - ('drive', id)      → ID do Google Drive
      - ('', '')           → inválido
    """
    if not val:
        return ("", "")
    val = val.strip()

    # YouTube
    if "youtube.com" in val or "youtu.be" in val:
        return ("youtube", val)

    # Google Drive — extrai ID de URL ou aceita ID puro
    if "drive.google.com" in val:
        m = re.search(r"/d/([a-zA-Z0-9_-]{10,})(?:/|\?|$)", val)
        return ("drive", m.group(1)) if m else ("", "")

    if re.match(r"^[a-zA-Z0-9_-]{10,}$", val):
        return ("drive", val)

    return ("", "")

def extract_drive_id(val):
    """Mantido para compatibilidade — retorna só o ID do Drive."""
    tipo, valor = extract_source(val)
    return valor if tipo == "drive" else (val.strip() if val.strip() else "")

# ── FIM DETECÇÃO ────────────────────────────────────────────────────────────

def get_pending_videos(sheet):
    raw_data = sheet.get_all_values()
    if not raw_data or len(raw_data) < 2:
        log("Planilha vazia.")
        return []
    headers = [re.sub(r'^[A-Z]\s*[—-]\s*', '', h).strip() for h in raw_data[0]]
    records = [dict(zip(headers, row)) for row in raw_data[1:]]
    now = datetime.now(TZ_SP)

    def parse_row(idx, r):
        status = str(r.get("Status", "")).strip().lower()
        if status in ("finalizado", "transmitindo", "falha"):
            return None
        raw_val = str(r.get("Drive_ID") or r.get("Drive_Video_ID") or "").strip()
        tipo_src, valor_src = extract_source(raw_val)
        if not valor_src:
            log(f"Linha {idx+2} ignorada: Drive_ID/URL ausente ou inválido.")
            return None
        try:
            duracao = int(str(r.get("Duracao_Seg") or r.get("Duracao_Segundos") or "0").strip())
        except ValueError:
            duracao = 0
        if duracao <= 0:
            log(f"Linha {idx+2} ignorada: Duracao_Seg ausente/inválido.")
            return None
        programa = str(r.get("Programa", "Empire TV")).strip()
        data_str = str(r.get("Data", "")).strip()
        horario  = str(r.get("Horario", "")).strip()
        raw_row  = raw_data[idx + 1]
        label_programa = str(raw_row[5]).strip() if len(raw_row) > 5 else programa
        tipo_col = str(raw_row[6]).strip() if len(raw_row) > 6 else ""
        titulo   = str(raw_row[7]).strip() if len(raw_row) > 7 else ""
        return {
            "row": idx + 2, "fonte_tipo": tipo_src, "fonte_valor": valor_src,
            "programa": programa, "duracao": duracao,
            "data_str": data_str, "horario": horario,
            "label_programa": label_programa, "tipo": tipo_col, "titulo": titulo,
        }

    if MODO_TESTE:
        log("*** MODO TESTE ATIVO — ignorando validação de data/hora ***")
        videos = []
        for idx, r in enumerate(records):
            entry = parse_row(idx, r)
            if entry:
                entry["horario"] = f"{entry['data_str']} {entry['horario']}".strip()
                videos.append(entry)
        return videos

    candidatos = []
    for idx, r in enumerate(records):
        entry = parse_row(idx, r)
        if not entry:
            continue
        if not entry["horario"]:
            log(f"Linha {entry['row']} ({entry['programa']}) sem horário — ignorando.")
            continue
        sched = parse_datetime(entry["data_str"], entry["horario"], now)
        if not sched:
            log(f"Linha {entry['row']} ({entry['programa']}) data/hora inválida — ignorando.")
            continue
        if now >= sched:
            entry["sched"] = sched
            candidatos.append(entry)
        else:
            log(f"Linha {entry['row']} ({entry['programa']}) agendada para {entry['data_str']} {entry['horario']} — ainda não chegou.")

    if not candidatos:
        return []

    sched_mais_cedo = min(c["sched"] for c in candidatos)
    programa_ativo  = next(c["programa"] for c in candidatos if c["sched"] == sched_mais_cedo)
    log(f"Grupo ativo: '{programa_ativo}' — início {sched_mais_cedo.strftime('%d/%m/%Y %H:%M')}")

    grupo = [
        {**c, "horario": f"{c['data_str']} {c['horario']}".strip()}
        for c in candidatos
        if c["programa"] == programa_ativo and c["sched"] == sched_mais_cedo
    ]
    grupo.sort(key=lambda x: x["row"])
    return grupo

def parse_datetime(data_str, horario_str, now):
    combined = f"{data_str} {horario_str}".strip() if data_str else horario_str.strip()
    fmts = [
        "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S",
        "%H:%M:%S", "%H:%M",
    ]
    for fmt in fmts:
        try:
            dt = datetime.strptime(combined, fmt)
            if fmt in ("%H:%M", "%H:%M:%S"):
                dt = now.replace(hour=dt.hour, minute=dt.minute, second=0, microsecond=0)
            if dt.tzinfo is None:
                dt = TZ_SP.localize(dt)
            return dt
        except ValueError:
            continue
    return None

# ── VINHETA ANIMADA ──────────────────────────────────────────────────────────

def _wrap_text(text, font, draw, max_width):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        w = draw.textbbox((0, 0), test, font=font)[2]
        if w <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines

def generate_title_card(titulo, label_programa, output_path):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        log("  Pillow não instalado — gerando vinheta estática via FFmpeg.")
        return _generate_title_card_fallback(titulo, label_programa, output_path)

    W, H = 1920, 1080
    FPS = 30
    DURACAO = 10
    total_frames = DURACAO * FPS
    typing_frames = int(total_frames * 0.5)
    MAX_TXT_W = 1720

    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    font_path = next((fp for fp in font_paths if os.path.exists(fp)), None)

    font_size = 88
    tmp_img  = Image.new("RGB", (W, H), (0, 0, 0))
    tmp_draw = ImageDraw.Draw(tmp_img)
    while font_size >= 48:
        font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
        lines = _wrap_text(titulo, font, tmp_draw, MAX_TXT_W)
        widths = [tmp_draw.textbbox((0, 0), l, font=font)[2] for l in lines]
        if max(widths) <= MAX_TXT_W:
            break
        font_size -= 4

    font       = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
    font_small = ImageFont.truetype(font_path, max(24, font_size // 3)) if font_path else font

    purple = (164, 112, 239)
    white  = (255, 255, 255)
    black  = (0, 0, 0)
    gray   = (110, 110, 110)

    lines   = _wrap_text(titulo, font, tmp_draw, MAX_TXT_W)
    line_h  = tmp_draw.textbbox((0, 0), "Ag", font=font)[3] + 12
    block_h = line_h * len(lines)
    y0_block = (H - block_h) // 2 - 20
    chars_total = len(titulo)

    frames_dir = f"/tmp/tc_frames_{os.getpid()}"
    os.makedirs(frames_dir, exist_ok=True)

    step = 2
    for fi in range(0, total_frames, step):
        img  = Image.new("RGB", (W, H), black)
        draw = ImageDraw.Draw(img)
        n_chars = chars_total if fi >= typing_frames else max(1, int((fi / typing_frames) * chars_total))
        current_text = titulo[:n_chars]
        show_cursor  = (fi // 15) % 2 == 0
        cur_lines = _wrap_text(current_text, font, draw, MAX_TXT_W)
        for li, line in enumerate(cur_lines):
            lb = draw.textbbox((0, 0), line, font=font)
            lw = lb[2] - lb[0]
            lx = (W - lw) // 2
            ly = y0_block + li * line_h
            draw.text((lx + 3, ly + 3), line, font=font, fill=(30, 0, 55))
            draw.text((lx, ly), line, font=font, fill=purple)
        if n_chars < chars_total or fi < typing_frames + FPS:
            last_line = cur_lines[-1] if cur_lines else ""
            cb = draw.textbbox((0, 0), last_line, font=font)
            last_lx = (W - (draw.textbbox((0, 0), cur_lines[-1] if cur_lines else "", font=font)[2])) // 2 if cur_lines else W // 2
            cx = last_lx + (cb[2] - cb[0]) + 6
            last_ly = y0_block + (len(cur_lines) - 1) * line_h
            if show_cursor:
                draw.text((cx, last_ly), "_", font=font, fill=white)
        lp = min(1.0, fi / max(1, typing_frames * 0.75))
        max_lw = min(MAX_TXT_W, max(draw.textbbox((0, 0), l, font=font)[2] for l in lines))
        bar_w = int(max_lw * lp)
        bar_y = y0_block + block_h + 16
        bar_x = (W - max_lw) // 2
        if bar_w > 0:
            draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + 3], fill=purple)
        if label_programa:
            alpha = min(200, fi * 10)
            lc = tuple(int(c * alpha / 200) for c in gray)
            lb2 = draw.textbbox((0, 0), label_programa, font=font_small)
            lx2 = (W - (lb2[2] - lb2[0])) // 2
            draw.text((lx2, y0_block - 60), label_programa, font=font_small, fill=lc)
        img.save(f"{frames_dir}/f{fi:05d}.png")

    for fi in range(total_frames):
        target = f"{frames_dir}/f{fi:05d}.png"
        if not os.path.exists(target):
            prev = (fi // step) * step
            shutil.copy(f"{frames_dir}/f{prev:05d}.png", target)

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", f"{frames_dir}/f%05d.png",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", str(DURACAO),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-vf", "scale=1920:1080",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-r", str(FPS), "-g", "60",
        "-keyint_min", "60", "-sc_threshold", "0",
        "-video_track_timescale", "90000",
        "-avoid_negative_ts", "make_zero",
        "-shortest", output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    shutil.rmtree(frames_dir, ignore_errors=True)
    if result.returncode == 0 and os.path.exists(output_path):
        log(f"  ✓ Vinheta gerada: '{titulo}' (10s, {len(lines)} linha(s), fonte {font_size}px)")
        return True
    log(f"  FALHA ao gerar vinheta: {result.stderr[-200:]}")
    return False

def _generate_title_card_fallback(titulo, label_programa, output_path):
    titulo_safe = titulo.replace("'", "\\'").replace(":", "\\:")
    label_safe  = label_programa.replace("'", "\\'").replace(":", "\\:")
    vf = (
        f"drawtext=text='{label_safe}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        f":fontsize=30:fontcolor=0x6e6e6e:x=(w-text_w)/2:y=(h/2)-120,"
        f"drawtext=text='{titulo_safe}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        f":fontsize=72:fontcolor=0xa470ef:x=(w-text_w)/2:y=(h-text_h)/2-20"
    )
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:size=1920x1080:rate=30:duration=10",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", "10", "-vf", vf,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-r", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
        "-video_track_timescale", "90000", "-avoid_negative_ts", "make_zero",
        "-shortest", output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode == 0 and os.path.exists(output_path):
        log(f"  ✓ Vinheta estática (fallback): '{titulo}' (10s)")
        return True
    log(f"  FALHA no fallback: {result.stderr[-200:]}")
    return False

# ── FIM VINHETA ──────────────────────────────────────────────────────────────

# ── DOWNLOAD ─────────────────────────────────────────────────────────────────

def download_video(fonte_tipo, fonte_valor, output_path):
    MIN_BYTES = 5 * 1024 * 1024
    if os.path.exists(output_path) and os.path.getsize(output_path) > MIN_BYTES:
        log(f"  Já em cache: {os.path.getsize(output_path)/1024/1024:.1f} MB")
        return True
    if os.path.exists(output_path):
        os.remove(output_path)

    if fonte_tipo == "youtube":
        return _download_youtube(fonte_valor, output_path, MIN_BYTES)
    else:
        return _download_drive(fonte_valor, output_path, MIN_BYTES)

def _download_youtube(url, output_path, min_bytes):
    log(f"  [YouTube] Baixando: {url}")
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", output_path,
                url
            ],
            capture_output=True, text=True, timeout=600
        )
        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > min_bytes:
            log(f"  [YouTube] Download OK: {os.path.getsize(output_path)/1024/1024:.1f} MB")
            return True
        log(f"  [YouTube] ⚠ FALHA — vídeo pode estar protegido, com restrição de região ou removido.")
        log(f"  [YouTube] Detalhe: {result.stderr[-200:]}")
    except Exception as e:
        log(f"  [YouTube] ⚠ ERRO inesperado: {e}")
    if os.path.exists(output_path):
        os.remove(output_path)
    return False

def _download_drive(drive_id, output_path, min_bytes):
    url = f"https://drive.google.com/file/d/{drive_id}/view"
    try:
        result = subprocess.run(
            ["yt-dlp", "--no-playlist", "-o", output_path, url],
            capture_output=True, text=True, timeout=600
        )
        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > min_bytes:
            log(f"  Download OK: {os.path.getsize(output_path)/1024/1024:.1f} MB")
            return True
        log(f"  yt-dlp falhou ({result.returncode}): {result.stderr[-150:]}")
    except Exception as e:
        log(f"  yt-dlp erro: {e}")
    try:
        session = requests.Session()
        session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"})
        dl_url = f"https://drive.google.com/uc?export=download&id={drive_id}"
        resp = session.get(dl_url, stream=True, timeout=30)
        if "text/html" in resp.headers.get("Content-Type", ""):
            html = resp.text
            m = re.search(r'name="uuid"\s+value="([^"]+)"', html) or re.search(r'confirm=([0-9A-Za-z_\-]+)', html)
            token = m.group(1) if m else ""
            extra = f"&uuid={token}" if token and len(token) > 10 else ""
            dl_url = f"https://drive.google.com/uc?export=download&id={drive_id}&confirm=t{extra}"
            resp = session.get(dl_url, stream=True, timeout=60)
        total = 0
        with open(output_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)
        if total > min_bytes:
            log(f"  Download OK (requests): {total/1024/1024:.1f} MB")
            return True
        log(f"  requests: arquivo pequeno ({total} bytes).")
        if os.path.exists(output_path):
            os.remove(output_path)
    except Exception as e:
        log(f"  requests erro: {e}")
        if os.path.exists(output_path):
            os.remove(output_path)
    return False

# ── FIM DOWNLOAD ──────────────────────────────────────────────────────────────

def normalize_video(input_path, output_path):
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black",
        "-r", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
        "-video_track_timescale", "90000", "-avoid_negative_ts", "make_zero",
        "-fflags", "+genpts", output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1024:
        log(f"  Normalizado: {os.path.getsize(output_path)/1024/1024:.1f} MB")
        return True
    log(f"  Normalização falhou: {result.stderr[-200:]}")
    return False

def validate_video(path):
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=codec_type", "-of", "json", path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return False
        data = json.loads(result.stdout)
        return len(data.get("streams", [])) > 0
    except Exception:
        return False

def build_rtmp_dest(rtmp_url, rtmp_key):
    base = rtmp_url.rstrip("/")
    key  = rtmp_key.strip()
    dest = base if (key and base.endswith(key)) else f"{base}/{key}"
    try:
        from urllib.parse import urlparse
        p = urlparse(dest)
        path_parts = p.path.split("/")
        safe_path = "/".join(path_parts[:-1]) + "/<chave_oculta>"
        log(f"[RTMP] Protocolo : {p.scheme}")
        log(f"[RTMP] Host      : {p.netloc}")
        log(f"[RTMP] Caminho   : {safe_path}")
        log(f"[RTMP] URL final : {p.scheme}://{p.netloc}{safe_path}")
    except Exception:
        log("[RTMP] Destino montado (log detalhado falhou)")
    return dest

def transmit_playlist(video_paths, rtmp_url, rtmp_key):
    list_path = "/tmp/ffmpeg_playlist.txt"
    with open(list_path, "w") as f:
        for p in video_paths:
            f.write(f"file '{p}'\n")
    dest = build_rtmp_dest(rtmp_url, rtmp_key)
    log(f"Iniciando FFmpeg — {len(video_paths)} vídeo(s) em sequência contínua...")
    log(f"[CONFIG] 30fps | 6500k vbr | 13000k buf | aac 160k")
    cmd = [
        "ffmpeg", "-re",
        "-f", "concat", "-safe", "0", "-i", list_path,
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-b:v", "6500k", "-maxrate", "6500k", "-bufsize", "13000k",
        "-r", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-f", "flv", dest
    ]
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in process.stdout:
        line = line.strip()
        if "frame=" in line or "time=" in line:
            print(f"\r{line}", end="", flush=True)
        elif line:
            print(line, flush=True)
    process.wait()
    print()
    return process.returncode == 0

def update_status(sheet, rows, status):
    headers = sheet.row_values(1)
    headers_clean = [re.sub(r'^[A-Z]\s*[—-]\s*', '', h).strip() for h in headers]
    status_col = None
    for i, h in enumerate(headers_clean):
        if h.strip().lower() == "status":
            status_col = i + 1
            break
    if not status_col:
        status_col = len(headers) + 1
        sheet.update_cell(1, status_col, "Status")
    for row_num in rows:
        if row_num is not None:
            sheet.update_cell(row_num, status_col, status)
    log(f"Status '{status}' atualizado para linhas: {[r for r in rows if r is not None]}")

def main():
    log("=== EMPIRE TV — INICIANDO TRANSMISSÃO ===")
    log("=== MODO: TESTE MANUAL ===" if MODO_TESTE else "=== MODO: AUTOMÁTICO (agendado) ===")

    spreadsheet_id = os.environ.get("SPREADSHEET_ID")
    rtmp_url = os.environ.get("RTMP_URL")
    rtmp_key = os.environ.get("RTMP_KEY")
    log(f"RTMP_KEY (primeiros 15 chars): '{str(rtmp_key)[:15]}...'")
    log(f"SPREADSHEET_ID (primeiros 10 chars): '{str(spreadsheet_id)[:10]}...'")
    if not all([spreadsheet_id, rtmp_url, rtmp_key]):
        log("ERRO: SPREADSHEET_ID, RTMP_URL ou RTMP_KEY ausentes!")
        sys.exit(1)

    client = setup_gspread()
    try:
        spreadsheet = client.open_by_key(spreadsheet_id) if len(spreadsheet_id) > 40 else client.open(spreadsheet_id)
    except Exception as e:
        log(f"Erro ao abrir planilha: {e}")
        sys.exit(1)
    try:
        sheet = spreadsheet.worksheet("Programacao_RPG")
    except Exception:
        sheet = spreadsheet.get_worksheet(0)

    videos = get_pending_videos(sheet)
    if not videos:
        log("Nenhuma transmissão pendente para agora. Encerrando.")
        sys.exit(0)

    log(f"{len(videos)} vídeo(s) encontrado(s) para transmissão:")
    for i, v in enumerate(videos):
        fonte_label = f"[YouTube] {v['fonte_valor']}" if v['fonte_tipo'] == 'youtube' else f"[Drive] {v['fonte_valor']}"
        log(f"  [{i+1}] {v['programa']} — {fonte_label} ({v['duracao']}s) [{v['horario']}]")

    update_status(sheet, [v["row"] for v in videos], "Transmitindo")

    log("=== FASE 1: Preparando vídeos em ordem ===")
    video_paths = []
    failed_rows = []

    for i, v in enumerate(videos):
        safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', v['fonte_valor'])[:40]
        raw_path  = f"/tmp/raw_{safe_id}.mp4"
        norm_path = f"/tmp/norm_{i:03d}_{safe_id}.mp4"

        if v.get("tipo", "").strip() == "Título" and v.get("titulo", "").strip():
            card_path = f"/tmp/card_{i:03d}.mp4"
            log(f"[{i+1}] Gerando vinheta: '{v['titulo']}' [{v.get('label_programa', '')}]")
            if generate_title_card(v["titulo"], v.get("label_programa", ""), card_path):
                video_paths.append((card_path, None))

        log(f"[{i+1}/{len(videos)}] Baixando: {v['programa']} ({v['fonte_tipo'].upper()})")
        if not download_video(v["fonte_tipo"], v["fonte_valor"], raw_path):
            log(f"  FALHA no download — vídeo {i+1} será pulado")
            failed_rows.append(v["row"])
            continue

        log(f"[{i+1}/{len(videos)}] Normalizando timestamps...")
        if not normalize_video(raw_path, norm_path):
            log(f"  FALHA na normalização — vídeo {i+1} será pulado")
            failed_rows.append(v["row"])
            if os.path.exists(raw_path):
                os.remove(raw_path)
            continue

        if os.path.exists(raw_path):
            os.remove(raw_path)

        if validate_video(norm_path):
            video_paths.append((norm_path, v["row"]))
            log(f"  ✓ Vídeo {i+1} pronto")
        else:
            log(f"  Arquivo inválido — vídeo {i+1} pulado")
            failed_rows.append(v["row"])
            if os.path.exists(norm_path):
                os.remove(norm_path)

    if failed_rows:
        update_status(sheet, failed_rows, "Pendente")

    if not video_paths:
        log("Nenhum vídeo pronto para transmitir. Abortando.")
        update_status(sheet, [v["row"] for v in videos], "Falha")
        sys.exit(1)

    log(f"=== FASE 2: Transmitindo {len(video_paths)} vídeo(s) sem interrupção ===")
    for i, (path, _) in enumerate(video_paths):
        log(f"  [{i+1}] {os.path.basename(path)}")

    paths_only = [p for p, _ in video_paths]
    success = transmit_playlist(paths_only, rtmp_url, rtmp_key)

    for path, _ in video_paths:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass

    transmitted_rows = [row for _, row in video_paths if row is not None]
    if success:
        update_status(sheet, transmitted_rows, "Finalizado")
        log("=== TRANSMISSÃO CONCLUÍDA COM SUCESSO ===")
    else:
        update_status(sheet, transmitted_rows, "Falha")
        log("=== TRANSMISSÃO ENCERRADA COM FALHA ===")
        sys.exit(1)

if __name__ == "__main__":
    main()
