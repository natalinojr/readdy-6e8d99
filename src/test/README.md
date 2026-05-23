# Testes Automatizados — ERPOS V2

## Estrutura

```
src/test/
├── setup.ts                          # Configuração global (mocks do Supabase, AuthContext)
├── README.md                         # Este arquivo
│
├── lib/                              # Testes unitários das bibliotecas
│   ├── dateUtils.test.ts             # getPeriodDates, getPeriodoAnterior, labelPeriodo, etc.
│   └── formatters.test.ts            # formatCurrency, formatDate, formatTime, etc.
│
├── business/                         # Testes de lógica de negócio
│   ├── orderLogic.test.ts            # deriveOrderStatus, STATUS_RANK, DEST_MAP, ORIGIN_MAP, UUID, loyalty
│   └── promotions.test.ts            # applyPromotions, isRuleActiveNow, isRuleValidForChannel
│
└── integration/                      # Testes de integração
    ├── orderFlow.test.ts             # Fluxo completo: criação → KDS → relatório → tenant
    └── tenantQuery.test.ts           # applyValidOrderFilters, VALID_ORDER_FILTERS
```

## Executar

```bash
# Rodar todos os testes (uma vez)
npm run test

# Modo watch (re-executa ao salvar)
npm run test:watch

# Com cobertura de código
npm run test:coverage
```

## Cobertura

Os testes cobrem:

| Módulo | Cobertura |
|--------|-----------|
| `src/lib/dateUtils.ts` | ~95% — todos os períodos, custom, edge cases |
| `src/lib/formatters.ts` | ~90% — todos os formatadores |
| `src/lib/tenantQuery.ts` | ~85% — filtros e helpers |
| Lógica `order-write` | ~80% — deriveOrderStatus, promoções, loyalty, UUID |
| Fluxo de pedido | ~75% — criação, KDS, cancelamento, relatório, tenant |

## Filosofia

- **Testes unitários** (`lib/`): testam funções puras sem dependências externas
- **Testes de negócio** (`business/`): testam lógica extraída das Edge Functions
- **Testes de integração** (`integration/`): testam fluxos completos com mocks do Supabase

## Mocks

O arquivo `setup.ts` mocka automaticamente:
- `@/lib/supabase` — cliente Supabase (sem conexão real)
- `@/contexts/AuthContext` — usuário autenticado de teste

## Adicionar novos testes

1. Crie o arquivo em `src/test/[categoria]/[nome].test.ts`
2. Importe as funções a testar
3. Use `describe` + `it` + `expect` (globals do Vitest)
4. Execute `npm run test:watch` para feedback imediato
