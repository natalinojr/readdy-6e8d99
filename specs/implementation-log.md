# Specs Implementation Log

Registro cronológico de specs criadas e seu progresso no workflow SDD.

## 2026-09-17

### backup-diario

**Spec Path**: `specs/2026-09-backup-diario/spec.md`

**Status**: draft

**Fase Atual**: `/sdd-01-new` ✓ (concluída)

**Descrição**: Backup diário automático do banco Supabase (plano Free, sem backup nativo). Implementar dump SQL diário compactado em `D:\backups\erpos\AAAA-MM-DD\`, retenção 30 dias, verificação de integridade e procedimento de restauração documentado.

**Context**:
- Supabase projeto `mdghhjemzdmeuqpzuyzx` (Free, 77 MB)
- Duas lojas em produção (Vila Leste + Paranaguá começando 18/09)
- TDD: sim
- Feature flag: não

**Próximas Etapas**:
- [ ] `/sdd-02-research`: Validar CLI commands, testar extração manual do banco
- [ ] `/sdd-03-specify`: Detalhar design de scripts (backup-diario.mjs, cleanup, verify)
- [ ] `/sdd-04-plan`: Planejar ordem de implementação, dependencies, riscos
- [ ] `/sdd-05-review`: Review do plano com usuário
- [ ] `/sdd-06-execute`: Implementar scripts, testes (TDD)
- [ ] `/sdd-07-spec-review`: Revisar spec após implementação
- [ ] `/sdd-08-docs`: Documentação final, PR/MR template
- [ ] `finish-branch`: Entrega no working tree

## 2026-09-18

### agente-impressao-remoto

**Spec Path**: `specs/2026-09-agente-impressao-remoto/spec.md`

**Status**: 01-new

**Fase Atual**: `/sdd-01-new` ✓ (concluída)

**Descrição**: Agente de impressão gerenciado remotamente com token por PC. Substituir modelo atual (chave pública + config.json local) por token de máquina, tela de status online/offline/versão, atribuição de lojas por clique, configuração remota. Backward compatible (flag `require_print_agent_token` padrão false).

**Context**:
- PC de casa do dono + PC Paranaguá disputam tickets de impressão hoje
- Paranaguá go-live: 21/09/2026 (segunda)
- TDD: sim (lógica de token, associação loja-agente)
- Feature flag: `system_settings.require_print_agent_token` (padrão false)
- Prazo: pronto antes de 21/09 para instalação em Paranaguá

**Problemas sendo resolvidos**:
1. Segurança: chave pública + id da loja → qualquer um acessa fila
2. Operação: config.json no PC, JSON inválido possível
3. Escalabilidade: sem controle de qual PC atende qual loja → duplicação
4. Visibilidade: sem status online/offline, versão, última impressão

**Próximas Etapas**:
- [ ] `/sdd-02-research`: Mapeamento do agente atual, Edge print-queue-agent, storage do token
- [ ] `/sdd-03-specify`: Detalhar goals, UX, fluxo de onboarding, atribuição de lojas
- [ ] `/sdd-04-plan`: Planejar tasks, ondas, arquitetura de token, tela no ERPOS
- [ ] `/sdd-05-review`: Review do plano
- [ ] `/sdd-06-execute`: Implementar (backend token, API de registro, tela, flag)
- [ ] `/sdd-07-spec-review`: Revisar spec vs código
- [ ] `/sdd-08-docs`: Documentação, guia de onboarding (gerador de token)
- [ ] `finish-branch`: Entrega no working tree

---


## 2026-09-20 — modulo-financeiro-sem-pdv: Módulo Financeiro para empresa sem PDV (Fase 1) — CONCLUÍDA

- **Spec:** `specs/2026-09-modulo-financeiro-sem-pdv/` · **Branch:** `claude/modulo-financeiro-sem-pdv` (base `main`)
- **Entrada:** `BRIEFING-MODULO-FINANCEIRO.md` (§4 = escopo; §5 = fora de escopo)
- **Resumo:** a empresa passa a ter tipo (`tenants.kind`). Empresa `financeiro` entra por card próprio em
  `/modulos`, com um papel `financeiro` preso ao Financeiro na tela **e** no servidor, telas sem o que
  depende de pedido/caixa, e nasce pronta (plano de contas + fontes de receita) pelo Admin Master.
  Loja com PDV conferida no navegador: idêntica.
- **Decisões:**
  - Escrita do papel liberada só nas **6** Edges do Financeiro (decisão do dono: menor privilégio).
    `config-write` foi **retirada** durante a execução — cria mesa/estação/forma de pagamento e grava
    permissões (`upsert_permissions`): seria escalação de privilégio.
  - `bulk_insert_ingredients` barrada ao papel (vem do modal de modelos, é ato de estoque).
  - Estoque **como consequência de compra/nota** é permitido ao papel (decisão do dono): é a mesma
    operação e é dela que o CMV vive.
  - Contexts de PDV **montam sem buscar**, em vez de não montar — não montar quebraria 5 consumidores
    fora do PDV, 4 deles dentro do próprio Financeiro.
  - `fn_setup_tenant_bypass`, `get_user_tenants` e `get_user_profile_for_tenant` foram **versionadas**
    (só existiam no banco).
- **Desvios declarados a "nada muda para o PDV":** Contas Vencidas passa a dizer "sem receita no período"
  em vez de "0,0%" quando não houve receita, e o percentual passa a usar vírgula (pt-BR, como o resto da
  tela). Só texto; nenhum número muda.
- **Gate:** `check.mjs --force` verde — tsc 287/292, vitest 500/500 (15 testes novos).

---
