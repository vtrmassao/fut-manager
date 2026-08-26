// Lógica compartilhada: recalcula Av e G/A/D só com avaliações aprovadas.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function recalcAvaliacoesAprovadas(
  admin: SupabaseClient,
  futId: string,
  partidaIds?: string[],
) {
  const { data: aprovadas, error: aErr } = await admin
    .from("avaliacoes")
    .select("id, partida_id")
    .eq("fut_id", futId)
    .not("aprovada_em", "is", null);
  if (aErr) throw new Error(aErr.message);

  const aprovadasList = aprovadas || [];
  const avaliacaoIds = aprovadasList.map((a) => a.id as string);

  // Av: média das notas aprovadas; jogadores sem notas → null
  const { data: jogs } = await admin.from("jogadores").select("id").eq("fut_id", futId);
  const jogIds = (jogs || []).map((j) => j.id as string);

  const sums: Record<string, { sum: number; count: number }> = {};
  if (avaliacaoIds.length) {
    const { data: allNotas, error: nErr } = await admin
      .from("avaliacao_notas")
      .select("avaliado_id, nota")
      .in("avaliacao_id", avaliacaoIds);
    if (nErr) throw new Error(nErr.message);
    for (const row of allNotas || []) {
      const id = row.avaliado_id as string;
      if (!sums[id]) sums[id] = { sum: 0, count: 0 };
      sums[id].sum += Number(row.nota) || 0;
      sums[id].count++;
    }
  }

  for (const id of jogIds) {
    const s = sums[id];
    const nivel = s && s.count
      ? Math.min(5, Math.max(1, Math.round(s.sum / s.count)))
      : null;
    await admin.from("jogadores").update({ nivel_avaliacao: nivel }).eq("id", id).eq("fut_id", futId);
  }

  // G/A/D por partida: média dos stats das avaliações aprovadas daquela partida
  const partidasAlvo = partidaIds?.length
    ? [...new Set(partidaIds)]
    : [...new Set(aprovadasList.map((a) => a.partida_id as string))];

  for (const partidaId of partidasAlvo) {
    const avsDaPartida = aprovadasList.filter((a) => a.partida_id === partidaId);
    const idsPartida = avsDaPartida.map((a) => a.id as string);

    const buckets: Record<string, { gols: number[]; assistencias: number[]; defesas: number[] }> = {};
    if (idsPartida.length) {
      const { data: statsRows, error: sErr } = await admin
        .from("avaliacao_stats")
        .select("player_id, gols, assistencias, defesas")
        .in("avaliacao_id", idsPartida);
      if (sErr) throw new Error(sErr.message);
      for (const st of statsRows || []) {
        const pid = st.player_id as string;
        if (!buckets[pid]) buckets[pid] = { gols: [], assistencias: [], defesas: [] };
        buckets[pid].gols.push(Math.max(0, Math.round(Number(st.gols) || 0)));
        buckets[pid].assistencias.push(Math.max(0, Math.round(Number(st.assistencias) || 0)));
        if (st.defesas != null) {
          buckets[pid].defesas.push(Math.max(0, Math.round(Number(st.defesas) || 0)));
        }
      }
    }

    const { data: parts } = await admin
      .from("partida_participantes")
      .select("player_id")
      .eq("partida_id", partidaId);

    const avg = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : 0;

    for (const part of parts || []) {
      const pid = part.player_id as string;
      const b = buckets[pid];
      const patch: Record<string, number> = {
        gols: b ? avg(b.gols) : 0,
        assistencias: b ? avg(b.assistencias) : 0,
        defesas: b && b.defesas.length ? avg(b.defesas) : 0,
      };
      await admin
        .from("partida_participantes")
        .update(patch)
        .eq("partida_id", partidaId)
        .eq("player_id", pid);
    }
  }
}
