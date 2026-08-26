// supabase/functions/import-backup/index.ts
// Importa JSON financeiro (formato backup v1) para um fut específico.
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

function newUuid() {
  return crypto.randomUUID();
}

function mapId(oldId: unknown, map: Map<string, string>) {
  const k = String(oldId);
  if (map.has(k)) return map.get(k)!;
  const id = newUuid();
  map.set(k, id);
  return id;
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
      // JWT do admin: usa o client autenticado (RLS + grants de authenticated).
      return { allowed: true, userId: user.id, db: userClient };
    }
  }

  return { allowed: false, userId: null, db: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await resolveAuth(req);
  if (!auth.allowed || !auth.db) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const futId = body.futId;
  if (!isUuid(futId)) return json({ error: "futId (UUID) é obrigatório" }, 400);

  if (!body || !Array.isArray(body.mensalistas)) {
    return json({ error: "Formato de backup inválido (mensalistas obrigatório)" }, 400);
  }

  const db = auth.db;

  const { data: fut, error: fErr } = await db.from("futs").select("id, owner_id").eq("id", futId).maybeSingle();
  if (fErr) return json({ error: fErr.message }, 500);
  if (!fut) return json({ error: "Fut não encontrado" }, 404);
  if (auth.userId && fut.owner_id !== auth.userId) {
    return json({ error: "Fut não pertence a este usuário" }, 403);
  }

  const { data: cfgRow, error: cfgLookupErr } = await db.from("config").select("id").eq("fut_id", futId).maybeSingle();
  if (cfgLookupErr) return json({ error: cfgLookupErr.message }, 500);
  if (!cfgRow) return json({ error: "Config do fut não encontrada" }, 404);

  const { data: adminRow, error: adminLookupErr } = await db
    .from("jogadores")
    .select("id")
    .eq("fut_id", futId)
    .eq("tipo", "admin")
    .maybeSingle();
  if (adminLookupErr) return json({ error: adminLookupErr.message }, 500);
  if (!adminRow) return json({ error: "Admin-jogador do fut não encontrado" }, 404);

  const CONFIG_ID = cfgRow.id as string;
  const ADMIN_ID = adminRow.id as string;

  const idMap = new Map<string, string>();
  idMap.set("900001", ADMIN_ID);

  const adminPerfil = (body.adminPerfil && typeof body.adminPerfil === "object")
    ? body.adminPerfil as Record<string, unknown>
    : {};

  const mensalistas = body.mensalistas as Array<Record<string, unknown>>;
  const avulsos = Array.isArray(body.avulsos) ? body.avulsos as Array<Record<string, unknown>> : [];
  const debitos = Array.isArray(body.debitos) ? body.debitos as Array<Record<string, unknown>> : [];
  const hist = Array.isArray(body.debitosHistorico)
    ? body.debitosHistorico as Array<Record<string, unknown>>
    : [];

  const { data: histIds } = await db.from("debitos_historico").select("id").eq("fut_id", futId);
  const histIdList = (histIds || []).map((h) => h.id as string);
  if (histIdList.length) {
    await db.from("debitos_historico_itens").delete().in("historico_id", histIdList);
  }
  await db.from("debitos_historico").delete().eq("fut_id", futId);
  await db.from("debitos").delete().eq("fut_id", futId);
  await db.from("jogadores").delete().eq("fut_id", futId).neq("tipo", "admin");

  const { error: cfgErr } = await db.from("config").upsert({
    id: CONFIG_ID,
    fut_id: futId,
    mes_ano: typeof body.mesAno === "string" ? body.mesAno : "",
    custo_quadra: Number(body.custoQuadra) || 0,
    saldo_anterior: Number(body.saldoAnterior) || 0,
    avulsos_pendentes_ant: Number(body.avulsosPendentesAnt) || 0,
    valor_mensalidade: Number(body.valorMensalidade) || 0,
    valor_avulso: Number(body.valorAvulso) || 0,
    outros_debitos: Number(body.outrosDebitos) || 0,
    jogadores_por_time: Math.min(11, Math.max(1, Math.round(Number(body.jogadoresPorTime) || 5))),
    balanceamento_times: body.balanceamentoTimes === "avaliacao" ? "avaliacao" : "nivel",
    chave_pix: typeof body.chavePix === "string" ? body.chavePix : "",
    discord_webhook_url: typeof body.discordWebhookUrl === "string" ? body.discordWebhookUrl : "",
    pelada_dia_semana: (() => {
      const n = Math.round(Number(body.peladaDiaSemana));
      return n >= 0 && n <= 6 ? n : 3;
    })(),
    pelada_hora_inicio: typeof body.peladaHoraInicio === "string" && body.peladaHoraInicio ? body.peladaHoraInicio : "21:00",
    pelada_hora_fim: typeof body.peladaHoraFim === "string" && body.peladaHoraFim ? body.peladaHoraFim : "23:00",
    pelada_data_inicio: typeof body.peladaDataInicio === "string" && body.peladaDataInicio ? body.peladaDataInicio : null,
  });
  if (cfgErr) return json({ error: cfgErr.message }, 500);

  const { error: adminErr } = await db.from("jogadores").upsert({
    id: ADMIN_ID,
    fut_id: futId,
    tipo: "admin",
    nome: typeof adminPerfil.nome === "string" ? adminPerfil.nome : "",
    pago: false,
    status: null,
    nivel: adminPerfil.nivel == null ? null : Math.min(5, Math.max(1, Number(adminPerfil.nivel) || 3)),
    nivel_avaliacao: adminPerfil.nivelAvaliacao == null
      ? null
      : Math.min(5, Math.max(1, Number(adminPerfil.nivelAvaliacao))),
    goleiro: !!adminPerfil.goleiro,
  });
  if (adminErr) return json({ error: adminErr.message }, 500);

  const jogadoresRows = [];
  for (const m of mensalistas) {
    const id = mapId(m.id, idMap);
    jogadoresRows.push({
      id,
      fut_id: futId,
      tipo: "mensalista",
      nome: String(m.nome || ""),
      pago: !!m.pago,
      status: null,
      nivel: m.nivel == null ? null : Math.min(5, Math.max(1, Number(m.nivel) || 3)),
      nivel_avaliacao: m.nivelAvaliacao == null ? null : Math.min(5, Math.max(1, Number(m.nivelAvaliacao))),
      goleiro: !!m.goleiro,
    });
  }
  for (const a of avulsos) {
    const id = mapId(a.id, idMap);
    jogadoresRows.push({
      id,
      fut_id: futId,
      tipo: "avulso",
      nome: String(a.nome || ""),
      pago: false,
      status: a.status === "pago" ? "pago" : "pendente",
      nivel: a.nivel == null ? null : Math.min(5, Math.max(1, Number(a.nivel) || 3)),
      nivel_avaliacao: a.nivelAvaliacao == null ? null : Math.min(5, Math.max(1, Number(a.nivelAvaliacao))),
      goleiro: !!a.goleiro,
    });
  }
  if (jogadoresRows.length) {
    const { error } = await db.from("jogadores").insert(jogadoresRows);
    if (error) return json({ error: error.message }, 500);
  }

  const debitoRows = debitos.map((d) => ({
    id: newUuid(),
    fut_id: futId,
    descricao: String(d.descricao || ""),
    valor: Math.max(0, Number(d.valor) || 0),
  }));
  if (debitoRows.length) {
    const { error } = await db.from("debitos").insert(debitoRows);
    if (error) return json({ error: error.message }, 500);
  }

  let histCount = 0;
  for (const h of hist) {
    const histId = newUuid();
    const itens = Array.isArray(h.itens) ? h.itens as Array<Record<string, unknown>> : [];
    const total = itens.reduce((s, d) => s + Math.max(0, Number(d.valor) || 0), 0);
    const { error: hErr } = await db.from("debitos_historico").insert({
      id: histId,
      fut_id: futId,
      mes_ano: typeof h.mesAno === "string" ? h.mesAno : "",
      total: h.total !== undefined ? Math.max(0, Number(h.total) || 0) : total,
    });
    if (hErr) return json({ error: hErr.message }, 500);
    if (itens.length) {
      const { error: iErr } = await db.from("debitos_historico_itens").insert(
        itens.map((d) => ({
          historico_id: histId,
          item_id: null,
          descricao: String(d.descricao || ""),
          valor: Math.max(0, Number(d.valor) || 0),
        })),
      );
      if (iErr) return json({ error: iErr.message }, 500);
    }
    histCount++;
  }

  return json({
    ok: true,
    futId,
    ignored: ["partidas", "avaliacoes"],
    counts: {
      jogadores: jogadoresRows.length + 1,
      debitos: debitoRows.length,
      debitosHistorico: histCount,
    },
  });
});
