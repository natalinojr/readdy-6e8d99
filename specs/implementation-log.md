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

---

## 2026-09-20 — contratacao-reorganizacao-layout: Contratação — reorganização de layout (5 áreas + engrenagem) — CONCLUÍDA

- **Spec:** `specs/2026-09-contratacao-reorganizacao-layout/` · **Branch:** N/A (working tree compartilhado)
- **Entrada:** Briefing `specs/briefing-contratacao-reorganizacao-layout.md` (7 critérios de aceite, restrição visual "regra nº 1")
- **Resumo:** As 9 abas monolíticas (Entrevistas, Candidatos, Vagas, Kanban, Agenda, Agendamentos, Relatórios, Links, Config) reorganizadas em **5 áreas principais + engrenagem**: Hoje, Entrevistas, Candidatos, Vagas, Conversa + Config › WhatsApp. Ficha do candidato em **5 abas** (Resumo, Currículo, Contato, Conversa, Anotações) em vez de rolo único de ~20 blocos. Filtros em etiquetas (vaga por `job_id`, ficha incompleta, ordenar por aderência). Seleção múltipla e ações em lote. Barra inferior no celular.
- **Decisões (dono ausente, todas registradas em `executions.md`):**
  - Filtro de vaga usa `job_id` (não título) para evitar ambiguidade de duas vagas com nomes iguais em empresas diferentes.
  - Default de navegação passa de `entrevistas` para `hoje` (consequência de "Hoje" virar tela inicial).
  - **Regra nº 1 (inegociável):** zero mudança de visual — cores, ícones Remix, componentes, classes reutilizadas verbatim.
  - Lógica pura (aderência, navegação, contagens "Precisa de você") em módulos separados com teste unitário próprio.
- **Desvios:** Nenhum — spec executada conforme briefing §3 (To Be).
- **Pendências não-código:**
  - Verificação visual ao vivo — não realizada (requer login `is_hiring_admin()`). 6 de 7 critérios de aceite confirmados por leitura de código + gate automatizado.
  - `hiring_scheduling_sessions` fora do Realtime — chip de estado do agendamento pela IA não atualiza em tempo real. Requer mudança de banco, fora do escopo.
  - `fmtTime`/`fmtDateTime` no fuso da máquina — dívida pré-existente, tarefa separada (não regressão).
  - `moveLote` duplica lógica de trava (refatoração rejeitada por escopo).
  - Tabela de candidatos não ordena por aderência (exigiria novo `SortKey`, fora do "Onde").
- **Gate:** `node scripts/check.mjs --force --build` verde — tsc 287/292 erros (baseline 292, sem regressão), vitest 560/560 passando (0 falhas), `npx vite build` OK.
- **19 tasks em 6 fases (todas executadas):**
  - Fase 1: T01–T03, T18 (aderência, cards/Kanban, modal upload, chip agendamento IA)
  - Fase 2: T04–T06 (conversa WhatsApp, ficha em blocos, shell + 5 abas)
  - Fase 3: T07–T10 (navegação, áreas extraídas, compatibilidade, configurações)
  - Fase 4: T11–T12 (vaga por dentro, WhatsApp)
  - Fase 5: T13–T15, T19 (contagens "Hoje", área Hoje, barra celular, atalho)
  - Fase 6: T16–T17 (filtros + ações em lote)
- **Próximas etapas:** Commit + push em `main` (permite deploy automático Vercel).

