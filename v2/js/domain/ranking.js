export function calcularPontos({ gols = 0, assistencias = 0, defesas = 0 }) {
  return gols * 3 + assistencias * 2 + defesas;
}

export function ordenarRanking(a, b) {
  return b.pontos - a.pontos ||
    b.gols - a.gols ||
    b.assistencias - a.assistencias ||
    a.nome.localeCompare(b.nome);
}

