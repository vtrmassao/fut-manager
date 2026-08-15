/**
 * Seed local para testes.
 *
 * Como usar:
 * 1. Copie este arquivo para `dev-seed.local.js` (já está no .gitignore)
 * 2. Abra o app em localhost / 127.0.0.1 / file://
 * 3. Se a lista de mensalistas estiver vazia, o seed aplica sozinho
 * 4. Para forçar de novo: abra com ?seed=1  ou  force: true abaixo
 */
window.__FUT_DEV_SEED__ = {
  enabled: true,
  force: false,
  // Se true, substitui mensalistas/avulsos mesmo quando já existem dados
  state: {
    valorMensalidade: 35,
    valorAvulso: 20,
    custoQuadra: 280,
    jogadoresPorTime: 5,
    adminPerfil: { nome: 'Massao', nivel: 4, goleiro: false },
    mensalistas: [
      { id: 1001, nome: 'Carlos', pago: true, nivel: 5, goleiro: false },
      { id: 1002, nome: 'Diego', pago: true, nivel: 4, goleiro: false },
      { id: 1003, nome: 'Eduardo', pago: false, nivel: 3, goleiro: false },
      { id: 1004, nome: 'Fábio', pago: true, nivel: 2, goleiro: true },
      { id: 1005, nome: 'Gustavo', pago: true, nivel: 5, goleiro: false },
      { id: 1006, nome: 'Henrique', pago: false, nivel: 3, goleiro: false },
      { id: 1007, nome: 'Igor', pago: true, nivel: 4, goleiro: false },
      { id: 1008, nome: 'João', pago: true, nivel: 1, goleiro: false },
      { id: 1009, nome: 'Kleber', pago: false, nivel: 3, goleiro: true },
      { id: 1010, nome: 'Lucas', pago: true, nivel: 4, goleiro: false },
      { id: 1011, nome: 'Marcos', pago: true, nivel: 2, goleiro: false },
      { id: 1012, nome: 'Natan', pago: false, nivel: 5, goleiro: false },
      { id: 1013, nome: 'Otávio', pago: true, nivel: 3, goleiro: false },
      { id: 1014, nome: 'Pedro', pago: true, nivel: 4, goleiro: false },
      { id: 1015, nome: 'Rafael', pago: false, nivel: 2, goleiro: false }
    ],
    avulsos: [
      { id: 2001, nome: 'Sergio (avulso)', status: 'pago', nivel: 3, goleiro: false },
      { id: 2002, nome: 'Tiago (avulso)', status: 'pendente', nivel: 4, goleiro: false }
    ]
  }
};
