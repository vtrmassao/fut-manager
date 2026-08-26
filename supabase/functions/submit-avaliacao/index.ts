// supabase/functions/submit-avaliacao/index.ts
// Avaliadores (anon) enviam notas/stats; service role grava com dedupe (partida_id, avaliador_id).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const partidaId = body.partidaId;
  const avaliadorId = body.avaliadorId;
  if (!isUuid(partidaId) || !isUuid(avaliadorId)) {
    return json({ error: "partidaId e avaliadorId devem ser UUID" }, 400);
  }

  const notasIn = body.notas && typeof body.notas === "object"
    ? body.notas as Record<string, unknown>
    : {};
  const notas: { avaliado_id: string; nota: number }[] = [];
  for (const [k, v] of Object.entries(notasIn)) {
    if (!isUuid(k) || k === avaliadorId) continue;
    const n = Math.min(5, Math.max(1, Math.round(Number(v))));
    if (!n || isNaN(n)) continue;
    notas.push({ avaliado_id: k, nota: n });
  }
  if (!notas.length) return json({ error: "Nenhuma nota válida" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: partida, error: pErr } = await admin
    .from("partidas")
    .select("id, data, fut_id")
    .eq("id", partidaId)
    .maybeSingle();
  if (pErr) return json({ error: pErr.message }, 500);
  if (!partida) return json({ error: "Partida não encontrada" }, 404);

  const futId = partida.fut_id as string;

  // Upsert avaliação (dedupe)
  const { data: existing } = await admin
    .from("avaliacoes")
    .select("id")
    .eq("partida_id", partidaId)
    .eq("avaliador_id", avaliadorId)
    .maybeSingle();

  let avaliacaoId: string;
  if (existing?.id) {
    avaliacaoId = existing.id;
    await admin.from("avaliacao_notas").delete().eq("avaliacao_id", avaliacaoId);
    await admin.from("avaliacao_stats").delete().eq("avaliacao_id", avaliacaoId);
    await admin.from("avaliacoes").update({
      importado_em: new Date().toISOString(),
      data: body.data || partida.data,
    }).eq("id", avaliacaoId);
  } else {
    const { data: inserted, error: iErr } = await admin.from("avaliacoes").insert({
      fut_id: futId,
      partida_id: partidaId,
      avaliador_id: avaliadorId,
      data: typeof body.data === "string" ? body.data : partida.data,
    }).select("id").single();
    if (iErr) return json({ error: iErr.message }, 500);
    avaliacaoId = inserted.id;
  }

  const { error: nErr } = await admin.from("avaliacao_notas").insert(
    notas.map((n) => ({ avaliacao_id: avaliacaoId, ...n })),
  );
  if (nErr) return json({ error: nErr.message }, 500);

  const statsIn = body.stats && typeof body.stats === "object"
    ? body.stats as Record<string, unknown>
    : {};
  const statsRows: {
    avaliacao_id: string;
    player_id: string;
    gols: number;
    assistencias: number;
    defesas: number | null;
  }[] = [];

  for (const [k, raw] of Object.entries(statsIn)) {
    if (!isUuid(k)) continue;
    let gols = 0, assistencias = 0, defesas: number | null = null;
    if (Array.isArray(raw)) {
      gols = Math.max(0, Math.round(Number(raw[0]) || 0));
      assistencias = Math.max(0, Math.round(Number(raw[1]) || 0));
      if (raw.length > 2) defesas = Math.max(0, Math.round(Number(raw[2]) || 0));
    } else if (raw && typeof raw === "object") {
      const s = raw as Record<string, unknown>;
      gols = Math.max(0, Math.round(Number(s.gols) || 0));
      assistencias = Math.max(0, Math.round(Number(s.assistencias) || 0));
      if (Object.prototype.hasOwnProperty.call(s, "defesas")) {
        defesas = Math.max(0, Math.round(Number(s.defesas) || 0));
      }
    }
    statsRows.push({ avaliacao_id: avaliacaoId, player_id: k, gols, assistencias, defesas });
  }
  if (statsRows.length) {
    const { error: sErr } = await admin.from("avaliacao_stats").insert(statsRows);
    if (sErr) return json({ error: sErr.message }, 500);
  }

  // Recalcula nivel_avaliacao dos jogadores deste fut a partir de todas as notas
  const { data: futAvaliacoes } = await admin.from("avaliacoes").select("id").eq("fut_id", futId);
  const avaliacaoIds = (futAvaliacoes || []).map((a) => a.id as string);
  const { data: allNotas } = avaliacaoIds.length
    ? await admin.from("avaliacao_notas").select("avaliado_id, nota").in("avaliacao_id", avaliacaoIds)
    : { data: [] as { avaliado_id: string; nota: number }[] };
  const sums: Record<string, { sum: number; count: number }> = {};
  for (const row of allNotas || []) {
    const id = row.avaliado_id as string;
    if (!sums[id]) sums[id] = { sum: 0, count: 0 };
    sums[id].sum += Number(row.nota) || 0;
    sums[id].count++;
  }
  for (const [id, s] of Object.entries(sums)) {
    const nivel = Math.min(5, Math.max(1, Math.round(s.sum / s.count)));
    await admin.from("jogadores").update({ nivel_avaliacao: nivel }).eq("id", id).eq("fut_id", futId);
  }

  // Aplica stats autodeclarados nos participantes (média simples se vários relatos — aqui sobrescreve do avaliador)
  for (const st of statsRows) {
    const patch: Record<string, number> = {
      gols: st.gols,
      assistencias: st.assistencias,
    };
    if (st.defesas != null) patch.defesas = st.defesas;
    await admin.from("partida_participantes")
      .update(patch)
      .eq("partida_id", partidaId)
      .eq("player_id", st.player_id);
  }

  return json({ ok: true, avaliacaoId, notas: notas.length, stats: statsRows.length });
});
