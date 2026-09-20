# Briefing — Módulo Financeiro (empresa sem PDV)

> Preparado em 2026-09-20 para ser executado em **outra sessão**, pelo fluxo SDD + orquestrador.
> Slug sugerido: **`modulo-financeiro-sem-pdv`**.
> Leia junto: [`AGENTS.md`](./AGENTS.md) (contrato do SDD, gates, restrições) e [`FINANCEIRO_MAP.md`](./FINANCEIRO_MAP.md).

## 1. O pedido, em uma frase

Hoje o Financeiro é uma aba dentro de "Gestão" e só existe dentro de uma loja com PDV. O dono quer que
exista também um **módulo Financeiro** para quem **não tem PDV** — uma empresa que usa só o financeiro
(contas, bancos, conciliação, notas, folha, DRE).

## 2. Decisões já tomadas pelo dono (2026-09-20)

1. **Quem tem PDV continua como está.** A aba Financeiro dentro de Gestão não muda. Toda mudança nas
   telas compartilhadas é **condicional**, nunca uma troca de comportamento para a loja com PDV.
2. **"Módulo financeiro" = empresa sem PDV.** Mesmo banco de dados, mesmas telas, mesma rota
   `/financeiro`. O que muda é a porta de entrada e o que aparece.
3. **Uma pessoa pode ter VÁRIAS empresas** (caso do contador com vários clientes). Usa o seletor de
   loja que já existe; onde a empresa não tiver PDV, o texto fala **"empresa"**, não "loja".
4. **Nome do módulo: "Financeiro"** (o dono chama de "módulo financeiro" quando se refere ao caso sem PDV).
5. **Não duplicar o Financeiro.** Se virar uma cópia "versão avulsa", toda correção passa a ser feita
   duas vezes. Mesma rota, mesmos componentes.

## 3. Estado atual (levantado em 2026-09-20, com evidência)

### 3.1 O que já ajuda
- **RLS é por participação na loja** (`auth_is_member_of`), não por PDV. Uma empresa sem PDV **não exige
  nenhuma mudança de RLS**.
- **Já existe módulo sem loja**: `user_module_access` (`tarefas`, `contratacao`, `nfse`), RPC
  `fn_my_modules`, hook `src/hooks/useModuleAccess.ts`. Migration:
  `supabase/migrations/20260914000000_user_module_access_admin_master.sql`.
- **O app já sabe rodar sem loja selecionada**: `src/components/feature/AppLayout.tsx` tem
  `NO_TENANT_ROUTES = ['/contratacao', '/notas-servico']` (~linha 30 e 78-105).
- **O Financeiro já sabe viver sem vendas do PDV**: `fin_revenue_settings.sources`
  (`src/lib/revenueSources.ts:11-13, 93-109`) decide o que conta como receita (pedidos, maquininha,
  Pix, iFood, manual).
- **17 das 20 abas do Financeiro são puramente financeiras** (contas a pagar/receber, bancos,
  conciliação, notas de entrada, folha, freelancers, orçamentos, centro de custos, implantação, iFood).

### 3.2 O que amarra hoje
- **Financeiro não tem card em `/modulos`**: a lista é fixa em `src/pages/modulos/page.tsx:33-177`
  (visibilidade em 450-466). Entra-se pelo card "Gestão" → `/dashboard` → aba Financeiro.
- **Não existe papel "só financeiro"**: `RotaProtegida` (`src/components/feature/RotaProtegida.tsx:13-25`)
  mapeia `'/financeiro' → FIN_KEYS`; admin/gerente passam por tudo. Papéis restritos já têm o padrão de
  "hard-lock por prefixo de rota" (linhas 47-54) — **é esse padrão que o papel novo deve copiar**.
- **Nascer loja é nascer PDV**: `supabase/functions/setup-tenant/index.ts:388-502` cria estações,
  categorias, itens, mesas, formas de pagamento e `pdv_config`. **Nada de financeiro** (sem plano de
  contas DRE, sem conta bancária).
- **`fn_setup_tenant_bypass` NÃO está versionada** (confirmado): existe só no banco, chamada em
  `setup-tenant/index.ts:344-351`. Versionar (ou criar uma irmã) faz parte do escopo.
- **Contextos de PDV carregam para todo mundo**: `src/providers/AppProviders.tsx:78-116` monta
  Estoque, Produção, Cardápio, Impressoras, KDS e Mesas em qualquer tela.
- **Padrão das fontes de receita é `['orders','manual']`** (`src/lib/revenueSources.ts:13`) — uma empresa
  sem PDV veria tudo zerado até alguém trocar isso.
- **Tabelas**: `tenants(id, name, slug, cnpj, address, logo_url, created_at, plan, is_active, phone,
  email, city, state, zip_code, backup_enabled)` — **não há marca de tipo**;
  `user_tenants(id, user_id, tenant_id, role, training_mode, ...)`;
  `user_module_access(user_id, module, granted_at)`.

### 3.3 As únicas telas do Financeiro que assumem PDV
| Onde | O que depende de pedido/caixa | Arquivo |
|---|---|---|
| DRE e DRE Comparativo | receita por canal (balcão/mesa/delivery/autoatendimento), cancelamentos, descontos, CMV teórico e cobertura de ficha | `DRETab.tsx:83-104, 151-160, 197-232, 269-303`; `DREComparativoTab.tsx:55, 99-178` |
| Visão Geral | ticket médio (conta `orders`) e "Modo Sessão" (sessão de caixa) | `useFinanceiro.ts:725-733`; `VisaoGeralFinTab.tsx:197` |
| Contas Vencidas | "% de impacto na margem" usa receita de `payments`+`orders` — **checar divisão por zero** | `ContasVencidasPanel.tsx:108-117` |
| Receitas | fatia "Pedidos do sistema" lê `orders` | `useReceitas.ts:143-166` |
| Bancos e Contas | rótulos de roteamento (PDV, Garçom, Delivery…) são só texto, sem query | `BancosContasTab.tsx:26-30` |

Nenhuma delas **quebra** sem PDV: ficam zeradas — o que é pior, porque parece defeito.

## 4. Escopo da Fase 1 (o que esta spec deve entregar)

1. **Marca no tenant**: `tenants.kind` (ou nome equivalente) com `'loja'` (padrão) e `'financeiro'`.
   Migration com `GRANT`/`REVOKE` conforme as restrições padrão do `AGENTS.md`.
2. **Papel `financeiro`** em `user_tenants.role`: vê só o Financeiro daquela empresa; segue o padrão de
   hard-lock de `RotaProtegida` (47-54) e entra no mapa PT↔EN de papéis (**atenção: há 4 cópias desse
   mapa no código — ver memória "Perfis de usuário"**).
3. **Card "Financeiro" em `/modulos`**, visível para o papel novo e para empresas `kind='financeiro'`.
4. **Entrada e navegação**: seletor mostra selo "sem PDV" e usa a palavra "empresa"; empresa sem PDV
   **não monta** os contextos de PDV (`AppProviders`).
5. **Telas condicionais**: esconder receita por canal, CMV teórico/cobertura, ticket médio e Modo Sessão
   quando `kind='financeiro'`; guarda contra divisão por zero em Contas Vencidas.
6. **Nascimento da empresa financeira** (pelo Admin Master nesta fase): cria o tenant, o papel,
   **plano de contas DRE inicial** e `fin_revenue_settings.sources` sem `orders` (ex.: `['manual','pix']`).
7. **Versionar `fn_setup_tenant_bypass`** (ou criar a irmã usada pela empresa financeira) numa migration.

## 5. Fora de escopo (projetos à parte)

- Cadastro público/self-service para o cliente criar a empresa sozinho.
- Cobrança/planos por módulo.
- **Empresa-mãe com várias lojas** (DRE consolidada) — hoje `tenants` é a unidade máxima e não existe
  hierarquia; é a mudança mais pesada e só vale se virar produto.
- App móvel dedicado ao financeiro.

## 6. Riscos e pegadinhas conhecidas

- **Nunca duplicar as telas do Financeiro.** Mesma rota, mesmos componentes, diferença só por condição.
- **O caminho do PDV não pode mudar** — inclusive visualmente. Vale comparar antes/depois.
- `tenant_id` em toda leitura e escrita (restrição padrão do `AGENTS.md`); contexts resetam ao trocar de
  empresa (já houve vazamento entre lojas).
- O papel novo precisa aparecer em **todas** as cópias do mapa de papéis, senão a pessoa loga e cai fora.
- Teste manual só na loja **Testes PDV** (`db3ca014-6c03-4c2e-97b9-9542cf825da2`), usuários `qa.*`
  (senhas em `.test-users.json`, **regeneradas em 2026-09-20**; para recriar:
  `SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-test-users.mjs`).
- O app abre **teclado virtual** em telas de toque: automação em viewport de celular não digita. Logar
  em largura de desktop e só depois emular o celular.

## 7. Critérios de aceite

1. Pessoa com papel `financeiro` em **duas** empresas sem PDV: entra, escolhe a empresa, vê só o
   Financeiro, sem nenhum card/rota de PDV; trocar de empresa troca os dados.
2. Loja com PDV: telas **idênticas** às de hoje (Gestão → Financeiro), incluindo DRE com receita por canal.
3. Empresa sem PDV: DRE sem linhas de canal, sem CMV teórico, sem ticket médio, sem Modo Sessão, e
   nenhum "∞"/NaN em Contas Vencidas.
4. Empresa financeira criada pelo Admin Master já nasce com plano de contas e fontes de receita corretas.
5. `node scripts/check.mjs --force` verde (**sem** `--update-baseline`).
6. Nada escrito em loja real durante os testes.

## 8. Como abrir a nova sessão

O plugin SDD e o orquestrador **só entram quando o dono pede** (regra do `CLAUDE.md`) — aqui ele pediu.
Mensagem sugerida para colar na sessão nova:

```
Leia BRIEFING-MODULO-FINANCEIRO.md e AGENTS.md. Rode o fluxo SDD para o slug
modulo-financeiro-sem-pdv, começando pelo /sdd-01-new (spec, pesquisa, plano)
e seguindo com o orquestrador. Escopo = Fase 1 do briefing; nada do que está
em "Fora de escopo". O caminho de quem tem PDV não pode mudar.
```

Se preferir o caminho autônomo de ponta a ponta, peça o orquestrador direto
(`/sdd-orchestrate`) citando este arquivo como entrada.

## 9. Ordem sugerida de execução (para o plano)

1. Migration: marca no tenant + papel + plano de contas padrão + fontes de receita da empresa financeira.
2. Papel e guardas (`RotaProtegida`, `AppLayout`, mapas de papéis) — sem tocar no PDV.
3. Card em `/modulos` + selo/"empresa" no seletor.
4. Condicionais nas telas do Financeiro (DRE, Visão Geral, Contas Vencidas).
5. Contextos de PDV sob demanda (ganho de peso ao abrir).
6. Admin Master: criar empresa financeira e conceder o papel.
7. Teste de ponta a ponta na loja Testes PDV + uma empresa financeira de teste.
