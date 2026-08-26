import { getActiveFutMeta } from './futs.js';
import { supabase } from '../supabase.js';
import { createDefaultState, obterMesAnoAtual } from '../state.js';

function fail(error) {
  if (error) throw error;
}

function num(value) {
  return Number(value) || 0;
}

function requireMeta(state) {
  const meta = state?.meta || getActiveFutMeta();
  if (!meta?.futId || !meta.configId || !meta.adminPlayerId) {
    throw new Error('Fut ativo incompleto');
  }
  return meta;
}

export async function hydrateState() {
  const { hydrateState: hydrate } = await import('./hydrate.js');
  return hydrate();
}

async function clearTable(table, futId, column = 'id') {
  const sentinel = column === 'indice' ? -1 : '00000000-0000-0000-0000-000000000000';
  const { error } = await supabase.from(table).delete().eq('fut_id', futId).neq(column, sentinel);
  fail(error);
}

async function clearFutChildTable(table, parentTable, futId, fkColumn) {
  const { data: parents, error: pErr } = await supabase.from(parentTable).select('id').eq('fut_id', futId);
  fail(pErr);
  const ids = (parents || []).map((p) => p.id);
  if (!ids.length) return;
  const { error } = await supabase.from(table).delete().in(fkColumn, ids);
  fail(error);
}

export async function persistState(state) {
  const meta = requireMeta(state);
  const futId = meta.futId;

  const config = {
    id: meta.configId,
    fut_id: futId,
    mes_ano: state.mesAno,
    custo_quadra: state.custoQuadra,
    saldo_anterior: state.saldoAnterior,
    avulsos_pendentes_ant: state.avulsosPendentesAnt,
    valor_mensalidade: state.valorMensalidade,
    valor_avulso: state.valorAvulso,
    outros_debitos: state.outrosDebitos,
    jogadores_por_time: state.jogadoresPorTime,
    balanceamento_times: state.balanceamentoTimes,
    chave_pix: state.chavePix,
    discord_webhook_url: state.discordWebhookUrl,
    pelada_dia_semana: state.peladaDiaSemana ?? 3,
    pelada_hora_inicio: state.peladaHoraInicio || '21:00',
    pelada_hora_fim: state.peladaHoraFim || '23:00',
    pelada_data_inicio: state.peladaDataInicio || null,
  };
  fail((await supabase.from('config').upsert(config)).error);

  const jogadores = [{
    id: meta.adminPlayerId,
    fut_id: futId,
    tipo: 'admin',
    nome: state.adminPerfil.nome,
    pago: false,
    status: null,
    nivel: state.adminPerfil.nivel,
    nivel_avaliacao: state.adminPerfil.nivelAvaliacao ?? null,
    goleiro: state.adminPerfil.goleiro,
  }, ...state.mensalistas.map(j => ({
    id: j.id,
    fut_id: futId,
    tipo: 'mensalista',
    nome: j.nome,
    pago: !!j.pago,
    status: null,
    nivel: j.nivel,
    nivel_avaliacao: j.nivelAvaliacao ?? null,
    goleiro: !!j.goleiro,
  })), ...state.avulsos.map(j => ({
    id: j.id,
    fut_id: futId,
    tipo: 'avulso',
    nome: j.nome,
    pago: false,
    status: j.status,
    nivel: j.nivel,
    nivel_avaliacao: j.nivelAvaliacao ?? null,
    goleiro: !!j.goleiro,
  }))];
  const keepIds = jogadores.map(j => j.id);
  fail((await supabase.from('jogadores').upsert(jogadores)).error);
  const existing = await supabase.from('jogadores').select('id').eq('fut_id', futId).neq('tipo', 'admin');
  fail(existing.error);
  const stale = (existing.data || []).map(x => x.id).filter(id => !keepIds.includes(id));
  if (stale.length) fail((await supabase.from('jogadores').delete().in('id', stale)).error);

  await clearTable('debitos', futId);
  if (state.debitos.length) {
    fail((await supabase.from('debitos').insert(state.debitos.map(d => ({
      id: d.id,
      fut_id: futId,
      descricao: d.descricao,
      valor: d.valor,
    })))).error);
  }

  await clearFutChildTable('debitos_historico_itens', 'debitos_historico', futId, 'historico_id');
  await clearTable('debitos_historico', futId);
  for (const h of state.debitosHistorico) {
    const historicoId = h.id || crypto.randomUUID();
    fail((await supabase.from('debitos_historico').insert({
      id: historicoId,
      fut_id: futId,
      mes_ano: h.mesAno,
      total: h.total,
    })).error);
    if (h.itens?.length) {
      fail((await supabase.from('debitos_historico_itens').insert(h.itens.map(i => ({
        id: crypto.randomUUID(),
        historico_id: historicoId,
        item_id: i.id,
        descricao: i.descricao,
        valor: i.valor,
      })))).error);
    }
  }

  await clearFutChildTable('avaliacao_notas', 'avaliacoes', futId, 'avaliacao_id');
  await clearFutChildTable('avaliacao_stats', 'avaliacoes', futId, 'avaliacao_id');
  await clearTable('avaliacoes', futId);
  await clearFutChildTable('partida_participantes', 'partidas', futId, 'partida_id');
  await clearFutChildTable('partida_times', 'partidas', futId, 'partida_id');
  await clearTable('partidas', futId);

  if (state.partidas.length) {
    fail((await supabase.from('partidas').insert(state.partidas.map(p => ({
      id: p.id,
      fut_id: futId,
      data: p.data,
      hora_inicio: p.horaInicio,
      hora_fim: p.horaFim,
    })))).error);
    const participantRows = state.partidas.flatMap(p => p.participantes.map(x => ({
      partida_id: p.id,
      player_id: x.playerId,
      nome: x.nome,
      origem: x.origem,
      nivel: x.nivel,
      goleiro: !!x.goleiro,
      gols: x.gols || 0,
      assistencias: x.assistencias || 0,
      defesas: x.defesas || 0,
    })));
    if (participantRows.length) fail((await supabase.from('partida_participantes').insert(participantRows)).error);
    const teamRows = state.partidas.flatMap(p => (p.times || []).map((ids, indice) => ({
      partida_id: p.id,
      indice,
      player_ids: ids,
    })));
    if (teamRows.length) fail((await supabase.from('partida_times').insert(teamRows)).error);
  }

  // Avaliações de partidas já removidas quebram a FK avaliacoes_partida_id_fkey
  const partidaIds = new Set((state.partidas || []).map((p) => String(p.id)));
  const avaliacoesValidas = (state.avaliacoes || []).filter((a) => partidaIds.has(String(a.partidaId)));
  if (avaliacoesValidas.length !== (state.avaliacoes || []).length) {
    state.avaliacoes = avaliacoesValidas;
  }

  for (const a of avaliacoesValidas) {
    fail((await supabase.from('avaliacoes').insert({
      id: a.id,
      fut_id: futId,
      partida_id: a.partidaId,
      data: a.data || null,
      avaliador_id: a.avaliadorId,
      importado_em: a.importadoEm || new Date().toISOString(),
      aprovada_em: a.aprovadaEm || null,
      rejeitada_em: a.rejeitadaEm || null,
    })).error);
    const notaRows = Object.entries(a.notas || {}).map(([avaliado_id, nota]) => ({
      avaliacao_id: a.id,
      avaliado_id,
      nota,
    }));
    if (notaRows.length) fail((await supabase.from('avaliacao_notas').insert(notaRows)).error);
    const statRows = Object.entries(a.stats || {}).map(([player_id, s]) => ({
      avaliacao_id: a.id,
      player_id,
      gols: s.gols || 0,
      assistencias: s.assistencias || 0,
      defesas: Object.prototype.hasOwnProperty.call(s, 'defesas') ? s.defesas : null,
    }));
    if (statRows.length) fail((await supabase.from('avaliacao_stats').insert(statRows)).error);
  }
}

export { createDefaultState, obterMesAnoAtual };
