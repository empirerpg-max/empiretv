import os
import sys
import json
import subprocess
from datetime import datetime
import pytz
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import requests

TZ_SP = pytz.timezone("America/Sao_Paulo")

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

def get_pending_videos(sheet):
    import re
    raw_data = sheet.get_all_values()
    if not raw_data or len(raw_data) < 2:
        log("Planilha vazia.")
        return []
    headers = [re.sub(r'^[A-Z]\s*[—-]\s*', '', h).strip() for h in raw_data[0]]
    records = [dict(zip(headers, row)) for row in raw_data[1:]]
    now = datetime.now(TZ_SP)
    videos = []
    grade_iniciada = False
    for idx, r in enumerate(records):
        status = str(r.get("Status", "")).strip().lower()
        if status in ("finalizado", "transmitindo", "falha"):
            continue
        drive_raw = str(r.get("Drive_ID") or r.get("Drive_Video_ID") or "").strip()
        drive_id = extract_drive_id(drive_raw)
        try:
            duracao = int(str(r.get("Duracao_Seg") or r.get("Duracao_Segundos") or "0").strip())
        except ValueError:
            duracao = 0
        data_str = str(r.get("Data", "")).strip()
        horario  = str(r.get("Horario", "")).strip()
        programa = str(r.get("Programa", "Empire TV")).strip()
        if not drive_id or duracao <= 0:
            log(f"Linha {idx+2} ignorada: Drive_ID ou Duracao_Seg ausente/inválido.")
            continue
        if horario:
            sched = parse_datetime(data_str, horario, now)
            if sched and now >= sched:
                grade_iniciada = True
                videos.append({"row": idx+2, "drive_id": drive_id, "programa": programa, "duracao": duracao, "horario": f"{data_str} {horario}".strip()})
            elif sched and now < sched:
                log(f"Linha {idx+2} ({programa}) agendada para {data_str} {horario} — ainda não chegou.")
            else:
                log(f"Linha {idx+2} ({programa}) com data/hora inválida: '{data_str} {horario}' — ignorando.")
        else:
            if grade_iniciada:
                videos.append({"row": idx+2, "drive_id": drive_id, "programa": programa, "duracao": duracao, "horario": "(encadeado)"})
            else:
                log(f"Linha {idx+2} ({programa}) sem horário e grade não iniciou — ignorando.")
    return videos

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

def extract_drive_id(val):
    if not val:
        return ""
    import re
    if "drive.google.com" in val or val.startswith("http"):
        m = re.search(r"/d/([a-zA-Z0-9_-]{10,})(?:/|\?|$)", val)
        return m.group(1) if m else ""
    if re.match(r"^[a-zA-Z0-9_-]{10,}$", val):
        return val
    return ""

def download_video(drive_id, output_path):
    MIN_BYTES = 5 * 1024 * 1024
    if os.path.exists(output_path) and os.path.getsize(output_path) > MIN_BYTES:
        log(f"  Já em cache: {os.path.getsize(output_path)/1024/1024:.1f} MB")
        return True
    if os.path.exists(output_path):
        os.remove(output_path)

    url = f"https://drive.google.com/file/d/{drive_id}/view"
    try:
        result = subprocess.run(
            ["yt-dlp", "--no-playlist", "-o", output_path, url],
            capture_output=True, text=True, timeout=600
        )
        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > MIN_BYTES:
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
            import re
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
        if total > MIN_BYTES:
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

def normalize_video(input_path, output_path):
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black",
        "-r", "30",
        "-g", "60",
        "-keyint_min", "60",
        "-sc_threshold", "0",
        "-video_track_timescale", "90000",
        "-avoid_negative_ts", "make_zero",
        "-fflags", "+genpts",
        output_path
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
    if key and base.endswith(key):
        dest = base
    else:
        dest = f"{base}/{key}"
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
        log(f"[RTMP] Destino montado (log detalhado falhou)")
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
        "-f", "concat", "-safe", "0",
        "-i", list_path,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-b:v", "6500k",
        "-maxrate", "6500k",
        "-bufsize", "13000k",
        "-r", "30",
        "-g", "60",
        "-keyint_min", "60",
        "-sc_threshold", "0",
        "-c:a", "aac",
        "-b:a", "160k",
        "-ar", "44100",
        "-f", "flv",
        dest
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
    import re
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
        sheet.update_cell(row_num, status_col, status)
    log(f"Status '{status}' atualizado para linhas: {rows}")

def main():
    log("=== EMPIRE TV — INICIANDO TRANSMISSÃO ===")
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
        log(f"  [{i+1}] {v['programa']} — ID: {v['drive_id']} ({v['duracao']}s) [{v['horario']}]")

    update_status(sheet, [v["row"] for v in videos], "Transmitindo")

    log("=== FASE 1: Preparando vídeos em ordem ===")
    video_paths = []
    failed_rows = []

    for i, v in enumerate(videos):
        raw_path  = f"/tmp/raw_{v['drive_id']}.mp4"
        norm_path = f"/tmp/norm_{i:03d}_{v['drive_id']}.mp4"

        log(f"[{i+1}/{len(videos)}] Baixando: {v['programa']} ({v['drive_id']})")
        if not download_video(v["drive_id"], raw_path):
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

    transmitted_rows = [row for _, row in video_paths]
    if success:
        update_status(sheet, transmitted_rows, "Finalizado")
        log("=== TRANSMISSÃO CONCLUÍDA COM SUCESSO ===")
    else:
        update_status(sheet, transmitted_rows, "Falha")
        log("=== TRANSMISSÃO ENCERRADA COM FALHA ===")
        sys.exit(1)

if __name__ == "__main__":
    main()
