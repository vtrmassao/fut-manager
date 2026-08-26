# ⚽ Fut Manager

O **Fut Manager** é um gerenciador de futsal simples, rápido e moderno projetado para rodar direto no celular ou navegador como um **Progressive Web App (PWA)**. Com ele, você consegue gerenciar o caixa do futebol de quarta-feira, registrar partidas e estatísticas, ver ranking e montar times.

- **v1 (raiz):** dados no `localStorage` — versão estável.
- **v2 (`/v2/`):** mesma experiência, persistência no **Supabase** (login admin). Um login pode gerenciar **vários futs** (peladas) isolados. Detalhes em [`CONTEXTO.md`](CONTEXTO.md).

> **Para agentes / novos chats:** leia [`CONTEXTO.md`](CONTEXTO.md) — modelo de dados, abas, admin configurável, datas `dd/mm/aaaa`, horário 24h e convenções de código.

---

## 🚀 Funcionalidades

- **📊 Resumo Financeiro Inteligente**:
  - Cálculo automático de **lucro no caixa** em tempo real.
  - Controle de saldo do mês anterior e avulsos pendentes anteriores.
  - Exibição de custos da quadra (editável).
  - Valor pendente a receber estimado.
  - **Barra de progresso** indicando quantos mensalistas já realizaram o pagamento.
  - Lista rápida de **Pendentes** exibida dinamicamente caso haja pendências.

- **👥 Gestão de Mensalistas**:
  - Lista com os jogadores recorrentes.
  - Adição e remoção simplificada.
  - Alternância rápida entre **PAGO** e **PENDENTE**.

- **⚡ Controle de Avulsos**:
  - Convidados do mês com status Pago/Pendente.
  - Totalizadores de pagos e pendentes.

- **⚽ Partidas**:
  - Data no formato **dd/mm/aaaa**; horário **24h** (padrão 21:00–23:00, quartas).
  - **Admin** (nome em Ajustes) sempre disponível e pré-selecionado — joga sem mensalidade.
  - Participantes: mensalistas, avulsos, convidados; dá para adicionar jogadores também na tela de stats.
  - Gols, assistências e defesas por jogador (**v2:** só leitura — vêm das avaliações aprovadas).
  - Montagem automática de times (snake draft) + embaralhar.

- **⭐ Avaliações pós-partida (v2)**:
  - Link curto `#a=<partidaUuid>` (sem login).
  - Jogador envia notas + G/A/D próprios → grava no banco (pendente) + Discord legível.
  - Admin **aprova ou rejeita** na tela da partida; só então atualizam Av (média) e estatísticas.
  - Upsert: reenviar substitui e volta a exigir aprovação.

- **🏆 Ranking**:
  - Filtros **Mensal**, **Partida** e **Total**.
  - Pontuação: Gol = 3 · Assistência = 2 · Defesa = 1.
  - Cópia formatada para WhatsApp.

- **📱 Suporte PWA**:
  - Instalável na tela inicial, offline via Service Worker.
  - v1: dados no `localStorage`. v2: dados no Supabase (PWA em `/v2/`, cache próprio).

---

## 🛠️ Tecnologias

- HTML5 + CSS vanilla + JavaScript (ES6+); v2 em módulos (`type="module"`)
- Fontes: Bebas Neue e DM Sans
- PWA: `manifest.json` + `sw.js` (v1 na raiz; v2 em `v2/`)
- **v2:** Supabase (Postgres + Auth + Edge Functions)

---

## 📦 Estrutura de Arquivos

```
fut-manager/
├── index.html              # v1 (HTML + CSS + JS, localStorage)
├── sw.js / manifest.json   # PWA v1
├── v2/                     # v2 modular (Supabase)
│   ├── index.html
│   ├── css/  js/  sw.js  manifest.json
│   │   └── js/api/futs.js   # listar/criar/trocar fut
│   │   └── js/api/auth.js   # login/logout admin
├── supabase/
│   ├── migrations/         # Schema + grants (incl. multi-fut, aprovação de avaliações)
│   └── functions/          # import/export-backup, submit/get-partida/approve-avaliacao
├── README.md
├── CONTEXTO.md             # Contexto técnico (leia em novos chats)
├── docs/
│   └── supabase-novo-usuario.md  # Cadastrar admin no Supabase
├── .cursor/rules/
├── icon-192.png / icon-512.png
└── .gitignore              # ignora dev-seed.local.js e backup*.json
```

### Edge Functions (v2)

| Function | Auth | Papel |
|----------|------|--------|
| `submit-avaliacao` | anon | Grava avaliação **pendente** + Discord legível |
| `get-partida-avaliacao` | anon | Roster da partida para o link `#a=` |
| `approve-avaliacao` | JWT admin | Aprovar/rejeitar → recalc Av e G/A/D |
| `import-backup` / `export-backup` | JWT admin | Backup financeiro do fut |
---

## 🎯 Como executar localmente

PWA pede HTTPS ou localhost. Na raiz do projeto:

```bash
npx serve . -l 4173
```

- **v1:** `http://localhost:4173/`
- **v2:** `http://localhost:4173/v2/` (login admin)

### Login da v2

Guia completo para cadastrar um novo admin: [`docs/supabase-novo-usuario.md`](docs/supabase-novo-usuario.md).

Resumo:

1. No Dashboard do Supabase: **Authentication → Users → Add user** (e-mail + senha, **Auto Confirm User**).
2. No SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'seu@email.com';
```

3. Abrir `/v2/` e entrar. Depois do `update` da role, faça logout/login para o JWT trazer `role: admin` (ou use **Ajustes → Sair da conta**).
4. No **primeiro acesso**, crie um fut (ex.: "Quarta-feira") no modal que aparece.

### Vários futs na v2

Cada **login admin** pode ter mais de um fut — cada um com caixa, elenco, partidas e ranking **independentes**. Outro admin não vê os seus futs.

- **Seletor no topo** da tela: troca o fut ativo.
- **Ajustes → Novo fut**: cadastra outra pelada.
- **Ajustes → Apagar fut atual**: remove o fut selecionado (irreversível; exporte backup antes).
- **Ajustes → Sair da conta**: encerra a sessão admin neste aparelho.
- **Backup/import** vale só para o fut selecionado no momento.

Se você organiza mais de um futsal, crie um fut por pelada e importe o backup da v1 em cada um.

### Trazer dados da v1 para a v2

Na v1: **Ajustes → Exportar Backup**. Na v2 (já logado, com o **fut correto** selecionado): **Ajustes → Importar Backup** e cole o JSON. O import grava financeiro + elenco **daquele fut**; **partidas e avaliações não vêm**. Repita para cada fut, se tiver mais de um. Não commite o JSON (`backup*.json` está no `.gitignore` — contém PIX e webhook).

Detalhes de schema, RLS, avaliações e Edge Functions: [`CONTEXTO.md`](CONTEXTO.md).

### Avaliações na v2 (fluxo rápido)

1. Em **Ajustes**: cole o webhook Discord (opcional, mas recomendado).
2. Na partida: **Link de avaliação** → mande no grupo (`#a=<uuid>`).
3. Cada jogador abre o link, avalia e toca **Enviar avaliação**.
4. De volta na partida (logado): **Revisar avaliações** → **Aprovar** / **Rejeitar**.
5. Só após aprovar o Av e os G/A/D entram no ranking.
---

## 📱 Como instalar no celular

1. **Android (Chrome)**: menu → **Adicionar à tela inicial** / **Instalar aplicativo**.
2. **iOS (Safari)**: Compartilhar → **Adicionar à Tela de Início**.
