// supabase/functions/approve-avaliacao/index.ts
// Admin aprova ou rejeita avaliações; recalcula Av e G/A/D das aprovadas.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user || (user.app_metadata as { role?: string })?.role !== "admin") {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const acao = body.acao;
  if (acao !== "aprovar" && acao !== "rejeitar") {
    return json({ error: "acao deve ser aprovar ou rejeitar" }, 400);
  }

  const idsRaw = Array.isArray(body.avaliacaoIds) ? body.avaliacaoIds : [];
  const avaliacaoIds = idsRaw.filter(isUuid);
  if (!avaliacaoIds.length) {
    return json({ error: "avaliacaoIds inválidos" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: rows, error: fErr } = await admin
    .from("avaliacoes")
    .select("id, fut_id, partida_id")
    .in("id", avaliacaoIds);
  if (fErr) return json({ error: fErr.message }, 500);
  if (!rows?.length) return json({ error: "Avaliações não encontradas" }, 404);

  // Garante que o admin é dono de todos os futs envolvidos
  const futIds = [...new Set(rows.map((r) => r.fut_id as string))];
  for (const futId of futIds) {
    const { data: fut } = await admin.from("futs").select("owner_id").eq("id", futId).maybeSingle();
    if (!fut || fut.owner_id !== user.id) {
      return json({ error: "Fut não pertence a este usuário" }, 403);
    }
  }

  const now = new Date().toISOString();
  const patch = acao === "aprovar"
    ? { aprovada_em: now, rejeitada_em: null }
    : { rejeitada_em: now, aprovada_em: null };

  const { error: uErr } = await admin
    .from("avaliacoes")
    .update(patch)
    .in("id", avaliacaoIds);
  if (uErr) return json({ error: uErr.message }, 500);

  const partidaIds = [...new Set(rows.map((r) => r.partida_id as string))];
  try {
    for (const futId of futIds) {
      const partidasDoFut = rows
        .filter((r) => r.fut_id === futId)
        .map((r) => r.partida_id as string);
      await recalcAvaliacoesAprovadas(admin, futId, [...new Set(partidasDoFut)]);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Falha ao recalcular" }, 500);
  }

  return json({
    ok: true,
    acao,
    count: avaliacaoIds.length,
    partidaIds,
  });
});
