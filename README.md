# ⚽ Fut Manager

O **Fut Manager** é um gerenciador de futsal simples, rápido e moderno projetado para rodar direto no celular ou navegador como um **Progressive Web App (PWA)**. Com ele, você consegue gerenciar o caixa do futebol de quarta-feira, registrar pagamentos de mensalistas e avulsos, descontar o valor da quadra e ver o lucro em tempo real — tudo salvo localmente e funcionando offline!

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
  - Lista pré-carregada com os jogadores recorrentes.
  - Adição e remoção simplificada de mensalistas.
  - Botão de alternância rápida entre **PAGO** e **PENDENTE**.
  - Valor fixo configurado em R$ 35,00 por mensalista.

- **⚡ Controle de Avulsos**:
  - Adição de convidados (avulsos) com definição imediata do status de pagamento (Pago ou Pendente).
  - Valor fixo configurado em R$ 20,00 por avulso.
  - Listagem com opção de alternar status de pagamento ou remover.
  - Cards detalhados com totalizadores de avulsos pagos e pendentes.

- **📱 Suporte PWA (Progressive Web App)**:
  - Pode ser instalado na tela inicial do celular como um aplicativo nativo.
  - Interface com áreas seguras configuradas (`safe-area-inset`) para celulares modernos (iOS/Android).
  - Suporte a funcionamento **offline** com cache via Service Worker (`sw.js`).
  - Salvamento automático de dados no `localStorage` a cada alteração.

---

## 🛠️ Tecnologias Utilizadas

- **Estrutura**: HTML5 Semântico
- **Estilo**: Vanilla CSS (com fontes modernas do Google Fonts: *Bebas Neue* e *DM Sans*)
- **Lógica**: Vanilla JavaScript (ES6+)
- **Instalabilidade & Offline**: Web App Manifest (`manifest.json`) e Service Worker (`sw.js`)

---

## 📦 Estrutura de Arquivos

```
fut-manager/
├── index.html       # Página principal da aplicação (HTML + CSS + JS)
├── manifest.json    # Configurações de instalação da PWA
├── sw.js            # Service Worker para caching e suporte offline
├── icon-192.png     # Ícone do app para dispositivos móveis (192x192)
└── icon-512.png     # Ícone do app em alta resolução (512x512)
```

---

## 🎯 Como Executar Localmente

### 1. Apenas Abrindo no Navegador
Você pode abrir o arquivo `index.html` diretamente em qualquer navegador de internet. Entretanto, recursos de PWA (como o registro do Service Worker) requerem um contexto seguro (HTTPS ou localhost).

### 2. Servidor Local (Recomendado para testar PWA)
Para testar a funcionalidade de instalação e Service Worker no computador, execute um servidor local simples no diretório do projeto:

**Usando Node.js (npx):**
```bash
npx serve .
```

**Usando Python:**
```bash
python -m http.server 8000
```
Em seguida, acesse no navegador `http://localhost:3000` (Node) ou `http://localhost:8000` (Python).

---

## 📱 Como instalar no celular

1. **Android (Chrome)**: Acesse o link onde o aplicativo está hospedado, clique nos três pontinhos no canto superior direito e selecione **"Adicionar à tela inicial"** ou **"Instalar aplicativo"**.
2. **iOS (Safari)**: Acesse o link no Safari, clique no botão de **Compartilhar** (ícone de quadrado com seta para cima) e escolha a opção **"Adicionar à Tela de Início"**.