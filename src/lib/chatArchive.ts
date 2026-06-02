/**
 * chatArchive.ts
 * Chamado quando a transmissão é encerrada.
 * Busca todas as mensagens da sala no banco, salva em chat_archives
 * e faz download do JSON para o operador.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

export interface ArchiveResult {
  ok: boolean;
  totalMsgs: number;
  jsonUrl: string; // object URL para download
}

export async function closeRoom(
  roomId: string,
  programa: string,
): Promise<ArchiveResult> {
  // 1. Busca todas as mensagens da sala
  const { data: msgs, error } = await sb
    .from("chat_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const messages = msgs ?? [];

  // 2. Salva arquivo no banco
  await sb.from("chat_archives").upsert({
    room_id:       roomId,
    programa,
    encerrado_at:  new Date().toISOString(),
    messages_json: messages,
  }, { onConflict: "room_id" });

  // 3. Gera download do JSON
  const blob    = new Blob([JSON.stringify({ roomId, programa, encerrado_at: new Date().toISOString(), messages }, null, 2)], { type: "application/json" });
  const jsonUrl = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = jsonUrl;
  a.download    = `chat_${programa.replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();

  return { ok: true, totalMsgs: messages.length, jsonUrl };
}
