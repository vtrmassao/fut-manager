// supabase/functions/get-partida-avaliacao/index.ts
// Anon: roster público da partida para a tela #a= (sem webhook).
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
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  let partidaId: unknown;
  if (req.method === "GET") {
    const url = new URL(req.url);
    partidaId = url.searchParams.get("partidaId");
  } else {
    try {
      const body = await req.json();
      partidaId = body?.partidaId;
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }
  }

  if (!isUuid(partidaId)) {
    return json({ error: "partidaId deve ser UUID" }, 400);
  }

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

  const { data: parts, error: partErr } = await admin
    .from("partida_participantes")
    .select("player_id, nome, goleiro")
    .eq("partida_id", partidaId);
  if (partErr) return json({ error: partErr.message }, 500);

  const participantes = (parts || [])
    .map((p) => ({
      playerId: p.player_id as string,
      nome: String(p.nome || "").trim(),
      goleiro: !!p.goleiro,
    }))
    .filter((p) => p.playerId && p.nome);

  if (!participantes.length) {
    return json({ error: "Partida sem jogadores" }, 400);
  }

  return json({
    partidaId: partida.id,
    data: partida.data,
    participantes,
  });
});
