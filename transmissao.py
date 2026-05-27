import os
import sys
import json
import subprocess
import threading
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
        data_str   = str(r.get("Data", "")).strip()
        horario    = str(r.get("Horario", "")).strip()
        programa   = str(r.get("Programa", "Empire TV")).strip()
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
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%H:%M:%S",
        "%H:%M",
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

def validate_video(path):
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_type",
                "-of", "json", path
            ],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            log(f"  ffprobe falhou em {os.path.basename(path)}: {result.stderr[:100]}")
            return False
        data = json.loads(result.stdout)
        streams = data.get("streams", [])
        if not streams:
            log(f"  {os.path.basename(path)}: sem stream de vídeo — inválido")
            return False
        log(f"  {os.path.basename(path)}: OK ✓")
        return True
    except Exception as e:
        log(f"  ffprobe erro: {e}")
        return False

def download_video(drive_id, output_path):
    MIN_BYTES = 5 * 1024 * 1024

    if os.path.exists(output_path):
        size = os.path.getsize(output_path)
        if size > MIN_BYTES:
            log(f"Já em cache: {output_path} ({size/1024/1024:.1f} MB)")
            return True
        os.remove(output_path)

    log(f"Baixando ID: {drive_id} → {output_path}")
    url = f"https://drive.google.com/file/d/{drive_id}/view"

    try:
        result = subprocess.run(
            ["yt-dlp", "--no-playlist", "-o", output_path, url],
            capture_output=True, text=True, timeout=600
        )
        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > MIN_BYTES:
            log(f"Download OK via yt-dlp: {os.path.getsize(output_path)/1024/1024:.1f} MB")
            return True
        log(f"yt-dlp falhou (código {result.returncode}): {result.stderr[-200:]}")
    except Exception as e:
        log(f"yt-dlp erro: {e}")

    try:
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        })
        dl_url = f"https://drive.google.com/uc?export=download&id={drive_id}"
        resp = session.get(dl_url, stream=True, timeout=30)
        content_type = resp.headers.get("Content-Type", "")
        if "text/html" in content_type:
            import re
            html = resp.text
            token = ""
            m = re.search(r'name="uuid"\s+value="([^"]+)"', html)
            if m:
                token = m.group(1)
            else:
                m = re.search(r'confirm=([0-9A-Za-z_\-]+)', html)
                if m:
                    token = m.group(1)
            confirm_param = f"&uuid={token}" if token and len(token) > 10 else ""
            dl_url = f"https://drive.google.com/uc?export=download&id={drive_id}&confirm=t{confirm_param}"
            resp = session.get(dl_url, stream=True, timeout=60)
        total = 0
        with open(output_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)
        if total > MIN_BYTES:
            log(f"Download OK via requests: {total/1024/1024:.1f} MB")
            return True
        log(f"requests: arquivo muito pequeno ({total} bytes).")
        if os.path.exists(output_path):
            os.remove(output_path)
    except Exception as e:
        log(f"requests erro: {e}")
        if os.path.exists(output_path):
            os.remove(output_path)

    log(f"FALHA TOTAL no download do ID: {drive_id}")
    return False

def download_all_parallel(videos):
    results = {}
    threads = []
    def worker(v):
        path = f"/tmp/video_{v['drive_id']}.mp4"
        results[v["drive_id"]] = (path, download_video(v["drive_id"], path))
    for v in videos:
        t = threading.Thread(target=worker, args=(v,))
        threads.append(t)
        t.start()
    for t in threads:
        t.join()
    return results

def transmit_playlist(video_paths, rtmp_url, rtmp_key):
    """
    Transmite cada vídeo individualmente em sequência.
    Isso evita completamente o problema de DTS out of order
    que ocorre com ffmpeg concat quando vídeos têm timestamps diferentes.
    """
    raw_url = rtmp_url.rstrip("/")
    if raw_url.startswith("rtmps://"):
        host_path = raw_url.replace("rtmps://", "")
        dest = f"rtmps://{host_path}/app/{rtmp_key}"
    else:
        dest = f"{raw_url}/app/{rtmp_key}"

    log(f"Transmitindo {len(video_paths)} vídeo(s) em sequência...")
    log(f"Destino RTMP: {raw_url}/app/<chave_oculta>")

    for i, path in enumerate(video_paths):
        log(f"[{i+1}/{len(video_paths)}] Transmitindo: {os.path.basename(path)}")
        cmd = [
            "ffmpeg", "-re",
            "-i", path,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-b:v", "8000k",
            "-maxrate", "8000k",
            "-bufsize", "16000k",
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black",
            "-r", "60",
            "-g", "120",
            "-keyint_min", "120",
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
        if process.returncode != 0:
            log(f"  FFmpeg encerrou com erro no vídeo {i+1} (código {process.returncode}) — continuando...")
        else:
            log(f"  Vídeo {i+1} concluído.")

    log("=== TODOS OS VÍDEOS TRANSMITIDOS ===")
    return True

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
    log(f"RTMP_URL recebida: '{rtmp_url}'")
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
    for v in videos:
        log(f"  [{v['horario']}] {v['programa']} — ID: {v['drive_id']} ({v['duracao']}s)")

    update_status(sheet, [v["row"] for v in videos], "Transmitindo")

    log("Iniciando downloads paralelos...")
    download_results = download_all_parallel(videos)

    log("Validando arquivos com ffprobe...")
    video_paths = []
    failed_rows = []
    for v in videos:
        path, success = download_results.get(v["drive_id"], (None, False))
        if not success:
            log(f"FALHA no download: {v['programa']} (ID: {v['drive_id']})")
            failed_rows.append(v["row"])
            continue
        if validate_video(path):
            video_paths.append(path)
        else:
            log(f"INVÁLIDO: {v['programa']} (ID: {v['drive_id']}) — removido da playlist")
            failed_rows.append(v["row"])
            if os.path.exists(path):
                os.remove(path)

    if failed_rows:
        update_status(sheet, failed_rows, "Pendente")

    if not video_paths:
        log("Nenhum vídeo válido para transmitir. Abortando.")
        update_status(sheet, [v["row"] for v in videos], "Falha")
        sys.exit(1)

    log(f"{len(video_paths)} arquivo(s) validados — iniciando transmissão!")
    transmit_playlist(video_paths, rtmp_url, rtmp_key)

    for path in video_paths:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass

    transmitted_rows = [
        v["row"] for v in videos
        if download_results.get(v["drive_id"], (None, False))[1]
        and v["row"] not in failed_rows
    ]
    update_status(sheet, transmitted_rows, "Finalizado")
    log("=== TRANSMISSÃO CONCLUÍDA COM SUCESSO ===")

if __name__ == "__main__":
    main()
