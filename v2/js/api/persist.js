import { getActiveFutMeta } from './futs.js';
import { supabase } from '../supabase.js';

function requireMeta() {
  const meta = getActiveFutMeta();
  if (!meta?.futId || !meta.configId || !meta.adminPlayerId) {
    throw new Error('Fut ativo incompleto');
  }
  return meta;
}

function normalizePeladaDiaSemana(v) {
  const n = Math.round(Number(v));
  return n >= 0 && n <= 6 ? n : 3;
}

function normalizePeladaHora(h) {
  const m = String(h || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Math.min(23, Math.max(0, +m[1]));
  const mm = Math.min(59, Math.max(0, +m[2]));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export async function saveConfig(state) {
  const meta = requireMeta();
  const { error } = await supabase.from('config').upsert({
    id: meta.configId,
    fut_id: meta.futId,
    mes_ano: state.mesAno || '',
    custo_quadra: state.custoQuadra || 0,
    saldo_anterior: state.saldoAnterior || 0,
    avulsos_pendentes_ant: state.avulsosPendentesAnt || 0,
    valor_mensalidade: state.valorMensalidade || 0,
    valor_avulso: state.valorAvulso || 0,
    outros_debitos: state.outrosDebitos || 0,
    jogadores_por_time: state.jogadoresPorTime || 5,
    balanceamento_times: state.balanceamentoTimes === 'avaliacao' ? 'avaliacao' : 'nivel',
    chave_pix: state.chavePix || '',
    discord_webhook_url: state.discordWebhookUrl || '',
    pelada_dia_semana: normalizePeladaDiaSemana(state.peladaDiaSemana),
    pelada_hora_inicio: normalizePeladaHora(state.peladaHoraInicio) || '21:00',
    pelada_hora_fim: normalizePeladaHora(state.peladaHoraFim) || '23:00',
    pelada_data_inicio: state.peladaDataInicio || null,
  });
  if (error) throw error;
}

export async function upsertAdmin(adminPerfil) {
  const meta = requireMeta();
  const { error } = await supabase.from('jogadores').upsert({
    id: meta.adminPlayerId,
    fut_id: meta.futId,
    tipo: 'admin',
    nome: adminPerfil?.nome || '',
    pago: false,
    status: null,
    nivel: adminPerfil?.nivel ?? 3,
    nivel_avaliacao: adminPerfil?.nivelAvaliacao ?? null,
    goleiro: !!adminPerfil?.goleiro,
  });
  if (error) throw error;
}

export async function upsertMensalista(m) {
  const meta = requireMeta();
  const { error } = await supabase.from('jogadores').upsert({
    id: m.id,
    fut_id: meta.futId,
    tipo: 'mensalista',
    nome: m.nome,
    pago: !!m.pago,
    status: null,
    nivel: m.nivel ?? null,
    nivel_avaliacao: m.nivelAvaliacao ?? null,
    goleiro: !!m.goleiro,
  });
  if (error) throw error;
}

export async function upsertAvulso(a) {
  const meta = requireMeta();
  const { error } = await supabase.from('jogadores').upsert({
    id: a.id,
    fut_id: meta.futId,
    tipo: 'avulso',
    nome: a.nome,
    pago: false,
    status: a.status === 'pago' ? 'pago' : 'pendente',
    nivel: a.nivel ?? null,
    nivel_avaliacao: a.nivelAvaliacao ?? null,
    goleiro: !!a.goleiro,
  });
  if (error) throw error;
}

export async function deleteJogador(id) {
  const { error } = await supabase.from('jogadores').delete().eq('id', id);
  if (error) throw error;
}

export async function replaceDebitos(debitos) {
  const meta = requireMeta();
  await supabase.from('debitos').delete().eq('fut_id', meta.futId);
  if (!debitos?.length) return;
  const { error } = await supabase.from('debitos').insert(
    debitos.map((d) => ({
      id: d.id,
      fut_id: meta.futId,
      descricao: d.descricao,
      valor: d.valor,
    })),
  );
  if (error) throw error;
}

export async function insertDebito(d) {
  const meta = requireMeta();
  const { error } = await supabase.from('debitos').insert({
    id: d.id,
    fut_id: meta.futId,
    descricao: d.descricao,
    valor: d.valor,
  });
  if (error) throw error;
}

export async function deleteDebito(id) {
  const { error } = await supabase.from('debitos').delete().eq('id', id);
  if (error) throw error;
}

export async function archiveDebitosHistorico(entry) {
  const meta = requireMeta();
  const histId = crypto.randomUUID();
  const { error: hErr } = await supabase.from('debitos_historico').insert({
    id: histId,
    fut_id: meta.futId,
    mes_ano: entry.mesAno,
    total: entry.total,
  });
  if (hErr) throw hErr;
  if (entry.itens?.length) {
    const { error } = await supabase.from('debitos_historico_itens').insert(
      entry.itens.map((i) => ({
        historico_id: histId,
        item_id: i.id || null,
        descricao: i.descricao,
        valor: i.valor,
      })),
    );
    if (error) throw error;
  }
}

/** Persiste config + admin + listas de jogadores + débitos (snapshot financeiro). */
export async function persistFinanceiro(state) {
  const meta = requireMeta();
  await saveConfig(state);
  await upsertAdmin(state.adminPerfil);
  for (const m of state.mensalistas || []) await upsertMensalista(m);
  for (const a of state.avulsos || []) await upsertAvulso(a);
  const keep = new Set([
    meta.adminPlayerId,
    ...(state.mensalistas || []).map((m) => m.id),
    ...(state.avulsos || []).map((a) => a.id),
  ]);
  const existing = await supabase.from('jogadores').select('id').eq('fut_id', meta.futId);
  if (existing.error) throw existing.error;
  const stale = (existing.data || []).map((x) => x.id).filter((id) => !keep.has(id));
  if (stale.length) {
    const { error } = await supabase.from('jogadores').delete().in('id', stale);
    if (error) throw error;
  }
  await replaceDebitos(state.debitos || []);
}

export async function savePartidaFull(partida) {
  const meta = requireMeta();
  const { error: pErr } = await supabase.from('partidas').upsert({
    id: partida.id,
    fut_id: meta.futId,
    data: partida.data,
    hora_inicio: partida.horaInicio || '21:00',
    hora_fim: partida.horaFim || '23:00',
  });
  if (pErr) throw pErr;

  await supabase.from('partida_participantes').delete().eq('partida_id', partida.id);
  await supabase.from('partida_times').delete().eq('partida_id', partida.id);

  const parts = (partida.participantes || []).map((part) => ({
    partida_id: partida.id,
    player_id: part.playerId,
    nome: part.nome,
    origem: part.origem,
    nivel: part.nivel ?? null,
    goleiro: !!part.goleiro,
    gols: part.gols || 0,
    assistencias: part.assistencias || 0,
    defesas: part.defesas || 0,
  }));
  if (parts.length) {
    const { error } = await supabase.from('partida_participantes').insert(parts);
    if (error) throw error;
  }

  const times = (partida.times || []).map((ids, indice) => ({
    partida_id: partida.id,
    indice,
    player_ids: ids,
  }));
  if (times.length) {
    const { error } = await supabase.from('partida_times').insert(times);
    if (error) throw error;
  }
}

export async function deletePartida(id) {
  const { error } = await supabase.from('partidas').delete().eq('id', id);
  if (error) throw error;
}

export async function replaceAvaliacoesFromState(avaliacoes) {
  const meta = requireMeta();
  const futId = meta.futId;

  const { data: avRows } = await supabase.from('avaliacoes').select('id').eq('fut_id', futId);
  const avIds = (avRows || []).map((a) => a.id);
  if (avIds.length) {
    await supabase.from('avaliacao_notas').delete().in('avaliacao_id', avIds);
    await supabase.from('avaliacao_stats').delete().in('avaliacao_id', avIds);
  }
  await supabase.from('avaliacoes').delete().eq('fut_id', futId);

  for (const av of avaliacoes || []) {
    const { error: aErr } = await supabase.from('avaliacoes').insert({
      id: av.id,
      fut_id: futId,
      partida_id: av.partidaId,
      data: av.data || null,
      avaliador_id: av.avaliadorId,
      importado_em: av.importadoEm || new Date().toISOString(),
    });
    if (aErr) throw aErr;
    const notas = Object.entries(av.notas || {}).map(([avaliado_id, nota]) => ({
      avaliacao_id: av.id,
      avaliado_id,
      nota,
    }));
    if (notas.length) {
      const { error } = await supabase.from('avaliacao_notas').insert(notas);
      if (error) throw error;
    }
    const stats = Object.entries(av.stats || {}).map(([player_id, s]) => ({
      avaliacao_id: av.id,
      player_id,
      gols: s.gols || 0,
      assistencias: s.assistencias || 0,
      defesas: s.defesas != null ? s.defesas : null,
    }));
    if (stats.length) {
      const { error } = await supabase.from('avaliacao_stats').insert(stats);
      if (error) throw error;
    }
  }
}
