// supabase/functions/export-backup/index.ts
// Exporta estado financeiro no shape do backup v1 (sem partidas/avaliacoes), escopado por futId.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-secret",
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

type AuthOk = { allowed: true; userId: string | null; db: SupabaseClient };
type AuthFail = { allowed: false; userId: null; db: null };

async function resolveAuth(req: Request): Promise<AuthOk | AuthFail> {
  const backupSecret = Deno.env.get("BACKUP_SECRET") || "";
  const headerSecret = req.headers.get("x-backup-secret") || "";
  const authHeader = req.headers.get("Authorization") || "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  if (backupSecret && headerSecret && headerSecret === backupSecret) {
    return {
      allowed: true,
      userId: null,
      db: createClient(supabaseUrl, serviceKey),
    };
  }

  if (authHeader.startsWith("Bearer ")) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (user && (user.app_metadata as { role?: string })?.role === "admin") {
      return { allowed: true, userId: user.id, db: userClient };
    }
  }

  return { allowed: false, userId: null, db: null };
}

async function assertFutOwner(
  db: SupabaseClient,
  futId: string,
  userId: string | null,
) {
  const { data: fut, error } = await db.from("futs").select("id, owner_id").eq("id", futId).maybeSingle();
  if (error) return { ok: false, status: 500, message: error.message };
  if (!fut) return { ok: false, status: 404, message: "Fut não encontrado" };
  if (userId && fut.owner_id !== userId) {
    return { ok: false, status: 403, message: "Fut não pertence a este usuário" };
  }
  return { ok: true as const };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await resolveAuth(req);
  if (!auth.allowed || !auth.db) return json({ error: "Unauthorized" }, 401);

  let futId: unknown = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      futId = body?.futId;
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }
  } else {
    const url = new URL(req.url);
    futId = url.searchParams.get("futId");
  }

  if (!isUuid(futId)) return json({ error: "futId (UUID) é obrigatório" }, 400);

  const ownerCheck = await assertFutOwner(auth.db, futId, auth.userId);
  if (!ownerCheck.ok) return json({ error: ownerCheck.message }, ownerCheck.status);

  const db = auth.db;

  const { data: cfg, error: cErr } = await db.from("config").select("*").eq("fut_id", futId).maybeSingle();
  if (cErr) return json({ error: cErr.message }, 500);

  const { data: jogs, error: jErr } = await db.from("jogadores").select("*").eq("fut_id", futId);
  if (jErr) return json({ error: jErr.message }, 500);

  const { data: debitos, error: dErr } = await db.from("debitos").select("*").eq("fut_id", futId).order("created_at");
  if (dErr) return json({ error: dErr.message }, 500);

  const { data: hist, error: hErr } = await db
    .from("debitos_historico")
    .select("*, debitos_historico_itens(*)")
    .eq("fut_id", futId);
  if (hErr) return json({ error: hErr.message }, 500);

  const adminRow = (jogs || []).find((j) => j.tipo === "admin");
  const mensalistas = (jogs || [])
    .filter((j) => j.tipo === "mensalista")
    .map((j) => ({
      id: j.id,
      nome: j.nome,
      pago: j.pago,
      nivel: j.nivel,
      nivelAvaliacao: j.nivel_avaliacao,
      goleiro: j.goleiro,
    }));
  const avulsos = (jogs || [])
    .filter((j) => j.tipo === "avulso")
    .map((j) => ({
      id: j.id,
      nome: j.nome,
      status: j.status || "pendente",
      nivel: j.nivel,
      nivelAvaliacao: j.nivel_avaliacao,
      goleiro: j.goleiro,
    }));

  const payload = {
    mensalistas,
    avulsos,
    partidas: [],
    adminPerfil: {
      nome: adminRow?.nome || "",
      nivel: adminRow?.nivel ?? 3,
      nivelAvaliacao: adminRow?.nivel_avaliacao ?? null,
      goleiro: !!adminRow?.goleiro,
    },
    jogadoresPorTime: cfg?.jogadores_por_time ?? 5,
    custoQuadra: Number(cfg?.custo_quadra) || 0,
    saldoAnterior: Number(cfg?.saldo_anterior) || 0,
    avulsosPendentesAnt: cfg?.avulsos_pendentes_ant ?? 0,
    valorMensalidade: Number(cfg?.valor_mensalidade) || 0,
    valorAvulso: Number(cfg?.valor_avulso) || 0,
    mesAno: cfg?.mes_ano || "",
    chavePix: cfg?.chave_pix || "",
    debitos: (debitos || []).map((d) => ({
      id: d.id,
      descricao: d.descricao,
      valor: Number(d.valor) || 0,
    })),
    outrosDebitos: Number(cfg?.outros_debitos) || 0,
    debitosHistorico: (hist || []).map((h) => ({
      mesAno: h.mes_ano,
      total: Number(h.total) || 0,
      itens: (h.debitos_historico_itens || []).map((i: { id: string; descricao: string; valor: number }) => ({
        id: i.id,
        descricao: i.descricao,
        valor: Number(i.valor) || 0,
      })),
    })),
    discordWebhookUrl: cfg?.discord_webhook_url || "",
    avaliacoes: [],
    balanceamentoTimes: cfg?.balanceamento_times === "avaliacao" ? "avaliacao" : "nivel",
    peladaDiaSemana: cfg?.pelada_dia_semana ?? 3,
    peladaHoraInicio: cfg?.pelada_hora_inicio || "21:00",
    peladaHoraFim: cfg?.pelada_hora_fim || "23:00",
    peladaDataInicio: cfg?.pelada_data_inicio || "",
  };

  return json(payload);
});
