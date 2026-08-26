/** Domínio financeiro — totais de caixa (espelha lógica da v1). */
export function calcCaixa(state) {
  const {
    mensalistas = [], avulsos = [], custoQuadra = 0, saldoAnterior = 0,
    avulsosPendentesAnt = 0, valorMensalidade = 0, valorAvulso = 0, outrosDebitos = 0
  } = state;
  const pagos = mensalistas.filter((m) => m.pago);
  const avP = avulsos.filter((a) => a.status === 'pago');
  const totalMens = pagos.length * valorMensalidade;
  const totalAvP = avP.length * valorAvulso;
  const totalRecebidoMes = avulsosPendentesAnt * valorAvulso + totalMens + totalAvP;
  const totalRec = saldoAnterior + totalRecebidoMes;
  const lucro = totalRec - custoQuadra - (Number(outrosDebitos) || 0);
  return { pagos, avP, totalMens, totalAvP, totalRecebidoMes, totalRec, lucro };
}
