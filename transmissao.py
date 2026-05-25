import os
import sys
import time
import json
import subprocess
from datetime import datetime, timedelta
import pytz
import gspread
from oauth2client.service_account import ServiceAccountCredentials

# Configuração de Fuso Horário (Brasília UTC-3)
TZ_SP = pytz.timezone("America/Sao_Paulo")

def log(message):
    now_str = datetime.now(TZ_SP).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] {message}", flush=True)

def setup_gspread():
    """Autentica na API do Google Sheets e Drive usando as credenciais do Secret do GitHub"""
    log("Autenticando na API do Google Sheets...")
    
    # Tentamos obter as credenciais de uma variável de ambiente contendo o JSON completo da conta de serviço
    creds_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if not creds_json:
        log("ERRO CRÍTICO: Variável 'GOOGLE_APPLICATION_CREDENTIALS_JSON' não fornecida!")
        sys.exit(1)
        
    try:
        creds_data = json.loads(creds_json)
        scope = [
            "https://spreadsheets.google.com/feeds",
            "https://www.googleapis.com/auth/drive"
        ]
        creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_data, scope)
        client = gspread.authorize(creds)
        log("Autenticação gspread realizada com sucesso!")
        return client
    except Exception as e:
        log(f"Erro ao autenticar com o gspread: {e}")
        sys.exit(1)

def download_drive_video(file_id, output_path):
    """
    Baixa o arquivo de vídeo MP4 do Google Drive usando o ID informado.
    Utiliza gdown ou wget de forma inteligente para lidar com arquivos gigantes.
    """
    log(f"Iniciando download do vídeo do Drive (ID: {file_id})...")
    
    # Forçamos deleção prévia do arquivo de saída se houver algum vestígio
    if os.path.exists(output_path):
        os.remove(output_path)
        
    # Tentativa de download do arquivo de vídeo público/compartilhado via gdown
    # gdown é um canivete suíço excelente para contornar a tela de aviso de arquivos grandes do Drive
    cmd = ["gdown", "--id", file_id, "-O", output_path, "--remaining-ok"]
    try:
        log(f"Executando comando: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1024 * 1024:
            log(f"Download concluído com sucesso via gdown! Tamanho: {os.path.getsize(output_path) / (1024*1024):.2f} MB")
            return True
    except Exception as e:
        log(f"Falha ao tentar baixar via gdown: {e}")

    # Fallback 2: usando curl com bypass de disclaimer do Drive para arquivos pesados
    log("Tentando baixar via curl (Fallback inteligente de confirmação do Drive)...")
    try:
        # Comando padrão com cookies para burlar confirmação de vírus do Google Drive para arquivos grandes
        confirm_cmd = f"curl -sc /tmp/cookie.txt 'https://drive.google.com/uc?export=download&id={file_id}' &>/dev/null"
        subprocess.run(confirm_cmd, shell=True)
        # Extrai código de autorização do cookie
        with open("/tmp/cookie.txt", "r") as f:
            cookies = f.read()
        
        confirm_code = ""
        for line in cookies.splitlines():
            if "download_warning" in line:
                confirm_code = line.split()[-1]
                break
                
        if confirm_code:
            download_url = f"https://drive.google.com/uc?export=download&confirm={confirm_code}&id={file_id}"
        else:
            download_url = f"https://drive.google.com/uc?export=download&id={file_id}"
            
        curl_cmd = f"curl -L -b /tmp/cookie.txt '{download_url}' -o {output_path}"
        subprocess.run(curl_cmd, shell=True)
        
        if os.path.exists(output_path) and os.path.getsize(output_path) > 1024 * 1024:
            log(f"Download via curl finalizado com sucesso! Tamanho: {os.path.getsize(output_path) / (1024*1024):.2f} MB")
            return True
    except Exception as e:
        log(f"Erro no download via curl: {e}")
        
    return False

def transmit_video_rtmp(video_path, rtmp_url, rtmp_key):
    """
    Executa o FFmpeg por subprocesso para transmitir o vídeo local direto para o servidor RTMP (Twitch/YouTube)
    Otimizado com -c:v copy e -c:a copy para retransmitir instantaneamente sem encode e poupar CPU
    """
    full_rtmp_destination = f"{rtmp_url}/{rtmp_key}" if not rtmp_url.endswith("/") else f"{rtmp_url}{rtmp_key}"
    log(f"Sinalizando FFmpeg para iniciar a transmissão em {rtmp_url} (chave oculta)...")
    
    # Configuração de transmissão limpa sem transcoding (economiza RAM e CPU nos runners do GitHub)
    # -re lê o arquivo na taxa de quadros (frame rate) nativa, de forma síncrona/em tempo real
    ffmpeg_cmd = [
        "ffmpeg",
        "-re",                          # Taxa de reprodução em tempo real (essencial para lives)
        "-i", video_path,               # Entrada de arquivo de vídeo
        "-c:v", "copy",                 # Copia o codec de vídeo sem renderizar (consome 0% de CPU)
        "-c:a", "aac",                  # Garante áudio compatível para Twitch/YouTube convertendo de forma barata
        "-b:a", "128k",                 # Áudio estável de rádio
        "-f", "flv",                    # Contêiner RTMP nativo para serviços de streaming
        full_rtmp_destination           # Destino RTMP final
    ]
    
    try:
        log(f"Iniciando processo de transmissão ao vivo FFmpeg...")
        # Executa em tempo real exibindo a saída
        process = subprocess.Popen(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        
        # Monitora o log do FFmpeg em tempo real no console do GitHub Actions
        for line in process.stdout:
            # Imprime discretamente a linha do progresso
            if "frame=" in line or "time=" in line:
                print(line.strip(), end="\r", flush=True)
            else:
                print(line.strip(), flush=True)
                
        process.wait()
        
        if process.returncode == 0:
            log("Transmissão do vídeo concluída pelo FFmpeg com extremo sucesso!")
            return True
        else:
            log(f"FFmpeg finalizou com código de erro incomum: {process.returncode}")
            return False
    except Exception as e:
        log(f"Erro grave de intercomunicação com subprocesso do FFmpeg: {e}")
        return False

def main():
    log("=== INICIANDO SISTEMA DE TRANSMISSÃO EM COMPACT VOD-TO-LIVE ===")
    
    # 1. Recuperar chaves de ambientes
    spreadsheet_name_or_id = os.environ.get("SPREADSHEET_ID")
    rtmp_url = os.environ.get("RTMP_URL")
    rtmp_key = os.environ.get("RTMP_KEY")
    
    if not spreadsheet_name_or_id or not rtmp_url or not rtmp_key:
        log("ERRO: Variáveis essenciais ausentes (SPREADSHEET_ID, RTMP_URL ou RTMP_KEY)!")
        sys.exit(1)
        
    # 2. Conectar planilha
    client = setup_gspread()
    try:
        if len(spreadsheet_name_or_id) > 40: # Parece ser um ID de planilha do sheets
            spreadsheet = client.open_by_key(spreadsheet_name_or_id)
        else:
            spreadsheet = client.open(spreadsheet_name_or_id)
    except Exception as e:
        log(f"Não foi possível abrir a planilha '{spreadsheet_name_or_id}': {e}")
        sys.exit(1)
        
    # Obtém a guia da programação
    try:
        sheet = spreadsheet.worksheet("Programacao_RPG")
        log("Aba 'Programacao_RPG' aberta com sucesso!")
    except Exception:
        # Tenta pegar a primeira aba do documento como fallback
        log("Aba 'Programacao_RPG' não localizada, usando a primeira aba da planilha.")
        sheet = spreadsheet.get_worksheet(0)
        
    # 3. Ler dados e verificar pendências
    records = sheet.get_all_records()
    if not records:
        log("Planilha vazia ou sem cabeçalhos definidos!")
        sys.exit(0)
        
    now_brasilia = datetime.now(TZ_SP)
    
    # Encontra o primeiro vídeo da lista que está agendado para o momento atual (ou passado recente) e que esteja "Pendente"
    target_row_index = None
    target_record = None
    
    log(f"Vasculhando programações cadastradas. Encontrando pendências para enviar ao ar...")
    
    for idx, r in enumerate(records):
        # Mapeia cabeçalhos ignorando capitalizações
        status_val = str(r.get("Status") or r.get("status") or "").strip()
        horario_str = str(r.get("Horario") or r.get("horario") or "").strip()
        drive_id = str(r.get("Drive_Video_ID") or r.get("link_drive") or r.get("drive_video_id") or "").strip()
        
        if not horario_str or not drive_id:
            continue
            
        # Limpar o drive_id se for uma URL inteira compartilhada
        if "drive.google.com" in drive_id:
            # Tenta extrair id
            import re
            reg = r"\/file\/d\/([^\/]+)|\/open\?id=([^\/&]+)|id=([^\/&]+)"
            matches = re.search(reg, drive_id)
            if matches:
                drive_id = matches.group(1) or matches.group(2) or matches.group(3)
                drive_id = drive_id.strip()

        if status_val.lower() == "pendente":
            # Validar formato da data e hora da planilha: 'YYYY-MM-DD HH:MM' ou tenta flexível
            try:
                # Tenta formato prescrito YYYY-MM-DD HH:MM
                scheduled_time = datetime.strptime(horario_str, "%Y-%m-%d %H:%M")
            except ValueError:
                try:
                    # Alternativa comum d/m/Y H:M (Brasileiro)
                    scheduled_time = datetime.strptime(horario_str, "%d/%m/%Y %H:%M")
                except ValueError:
                    # Se vier apenas hora (ex: HH:MM), assumimos a data de hoje!
                    try:
                        time_parts = datetime.strptime(horario_str, "%H:%M")
                        scheduled_time = now_brasilia.replace(hour=time_parts.hour, minute=time_parts.minute, second=0, microsecond=0)
                    except ValueError:
                        log(f"Formato de horário inválido para a linha do drive {drive_id}: '{horario_str}'")
                        continue
                        
            # Adiciona fuso horário para comparação segura
            if scheduled_time.tzinfo is None:
                scheduled_time = TZ_SP.localize(scheduled_time)
                
            # Verifica se já bateu o horário de exibição (está no passado ou no minuto exato tolerável)
            if now_brasilia >= scheduled_time:
                # Encontramos o vídeo da vez!
                target_row_index = idx + 2 # +2 porque headers é linha 1 e gspread é indexado em 1
                target_record = {
                    "row": target_row_index,
                    "drive_id": drive_id,
                    "title": r.get("Programa") or r.get("programa") or r.get("Titulo") or r.get("titulo") or "Video Alinhado",
                    "scheduled_time": scheduled_time
                }
                break

    if not target_record:
        log("Excelente! Nenhuma transmissão agendada pendente para o momento atual.")
        sys.exit(0)
        
    log(f"🔔 PROGRAMA ENCONTRADO PÁRA TRANSMISSÃO: '{target_record['title']}'")
    log(f"Agendado para: {target_record['scheduled_time'].strftime('%Y-%m-%d %H:%M')} | Linha na Planilha: {target_record['row']}")
    
    # 4. Atualiza o status na planilha para "Transmitindo" instantaneamente (Evita concorrência de múltiplos runs)
    # Procuramos dinamicamente qual a coluna física de 'Status'
    headers_row = sheet.row_values(1)
    status_col_idx = None
    for col_idx, h in enumerate(headers_row):
        if h.strip().lower() == "status":
            status_col_idx = col_idx + 1
            break
            
    if not status_col_idx:
        # Se não houver coluna com cabeçalho 'Status', cria uma no final da planilha para registrar
        status_col_idx = len(headers_row) + 1
        sheet.update_cell(1, status_col_idx, "Status")
        log(f"Criando coluna 'Status' na célula {status_col_idx}...")

    sheet.update_cell(target_record["row"], status_col_idx, "Transmitindo")
    log(f"Status atualizado para 'Transmitindo' na linha {target_record['row']}.")
    
    # 5. Baixar e transmiti-lo
    video_filename = "video_transmissao_atual.mp4"
    download_success = download_drive_video(target_record["drive_id"], video_filename)
    
    if not download_success:
        log("ERRO CRÍTICO: Não foi possível baixar o vídeo do Google Drive! Resetando status na planilha para Pendente...")
        sheet.update_cell(target_record["row"], status_col_idx, "Pendente")
        sys.exit(1)
        
    # Executa a live via FFmpeg
    stream_success = transmit_video_rtmp(video_filename, rtmp_url, rtmp_key)
    
    # Deleta arquivo baixado imediatamente das dependências locais do runner para livrar armazenamento
    if os.path.exists(video_filename):
        os.remove(video_filename)
        log("Ficheiro de vídeo local excluído para liberar espaço em disco.")
        
    # 6. Atualiza o status para "Concluido" ou sinaliza falha
    if stream_success:
        sheet.update_cell(target_record["row"], status_col_idx, "Concluido")
        log(f"🎉 Ciclo concluído com sucesso total! Linha {target_record['row']} foi marcada como 'Concluido'.")
    else:
        sheet.update_cell(target_record["row"], status_col_idx, "Falha")
        log(f"⚠️ FFmpeg abortou a transmissão ou falhou de modo silencioso. Linha {target_record['row']} marcada como 'Falha'.")

if __name__ == "__main__":
    main()
