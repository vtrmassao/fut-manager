# Contexto do projeto — Fut Manager

Documento de referência para humanos e agentes de IA. Leia isto antes de alterar o código.

## Visão geral

PWA **monolítico** (sem framework, sem backend, sem npm) para o **futsal de quarta-feira**.

Dois domínios no mesmo app:

1. **Financeiro** — caixa, mensalistas, avulsos, Pix, fechamento de mês
2. **Esportivo** — partidas, gols/assistências/defesas, ranking, montagem de times

Tudo persiste em `localStorage` na chave `futmgr`.

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `index.html` | UI + CSS + toda a lógica JS |
| `sw.js` | Service Worker (cache offline) |
| `manifest.json` | Manifest PWA |
| `README.md` | Visão para usuário / instalação |
| `CONTEXTO.md` | Este arquivo (contexto técnico e de produto) |

Ao mudar `index.html` de forma relevante para quem já instalou o PWA, **incremente a versão do cache** em `sw.js` (ex.: `futmanager-v9` → `v10`).

## Seed local (só desenvolvimento)

Para testar com dados preenchidos sem sujar o repo:

1. Copie `dev-seed.local.example.js` → `dev-seed.local.js` (gitignored)
2. Abra em `localhost` / `127.0.0.1` / `file://`
3. Se não houver mensalistas, o seed aplica sozinho
4. Force de novo com `?seed=1` ou `force: true` no arquivo

O loader só injeta o script em host local; em produção o seed não carrega.

## Stack e padrões de código

- Vanilla HTML/CSS/JS (ES6+)
- Fontes: Bebas Neue + DM Sans
- Tema dark (`#0a0a0f`, acentos `#00e676`)
- Padrão de mutação: alterar `state` → `save()` → `render()`
- UI por abas (`setTab`): `resumo` | `mensalistas` | `avulsos` | `partidas` | `ranking` | `ajustes`
- Estado de tela das partidas em objeto `ui` (não vai para o localStorage): `partidaView`, `partidaId`, draft da nova partida, filtros do ranking
- Sem React/Vue, sem build step, sem TypeScript
- Respostas e UI em **português (pt-BR)**

## Domínio do produto

- Pelada: **toda quarta-feira**, horário padrão **21:00–23:00** (formato **24h**)
- Datas na UI: **`dd/mm/aaaa`** (armazenadas internamente como `YYYY-MM-DD`)
- **Admin do grupo**: joga, **não paga mensalidade**, id fixo `ADMIN.id = 900001`, `origem: 'admin'`, sempre pré-selecionado em nova partida
- Nome do admin fica em `state.adminPerfil.nome` — **sem default** (vazio até configurar em Ajustes; o seed local pode preencher, ex. Massao)
- Perfil esportivo do admin (`nivel`, `nivelAvaliacao`, `goleiro`) editável na aba Mensalistas (Av só leitura)
- Mensalistas = recorrentes que pagam
- Avulsos = convidados do mês (também cobrados)
- Convidados na partida = só estatística (nome livre), sem cobrança automática
- **Nível manual (`nivel`)** (1–5 ou `null` = **?**): você escolhe no cadastro (badge **Nv**); usado no sorteio quando balanceamento = Nv
- **Nível das avaliações (`nivelAvaliacao` / badge Av)**: *average* — média arredondada das notas recebidas (só leitura); `null` / **?** se ainda não houver notas
- **Goleiro** é flag de cadastro; badge Nv cicla `1→2→3→4→5→?→1`
- No sorteio, nível desconhecido conta como **3** (médio)

## Modelo de dados (`state`)

```js
{
  mensalistas: [{ id, nome, pago, nivel: 1-5|null, nivelAvaliacao: 1-5|null, goleiro: boolean }],
  avulsos: [{ id, nome, status: 'pago'|'pendente', nivel: 1-5|null, nivelAvaliacao: 1-5|null, goleiro: boolean }],
  adminPerfil: { nome: string, nivel: 1-5|null, nivelAvaliacao: 1-5|null, goleiro: boolean },
  jogadoresPorTime: 5,   // tamanho ideal; define qtde de times (15→3, 20→4)
  partidas: [{
    id,
    data,           // 'YYYY-MM-DD'
    horaInicio,     // '21:00'
    horaFim,        // '23:00'
    participantes: [{
      playerId, nome,
      origem: 'admin'|'mensalista'|'avulso'|'convidado',
      nivel,         // snapshot do cadastro no momento da criação/adição
      goleiro,       // snapshot
      gols, assistencias, defesas
    }],
    times: [[playerId], [playerId], ...]  // N times; legado {a,b} é migrado
  }],
  custoQuadra, saldoAnterior, avulsosPendentesAnt,
  valorMensalidade, valorAvulso, mesAno, chavePix,
  debitos: [{ id, descricao, valor }],  // débitos do mês atual (só UI/histórico do período)
  outrosDebitos: 0,  // total já debitado do caixa (mutado no add/remove, não recalculado da lista)
  debitosHistorico: [{ mesAno, itens: [{ id, descricao, valor }], total }],  // arquivado ao iniciar novo mês
  discordWebhookUrl: '',  // Ajustes; só neste aparelho — nunca no git
  balanceamentoTimes: 'nivel' | 'avaliacao',  // critério do sorteio de times
  avaliacoes: [{
    id, partidaId, data, avaliadorId,
    notas: { [avaliadoId]: 1-5 },
    stats: { [playerId]: { gols, assistencias, defesas? } },  // autodeclaração no link #a= (só do avaliador; defesas se goleiro)
    importadoEm
  }]
}
```

- Defaults de cadastro: `nivel: 3`, `goleiro: false` (`nivel: null` = desconhecido / `?`)
- `load()` / `migrateState()` preenchem defaults (`partidas: []`, `adminPerfil`, `debitos: []`, `outrosDebitos: 0`, `debitosHistorico: []`, `discordWebhookUrl`, `avaliacoes: []`, `balanceamentoTimes: 'nivel'`, `nivel`/`goleiro`/`nivelAvaliacao` em cadastro e participantes)
- **`iniciarNovoMes()` não apaga `partidas` nem `avaliacoes`** — só zera pagamentos, limpa avulsos e débitos do mês, arquiva débitos em `debitosHistorico`, avança `mesAno` para o mês seguinte, e atualiza o saldo
- `mesAno` editável em **Ajustes** (dropdown Janeiro–Dezembro + ano); toque no subtítulo do header também abre Ajustes
- Caixa: `lucro = totalRecebido - custoQuadra - outrosDebitos` (`outrosDebitos` é valor salvo; add soma, remove subtrai)
- Backup export/import = JSON completo do `state` (passa por `migrateState`)

## Avaliações pós-partida (nível por pares)

1. Em **Ajustes**: colar URL do webhook Discord (+ Testar webhook); importar JSON(s) de avaliação; **Resetar avaliações** apaga todas (Av volta a ?; G/A das partidas não mudam)
2. Na partida: **Link de avaliação** gera `#a=<jsonB64>.<idB64>~<token>` — roster no JSON flat `{ v, p, d, j }`; webhook **fora** do JSON. O snowflake vai como `uint64` BE em base64url; o token fica em texto. Prefixo Discord fixo no código. Links legados com `w` texto dentro do JSON ainda abrem. Na partida também dá para importar/resetar só as avaliações dela.
3. Quem abre o link (app em URL pública): escolhe “quem sou eu”, nota 1–5 nos outros, registra **só os próprios** gols/assistências (e **defesas** se for goleiro no roster), **Enviar** → POST no Discord (fallback: copiar JSON). Pacote inclui `stats: { [avaliadorId]: { gols, assistencias, defesas? } }`. O roster do link marca goleiro como `[id, nome, 1]`.
4. Admin importa o JSON do canal → dedupe `(partidaId, avaliadorId)` → atualiza `nivelAvaliacao` (média das notas recebidas) e, se houver `stats`, gols/assistências/defesas dos participantes (cada um declara os próprios). O **Nv** manual **não** é sobrescrito.
5. **Todos os participantes da partida** entram na avaliação (admin, mensalista, avulso e convidado). Notas só atualizam Av no cadastro de admin/mensalista/avulso; gols/assistências aplicam em qualquer participante. Digitar um nome que já existe no cadastro reusa o id/origem (não cria convidado fantasma).
6. Badges no cadastro: **Nv** (manual, cicla) + **Av** (avaliações; `title` com média exata)

## Partidas (fluxo)

1. Lista (mais recente primeiro)
2. Nova partida: data BR + horas 24h + checkboxes (admin, mensalistas, avulsos) + convidados
3. Detalhe: stats `+/-`, adicionar/remover jogadores, montar times, WhatsApp

Helpers importantes: `isoToBR`, `brToISO`, `normalizeHora`, `dataPadraoPartida`, `proximaQuartaApos`, `isQuarta`, `snapshotParticipante`, `clampNivel`.

Ao criar/adicionar jogador, **copiar** `nivel` e `goleiro` do cadastro para o participante (snapshot). Convidados nascem com nível 3 / não-goleiro.

## Ranking

- Filtros: **Mensal** (mês de `state.mesAno`) | **Partida** | **Total**
- Pontos: `gols*3 + assistencias*2 + defesas*1`
- Desempate: gols → assistências → nome
- **Não** usa o nível manual (nível é só para equilibrar times)

## Montagem de times

1. Número de times = `max(2, ceil(presentes / jogadoresPorTime))`  
   Ex.: 15→3, 20→4, 13→3 (com `jogadoresPorTime = 5`)
2. Prioriza completar times no tamanho ideal; sobra no último (ex. 13 → 5+5+3, não 5+4+4); todos entram (sem reserva)
3. Goleiros primeiro (preferência 1 por time), depois de linha
4. Cada próximo jogador vai para o time com **menor soma** do critério escolhido (`balanceamentoTimes`: **Nv** ou **Av**) que ainda tenha vaga
5. Em modo **Av**, jogador sem `nivelAvaliacao` usa o **Nv** manual como fallback
6. “Embaralhar” aplica jitter ±1 no valor usado
7. `partida.times` = array de arrays de `playerId` (ex. `[[...], [...], [...]]`); legado `{a,b}` é migrado
8. Estatísticas: painel por time com borda; arrastar card ou select da letra para trocar de time
9. Jogador adicionado depois do sorteio vai automaticamente para o time com menos gente / menor soma
10. Remover jogador: modal de confirmação

`jogadoresPorTime` e `balanceamentoTimes` são editáveis em **Ajustes** (e o balanceamento também na tela da partida). Default: **5** jogadores/time · balanceamento **Nv**.

**Outros débitos** (Ajustes): ao cadastrar, soma em `outrosDebitos` e salva; ao remover, devolve o valor. Botão **Histórico** abre popup com mês atual + `debitosHistorico`. No fechamento de mês, débitos do período vão para o histórico e a lista do mês zera.

## Convenções de UI / produto

- Não quebrar o fluxo financeiro existente
- Preferir edição no mesmo estilo (cards, badges, `btn-add`)
- Badges `Nv 1…5` (ciclam ao toque) e `GOL`/`LINHA` no cadastro
- Stats G/A/D com **borda vertical** entre as colunas
- Na tela de stats da partida, permitir **adicionar jogadores** (select de cadastrados + nome livre)
- Textos de data/hora: texto (não `type="date"` / `type="time"`) para forçar BR e 24h no Windows/locale US

## Ideias futuras (ainda não implementadas)

- Badges artilheiro / garçom / muralha da semana
- Melhor do mês no Resumo
- Draft manual / capitães
- Sync de avaliações em nuvem (sem colar JSON do Discord)
- Meta coletiva do mês

## O que NÃO fazer

- Não introduzir framework ou bundler sem pedido explícito
- Não criar backend / banco remoto sem pedido
- Não hardcodar URL de webhook Discord no repositório
- Não apagar `partidas` (nem `avaliacoes`) no fechamento de mês
- Não editar arquivos de CI GitLab (se existirem) — gerenciados pela equipe de core
- Não commitar sem o usuário pedir

## Como testar rápido

1. Abrir `index.html` ou servir a pasta (`npx serve .`)
2. Em Ajustes: definir nome do admin · webhook Discord · em Mensalistas: ajustar Nv e GOL
3. Partidas → Nova partida (selecionar presentes) → Criar
4. Montar times → conferir goleiros separados e soma de níveis
5. Lançar G/A/D → Ranking (mensal/partida/total)
6. Link de avaliação → abrir `#a=…` → enviar/copiar JSON → Importar em Ajustes ou na partida
7. Após deploy PWA: hard refresh / limpar cache se a versão do SW não atualizar sozinha
