import { getActiveFutMeta } from './futs.js';
import { supabase } from '../supabase.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function obterMesAnoAtual() {
  const d = new Date();
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

export { MESES };

/** Estado em memória no shape da v1 (facilita UI). */
export function createDefaultState(meta) {
  return {
    meta: meta || { futId: null, configId: null, adminPlayerId: null, futNome: '' },
    mensalistas: [],
    avulsos: [],
    partidas: [],
    adminPerfil: { nome: '', nivel: 3, nivelAvaliacao: null, goleiro: false },
    jogadoresPorTime: 5,
    custoQuadra: 0,
    saldoAnterior: 0,
    avulsosPendentesAnt: 0,
    valorMensalidade: 50,
    valorAvulso: 15,
    mesAno: obterMesAnoAtual(),
    chavePix: '',
    debitos: [],
    outrosDebitos: 0,
    debitosHistorico: [],
    discordWebhookUrl: '',
    avaliacoes: [],
    balanceamentoTimes: 'nivel',
    peladaDiaSemana: 3,
    peladaHoraInicio: '21:00',
    peladaHoraFim: '23:00',
    peladaDataInicio: '',
  };
}

export function jogadorToMensalista(j) {
  return {
    id: j.id,
    nome: j.nome,
    pago: !!j.pago,
    nivel: j.nivel,
    nivelAvaliacao: j.nivel_avaliacao,
    goleiro: !!j.goleiro,
  };
}

export function jogadorToAvulso(j) {
  return {
    id: j.id,
    nome: j.nome,
    status: j.status === 'pago' ? 'pago' : 'pendente',
    nivel: j.nivel,
    nivelAvaliacao: j.nivel_avaliacao,
    goleiro: !!j.goleiro,
  };
}

export async function hydrateState() {
  const meta = getActiveFutMeta();
  if (!meta?.futId) throw new Error('Nenhum fut ativo');

  const futId = meta.futId;
  const state = createDefaultState(meta);

  const [
    { data: cfg, error: cErr },
    { data: jogs, error: jErr },
    { data: debitos, error: dErr },
    { data: hist, error: hErr },
    { data: partidas, error: pErr },
    { data: avaliacoes, error: aErr },
  ] = await Promise.all([
    supabase.from('config').select('*').eq('fut_id', futId).maybeSingle(),
    supabase.from('jogadores').select('*').eq('fut_id', futId).order('created_at'),
    supabase.from('debitos').select('*').eq('fut_id', futId).order('created_at'),
    supabase.from('debitos_historico').select('*, debitos_historico_itens(*)').eq('fut_id', futId).order('created_at'),
    supabase.from('partidas').select('*, partida_participantes(*), partida_times(*)').eq('fut_id', futId).order('data', { ascending: false }),
    supabase.from('avaliacoes').select('*, avaliacao_notas(*), avaliacao_stats(*)').eq('fut_id', futId).order('importado_em', { ascending: false }),
  ]);

  if (cErr) throw cErr;
  if (jErr) throw jErr;
  if (dErr) throw dErr;
  if (hErr) throw hErr;
  if (pErr) throw pErr;
  if (aErr) throw aErr;

  if (cfg) {
    state.meta.configId = cfg.id;
    state.mesAno = cfg.mes_ano || obterMesAnoAtual();
    state.custoQuadra = Number(cfg.custo_quadra) || 0;
    state.saldoAnterior = Number(cfg.saldo_anterior) || 0;
    state.avulsosPendentesAnt = cfg.avulsos_pendentes_ant || 0;
    state.valorMensalidade = Number(cfg.valor_mensalidade) || 0;
    state.valorAvulso = Number(cfg.valor_avulso) || 0;
    state.outrosDebitos = Number(cfg.outros_debitos) || 0;
    state.jogadoresPorTime = cfg.jogadores_por_time || 5;
    state.balanceamentoTimes = cfg.balanceamento_times === 'avaliacao' ? 'avaliacao' : 'nivel';
    state.chavePix = cfg.chave_pix || '';
    state.discordWebhookUrl = cfg.discord_webhook_url || '';
    state.peladaDiaSemana = cfg.pelada_dia_semana ?? 3;
    state.peladaHoraInicio = cfg.pelada_hora_inicio || '21:00';
    state.peladaHoraFim = cfg.pelada_hora_fim || '23:00';
    state.peladaDataInicio = cfg.pelada_data_inicio || '';
  } else if (!state.mesAno) {
    state.mesAno = obterMesAnoAtual();
  }

  const admin = (jogs || []).find((j) => j.tipo === 'admin');
  if (admin) {
    state.meta.adminPlayerId = admin.id;
    state.adminPerfil = {
      nome: admin.nome || '',
      nivel: admin.nivel,
      nivelAvaliacao: admin.nivel_avaliacao,
      goleiro: !!admin.goleiro,
    };
  }

  state.mensalistas = (jogs || []).filter((j) => j.tipo === 'mensalista').map(jogadorToMensalista);
  state.avulsos = (jogs || []).filter((j) => j.tipo === 'avulso').map(jogadorToAvulso);

  state.debitos = (debitos || []).map((d) => ({
    id: d.id,
    descricao: d.descricao,
    valor: Number(d.valor) || 0,
  }));

  state.debitosHistorico = (hist || []).map((h) => ({
    mesAno: h.mes_ano,
    total: Number(h.total) || 0,
    itens: (h.debitos_historico_itens || []).map((i) => ({
      id: i.id,
      descricao: i.descricao,
      valor: Number(i.valor) || 0,
    })),
  }));

  state.partidas = (partidas || []).map((p) => {
    const timesSorted = (p.partida_times || []).slice().sort((a, b) => a.indice - b.indice);
    return {
      id: p.id,
      data: p.data,
      horaInicio: p.hora_inicio,
      horaFim: p.hora_fim,
      participantes: (p.partida_participantes || []).map((part) => ({
        playerId: part.player_id,
        nome: part.nome,
        origem: part.origem,
        nivel: part.nivel,
        goleiro: !!part.goleiro,
        gols: part.gols || 0,
        assistencias: part.assistencias || 0,
        defesas: part.defesas || 0,
      })),
      times: timesSorted.map((t) => (t.player_ids || []).slice()),
    };
  });

  state.avaliacoes = (avaliacoes || []).map((av) => {
    const notas = {};
    (av.avaliacao_notas || []).forEach((n) => {
      notas[String(n.avaliado_id)] = n.nota;
    });
    const stats = {};
    (av.avaliacao_stats || []).forEach((s) => {
      const entry = { gols: s.gols || 0, assistencias: s.assistencias || 0 };
      if (s.defesas != null) entry.defesas = s.defesas;
      stats[String(s.player_id)] = entry;
    });
    const out = {
      id: av.id,
      partidaId: av.partida_id,
      data: av.data || '',
      avaliadorId: av.avaliador_id,
      notas,
      importadoEm: av.importado_em || '',
      aprovadaEm: av.aprovada_em || null,
      rejeitadaEm: av.rejeitada_em || null,
    };
    if (Object.keys(stats).length) out.stats = stats;
    return out;
  });

  return state;
}
