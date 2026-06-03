/**
 * chatArchive.ts
 * 1. Busca mensagens do banco
 * 2. Salva em chat_archives (≥1 msg)
 * 3. Envia histórico + presença p/ GAS webhook
 * 4. Deleta mensagens da sala
 * 5. Notifica broadcast close_room
 */
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import { endPresence } from "../components/Chat";

const SUPABASE_URL  = "https://rcfzzhucvsqeqdlfoxmq.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZnp6aHVjdnNxZXFkbGZveG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzg2MTQsImV4cCI6MjA5NTkxNDYxNH0.U9SL1CDN2jNpv2H0BSwP-lw2hA045cKtrPbccFWV1BQ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

const GAS_WEBHOOK = import.meta.env.VITE_GAS_CHAT_WEBHOOK || "";

export interface ArchiveResult {
  ok: boolean;
  totalMsgs: number;
  skipped?: boolean;
}

export async function closeRoom(
  roomId: string,
  programa: string,
  channel?: RealtimeChannel | null,
  // duração real da transmissão em ms (calculada pelo ao-vivo.tsx)
  transmissaoDuracaoMs = 0,
): Promise<ArchiveResult> {
  // 1. Busca mensagens
  const { data: msgs, error } = await sb
    .from("chat_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const messages = msgs ?? [];

  // 🛡️ Não arquiva sala vazia
  if (messages.length === 0) {
    console.warn(`[closeRoom] "${roomId}" sem mensagens — arquivamento ignorado.`);
    if (channel) await channel.send({ type: "broadcast", event: "close_room", payload: { roomId } });
    // Encerra presença com 0 de duração conhecida
    await endPresence(transmissaoDuracaoMs);
    return { ok: true, totalMsgs: 0, skipped: true };
  }

  const encerrado_at = new Date().toISOString();

  // 2. Salva archive
  await sb.from("chat_archives").upsert({
    room_id: roomId, programa, encerrado_at, messages_json: messages,
  }, { onConflict: "room_id" });

  // 3. Envia para GAS (histórico)
  if (GAS_WEBHOOK) {
    try {
      await fetch(GAS_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "historico", roomId, programa, encerrado_at, messages }),
      });
    } catch (e) {
      console.warn("[closeRoom] GAS webhook falhou:", e);
    }
  }

  // 4. Deleta mensagens
  await sb.from("chat_messages").delete().eq("room_id", roomId);

  // 5. Broadcast
  if (channel) await channel.send({ type: "broadcast", event: "close_room", payload: { roomId } });

  // 6. Envia presença do usuário local
  await endPresence(transmissaoDuracaoMs);

  return { ok: true, totalMsgs: messages.length };
}
