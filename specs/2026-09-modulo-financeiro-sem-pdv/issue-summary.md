# Issue Summary — modulo-financeiro-sem-pdv

## Metadados da issue

| Campo | Valor |
|------|-------|
| Key | N/A (sem issue tracker — ver [`AGENTS.md`](../../AGENTS.md)); slug `modulo-financeiro-sem-pdv` |
| Link | N/A |
| Summary | Módulo Financeiro para empresa sem PDV (Fase 1) |
| Status | pedido do dono em chat, 2026-09-20 |
| Assignee | N/A |
| Labels | N/A |
| Atualizado em | 2026-09-20 |

## Resumo do body

A entrada desta spec é o [`BRIEFING-MODULO-FINANCEIRO.md`](../../BRIEFING-MODULO-FINANCEIRO.md) (raiz do
repo, preparado em 2026-09-20). O Financeiro hoje só existe como aba de "Gestão" dentro de uma loja com PDV.
O dono quer o mesmo Financeiro disponível para empresa **sem PDV** (contas, bancos, conciliação, notas,
folha, DRE), sem duplicar telas: mesma rota `/financeiro`, mesmos componentes, diferença só por condição.
Uma pessoa pode ter várias empresas (contador). Quem tem PDV não pode perceber mudança nenhuma.

## Trechos relevantes do body

- Escopo (briefing §4): `tenants.kind` (`'loja'` padrão / `'financeiro'`); papel `financeiro` em
  `user_tenants.role` com hard-lock no padrão de `RotaProtegida`; card "Financeiro" em `/modulos`; selo
  "sem PDV" + palavra "empresa" no seletor; empresa sem PDV não monta contextos de PDV; telas condicionais
  (receita por canal, CMV teórico/cobertura, ticket médio, Modo Sessão; guarda de divisão por zero em
  Contas Vencidas); nascimento pelo Admin Master com plano de contas DRE e `fin_revenue_settings.sources`
  sem `orders`; versionar `fn_setup_tenant_bypass` (ou criar a irmã).
- Fora de escopo (§5): self-service, cobrança por módulo, empresa-mãe/DRE consolidada, app móvel dedicado.
- Critérios de aceite: briefing §7 (6 itens). Ordem sugerida: briefing §9.

## Anexos referenciados

| Nome | Tipo | Decisão |
|------|------|---------|
| `BRIEFING-MODULO-FINANCEIRO.md` | markdown | já versionado na raiz do repo (não copiar) |
| `FINANCEIRO_MAP.md` | markdown | referência viva do financeiro, raiz do repo |

## Observações (dúvidas para research/specify)

- O briefing cita linhas de arquivos levantadas em 2026-09-20 — **confirmar no código atual** no research.
- Há 4 cópias do mapa PT↔EN de papéis: localizar todas.
- `fn_setup_tenant_bypass` só existe no banco: o research precisa extrair a definição atual. **O MCP do
  Supabase falhou ao conectar nesta sessão** — caminho alternativo: CLI (ver memória "Migrações sem o MCP").
- `user_tenants.role` tem CHECK/enum? Verificar antes de planejar a migration do papel novo.
