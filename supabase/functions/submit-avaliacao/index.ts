// supabase/functions/submit-avaliacao/index.ts
// Avaliadores (anon) enviam notas/stats; grava pendente; Discord legível; Av/G/A/D só após aprovação.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { recalcAvaliacoesAprovadas } from "../_shared/recalc-avaliacao.ts";

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

function formatDataBR(iso: string) {
  if (!iso || iso.length < 10) return iso || "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
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
  const dataPartida = typeof body.data === "string" && body.data
    ? body.data
    : (partida.data as string);

  const { data: participants } = await admin
    .from("partida_participantes")
    .select("player_id, nome")
    .eq("partida_id", partidaId);
  const nomeById: Record<string, string> = {};
  for (const p of participants || []) {
    nomeById[p.player_id as string] = String(p.nome || "").trim() || "—";
  }
  if (!nomeById[avaliadorId]) {
    return json({ error: "Avaliador não está nesta partida" }, 400);
  }

  const { data: existing } = await admin
    .from("avaliacoes")
    .select("id, aprovada_em, rejeitada_em")
    .eq("partida_id", partidaId)
    .eq("avaliador_id", avaliadorId)
    .maybeSingle();

  const wasComputed = !!(existing?.aprovada_em || existing?.rejeitada_em);
  let avaliacaoId: string;

  if (existing?.id) {
    avaliacaoId = existing.id;
    await admin.from("avaliacao_notas").delete().eq("avaliacao_id", avaliacaoId);
    await admin.from("avaliacao_stats").delete().eq("avaliacao_id", avaliacaoId);
    await admin.from("avaliacoes").update({
      importado_em: new Date().toISOString(),
      data: dataPartida,
      aprovada_em: null,
      rejeitada_em: null,
    }).eq("id", avaliacaoId);
  } else {
    const { data: inserted, error: iErr } = await admin.from("avaliacoes").insert({
      fut_id: futId,
      partida_id: partidaId,
      avaliador_id: avaliadorId,
      data: dataPartida,
      aprovada_em: null,
      rejeitada_em: null,
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

  // Se tinha sido aprovada/rejeitada, recalcula sem ela (evita Av/stats fantasma)
  if (wasComputed) {
    try {
      await recalcAvaliacoesAprovadas(admin, futId, [partidaId]);
    } catch (e) {
      console.error("recalc após reenvio", e);
    }
  }

  // Discord legível (webhook do config do fut)
  let discordOk = false;
  const { data: cfg } = await admin
    .from("config")
    .select("discord_webhook_url")
    .eq("fut_id", futId)
    .maybeSingle();
  const webhook = String(cfg?.discord_webhook_url || "").trim();
  if (!webhook) {
    console.warn("Discord: webhook vazio no config do fut", futId);
  } else if (!/^https:\/\/discord(?:app)?\.com\/api\/webhooks\//i.test(webhook)) {
    console.warn("Discord: URL de webhook inválida (prefixo esperado discord.com/api/webhooks/)");
  } else {
    const avaliadorNome = nomeById[avaliadorId] || "—";
    const selfStats = statsRows.find((s) => s.player_id === avaliadorId);
    const gols = selfStats ? selfStats.gols : 0;
    const assistencias = selfStats ? selfStats.assistencias : 0;
    const content =
      `⚽ **Avaliação** — ${formatDataBR(dataPartida)}\n` +
      `Avaliador: **${avaliadorNome}**\n` +
      `Gols: **${gols}** · Assistências: **${assistencias}**`;
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        console.warn("Discord webhook HTTP", res.status, bodyText.slice(0, 200));
      } else {
        discordOk = true;
      }
    } catch (e) {
      console.warn("Discord webhook falhou", e);
    }
  }

  return json({
    ok: true,
    avaliacaoId,
    notas: notas.length,
    stats: statsRows.length,
    pendente: true,
    discordOk,
  });
});
