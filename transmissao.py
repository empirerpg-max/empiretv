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

def download_video(drive_id, output_path):
    """
    Baixa vídeo do Google Drive usando requests com sessão.
    Funciona para arquivos pequenos E grandes (+100MB) automaticamente.
    """
    MIN_BYTES = 5 * 1024 * 1024  # 5 MB mínimo para considerar válido

    if os.path.exists(output_path):
        size = os.path.getsize(output_path)
        if size > MIN_BYTES:
            log(f"Já em cache: {output_path} ({size/1024/1024:.1f} MB)")
            return True
        os.remove(output_path)

    log(f"Baixando ID: {drive_id} → {output_path}")

    session = requests.Session()
    url = f"https://drive.google.com/uc?export=download&id={drive_id}"

    try:
        # Primeira requisição — pega cookies e detecta aviso de arquivo grande
        resp = session.get(url, stream=True, timeout=30)

        # Se vier HTML (aviso de arquivo grande), extrai token de confirmação
        content_type = resp.headers.get("Content-Type", "")
        if "text/html" in content_type:
            html = resp.text
            # Tenta extrair token do formulário de confirmação
            import re
            token = ""
            m = re.search(r'name="uuid"\s+value="([^"]+)"', html)
            if m:
                token = m.group(1)
                url = f"https://drive.google.com/uc?export=download&id={drive_id}&confirm=t&uuid={token}"
            else:
                m = re.search(r'confirm=([0-9A-Za-z_\-]+)', html)
                if m:
                    token = m.group(1)
                    url = f"https://drive.google.com/uc?export=download&id={drive_id}&confirm={token}"
                else:
                    url = f"https://drive.google.com/uc?export=download&id={drive_id}&confirm=t"
            log(f"  Arquivo grande detectado — token: '{token or 't'}'. Refazendo download...")
            resp = session.get(url, stream=True, timeout=60)

        # Salva o arquivo em chunks
        total = 0
        with open(output_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)

        if total > MIN_BYTES:
            log(f"Download OK: {total/1024/1024:.1f} MB")
            return True
        else:
            log(f"Arquivo muito pequeno ({total} bytes) — Drive bloqueou. Verifique permissão 'Qualquer pessoa com o link'.")
            if os.path.exists(output_path):
                os.remove(output_path)
            return False

    except Exception as e:
        log(f"Erro no download: {e}")
        if os.path.exists(output_path):
            os.remove(output_path)
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
    list_path = "/tmp/ffmpeg_playlist.txt"
    with open(list_path, "w") as f:
        for p in video_paths:
            f.write(f"file '{p}'\n")
    log(f"Transmitindo {len(video_paths)} vídeo(s) em sequência contínua...")
    for p in video_paths:
        log(f"  → {p}")
    raw_url = rtmp_url.rstrip("/")
    if raw_url.startswith("rtmps://"):
        host_path = raw_url.replace("rtmps://", "")
        dest = f"rtmps://{host_path}/app/{rtmp_key}"
    else:
        dest = f"{raw_url}/app/{rtmp_key}"
    log(f"Destino RTMP: {raw_url}/app/<chave_oculta>")
    cmd = [
        "ffmpeg", "-re",
        "-f", "concat", "-safe", "0",
        "-i", list_path,
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
    log("Iniciando FFmpeg...")
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
    video_paths = []
    failed_rows = []
    for v in videos:
        path, success = download_results.get(v["drive_id"], (None, False))
        if success:
            video_paths.append(path)
        else:
            log(f"FALHA no download: {v['programa']} (ID: {v['drive_id']})")
            failed_rows.append(v["row"])
    if failed_rows:
        update_status(sheet, failed_rows, "Pendente")
    if not video_paths:
        log("Nenhum vídeo disponível para transmitir. Abortando.")
        update_status(sheet, [v["row"] for v in videos], "Falha")
        sys.exit(1)
    success = transmit_playlist(video_paths, rtmp_url, rtmp_key)
    for path in video_paths:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
    transmitted_rows = [
        v["row"] for v in videos
        if download_results.get(v["drive_id"], (None, False))[1]
    ]
    if success:
        update_status(sheet, transmitted_rows, "Finalizado")
        log("=== TRANSMISSÃO CONCLUÍDA COM SUCESSO ===")
    else:
        update_status(sheet, transmitted_rows, "Falha")
        log("=== TRANSMISSÃO ENCERRADA COM FALHA ===")
        sys.exit(1)

if __name__ == "__main__":
    main()
