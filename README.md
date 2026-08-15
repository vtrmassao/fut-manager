# ⚽ Fut Manager

O **Fut Manager** é um gerenciador de futsal simples, rápido e moderno projetado para rodar direto no celular ou navegador como um **Progressive Web App (PWA)**. Com ele, você consegue gerenciar o caixa do futebol de quarta-feira, registrar partidas e estatísticas, ver ranking e montar times — tudo salvo localmente e funcionando offline!

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
  - Gols, assistências e defesas por jogador.
  - Montagem automática de times (snake draft) + embaralhar.

- **🏆 Ranking**:
  - Filtros **Mensal**, **Partida** e **Total**.
  - Pontuação: Gol = 3 · Assistência = 2 · Defesa = 1.
  - Cópia formatada para WhatsApp.

- **📱 Suporte PWA**:
  - Instalável na tela inicial, offline via Service Worker, dados no `localStorage`.

---

## 🛠️ Tecnologias

- HTML5 + CSS vanilla + JavaScript (ES6+)
- Fontes: Bebas Neue e DM Sans
- PWA: `manifest.json` + `sw.js`

---

## 📦 Estrutura de Arquivos

```
fut-manager/
├── index.html          # App completo (HTML + CSS + JS)
├── sw.js               # Service Worker
├── manifest.json       # Manifest PWA
├── README.md           # Este arquivo
├── CONTEXTO.md         # Contexto técnico (leia em novos chats)
├── .cursor/rules/      # Regras Cursor para o agente
├── icon-192.png
└── icon-512.png
```

---

## 🎯 Como Executar Localmente

### 1. Abrindo no Navegador
Abra `index.html` direto. Recursos de PWA pedem HTTPS ou localhost.

### 2. Servidor Local (recomendado)

```bash
npx serve .
```

```bash
python -m http.server 8000
```

Acesse `http://localhost:3000` (serve) ou `http://localhost:8000` (Python).

---

## 📱 Como instalar no celular

1. **Android (Chrome)**: menu → **Adicionar à tela inicial** / **Instalar aplicativo**.
2. **iOS (Safari)**: Compartilhar → **Adicionar à Tela de Início**.
