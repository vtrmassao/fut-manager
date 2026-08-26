export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function obterMesAnoAtual() {
  const d = new Date();
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

export function createDefaultMeta() {
  return { futId: null, configId: null, adminPlayerId: null, futNome: '' };
}

export function createDefaultState() {
  return {
    meta: createDefaultMeta(),
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

export const appState = {
  data: createDefaultState(),
  hydrated: false,
};

export function replaceState(next) {
  appState.data = next;
  appState.hydrated = true;
  return appState.data;
}
