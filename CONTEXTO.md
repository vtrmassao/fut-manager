# Contexto do projeto — Fut Manager

Documento de referência para humanos e agentes de IA. Leia isto antes de alterar o código.

## Visão geral

PWA para o **futsal de quarta-feira**, com **duas versões** no mesmo site:

| Path | Versão | Persistência |
|------|--------|----------------|
| `/` (raiz) | **v1** — monolito estável | `localStorage` chave `futmgr` |
| `/v2/` | **v2** — app modular + Supabase | Postgres (Supabase) |

Dois domínios no mesmo app:

1. **Financeiro** — caixa, mensalistas, avulsos, Pix, fechamento de mês
2. **Esportivo** — partidas, gols/assistências/defesas, ranking, montagem de times

**Não altere a v1** ao evoluir a v2, salvo pedido explícito.

## Fut Manager v2 (`/v2`)

- Front com paridade da v1, código em módulos ES (`v2/js/…`, `v2/css/…`).
- Login admin (Supabase Auth) com `app_metadata.role = 'admin'` para financeiro/config/partidas.
- **Multi-fut**: cada login admin gerencia um ou mais **futs** (`futs.owner_id = auth.uid()`). Dados (config, jogadores, partidas…) têm `fut_id`; RLS com `is_admin()` + `owns_fut()`. Após login: escolher/criar fut → hydrate escopado. Seletor no header + **Ajustes → Novo fut** / **Apagar fut atual** (DELETE em `futs` com CASCADE). Logout: **Ajustes → Sair da conta** (`deslogar()` → `auth.signOut` + reload). RPC `create_fut(nome)`.
- IDs: **UUID** (`crypto.randomUUID()`). Admin-jogador: um por fut (`jogadores.tipo = 'admin'`), UUID gerado no `create_fut`.
- Schema SQL versionado em [`supabase/migrations/`](supabase/migrations/). Inclui grants: **`authenticated`** tem SELECT/INSERT/UPDATE/DELETE nas tabelas (+ `futs`); **`anon` não** (avaliações públicas só via `submit-avaliacao` + service role). RLS: `is_admin()` + `owns_fut(fut_id)` por tabela. Sem GRANT de tabela o PostgREST devolve 42501 e o `render()` nunca preenche Ajustes.
- Edge Functions: `import-backup`, `export-backup` (JWT admin + `futId` no body), `submit-avaliacao` (anon → service role; recalc Av escopado ao fut da partida).
- Avaliações pelo link `#a=` gravam via `submit-avaliacao` (e Discord se houver webhook).
- Projeto Supabase: **fut-manager** (`lajdoswgtgcuazviewgb`, `sa-east-1`).
- PWA própria: `v2/manifest.json`, `v2/sw.js` (cache `futmanager-v2-…`), scope `/fut-manager/v2/`.
- Migrar financeiro da v1: Exportar backup na v1 → **Ajustes → Importar Backup** na v2 (prompt no navegador; chama `import-backup`). Ignora `partidas` e `avaliacoes`. Não versionar o JSON (`backup*.json` no `.gitignore`).
- Handlers `onclick` na v2: interpolar IDs com `jsArg()` (`v2/js/utils/ids.js`), que escapa aspas para atributo HTML. UUID cru com `JSON.stringify` quebra o atributo (`onclick="fn("` incompleto).

### Arquivos v2 (resumo)

| Path | Papel |
|------|--------|
| `v2/index.html` | Shell HTML + abas |
| `v2/css/*` | Estilos |
| `v2/js/main.js` | Bootstrap, login, seleção de fut |
| `v2/js/app.js` | Lógica de UI/domínio (port da v1) |
| `v2/js/supabase.js` | Client + URL/anon key |
| `v2/js/api/futs.js` | Listar/criar/trocar fut ativo |
| `v2/js/api/auth.js` | Login/logout admin (`logout`, `deslogar` na UI) |
| `v2/js/api/*` | Hydrate/persist/functions |
| `supabase/migrations/*.sql` | Documentação + histórico do schema |
| `supabase/functions/*` | Código das Edge Functions |

### Admin Auth

Guia passo a passo: [`docs/supabase-novo-usuario.md`](docs/supabase-novo-usuario.md).

1. Criar usuário no Supabase Auth (Dashboard → Add user, **Auto Confirm User**). Sem confirmar, `signInWithPassword` falha.
2. Definir `app_metadata`: `{ "role": "admin" }` via SQL em `auth.users.raw_app_meta_data` (não usar `user_metadata`).
3. Entrar em `/v2/` com e-mail/senha. Depois de gravar a role, **login de novo** para o JWT trazer `role` (ou **Ajustes → Sair da conta** e entrar outra vez).
4. Sem role admin o app faz sign-out e mostra "Usuário sem role admin".
5. Primeiro acesso (ou fut novo): modal **Criar fut** ou seletor se já houver futs. Cada admin vê só os próprios futs.
6. **Sair da conta** (topo de Ajustes): `deslogar()` chama `logout()` (`signOut`), limpa fut em memória e recarrega a página para exibir o login.

## Arquivos (v1 — raiz)

| Arquivo | Papel |
|---------|--------|
| `index.html` | UI + CSS + toda a lógica JS |
| `sw.js` | Service Worker (cache offline) |
| `manifest.json` | Manifest PWA |
| `README.md` | Visão para usuário / instalação |
| `CONTEXTO.md` | Este arquivo (contexto técnico e de produto) |

Ao mudar `index.html` da **v1** de forma relevante para quem já instalou o PWA, **incremente a versão do cache** em `sw.js` da raiz. Na **v2**, incremente `v2/sw.js`.

## Seed local (só desenvolvimento — v1)

Para testar com dados preenchidos sem sujar o repo:

1. Copie `dev-seed.local.example.js` → `dev-seed.local.js` (gitignored)
2. Abra em `localhost` / `127.0.0.1` / `file://`
3. Se não houver mensalistas, o seed aplica sozinho
4. Force de novo com `?seed=1` ou `force: true` no arquivo

O loader só injeta o script em host local; em produção o seed não carrega.

## Stack e padrões de código

- Vanilla HTML/CSS/JS (ES6+); v2 usa `type="module"`
- Fontes: Bebas Neue + DM Sans
- Tema dark (`#0a0a0f`, acentos `#00e676`)
- Padrão de mutação: alterar `state` → `save()` → `render()` (v2: `save()` persiste no Supabase)
- UI por abas (`setTab`): `resumo` | `mensalistas` | `avulsos` | `partidas` | `ranking` | `ajustes`
- Estado de tela das partidas em objeto `ui` (não persiste): `partidaView`, `partidaId`, draft da nova partida, filtros do ranking
- Sem React/Vue, sem build step, sem TypeScript
- Respostas e UI em **português (pt-BR)**

## Domínio do produto

- Pelada: **toda quarta-feira**, horário padrão **21:00–23:00** (formato **24h**)
- Datas na UI: **`dd/mm/aaaa`** (armazenadas internamente como `YYYY-MM-DD`)
- **Admin do grupo**: joga, **não paga mensalidade**, sempre pré-selecionado em nova partida. **v1:** `ADMIN.id = 900001`. **v2:** `jogadores.tipo = 'admin'` **por fut** (UUID do `create_fut`; em memória `state.meta.adminPlayerId`).
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
  discordWebhookUrl: '',  // Ajustes; v1 = localStorage, v2 = coluna config — nunca no git
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
- Backup v1: export/import = JSON completo do `state` (passa por `migrateState`)
- Backup v2: export/import via Edge Functions; import **só financeiro + jogadores** (partidas/avaliações ignoradas)

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
- Não hardcodar URL de webhook Discord no repositório (nem em `backup*.json`)
- Não apagar `partidas` (nem `avaliacoes`) no fechamento de mês
- Não editar arquivos de CI GitLab (se existirem) — gerenciados pela equipe de core
- Não commitar sem o usuário pedir
- Não quebrar a **v1** na raiz ao trabalhar na **v2**
- Não expor `service_role` no front; avaliações públicas só via Edge Function

## Como testar rápido

### v1
1. Abrir `index.html` ou servir a pasta (`npx serve .`)
2. Em Ajustes: definir nome do admin · webhook Discord · em Mensalistas: ajustar Nv e GOL
3. Partidas → Nova partida → Criar → Montar times → Ranking
4. Link de avaliação → `#a=…` → importar JSON

### v2
1. Criar usuário no Supabase Auth e setar `app_metadata.role = "admin"`.
2. Aplicar migrations (incl. `202603250004_multi_fut.sql`) e redeploy das Edge Functions.
3. Servir a raiz (`npx serve . -l 4173`) e abrir `http://localhost:4173/v2/` (produção: `/fut-manager/v2/`).
4. Login → criar ou escolher fut → usar o app. Se Ajustes vier vazio, conferir grants de `authenticated` e o console (hydrate falhou).
5. Importar backup da v1 em **Ajustes → Importar Backup** (colar JSON) **no fut ativo**. Partidas/avaliações não vêm.
6. Avaliações: link `#a=` envia para `submit-avaliacao` (+ Discord se houver webhook).
7. Vários peladas: **Ajustes → Novo fut** ou seletor no header.
8. Logout: **Ajustes → Sair da conta**.
9. Apagar pelada: **Ajustes → Apagar fut atual** (remove o fut selecionado no topo; irreversível).
