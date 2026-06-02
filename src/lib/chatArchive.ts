/**
 * chatArchive.ts
 * Chamado quando status muda para "finalizado" no GAS.
 * 1. Busca todas as mensagens do banco
 * 2. Salva em chat_archives (Supabase)
 * 3. Envia resumo para o Google Sheets via GAS webhook
 * 4. Apaga mensagens da sala no banco (libera espaço)
 * 5. Notifica todos no canal broadcast que a sala fechou
 */
import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// URL do GAS que recebe o histórico do chat e salva na planilha
// Aponte para seu webapp GAS com doPost habilitado
const GAS_WEBHOOK = import.meta.env.VITE_GAS_CHAT_WEBHOOK || "";

export interface ArchiveResult {
  ok: boolean;
  totalMsgs: number;
}

export async function closeRoom(
  roomId: string,
  programa: string,
  channel?: RealtimeChannel | null,
): Promise<ArchiveResult> {
  // 1. Busca todas as mensagens da sala
  const { data: msgs, error } = await sb
    .from("chat_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const messages = msgs ?? [];
  const encerrado_at = new Date().toISOString();

  // 2. Salva arquivo no Supabase
  await sb.from("chat_archives").upsert({
    room_id: roomId,
    programa,
    encerrado_at,
    messages_json: messages,
  }, { onConflict: "room_id" });

  // 3. Envia para Google Sheets (se webhook configurado)
  if (GAS_WEBHOOK) {
    try {
      await fetch(GAS_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, programa, encerrado_at, messages }),
      });
    } catch (e) {
      console.warn("[closeRoom] GAS webhook falhou:", e);
    }
  }

  // 4. Apaga mensagens da sala do banco (mantém só o archive)
  await sb.from("chat_messages").delete().eq("room_id", roomId);

  // 5. Notifica todos via broadcast que a sala fechou
  if (channel) {
    await channel.send({ type: "broadcast", event: "close_room", payload: { roomId } });
  }

  return { ok: true, totalMsgs: messages.length };
}
