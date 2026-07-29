# Navi

Um PWA de controle financeiro pessoal, com uma identidade leve em azul e sem
mascote. O app guarda cada dado no Supabase, por usuário, e funciona em tela
cheia no celular como um aplicativo instalável.

## O que já funciona

- Cadastro e login por e-mail e senha.
- Onboarding para renda, custos fixos e dia de recebimento.
- Cálculo diário do valor disponível, já protegendo custos fixos.
- Registro de entradas e saídas, categorias e histórico.
- Metas financeiras e progresso.
- Cache de leitura e fila de lançamentos para momentos sem conexão.
- Instalação como PWA em Android, iPhone e desktop.
- Dados isolados com Row Level Security no Supabase.

Leitura automática de faturas fica fora deste primeiro corte: os lançamentos
manuais já são completos e deixam o fluxo confiável. A importação de PDF, CSV
e imagem pode entrar como a próxima etapa sem alterar o modelo de dados.

## Desenvolvimento local

Pré-requisito: Node.js 22 ou superior.

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie o arquivo local de configuração a partir de `.env.example` e preencha
   as duas chaves **públicas** do seu projeto Supabase:

   ```dotenv
   VITE_NAVI_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_NAVI_SUPABASE_ANON_KEY=sua-chave-publica
   ```

   Nunca use nem publique uma chave `service_role` ou um token pessoal do
   Supabase. O arquivo `.env.local` é ignorado pelo Git.

3. Aplique a migração em
   `supabase/migrations/20260728000000_navi_initial_schema.sql` no SQL Editor
   do Supabase.

4. Execute:

   ```bash
   npm run dev
   ```

   Abra `http://localhost:3000`.

## Verificação

```bash
npm run build
npm test
```

## Publicação

O build produz um app Vinext compatível com Cloudflare Workers. Defina as duas
variáveis `VITE_NAVI_*` no ambiente de build do host, configure a URL pública
em **Supabase > Authentication > URL Configuration** e publique. O backend e
os dados continuam no Supabase; não há dependência de ambiente do Codex.

Antes de divulgar, revise o domínio público permitido no Supabase e ative a
confirmação de e-mail conforme o seu fluxo de lançamento.
