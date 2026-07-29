# Navi

PWA de controle financeiro pessoal em português do Brasil, sem mascote e com
identidade azul. O Navi separa corretamente saldo bancário, consumo, dívida no
cartão, saída de caixa, transferências e compromissos futuros.

## Funcionalidades

- Autenticação e isolamento por usuário com Supabase Auth + RLS.
- Contas com saldo consolidado e transferências sem falsa receita/despesa.
- Cartões, faturas, pagamentos, estornos e compras parceladas.
- Lançamentos de receitas, despesas, cartão, transferências e pagamentos.
- Orçamentos mensais por categoria e alertas de limite excedido.
- Receitas e despesas recorrentes.
- Metas, contribuições e dinheiro protegido.
- Limite diário conservador ou por fluxo de caixa.
- Planejamento visual de 12 meses.
- Backup JSON e exportação CSV.
- PWA instalável com shell offline.
- Interface responsiva: menu lateral no desktop e navegação inferior no celular.

## Modelo financeiro

- Valores monetários são inteiros em centavos.
- Compra no cartão é consumo e dívida, mas não reduz a conta bancária.
- Pagamento da fatura reduz a conta e não cria um segundo gasto.
- Transferência apenas move saldo entre contas.
- Estorno reduz consumo e fatura.
- O valor disponível hoje protege faturas, planejamentos e metas antes de
  dividir o restante pelos dias do mês.

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

Crie `.env.local`:

```dotenv
VITE_NAVI_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_NAVI_SUPABASE_ANON_KEY=sua-chave-anon-publica
```

Aplique, em ordem, as migrações de `supabase/migrations/`. Nunca coloque
`service_role`, senha do banco ou token pessoal no cliente ou no Git.

## Qualidade

```bash
npm test
npm run lint
npm run build
```

Os testes cobrem dinheiro em centavos, arredondamento de parcelas, saldo de
conta, transferência, estorno e a não duplicação do pagamento de fatura.

## Publicação

O workflow de GitHub Pages compila e publica todo push em `main`:

<https://gabriel-pirotello-lizzi.github.io/navi/>

As variáveis `VITE_NAVI_SUPABASE_URL` e `VITE_NAVI_SUPABASE_ANON_KEY` devem
existir como secrets no GitHub. Os dados financeiros ficam somente no Supabase;
o repositório e o bundle não contêm a planilha ou as faturas pessoais.
