# Tasks: Contratação — reorganização de layout (5 áreas + engrenagem)

> Spec: [spec.md](./spec.md) · Briefing: [`specs/briefing-contratacao-reorganizacao-layout.md`](../briefing-contratacao-reorganizacao-layout.md)
> Plano escrito em `/sdd-04-plan` (2026-09-20), modo **Plan em ondas** (6 fases ⇒ §4.2 obrigatório).

---

## Global Constraints

> Valem para **todas** as tasks. Copiados **verbatim** de `spec.md` §2 "Restrições" + restrições padrão do [`AGENTS.md`](../../AGENTS.md) aplicáveis. O Context pack de cada task **referencia** esta seção; não a repete.

1. **Regra nº 1 desta spec (inegociável):** NÃO mudar o visual. Mesmas cores (rose/violet/emerald/amber/zinc), mesma fonte, mesmos cards `rounded-2xl border-zinc-200`, mesmas etiquetas de fase (`colorOf`), mesmo drawer lateral da ficha, mesmos botões e janelas (`dialog.tsx`, padrão do `EntrevistaModal`). A mudança é só de **organização**: onde cada coisa fica, o que aparece em cada card, quantas abas existem. Reaproveitar os componentes e classes que já existem; não criar "design system" novo nem trocar ícones (Remix `ri-*`).

2. **Working tree compartilhado:** Não reverter alterações de outra sessão/Codex; não usar `git stash`; `git add` só dos próprios arquivos; nenhum `git commit`/`push`/`checkout` — trabalho em local, append-only no log.

3. **Sem TDD em UI:** Teste só em lógica pura (mapa de compatibilidade de abas, cálculo de melhor nota, montagem de itens "Precisa de você"). Verificação visual é manual (prints, login com acesso ao módulo).

4. **Compatibilidade de links:** `?aba=kanban` → Candidatos/Kanban; `?aba=agenda` → Entrevistas/Calendário; `?aba=agendamentos` → Entrevistas/Conversas; localStorage `contratacao_aba` igual; `focoEntrevista` continua abrindo a entrevista certa.

5. **Não quebrar o que entrou esta semana:** Rascunho local (`contratacao_rascunho_entrevista_*`, `contratacao_entrevistas_pos`), tempo real (`contratacao-tempo-real`), trava de dados mínimos + "Mover mesmo assim", histórico por gatilhos, campo WhatsApp ≠ telefone, selo de presença confirmada.

6. **Dados candidatos reais:** Processo seletivo TBA Ipanema em andamento. Testar leitura/navegação apenas; escrita só em candidatos de teste (`source = 'whatsapp_link_teste'`) ou criados para isso.

7. **Verificação visual requer login:** RLS `is_hiring_admin()` (dono ou `user_module_access`). Usuários `qa.*` podem não ter acesso — conferir; se não tiverem, pedir ao dono para logar no painel Navegador.

### Constraints adicionais desta spec (do briefing §5 e do AGENTS.md)

8. **Nada de banco nesta spec.** Nenhuma migration, nenhuma Edge Function nova, nenhuma coluna nova, nenhuma RPC nova. Leitura adicional só de tabela/Edge **que já é lida hoje pelo próprio módulo** (`hiring_scheduling_sessions`, `hiring_job_scheduling`, `bot_conversations`, `wa_log`, `hiring-scheduler › decide`). Se alguma task parecer exigir banco → **parar e escalar ao dev**, não implementar.

9. **Gate por task (obrigatório no DoD de toda task):**
   - `node scripts/check.mjs --force` — gate completo do projeto (tsc + vitest comparados a `scripts/baseline.json`); precisa sair **verde** (exit 0).
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — **referência desta spec: 287** (medido no tree em 2026-09-20). `scripts/baseline.json` diz 292 porque outra sessão já baixou a contagem; a task **não pode passar de 287**.
   - `npx vitest run` — nenhuma falha nova; a suíte **não pode encolher**. **Referência medida em 2026-09-20: `Test Files 50 passed (50)` · `Tests 500 passed (500)`.** Atenção: `scripts/baseline.json` diz `vitest.total: 211` — está **obsoleto** (por isso `check.mjs --force` passa folgado nesse quesito; ele só reclama se o total ficar **abaixo** do baseline). Antes de mexer no código, rode `npx vitest run` e anote o total; ao terminar a task, o total tem que ser **o mesmo + os testes que a task criou**, com 0 falhas. Não "conserte" o baseline (`--update-baseline` é proibido).
   - `npx vite build` — precisa passar limpo.
   - **Nunca** rodar `scripts/check.mjs --update-baseline`.

10. **Existe suíte a proteger neste módulo** (corrige o achado #3 de `spec.md` §1 "Divergências", que dizia não haver nenhum teste): `src/test/components/entrevistasDoDia.test.tsx` cobre `EntrevistasDoDia` com `focoId`/`onFocoUsado` (o deep link "Abrir entrevista de Fulana"). Esse arquivo **tem que continuar verde e não pode ser alterado** por nenhuma task desta spec — é o teste de regressão do `focoEntrevista`. Ele também é o **padrão a imitar** nos testes novos (mock de `@/lib/supabase`, `render` do `@testing-library/react`).

11. **Nenhum bloco/funcionalidade pode desaparecer.** Toda reorganização é movimentação: se um bloco, botão, chip, filtro ou contador existe hoje, ele existe depois (em outro lugar). Remover só o que a spec manda remover explicitamente (faixa tracejada fixa do Kanban/lista; aba "Links WhatsApp"; botão "Adicionar currículos" nas abas onde ele não deve mais aparecer; `BotaoAvisos` solto no cabeçalho).

12. **Sem dependência nova.** Não instalar pacote (`npm install` proibido). O módulo **não usa Radix**: abas são `<button>` com `border-b-2` (ver `page.tsx:564-571`), modais são `dialog.tsx` próprio. Não introduzir Radix Tabs / Sheet / Dropdown.

---

## Mapa de arquivos

> Trava o corte das tasks. Arquivos que mudam juntos ficam na mesma task; quando não dá, o contrato vai em **Interfaces**.

### Lógica pura (novos módulos + testes)

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `src/pages/contratacao/aderencia.ts` | criar | `melhorAderencia()` — melhor `hiring_applications.score` do candidato + vaga correspondente (lógica pura) | T01 |
| `src/test/lib/contratacaoAderencia.test.ts` | criar | Teste de `melhorAderencia()` | T01 |
| `src/pages/contratacao/navegacao.ts` | criar | Áreas novas, sub-abas, `destinoDeAbaAntiga()` (mapa de compatibilidade `?aba=`/localStorage) | T07 |
| `src/test/lib/contratacaoNavegacao.test.ts` | criar | Teste do mapa de compatibilidade | T07 |
| `src/pages/contratacao/hoje.ts` | criar | Contagens da tela Hoje + `montarPrecisaDeVoce()` (lógica pura, recebe os dados já carregados; **não** faz query) | T13 |
| `src/test/lib/contratacaoHoje.test.ts` | criar | Teste das contagens e de `montarPrecisaDeVoce()` | T13 |
| `src/test/lib/contratacaoFiltrosCandidatos.test.ts` | criar | Teste da lógica pura de filtro (vaga, ficha incompleta) e da ordenação por aderência. **Ajuste de mapa aprovado em 2026-09-20** (pedido do plano da Fase 6): a Constraint 3 e os critérios de sucesso exigem teste para toda lógica pura nova. | T16 |
| `src/test/lib/contratacaoAcoesEmLote.test.ts` | criar | Teste da regra pura "quem do lote está travado pela ficha incompleta". **Ajuste de mapa aprovado em 2026-09-20**: é a regra mais sensível da Fase 6 (mexe com `required_waived_at`) e tem que ser testada, não só conferida na tela. | T17 |

### Shell e áreas

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `src/pages/contratacao/page.tsx` | modificar | Shell: estado global, carga, tempo real, mutações, barra de 5 áreas + engrenagem, roteamento interno. **Não** deve mais conter o JSX das áreas. Em **T17** ganha `moveLote` (escrita em lote da fase, com a trava de dados mínimos) — **ajuste de mapa aprovado em 2026-09-20**: toda escrita no banco deste módulo mora no shell (é onde vivem `updateCandidate`, `applyToJob`, `deleteJob`), então a de lote tem que morar aqui também; deixá-la dentro de `AcoesEmLote.tsx` espalharia acesso a dados pelos componentes de apresentação. | T02, T18, T03, T08, T09, T10, T11, T12, T14, T15, T17 |
| `src/pages/contratacao/areas/AreaCandidatos.tsx` | criar | Busca, filtro de decisão, alternância Lista/Tabela/Kanban, chips de fase, `CandidatosLista`/`Kanban` (JSX extraído de `page.tsx:687-738`, sem mudança de comportamento) | T08, T09, T16, T17 |
| `src/pages/contratacao/areas/AreaEntrevistas.tsx` | criar | Sub-abas Do dia / Calendário / Conversas da IA sobre `EntrevistasDoDia`, `AgendaEntrevistas`, `AgendamentosPainel` | T08, T09 |
| `src/pages/contratacao/areas/AreaConfiguracoes.tsx` | criar | Menu lateral (desktop) / lista (celular) sobre os cards de `ConfiguracoesContratacao` + card WhatsApp | T08, T10, T12 |
| `src/pages/contratacao/areas/AreaHoje.tsx` | criar | Tela Hoje: 3 números, "Precisa de você", próximas entrevistas, vagas abertas | T14 |
| `src/pages/contratacao/components/BarraInferior.tsx` | criar | Barra fixa de navegação no celular (< sm) com as 5 áreas + engrenagem | T15 |

### Candidatos (cards, upload, filtros, lote)

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `src/pages/contratacao/components/CandidatosLista.tsx` | modificar | `CandidateCard` ganha chip de aderência + vaga + "falta X" (T02) e o chip de agendamento da IA + o mapa `AGENDAMENTO_IA` (T18, aqui e não em `Kanban.tsx`, para não fechar ciclo de import com `Kanban.tsx:6`); coluna "Nota" da Tabela ganha rótulo que a distingue da aderência | T02, T18, T16, T17 |
| `src/pages/contratacao/components/Kanban.tsx` | modificar | Repassa as props novas ao `CandidateCard` (aderência, vaga, faltas em T02; estado do agendamento da IA em T18). Não declara nem importa o mapa de rótulos. | T02, T18, T17 |
| `src/pages/contratacao/components/UploadCurriculosModal.tsx` | criar | Janela única "Adicionar currículos": empresa, vaga, área de arrastar, fila de leitura (JSX extraído de `page.tsx:626-685`) | T03 |
| `src/pages/contratacao/components/FiltrosCandidatos.tsx` | criar | Filtros em etiquetas: fase (já existe), vaga, decisão, "ficha incompleta"; ordenar por nota | T16 |
| `src/pages/contratacao/components/AcoesEmLote.tsx` | criar | Seleção múltipla + ações em lote (mandar a IA agendar, mover de fase, descartar) respeitando a trava de dados mínimos | T17 |

### Ficha do candidato (drawer em 5 abas)

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `src/pages/contratacao/components/CandidatoDrawer.tsx` | modificar | Shell do drawer: cabeçalho fixo, barra de ações, menu "⋯", 5 abas. Deixa de conter o corpo dos blocos. | T05, T06 |
| `src/pages/contratacao/components/ficha/FichaResumo.tsx` | criar | Blocos 1–6, 11, 12, 19 (estrelas, empresa, dados mínimos, decisão, banner IA, Vagas com nota, agendamento IA, resumo, fortes/atenção, anotações) | T05 |
| `src/pages/contratacao/components/ficha/FichaCurriculo.tsx` | criar | Blocos 9, 10, 13–18 (contato, distância, experiência, formação, cursos, habilidades, outras, texto) | T05 |
| `src/pages/contratacao/components/ficha/FichaEntrevistas.tsx` | criar | Bloco 7 (lista + `RegistroEntrevista` + botão Agendar) | T05 |
| `src/pages/contratacao/components/ficha/FichaHistorico.tsx` | criar | Bloco 8 (`HistoricoCandidato`: timeline `hiring_candidate_events` + anotação) | T05 |
| `src/pages/contratacao/components/ficha/FichaConversa.tsx` | criar | Aba Conversa: `wa_log` completo do número do candidato (acesso novo pela ficha) | T06 |
| `src/pages/contratacao/components/ConversaWhatsApp.tsx` | criar | Renderização das bolhas de `wa_log` + busca por `phone_key`, extraída de `AgendamentosPainel.tsx` para ser usada nos dois lugares | T04 |
| `src/pages/contratacao/components/AgendamentosPainel.tsx` | modificar | (T04) Passa a usar `ConversaWhatsApp` no lugar do JSX de bolhas interno, comportamento idêntico. (T14) **Ajuste de mapa aprovado pelo orquestrador em 2026-09-20:** exporta `DecidirPedido` e o tipo `Sess`, para a tela Hoje ter Aceitar/Recusar sem reimplementar a chamada a `hiring-scheduler › decide` — é o que RF-08 item 1 exige ("item com ações Aceitar/Recusar chamando `hiring-scheduler › decide`, mesma Edge já usada hoje, sem mudança de contrato"). Só `export` + estreitamento do prop; nenhum comportamento do painel muda. | T04, T14 |

### Vagas e configurações

| Path | Ação | Responsabilidade | Task |
|------|------|------------------|------|
| `src/pages/contratacao/components/Vagas.tsx` | modificar | Fica só com `ListaVagas` (`:38-97`) + o switch por `selectedJobId` (`:32-37`). O corpo de `DetalheVaga` (`:98-246`) **sai** para `VagaDetalhe.tsx`; os helpers `ScoreRing` (`:247-263`), `Lista` (`:264-273`) e `Dado` (`:274-281`) acompanham o detalhe (ou são exportados) | T11 |
| `src/pages/contratacao/components/VagaDetalhe.tsx` | criar | Vaga por dentro: sub-abas Candidatos · Divulgação · Agendamento pela IA · Dados da vaga. A sub-aba "Candidatos" é o ranking que **já existe** em `Vagas.tsx:98-246` (`DetalheVaga`), movido verbatim | T11 |
| `src/pages/contratacao/components/VagaDivulgacao.tsx` | criar | Link wa.me + QR + primeira resposta **de uma vaga** — reaproveita `waLink` (`LinksWhatsApp.tsx:55`), `defaultStart` (`:58`), `newCode` (`:51`), `SHARE_OPTIONS`/`DEFAULT_SHARE` (`:44-49`), `CanalModal` (`:252-379`) e `QrModal` (`:392-417`) | T11 |
| `src/pages/contratacao/components/VagaModal.tsx` | modificar | Extrair o formulário do corpo do modal (`:16-122`) para poder renderizá-lo **dentro** da sub-aba "Dados da vaga" sem o invólucro de modal; o modal continua existindo para "Nova vaga" (`page.tsx:781-785`) | T11 |
| `src/pages/contratacao/components/AgendamentoVaga.tsx` | nenhuma | Usado como está na sub-aba "Agendamento pela IA" | T11 |
| `src/pages/contratacao/components/LinksWhatsApp.tsx` | modificar | Deixa de ser aba; o que é da vaga vai para `VagaDivulgacao`, o que é canal sem vaga / `is_default` vai para `ConfigWhatsApp` | T11, T12 |
| `src/pages/contratacao/components/ConfigWhatsApp.tsx` | criar | Configurações › WhatsApp: canais sem vaga e canal padrão (mesma renderização/comportamento de `LinksWhatsApp.tsx`, escopo mínimo) | T12 |
| `src/pages/contratacao/components/ConfiguracoesContratacao.tsx` | modificar | Os 4 cards **já são funções separadas** no arquivo: `Empresas` (`:43-158`), `Fases` (`:163-229`), `DadosMinimos` (`:257-346`), `FichaEConvite` (`:351-481`). A mudança é só exportá-los (ou aceitar uma prop `secao`) para o menu lateral renderizar **um por vez** em vez de empilhar os 4 (`:25-42`). Nada dentro dos cards muda. | T10 |

### Não tocar (usados como estão)

| Path | Ação | Nota |
|------|------|------|
| `src/pages/contratacao/shared.ts` | nenhuma | Tipos/helpers do módulo. Lógica nova vai nos módulos próprios (`aderencia.ts`, `navegacao.ts`, `hoje.ts`) para não mexer num arquivo que 15 componentes importam. |
| `src/pages/contratacao/dialog.tsx` | nenhuma | `DialogHost`/`confirmar`/`avisar` — padrão de janela, reaproveitado. |
| `src/pages/contratacao/components/EntrevistasDoDia.tsx` | **modificar (só em T19)** | Vira sub-aba "Do dia" **sem alteração** em T08/T09 (nenhuma fase anterior o toca). Em **T19** ganha um acréscimo pontual: o atalho "Ir para a próxima: seg 21/09 · 7 entrevistas" no dia vazio (RF-05, última linha). **Ajuste de mapa aprovado pelo orquestrador em 2026-09-20**, depois do BLOQUEIO levantado no plano da Fase 5: sem isso o RF-05 fica descoberto e o `/sdd-07-spec-review` reprovaria a spec. É acréscimo puro (nenhuma prop muda, nenhum bloco sai), e o arquivo continua protegido por `src/test/components/entrevistasDoDia.test.tsx`, que **tem que seguir verde sem ser editado** — isso é DoD de T19. |
| `src/pages/contratacao/components/AgendaEntrevistas.tsx` | nenhuma | Vira sub-aba "Calendário" sem alteração. |
| `src/pages/contratacao/components/RelatoriosContratacao.tsx` | nenhuma | Aba Relatórios intacta (briefing §3.8). |
| `src/pages/contratacao/components/EntrevistaModal.tsx` | nenhuma | Modal de entrevista, reaproveitado. |
| `src/pages/contratacao/components/EditarCandidatoModal.tsx` | nenhuma | Reaproveitado pela barra de ações da ficha. |
| `src/pages/contratacao/components/AdicionarCandidatosModal.tsx` | nenhuma | "Adicionar do banco" à vaga — **não** é a janela de upload de PDFs (nome parecido, função outra). |
| `src/components/feature/BotaoAvisos.tsx` | nenhuma | Componente compartilhado fora do módulo: só muda **onde** é renderizado (T14), nunca o componente. |
| `src/test/components/entrevistasDoDia.test.tsx` | nenhuma | Teste de regressão do `focoEntrevista` — tem que continuar verde, sem edição. |

**Contagem (conferida linha a linha).** No fechamento do skeleton (Onda 0): 23 `criar` · 9 `modificar` · 11 `nenhuma` = 43 paths. Depois dos ajustes de mapa aprovados nas ondas 5 e 6 (2 arquivos de teste novos na Fase 6; `EntrevistasDoDia.tsx` saiu de `nenhuma` para `modificar` por causa de T19): **25 `criar` · 10 `modificar` · 10 `nenhuma` = 45 paths** (contado linha a linha em 2026-09-20 com `grep`, depois de o gate `cross` pegar um erro de soma aqui). `criar` = 25/45 = **55,6%**, acima do limiar de 50% da regra 2 da árvore de `plan_depth` (e muito acima do limiar alternativo de 8 paths `criar`) — a decisão `contracts` continua válida, com margem maior do que no skeleton.

### Achados desta fase (Plan) que corrigem `spec.md` §1

Conferidos no código em 2026-09-20; o executor deve tratar **estes** como verdade, não o texto correspondente da fase 02:

1. **Existe teste cobrindo Contratação.** `src/test/components/entrevistasDoDia.test.tsx` renderiza `EntrevistasDoDia` com `focoId`/`onFocoUsado` e cobre exatamente o deep link que a Fase 3 tem que preservar. A afirmação de `spec.md` §1 item 12 / "Divergências" #3 ("nenhum teste") está **errada**. Consequências: (a) esse teste é o gate de regressão do `focoEntrevista`; (b) é o padrão de teste a imitar; (c) `EntrevistasDoDia.tsx` não pode mudar de assinatura sem atualizar o teste — e a spec manda não mudar.
2. **`needs_human` não é de agendamento.** O campo mora em `bot_conversations` e hoje é lido em `LinksWhatsApp.tsx:38,107,433` (badge "Atenção", `:463`), **não** em `hiring_scheduling_sessions`. O RF-08 item 2 ("conversas onde a IA não segue sozinha") depende de ler `bot_conversations` — tabela já lida pelo módulo, portanto dentro da Constraint 8, mas a fonte precisa estar explícita em T13/T14.
3. **`aguardando_gestor` e Aceitar/Recusar já existem prontos.** `AgendamentosPainel.tsx:118` classifica o status e `DecidirPedido` (`:49-139`) já chama `hiring-scheduler › decide` com `op: 'aceitar' | 'recusar' | 'propor'` (`:59-61`). A tela Hoje **reaproveita esse componente**, não reimplementa a decisão.
4. **`Vagas.tsx` já tem lista e detalhe separados** (`ListaVagas` `:38`, `DetalheVaga` `:98`) e **`ConfiguracoesContratacao.tsx` já tem os 4 cards como funções separadas** (`:43`, `:163`, `:257`, `:351`). As Fases 3 e 4 são recorte e roteamento, não reescrita.
5. **O módulo não usa Radix.** `spec.md` §6 "Referências" cita "Radix Tabs (componente `tabs.tsx`)" e "Radix Dialog"; no módulo Contratação as abas são `<button>` com `border-b-2` (`page.tsx:564-571`) e as janelas são o `dialog.tsx` local (93 linhas, sem Radix). Toda aba/sub-aba nova desta spec usa o padrão de `<button>` do `page.tsx:564-571`.

---

## Profundidade do plano (`plan_depth`)

| Campo | Valor |
|-------|-------|
| **plan_depth** | `contracts` |
| **Critério** | Árvore §4.0, regra 2 "Maioria criar": no fechamento do skeleton, 23 paths `criar` de 43 com ação (53%); depois dos ajustes de mapa, 25 de 45 (55,6%) — acima do limiar de 50% e do limiar alternativo de 8 paths `criar` nos dois momentos. A entrega é majoritariamente extração de JSX existente para arquivos novos — o que trava o comportamento é a **assinatura de props** (o JSX é movido verbatim), não um snippet reescrito no plano. |
| **Override do dev?** | não |
| **Override por task** | `snippets` nas 3 tasks de **lógica pura** (T01 `aderencia.ts`, T07 `navegacao.ts`, T13 `hoje.ts`): nelas o Step traz o corpo completo da função e o teste completo, porque são o único código novo de verdade (e o único com teste automatizado). |

**Regra de artefato deste plano (vale para as tasks `contracts`):** todo Step de produção precisa (a) a **assinatura exata** das props/exports em `Interfaces`, (b) a **origem verbatim** do JSX (`arquivo:linha-linha` do As Is) e (c) a frase de invariante *"mover o JSX sem reescrever: mesmas classes, mesmos ícones `ri-*`, mesmos textos"*. Step de produção sem esses três = falha de plano.

---

## Progresso do Plan (ondas)

| Onda | Escopo | Status | Compliance | Nota |
|------|--------|--------|------------|------|
| 0 | Skeleton (Constraints + Mapa + plan_depth + Fases) | ✅ | ✅ skeleton (iter 1) | Reescrito em `/sdd-04-plan` 2026-09-20 (o de `/sdd-01-new` era rascunho mecânico). Único Crítico do revisor era aritmético (contagem do Mapa 23/11/10 → 23/9/11); corrigido, `plan_depth: contracts` inalterado |
| 1 | Fase 1 — Cards + janela de upload (T01, T02, T18, T03) | ✅ | ✅ fase-1 (iter 1) | T18 acrescentada nesta onda (furo do briefing §3.3 sem fonte de dados); ciclo de import corrigido pelo orquestrador; Crítico do revisor (contagem do vitest obsoleta) corrigido em toda a spec |
| 2 | Fase 2 — Ficha em 5 abas (T04–T06) | ✅ | ✅ fase-2 (iter 2) | 4 Críticos na 1ª volta, todos reais: ~271 linhas ficariam órfãs no `CandidatoDrawer.tsx`; o plano afirmava em 5 pontos que o rascunho local vive nesse arquivo (não vive); off-by-one que cortaria a tag de fechamento das bolhas; `fmtKm` nas listas "manter" e "remover" ao mesmo tempo. Na correção o planejador ainda achou `vagasAbertas` faltando, sem a qual `FichaResumo.tsx` não compilaria |
| 3 | Fase 3 — Consolidação das abas (T07–T10) | ✅ | ✅ fase-3 (iter 1) | Extrai `page.tsx` para `areas/*` antes de trocar a navegação. Crítico do revisor corrigido: `destinoDeAbaAntiga('candidatos')` fixava `modoCandidatos: 'cards'` e o teste travava esse contrato errado — apagaria a preferência de quem tem `contratacao_view='tabela'` gravado |
| 4 | Fase 4 — Vaga por dentro (T11–T12) | ✅ | ✅ fase-4 (iter 1) | Caminho de "escopo" em `LinksWhatsApp` em vez de recortar o arquivo; `ON DELETE SET NULL` confirmado nas migrations. Crítico do revisor corrigido: das 6 linhas do antigo "Ver dados da vaga", a do **endereço da loja** (e o aviso "Endereço não cadastrado") não tinha destino no formulário novo — violaria a Constraint 11. Citação de migration corrigida (`:13`, não `:17`) |
| 5 | Fase 5 — Tela Hoje + celular (T13, T14, T15, **T19**) | ✅ | ✅ fase-5 (iter 1) | T19 acrescentada (atalho do RF-05); ajuste de mapa em `AgendamentosPainel.tsx` (exportar `DecidirPedido` — revisor confirmou campo a campo que o `Pick<Sess, 'id' \| 'pending_request'>` cobre tudo que a função usa). Sem críticos; a única ambiguidade (remover ou não o import morto do `BotaoAvisos`) foi fechada pelo orquestrador: remove, porque `noUnusedLocals: false` não acusaria |
| 6 | Fase 6 — Filtros e ações em lote (T16–T17) | ✅ | ✅ fase-6 (iter 1) | Fase **adicional** (spec §2 "Escopo da entrega"): nenhuma task anterior depende dela — confirmado por varredura das linhas `Bloqueia`. Sem críticos; o revisor conferiu a equivalência da trava de dados mínimos operando por operando contra `page.tsx:317-348` |
| final | cross (cobertura RF/US + Interfaces entre fases) | ✅ | ✅ cross (iter 1) | 3 Críticos, todos corrigidos pelo orquestrador e reconferidos por `grep`: (1) briefing §3.8(a) "filtro de empresa só com mais de uma empresa" não tinha task em fase nenhuma → virou parte de T09 (Decisão 8, Step 4 e DoD), trocando `companies.length > 0` por `> 1`; (2) briefing §3.8(b) "esqueleto de carga em Conversas da IA" também não tinha task **e é contradito pelo RF-05** ("`AgendamentosPainel` sem mudança") → **declarado fora do escopo**, com motivo, no item 13 de "Pontos para o `/sdd-05-review`"; (3) T19 faltava no desenho do grafo → acrescentada. Melhoria: a contagem do Mapa dizia 26/10/10=46; o certo é **25/10/10=45** (recontado com `grep`), `plan_depth: contracts` inalterado (55,6%). **Interfaces cross-fase: todas casam** (o revisor conferiu os ~15 símbolos que cruzam fase, um a um). Nenhuma afirmação de "o dono aprovou" no plano. |

---

## Plano de execução

### Fases (ondas do briefing §4 — ordem do dono, não reordenar)

| Fase | Tasks | Depende de | Paralelo? | Onde (resumo) | Descrição |
|------|-------|------------|-----------|---------------|-----------|
| **1** | T01, T02, **T18**, T03 | — | **sim, com a Fase 2** | `aderencia.ts`, `CandidatosLista.tsx`, `Kanban.tsx`, `UploadCurriculosModal.tsx`, `page.tsx` | Card e Kanban com nota de aderência + vaga (+ estado do agendamento da IA no Kanban); janela única "Adicionar currículos"; fim da faixa tracejada fixa |
| **2** | T04, T05, T06 | — | **sim, com a Fase 1** | `CandidatoDrawer.tsx`, `ficha/*`, `ConversaWhatsApp.tsx`, `AgendamentosPainel.tsx` | Ficha em 5 abas (Resumo · Currículo · Entrevistas · Conversa · Histórico) com cabeçalho fixo e barra de ações |
| **3** | T07, T08, T09, T10 | Fases 1 e 2 | não | `navegacao.ts`, `areas/*`, `page.tsx`, `ConfiguracoesContratacao.tsx` | Extrair as áreas de `page.tsx` sem mudar comportamento; depois 5 áreas + engrenagem, Kanban como 3º modo, Entrevistas com sub-abas, compatibilidade dos `aba` antigos |
| **4** | T11, T12 | Fase 3 | não | `Vagas.tsx`, `VagaDetalhe.tsx`, `VagaDivulgacao.tsx`, `VagaModal.tsx`, `LinksWhatsApp.tsx`, `ConfigWhatsApp.tsx`, `page.tsx` | Vaga por dentro (4 sub-abas); fim da aba Links WhatsApp; Configurações › WhatsApp |
| **5** | T13, T14, T15, **T19** | Fase 4 | não | `hoje.ts`, `areas/AreaHoje.tsx`, `BarraInferior.tsx`, `page.tsx`, `AgendamentosPainel.tsx` (só `export`), `EntrevistasDoDia.tsx` (só T19) | Tela Hoje (3 números + "Precisa de você" + próximas + vagas abertas); barra inferior no celular; default passa a ser Hoje; atalho "Ir para a próxima" no dia vazio (T19) |
| **6** | T16, T17 | Fase 5 | não | `FiltrosCandidatos.tsx`, `AcoesEmLote.tsx`, `AreaCandidatos.tsx`, `CandidatosLista.tsx`, `Kanban.tsx` | Filtros em etiquetas (vaga, ficha incompleta, ordenar por nota) e ações em lote |

**Paralelismo (para o `/sdd-06-execute`):** só as Fases 1 e 2 são paralelas — `Onde` disjunto (Fase 1 não toca `CandidatoDrawer.tsx`/`ficha/*`/`AgendamentosPainel.tsx`; Fase 2 não toca `page.tsx`/`CandidatosLista.tsx`/`Kanban.tsx`). Fases 3, 4, 5 e 6 concentram-se em `page.tsx` / `areas/*` e são **estritamente sequenciais**. Dentro de cada fase as tasks são sequenciais (compartilham arquivo), com exceção anotada na própria task.

### Grafo de dependências

```
Fase 1                                Fase 2
T01 aderencia.ts + teste              T04 ConversaWhatsApp (extrai bolhas)
  └─> T02 card/kanban c/ nota           └─> T06 shell da ficha (5 abas)
        └─> T18 chip agendamento IA   T05 ficha/* (5 sub-componentes)
T03 janela de upload                    └─> T06
  (T02, T18 e T03 serializam:
   todas mexem em page.tsx)
       │                                │
       └────────────┬───────────────────┘
                    ▼
Fase 3   T07 navegacao.ts + teste ──┐
         T08 extrair areas/* (sem mudar comportamento) ──┐
                                    └──> T09 nav de 5 áreas + compat ──> T10 Configurações na engrenagem
                    ▼
Fase 4   T11 VagaDetalhe (4 sub-abas) ──> T12 Config › WhatsApp + fim da aba Links
                    ▼
Fase 5   T13 hoje.ts + teste ──> T14 AreaHoje ──> T15 barra inferior + default Hoje
                     └─────────> T19 atalho "Ir para a próxima" no dia vazio
                                 (consome a função de T13; depende também de T09,
                                  que já pôs EntrevistasDoDia na sub-aba "Do dia")
                    ▼
Fase 6   T16 filtros em etiquetas ──> T17 seleção múltipla + ações em lote
```

### Feature flag

| Propriedade | Default | Task | Justificativa |
|-------------|---------|------|---------------|
| N/A | — | — | `feature_flag: nao` no frontmatter (decisão do `/sdd-01-new`, mantida aqui). Reavaliada em `/sdd-04-plan`: uma flag exigiria manter as 9 abas antigas **e** as 5 novas vivas ao mesmo tempo no mesmo `page.tsx`, dobrando o roteamento interno e o risco de divergência visual — o oposto do objetivo. O mecanismo do projeto (`system_settings` por loja, `SystemSettingsContext`) também não serve: Contratação é independente das lojas do ERPOS (empresas próprias em `hiring_companies`). Rollback é por `git revert` do commit da fase. |

### Impactos

| Mudança | Consequências intencionais | Consequências não intencionais (riscos) | Mitigação |
|---------|---------------------------|------------------------------------------|-----------|
| 9 abas → 5 áreas + engrenagem | Cabe no desktop 1366px sem rolagem; celular com barra inferior | Links antigos (`?aba=kanban`, `agenda`, `agendamentos`, `links`) e `localStorage contratacao_aba` gravado nos aparelhos do dono param de abrir o lugar certo | `destinoDeAbaAntiga()` em `navegacao.ts` com teste unitário (T07); `localStorage` continua sendo lido com os valores antigos |
| Default da navegação muda de `entrevistas` para `hoje` | "Hoje" vira a porta de entrada (briefing §3.2) | Quem usava a tela como "abrir e ver as entrevistas do dia" passa a dar um clique a mais; decisão tomada sem o dono (ver `executions.md`) | Registrada como decisão revisável em `/sdd-05-review`; a área Entrevistas continua a 1 clique e o `localStorage` de quem já usava preserva a última área |
| Extração de `page.tsx` para `areas/*` (T08) | Fases 3–6 param de disputar um arquivo de 797 linhas; diff de cada fase fica legível | Extração é o passo com maior chance de perder um `prop`, um `useMemo` ou um `onClick` no caminho e quebrar algo sem erro de tipo | T08 é task própria, **só extração, zero mudança de comportamento**, com DoD "mesma tela em todas as 9 abas antes/depois"; `npx tsc` pega prop faltando; gate + conferência visual aba por aba |
| Card/Kanban passam a mostrar aderência | Decisão rápida sem abrir a ficha | Duas "notas" na mesma tela (aderência no card × nota de entrevista na coluna da Tabela) confundindo o dono | Rótulo explícito em cada uma (RF-02): chip "Aderência" no card; `title` "Nota da entrevista" na coluna da Tabela |
| Ficha em 5 abas | Contato/distância/conversa a 1 clique em vez de 9 blocos de rolagem | Bloco "esquecido" na migração; perda do estado de rascunho/scroll ao trocar de aba | Mapa bloco→aba de `spec.md` §2 RF-04 é checklist do DoD de T05/T06 (20 itens); `RegistroEntrevista` fica inteiro dentro de uma aba só (Entrevistas), preservando o rascunho local |
| Aba "Links WhatsApp" deixa de existir | Link da vaga fica junto da vaga | Canal `bot_channels` sem vaga (`job_id = null`) ou `is_default` ficaria inacessível | T12 cria Configurações › WhatsApp **antes** de tirar a aba, na mesma fase |
| `BotaoAvisos` sai do cabeçalho e vira item de "Precisa de você" | Fim do botão "Bloqueadas" solto sem contexto | Se a tela Hoje não renderizar o componente, o dono perde o único caminho para reativar as notificações | T14 tem DoD explícito: o mesmo componente, com os mesmos estados (`inativo`/`negado`/erro), acessível na área Hoje antes de sair do cabeçalho |
| Faixa tracejada sai da lista e do Kanban | Colunas do Kanban voltam ao topo | Perde-se o arrastar-e-soltar direto na tela | A janela de upload (T03) mantém a mesma área de arrastar dentro dela, com o mesmo texto e o mesmo seletor de empresa/vaga |

---

## T01: `aderencia.ts` — melhor nota de aderência do candidato

| Campo | Valor |
|---|---|
| **Entregável** | `melhorAderencia()` — melhor `hiring_applications.score` de um candidato + vaga correspondente |
| **Onde** | `src/pages/contratacao/aderencia.ts` (criar), `src/test/lib/contratacaoAderencia.test.ts` (criar) |
| **Depende de** | — |
| **Bloqueia** | T02 |
| **Paralelo com** | T03 (arquivos disjuntos) |
| **Profundidade** | `snippets` (override desta task — ver `#profundidade-do-plano`) |
| **Requisitos** | RF-02, US-03 |

### Context pack

- Spec: RF-02 (`#c-spec-filtrada`) — "melhor `hiring_applications.score`", edge cases (score nulo/erro, empate, vaga apagada).
- Global Constraints: `#global-constraints` #1 (visual — N/A aqui, é lógica pura), #3 (teste só em lógica pura — este é o caso), #8 (nada de banco — função pura, recebe dados já carregados), #9 (gate).
- Padrão do repo: imitar `src/test/lib/tipoEmpresa.test.ts` (import relativo, `describe`/`it` em pt-BR, casos curtos).
- Tipos consumidos (verbatim de `shared.ts`, **não editar esse arquivo**): `Application` (`shared.ts:134-143`), `Job` (`shared.ts:99-114`), `Fit`/`FIT`/`fitOf` (`shared.ts:133,145-150`).
- Arquivos vizinhos: nenhum — módulo novo, sem dependência de `page.tsx`.
- **Não fazer:** não filtrar `applications` pela lista inteira do módulo dentro da função (isso é responsabilidade de quem chama, em T02); não editar `shared.ts`; não usar `Application.fit` sem fallback (pode vir `null` mesmo com `score` preenchido).

### Decisões tomadas

- **Assinatura:** `melhorAderencia(applications: Application[], jobs: Job[]): Aderencia | null` recebe as candidaturas **já filtradas de um único candidato** (não a lista toda + `candidateId`), porque quem chama (T02, em `page.tsx`) já vai agrupar `applications` por `candidate_id` num `Map` uma única vez (o mesmo padrão de `vagasPorCandidato`, `page.tsx:496-505`) — assim o custo é O(candidaturas totais) para agrupar + O(candidaturas do candidato) por card, em vez de filtrar 100% das candidaturas a cada um dos ~2000 candidatos renderizados.
- **Desempate de score:** vence a candidatura com `created_at` mais recente (candidatura mais nova é mais confiável — reflete a última análise da IA para aquele candidato).
- **`score: null` / `error`:** candidatura é ignorada (não concorre a "melhor"); se todas forem assim, retorna `null` (sem chip, conforme edge case da spec).
- **Vaga apagada (`job_id` fora de `jobs`):** candidatura é ignorada mesmo que tenha o maior score — não inventa título; se essa era a única candidatura, retorna `null`.
- **`fit`:** usa `Application.fit` quando vier preenchido; senão deriva com `fitOf(score)` (já existe em `shared.ts:150`).

### Interfaces

**Produces** (usado por T02):
```ts
// src/pages/contratacao/aderencia.ts
export interface Aderencia {
  score: number;
  fit: Fit;
  jobId: string;
  jobTitle: string;
}
export function melhorAderencia(applications: Application[], jobs: Job[]): Aderencia | null
```

### Steps

1. **Criar `src/pages/contratacao/aderencia.ts`** com o corpo completo:
   ```ts
   // Melhor nota de aderência do candidato: a maior hiring_applications.score entre as
   // candidaturas dele, com o nome da vaga correspondente. Lógica pura — sem query, sem IA.
   // Recebe as candidaturas JÁ agrupadas por candidato (page.tsx faz o agrupamento uma vez
   // com um Map, O(candidaturas) no total) para não filtrar a lista inteira a cada card
   // numa tela com milhares de candidatos.
   import { type Application, type Fit, type Job, fitOf } from './shared';

   export interface Aderencia {
     score: number;
     fit: Fit;
     jobId: string;
     jobTitle: string;
   }

   /**
    * Recebe as candidaturas de UM candidato (já filtradas por candidate_id) e a lista de
    * vagas (para achar o título). Ignora candidatura sem score (ainda não analisada ou
    * error != null) e candidatura cuja vaga foi apagada (não inventa título — edge case da
    * spec). Em empate de score, vence a candidatura mais recente (created_at maior).
    */
   export function melhorAderencia(applications: Application[], jobs: Job[]): Aderencia | null {
     const tituloPorVaga = new Map(jobs.map((j) => [j.id, j.title]));
     let melhor: Aderencia | null = null;
     let melhorCreatedAt = '';
     for (const a of applications) {
       if (a.score == null || a.error) continue; // sem análise ainda, ou erro na IA
       const jobTitle = tituloPorVaga.get(a.job_id);
       if (!jobTitle) continue; // vaga apagada: não inventa título, ignora a candidatura
       const ganha = !melhor || a.score > melhor.score || (a.score === melhor.score && a.created_at > melhorCreatedAt);
       if (ganha) {
         melhor = { score: a.score, fit: a.fit ?? fitOf(a.score) ?? 'baixa', jobId: a.job_id, jobTitle };
         melhorCreatedAt = a.created_at;
       }
     }
     return melhor;
   }
   ```

2. **Criar `src/test/lib/contratacaoAderencia.test.ts`** com o corpo completo:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { melhorAderencia } from '../../pages/contratacao/aderencia';
   import type { Application, Job } from '../../pages/contratacao/shared';

   const job = (id: string, title: string): Job => ({
     id, company_id: null, title, description: null, requirements: null, desirable: null,
     schedule: null, salary: null, benefits: null, contract_type: null, openings: 1,
     status: 'aberta', notes: null, opened_at: '2026-01-01', closed_at: null, created_at: '2026-01-01',
   });

   const app = (over: Partial<Application>): Application => ({
     id: over.id ?? 'a1', job_id: over.job_id ?? 'j1', candidate_id: 'c1',
     score: over.score ?? null, fit: over.fit ?? null, analysis: null,
     analyzed_at: over.analyzed_at ?? null, error: over.error ?? null,
     created_at: over.created_at ?? '2026-01-01',
   });

   describe('melhorAderencia', () => {
     const jobs = [job('j1', 'Atendente'), job('j2', 'Caixa')];

     it('sem candidatura, sem aderência', () => {
       expect(melhorAderencia([], jobs)).toBeNull();
     });

     it('escolhe a maior nota entre várias candidaturas', () => {
       const apps = [app({ id: 'a1', job_id: 'j1', score: 60 }), app({ id: 'a2', job_id: 'j2', score: 85 })];
       const r = melhorAderencia(apps, jobs);
       expect(r).toEqual({ score: 85, fit: 'alta', jobId: 'j2', jobTitle: 'Caixa' });
     });

     it('ignora candidatura com score nulo (ainda não analisada)', () => {
       const apps = [app({ id: 'a1', job_id: 'j1', score: null }), app({ id: 'a2', job_id: 'j2', score: 55 })];
       expect(melhorAderencia(apps, jobs)).toEqual({ score: 55, fit: 'media', jobId: 'j2', jobTitle: 'Caixa' });
     });

     it('ignora candidatura com erro mesmo se tiver score residual', () => {
       const apps = [app({ id: 'a1', job_id: 'j1', score: 90, error: 'timeout' })];
       expect(melhorAderencia(apps, jobs)).toBeNull();
     });

     it('empate de score: vence a candidatura mais recente', () => {
       const apps = [
         app({ id: 'a1', job_id: 'j1', score: 70, created_at: '2026-01-01T10:00:00Z' }),
         app({ id: 'a2', job_id: 'j2', score: 70, created_at: '2026-01-02T10:00:00Z' }),
       ];
       expect(melhorAderencia(apps, jobs)?.jobId).toBe('j2');
     });

     it('vaga apagada não inventa título: candidatura é ignorada', () => {
       const apps = [app({ id: 'a1', job_id: 'j-apagada', score: 95 }), app({ id: 'a2', job_id: 'j1', score: 40 })];
       expect(melhorAderencia(apps, jobs)).toEqual({ score: 40, fit: 'baixa', jobId: 'j1', jobTitle: 'Atendente' });
     });

     it('só candidatura de vaga apagada: sem aderência', () => {
       const apps = [app({ id: 'a1', job_id: 'j-apagada', score: 95 })];
       expect(melhorAderencia(apps, jobs)).toBeNull();
     });
   });
   ```

3. Rodar `npx vitest run src/test/lib/contratacaoAderencia.test.ts` — esperado `Test Files  1 passed (1)` e `Tests  7 passed (7)`, sem falha.

4. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **507 passed (51 arquivos)**: os 500 de hoje (medidos em 2026-09-20; ver Constraint 9 — o `baseline.json` com 211 está obsoleto) + os 7 novos desta task. 0 failed.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] `aderencia.ts` e o teste criados exatamente como no Step 1/2; `melhorAderencia` exportada com a assinatura de **Interfaces**.
- [ ] `npx vitest run src/test/lib/contratacaoAderencia.test.ts` → `Tests 7 passed (7)`.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher (≥ 500 de hoje + os 7 novos desta task); `npx vite build` limpo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos (N/A nesta task: é lógica pura, sem JSX).
- [ ] Nada desapareceu (Constraint 11): task só adiciona arquivos novos, não mexe em nada existente.
- [ ] Rastreio: RF-02, US-03 — cobertos pela função + teste (o card em si é T02).

---

## T02: Card e Kanban com aderência, vaga e "falta X"

| Campo | Valor |
|---|---|
| **Entregável** | `CandidateCard` (Lista e Kanban) exibindo chip de aderência + vaga e chip "falta X"; coluna "Nota" da Tabela com rótulo que a distingue da aderência |
| **Onde** | `src/pages/contratacao/components/CandidatosLista.tsx` (modificar), `src/pages/contratacao/components/Kanban.tsx` (modificar), `src/pages/contratacao/page.tsx` (modificar) |
| **Depende de** | T01 |
| **Bloqueia** | T17 (Fase 6, mesmos arquivos) |
| **Paralelo com** | — (serializa com T03: ambas mexem em `page.tsx`) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-02, US-03 |

### Context pack

- Spec: RF-02 (`#c-spec-filtrada`) — chip "Aderência" no card, `title`/rótulo distinto na coluna "Nota" da Tabela, "sem query nova" (só propagação de prop).
- Global Constraints: `#global-constraints` #1 (reaproveitar `Chip`/`FIT`, não criar classe de cor nova), #8 (sem query nova — usa `applications`/`jobs` já carregados em `page.tsx`), #9 (gate), #11 (nada desaparece — chips existentes continuam).
- Padrão do repo: `CandidateCard`/`Chip` em `CandidatosLista.tsx:167-217` (amostra E1); `FIT`/`fitOf` em `shared.ts:145-150` (amostra E1, "observação crítica" — não criar classe de cor nova); alerta "falta X" no mesmo estilo amber usado em `CandidatoDrawer.tsx:136-139` (`border-amber-200 bg-amber-50`, ícone `ri-error-warning-line`).
- Arquivos vizinhos: `aderencia.ts` (T01, já pronto — `Aderencia`/`melhorAderencia`); `vagasPorCandidato`/`vagasDe` em `page.tsx:496-505` é o padrão de `Map` + função a imitar para os novos `aderenciaPorCandidato`/`faltasPorCandidato`.
- **Não fazer:** não criar classe de cor nova (usar `FIT[fit].cls`); não recalcular `faltasFicha`/`melhorAderencia` dentro do render de cada card (tem que vir pronto de um `Map` calculado uma vez em `page.tsx`); não mexer em `shared.ts`; não adicionar "estado do agendamento IA" ao Kanban nesta task — **coberto em T18**; não tocar na coluna "Vaga" da Tabela (já existe, `vagasDe`, inalterada).

> **Nota sobre "estado do agendamento IA" (Kanban, RF-02):** a spec (`spec.md` §2, US-03) lista "fase + decisão + estado agendamento IA" como o que o Kanban deve mostrar. "Fase" (posição na coluna) e "decisão" (`DecisionBadge`) **já existem hoje** no card — nada a fazer. "Estado do agendamento IA" (se o assistente está tentando marcar entrevista pelo WhatsApp) **não tem fonte carregada em `page.tsx` nesta task** — decisão do orquestrador: **coberto em T18**, que acrescenta a leitura de `hiring_scheduling_sessions` (tabela já lida pelo módulo em `AgendamentosPainel.tsx`, dentro da Constraint 8) e o chip correspondente, na própria Fase 1, depois de T02.

### Decisões tomadas

- **Título da vaga no card:** vem de `Aderencia.jobTitle` (já resolvido por `melhorAderencia`), não de uma nova chamada a `vagasDe` — são conceitos diferentes (`vagasDe` lista **todas** as vagas do candidato para a coluna Vaga da Tabela; `Aderencia.jobTitle` é a vaga da **melhor** candidatura).
- **Chip do card:** uma chip só combinando nota e vaga, formato `Aderência: 8,5 · Atendente` (vírgula decimal, `score.toFixed(1).replace('.', ',')`), classe `FIT[aderencia.fit].cls`, ícone `ri-percent-line`.
- **"falta X" sem refazer `faltasFicha` por card:** `page.tsx` calcula um `Map<string, number>` (`faltasPorCandidato`) uma vez por `useMemo` (dependências `items`, `settings`), do mesmo jeito que `vagasPorCandidato`; o card só lê `faltas: number` já pronto.
- **Coluna "Nota" da Tabela:** mantém o cabeçalho "Nota" (não muda texto, Constraint 1) e ganha `title="Nota da entrevista (1 a 5) — não é a aderência do currículo"` no `<Th k="nota">` (`CandidatosLista.tsx:94`).

### Interfaces

**Consumes** (de T01):
```ts
import { type Aderencia, melhorAderencia } from '../aderencia'; // a partir de page.tsx
export interface Aderencia { score: number; fit: Fit; jobId: string; jobTitle: string }
export function melhorAderencia(applications: Application[], jobs: Job[]): Aderencia | null
```

**Produces** (assinaturas exatas — consumidas depois por T17):
```ts
// page.tsx — novos memos/funções, ao lado de vagasPorCandidato (page.tsx:496-505)
const applicationsPorCandidato: Map<string, Application[]>
const aderenciaPorCandidato: Map<string, Aderencia | null>
const faltasPorCandidato: Map<string, number>
const aderenciaDe: (c: Candidate) => Aderencia | null
const faltasDe: (c: Candidate) => number

// CandidatosLista.tsx — Props (CandidatosLista.tsx:17-30), acrescenta:
interface Props {
  // ...props existentes inalteradas...
  aderenciaDe: (c: Candidate) => Aderencia | null;
  faltasDe: (c: Candidate) => number;
}

// Kanban.tsx — Props (Kanban.tsx:8-18), acrescenta:
interface Props {
  // ...props existentes inalteradas...
  aderenciaDe: (c: Candidate) => Aderencia | null;
  faltasDe: (c: Candidate) => number;
}

// CandidatosLista.tsx — CandidateCard (CandidatosLista.tsx:167-170), acrescenta:
export function CandidateCard({ c, companies, stage, empresa, entrevista, onOpen, compact = false, dist = null, aderencia = null, faltas = 0 }: {
  c: Candidate; companies: Company[]; stage: Stage | null; empresa: string | null; entrevista: Interview | null; onOpen: () => void; compact?: boolean;
  dist?: Distance | null; aderencia?: Aderencia | null; faltas?: number;
})
```

### Steps

1. **`page.tsx` — agrupar `applications` por candidato.** Logo após `vagasPorCandidato`/`vagasDe` (`page.tsx:496-505`), adicionar:
   ```ts
   const applicationsPorCandidato = useMemo(() => {
     const m = new Map<string, Application[]>();
     for (const a of applications) m.set(a.candidate_id, [...(m.get(a.candidate_id) ?? []), a]);
     return m;
   }, [applications]);
   const aderenciaPorCandidato = useMemo(() => {
     const m = new Map<string, Aderencia | null>();
     for (const c of items) m.set(c.id, melhorAderencia(applicationsPorCandidato.get(c.id) ?? [], jobs));
     return m;
   }, [items, applicationsPorCandidato, jobs]);
   const aderenciaDe = useCallback((c: Candidate) => aderenciaPorCandidato.get(c.id) ?? null, [aderenciaPorCandidato]);
   const faltasPorCandidato = useMemo(() => {
     const m = new Map<string, number>();
     for (const c of items) m.set(c.id, faltasFicha(c, settings).length);
     return m;
   }, [items, settings]);
   const faltasDe = useCallback((c: Candidate) => faltasPorCandidato.get(c.id) ?? 0, [faltasPorCandidato]);
   ```
   Import `melhorAderencia`, `type Aderencia` de `./aderencia` no topo de `page.tsx` (junto dos outros imports de `./shared`, `./components/...`).

2. **`page.tsx` — repassar as duas funções aos dois call sites existentes.**
   - `<Kanban ...>` (`page.tsx:714`): acrescentar `aderenciaDe={aderenciaDe} faltasDe={faltasDe}`.
   - `<CandidatosLista ...>` (`page.tsx:734`): acrescentar `aderenciaDe={aderenciaDe} faltasDe={faltasDe}`.

3. **`CandidatosLista.tsx` — Props (`CandidatosLista.tsx:17-30`).** Acrescentar `aderenciaDe` e `faltasDe` conforme **Interfaces**; importar `type Aderencia` de `../aderencia`.

4. **`CandidatosLista.tsx` — repassar ao `CandidateCard` na visão Cards (`CandidatosLista.tsx:31-38`).** No `.map` que hoje passa `dist={distancia(c)}`, acrescentar `aderencia={aderenciaDe(c)} faltas={faltasDe(c)}`.

5. **`CandidatosLista.tsx` — `Th k="nota"` (`CandidatosLista.tsx:94`).** Trocar `<Th k="nota">Nota</Th>` por `<Th k="nota"><span title="Nota da entrevista (1 a 5) — não é a aderência do currículo">Nota</span></Th>` — mesmo texto do cabeçalho, só ganha `title`. Invariante: mover/ajustar sem reescrever o resto da tabela — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

6. **`CandidatosLista.tsx` — `CandidateCard` (origem verbatim `CandidatosLista.tsx:167-217`, amostra E1).** Acrescentar os parâmetros `aderencia = null` e `faltas = 0` na assinatura (ver **Interfaces**) e, no bloco de chips (depois do `{empresa && <Chip .../>}`, antes do `{dist && ...}` — mesma lista de `<Chip>` condicionais que já existe), inserir:
   ```tsx
   {aderencia && (
     <Chip cls={FIT[aderencia.fit].cls}>
       <i className="ri-percent-line" /> Aderência: {aderencia.score.toFixed(1).replace('.', ',')} · {aderencia.jobTitle}
     </Chip>
   )}
   {faltas > 0 && (
     <Chip cls="bg-amber-50 text-amber-700 border-amber-200">
       <i className="ri-error-warning-line" /> {faltas === 1 ? 'falta 1 dado' : `faltam ${faltas} dados`}
     </Chip>
   )}
   ```
   Importar `FIT` de `../shared` (já importa outros símbolos de `../shared` na mesma linha, `CandidatosLista.tsx:4-7`) e `type Aderencia` de `../aderencia`. Invariante: mover/inserir sem reescrever o resto do componente — mesmas classes do `Chip` local (`CandidatosLista.tsx:216`), mesmo padrão de chip condicional já usado para `dist`/`entrevista`/`concerns`.

7. **`Kanban.tsx` — Props (`Kanban.tsx:8-18`).** Acrescentar `aderenciaDe` e `faltasDe` conforme **Interfaces**; importar `type Aderencia` de `../aderencia`.

8. **`Kanban.tsx` — chamada do `CandidateCard` (origem verbatim `Kanban.tsx:52-53`).** Trocar:
   ```tsx
   <CandidateCard compact c={c} companies={companies} stage={s} empresa={mostrarEmpresa ? companyName(companies, c.company_id) : null}
     entrevista={proximaEntrevista.get(c.id) ?? null} onOpen={() => onOpen(c.id)} />
   ```
   por (acrescenta só os dois atributos novos, resto idêntico):
   ```tsx
   <CandidateCard compact c={c} companies={companies} stage={s} empresa={mostrarEmpresa ? companyName(companies, c.company_id) : null}
     entrevista={proximaEntrevista.get(c.id) ?? null} onOpen={() => onOpen(c.id)}
     aderencia={aderenciaDe(c)} faltas={faltasDe(c)} />
   ```
   Invariante: mover/ajustar sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos; nenhum outro atributo do card muda.

9. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **507 ou mais** (os 500 de hoje + os 7 de T01), 0 failed; esta task não cria teste, então o total não deve mudar em relação ao fim de T01.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Card (Lista, view "cards") e Kanban mostram o chip "Aderência: X,X · Vaga" quando `aderenciaDe(c)` não é `null`; sem chip quando é `null` (candidato sem candidatura com score válido) — sem "0" nem "—" inventado.
- [ ] Chip "falta X" aparece quando `faltasDe(c) > 0`, mesmo estilo amber de `CandidatoDrawer.tsx:136-139`.
- [ ] Coluna "Nota" da Tabela mantém o texto "Nota" e ganha `title` distinguindo da aderência; comportamento de ordenação (`sort.key === 'nota'`) inalterado.
- [ ] `compact` (Kanban): os dois chips novos aparecem; o que já era escondido em `compact` (avatar, bloco de experiência, chip de "pontos de atenção") continua escondido — nada novo foi escondido nem revelado além do pedido.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes (`Chip`, `FIT`, mesmo padrão de chip condicional), não criou novos.
- [ ] Nada desapareceu (Constraint 11): todos os chips/colunas/badges de hoje continuam; só foram acrescentados os dois novos.
- [ ] Rastreio: RF-02, US-03 cobertos (exceto "estado do agendamento IA" do Kanban, coberto em T18 — ver nota acima).

---

## T03: Janela única "Adicionar currículos"

| Campo | Valor |
|---|---|
| **Entregável** | Janela modal única (`UploadCurriculosModal`) com empresa, vaga, área de arrastar e fila de leitura; fim da faixa tracejada fixa na lista/Kanban; botão "Adicionar currículos" só em Candidatos e Vagas |
| **Onde** | `src/pages/contratacao/components/UploadCurriculosModal.tsx` (criar), `src/pages/contratacao/page.tsx` (modificar) |
| **Depende de** | — (lógica independente de T01/T02) |
| **Bloqueia** | T11 (Fase 4 — reusa `vagaId`/`empresaId` controlados para pré-selecionar a vaga "de dentro" dela) |
| **Paralelo com** | — (serializa com T02: ambas mexem em `page.tsx`) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-03, US-05 |

### Context pack

- Spec: RF-03 e US-05 (`#c-spec-filtrada`) — botão só em Candidatos (header/rodapé) e dentro da Vaga; modal com empresa, vaga, drag & drop, fila; faixa tracejada sai da lista e do Kanban.
- Global Constraints: `#global-constraints` #1 (mesmas classes/botões/janelas — invólucro do `dialog.tsx`/modais existentes, não um `fixed inset-0` inventado), #9 (gate), #11 ("botão 'Adicionar currículos' nas abas onde ele não deve mais aparecer" e "faixa tracejada fixa do Kanban/lista" são as duas remoções **explicitamente autorizadas** por esta constraint), #12 (sem Radix — janela é `<div className="fixed inset-0 ...">` como as outras do módulo).
- Padrão do repo: invólucro de janela — **copiar exatamente** de `AdicionarCandidatosModal.tsx:34-35` (overlay `<div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />` + cartão `<div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[70] w-full sm:max-w-lg max-h-[90vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">`); cabeçalho com ícone + título + botão fechar — mesmo padrão de `AdicionarCandidatosModal.tsx:36-41`. Corpo = JSX movido verbatim de `page.tsx:628-685` (amostra E4-b).
- Arquivos vizinhos: `page.tsx` já declara todo o estado necessário (`queue`/`setQueue` `:77`, `dragOver`/`setDragOver` `:87`, `fileRef` `:88`, `empresaUpload`/`setEmpresaUpload` `:84`, `vagaUpload`/`setVagaUpload` `:72`, `ativas` `:115`, `vagasUpload` `:466`, `lendo` `:523`, `addFiles` `:303`); nada disso muda de lugar, só passa a ser lido/escrito de dentro do modal via props.
- **Não fazer:** não duplicar o estado (`queue`, `dragOver`, `empresaUpload`, `vagaUpload`) dentro do modal — ele é **controlado** (o estado inteiro continua em `page.tsx`); não criar um segundo `<input type="file">` (reusar o mesmo `fileRef`/`onChange` de `page.tsx:554-560`, só trocando o que ele faz com o `job_id`); não introduzir Radix (Constraint 12); não inventar classes de overlay/cartão fora do que `AdicionarCandidatosModal.tsx` já usa.

### Decisões tomadas

- **Onde fica o estado:** tudo em `page.tsx` (controlado), como já é hoje — `UploadCurriculosModal` só recebe valores e callbacks (`empresaId`/`onEmpresaChange`, `vagaId`/`onVagaChange`, `dragOver`/`onDragOver`, `queue`/`onClearQueue`, `lendo`, `onPickFiles`, `onDropFiles`). Nenhum `useState` novo dentro do modal.
- **`presetJobId` (Fase 4):** não existe como prop separada — o preset da vaga ao abrir "de dentro da Vaga" é feito pelo próprio chamador ajustando os próprios `vagaId`/`empresaId` (controlados) **antes** de abrir o modal (`setEmpresaUpload(job.company_id ?? ''); setVagaUpload(job.id); setUploadOpen(true);`). Como esses dois props já são obrigatórios e controlados, T11 (Fase 4) reusa exatamente esse mecanismo sem precisar de uma prop nova — cumpre "a assinatura já prever isso" sem duplicar estado.
- **Em quais abas o botão aparece nesta fase:** só `candidatos` e `vagas` — as duas abas de hoje que correspondem a "Candidatos" e "dentro da Vaga" da spec (a navegação de 5 áreas só chega na Fase 3). Deixa de aparecer em `entrevistas`, `kanban`, `agenda`, `agendamentos`, `relatorios`, `links` — autorizado pela Constraint 11 ("botão nas abas onde ele não deve mais aparecer").
- **`pendingJobRef` é removido.** Em vez de guardar o `job_id` num ref para o `onChange` do `<input>` ler depois, o job pré-selecionado passa a ser o próprio `vagaUpload` (já controlado): o `onChange` do `<input>` chama `addFiles(e.target.files)` sem segundo argumento, e `addFiles` já cai no fallback `vagaUpload || null` (`page.tsx:306`, inalterado).

### Interfaces

**Produces:**
```ts
// page.tsx — exportar o tipo que já existe (page.tsx:36), só acrescenta "export"
export interface QueueItem { key: string; name: string; state: 'lendo' | 'ok' | 'erro'; msg?: string }

// src/pages/contratacao/components/UploadCurriculosModal.tsx
import type { QueueItem } from '../page';
interface Props {
  open: boolean;
  onClose: () => void;
  empresas: Company[];             // ativas — page.tsx `ativas` (:115)
  empresaId: string;               // page.tsx `empresaUpload`
  onEmpresaChange: (id: string) => void;
  vagas: Job[];                    // page.tsx `vagasUpload` (:466), já filtradas por empresa
  vagaId: string;                  // page.tsx `vagaUpload`
  onVagaChange: (id: string) => void;
  dragOver: boolean;
  onDragOver: (v: boolean) => void;
  onPickFiles: () => void;         // page.tsx: () => fileRef.current?.click()
  onDropFiles: (files: FileList) => void; // page.tsx: (files) => addFiles(files)
  queue: QueueItem[];
  onClearQueue: () => void;
  lendo: number;
}
export default function UploadCurriculosModal(props: Props): JSX.Element | null
```

**Consumes:** nenhuma de T01/T02 (independente).

### Steps

1. **`page.tsx` — exportar `QueueItem`.** Trocar `interface QueueItem { ... }` (`page.tsx:36`) por `export interface QueueItem { ... }` — só a palavra `export`, corpo idêntico.

2. **`page.tsx` — novo estado de abertura do modal.** Junto de `const [dragOver, setDragOver] = useState(false);` (`page.tsx:87`), acrescentar `const [uploadOpen, setUploadOpen] = useState(false);`.

3. **`page.tsx` — remover `pendingJobRef`.** Apagar a declaração `const pendingJobRef = useRef<string | null>(null);` (`page.tsx:73`) — as três chamadas que o usam são reescritas nos Steps 4, 5 e 6.

4. **Criar `src/pages/contratacao/components/UploadCurriculosModal.tsx`.** Invólucro copiado de `AdicionarCandidatosModal.tsx:32-41` (overlay + cartão + cabeçalho com ícone `ri-upload-2-line`, título "Adicionar currículos" e botão fechar `ri-close-line`, mesmas classes); dentro do cartão, um `<div className="flex-1 overflow-y-auto px-5 py-4">` contendo o **corpo movido verbatim de `page.tsx:628-685`** (amostra E4-b: bloco "Área de soltar" + bloco "Fila de leitura"), com as seguintes trocas mecânicas de nome (mesmo comportamento, só a origem do valor):
   - `dragOver`/`setDragOver` → `props.dragOver`/`props.onDragOver`
   - `addFiles(e.dataTransfer.files)` → `props.onDropFiles(e.dataTransfer.files)`
   - `fileRef.current?.click()` → `props.onPickFiles()`
   - `ativas` → `props.empresas`, `empresaUpload`/`setEmpresaUpload` → `props.empresaId`/`props.onEmpresaChange`
   - `vagasUpload` → `props.vagas`, `vagaUpload`/`setVagaUpload` → `props.vagaId`/`props.onVagaChange`
   - `queue` → `props.queue`, `setQueue([])` → `props.onClearQueue()`, `lendo` → `props.lendo`

   Se `!props.open`, retornar `null` antes do overlay. Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos ("Arraste PDFs ou fotos de currículos aqui", "Vários de uma vez...", "Lendo N currículo(s)…", "Leitura concluída", "Limpar").

5. **`page.tsx` — botão "Adicionar currículos" (origem verbatim `page.tsx:548-560`, amostra E4-a).** Trocar:
   ```tsx
   {aba !== 'config' && (
     <button onClick={() => { pendingJobRef.current = aba === 'vagas' ? selectedJobId : null; fileRef.current?.click(); }}
       className="flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer whitespace-nowrap">
       <i className="ri-upload-2-line" /> Adicionar currículos
     </button>
   )}
   <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden"
     onChange={(e) => {
       const jid = pendingJobRef.current;
       pendingJobRef.current = null;
       if (e.target.files) addFiles(e.target.files, jid);
       e.target.value = '';
     }} />
   ```
   por:
   ```tsx
   {(aba === 'candidatos' || aba === 'vagas') && (
     <button onClick={() => {
       const job = aba === 'vagas' ? jobs.find((j) => j.id === selectedJobId) : null;
       setEmpresaUpload(job ? (job.company_id ?? '') : '');
       setVagaUpload(job ? job.id : '');
       setUploadOpen(true);
     }}
       className="flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer whitespace-nowrap">
       <i className="ri-upload-2-line" /> Adicionar currículos
     </button>
   )}
   <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden"
     onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
   ```
   Invariante: mesmas classes do botão e do input, mesmo ícone, mesmo texto — só a lógica do `onClick`/`onChange` muda (abre o modal em vez de abrir o seletor de arquivo direto; não lê mais `pendingJobRef`).

6. **`page.tsx` — `onUploadToJob` da `Vagas` (origem verbatim `page.tsx:599`).** Trocar:
   ```tsx
   onUploadToJob={(job) => { pendingJobRef.current = job.id; fileRef.current?.click(); }}
   ```
   por:
   ```tsx
   onUploadToJob={(job) => { setEmpresaUpload(job.company_id ?? ''); setVagaUpload(job.id); setUploadOpen(true); }}
   ```
   `Vagas.tsx` não é tocado — a prop `onUploadToJob: (job: Job) => void` já existe com essa assinatura; só a implementação em `page.tsx` muda.

7. **`page.tsx` — remover a faixa tracejada + fila do corpo (origem verbatim `page.tsx:628-685`, amostra E4-b).** Apagar o bloco inteiro (comentários "Área de soltar" e "Fila de leitura" inclusos) de dentro do `else` do roteamento de abas — o conteúdo já foi movido para `UploadCurriculosModal.tsx` no Step 4. O que sobra no `else` é só a busca + chips de fase + `Kanban`/`CandidatosLista` (`page.tsx:686` em diante, inalterado).

8. **`page.tsx` — renderizar o modal.** Perto de onde os outros modais do shell são renderizados (ex.: ao lado de `{modal && <EntrevistaModal .../>}`), acrescentar:
   ```tsx
   <UploadCurriculosModal
     open={uploadOpen} onClose={() => setUploadOpen(false)}
     empresas={ativas} empresaId={empresaUpload} onEmpresaChange={(id) => { setEmpresaUpload(id); setVagaUpload(''); }}
     vagas={vagasUpload} vagaId={vagaUpload} onVagaChange={setVagaUpload}
     dragOver={dragOver} onDragOver={setDragOver}
     onPickFiles={() => fileRef.current?.click()} onDropFiles={(files) => addFiles(files)}
     queue={queue} onClearQueue={() => setQueue([])} lendo={lendo}
   />
   ```
   Importar `UploadCurriculosModal` no topo de `page.tsx`.

9. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **507 ou mais** (os 500 de hoje + os 7 de T01), 0 failed; esta task não cria teste.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Botão "Adicionar currículos" aparece só nas abas `candidatos` e `vagas`; ao clicar, abre `UploadCurriculosModal` (não abre mais o seletor de arquivo direto).
- [ ] Modal mostra empresa, vaga, área de arrastar e fila de leitura com os mesmos textos/classes de antes (comparar com `page.tsx:628-685` original antes da remoção).
- [ ] Faixa tracejada e fila **não aparecem mais** soltas no corpo da aba Candidatos/Kanban — só dentro do modal.
- [ ] Abrir "de dentro da Vaga" (`onUploadToJob`) pré-seleciona empresa e vaga no modal, igual ao comportamento anterior (que pré-selecionava só o `job_id` para o `<input>`).
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes (invólucro de `AdicionarCandidatosModal.tsx`, mesmo JSX de drag/fila), não criou novos.
- [ ] Nada desapareceu (Constraint 11) além do explicitamente autorizado (faixa tracejada fixa; botão nas abas onde não deve mais aparecer).
- [ ] Rastreio: RF-03, US-05 cobertos.

## T04: `ConversaWhatsApp` — bolhas de `wa_log` extraídas

| Campo | Valor |
|---|---|
| **Entregável** | `ConversaWhatsApp` — bolhas de `wa_log` (+ histórico do entrevistador) extraídas de `AgendamentosPainel.tsx`, usada lá e, depois (T06), na aba Conversa da ficha |
| **Onde** | `src/pages/contratacao/components/ConversaWhatsApp.tsx` (criar), `src/pages/contratacao/components/AgendamentosPainel.tsx` (modificar) |
| **Depende de** | — |
| **Bloqueia** | T06 (consome `ConversaWhatsApp`) |
| **Paralelo com** | T05 (arquivos disjuntos: T04 não toca `CandidatoDrawer.tsx`/`ficha/*`; T05 não toca `AgendamentosPainel.tsx`) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-04, US-04 |

### Context pack

- Spec: RF-04 (`#c-spec-filtrada`) — aba Conversa "WhatsApp completo (`wa_log`)"; edge case "candidato sem `wa_log` → aba Conversa vazia com 'Sem histórico'" (o texto e a decisão de quando mostrá-lo são de **T06**, que é quem monta a aba — este componente só cuida das bolhas).
- Global Constraints: `#global-constraints` #1 (mesmas classes/bolhas, nada novo), #5 (não quebrar "campo WhatsApp ≠ telefone" — a escolha de qual número usar fica em T06/`FichaConversa`; este componente só recebe `phone` já resolvido), #8 (`wa_log` já é lida em `AgendamentosPainel.tsx:156`, então ler o mesmo dado para a ficha está dentro da constraint), #9 (gate), #11 (nada desaparece — `AgendamentosPainel` continua idêntico visualmente), #12 (sem Radix).
- Padrão do repo: bolhas verbatim em `AgendamentosPainel.tsx:308-333` (amostra E5 do enunciado — **conferido no arquivo real**: o invólucro `<div className="space-y-1.5 max-h-80 overflow-y-auto">` abre em `:308` e o `</div>` que o fecha está em `:333` — `:332` é só o `})()}` que fecha o IIFE interno, não o invólucro; a citação anterior desta task, `:308-332`, cortava a tag de fechamento e foi corrigida agora); query verbatim em `:152-159` (amostra E6 — o enunciado citava `:152-160`, conferido e corrigido em 1 linha).
- Arquivos vizinhos (todos em `AgendamentosPainel.tsx`, linhas conferidas e corrigidas onde o enunciado deslizou 1 linha): `phoneKey` (`:34-39`, enunciado citava `:35-40`), `ORIGEM` (`:40`, enunciado citava `:41`), `MODELOS`/`textoModelo` (`:14-24`, confere), `WaLog` (`:32`, enunciado citava `:34`), `Hist` (`:10`, confere), `quando` (`:44`, formatter curto com fuso — usado também **fora** das bolhas, no render de `passos(s).map(...)` em `:287` — `title={p.on && p.at ? quando(p.at) : 'ainda não'}`, dentro da linha do tempo de cada sessão; `passos()` em si, `:127-137`, não chama `quando` — então **não pode sair** de `AgendamentosPainel.tsx`, só duplicado).
- **Não fazer:** não importar nada de `AgendamentosPainel.tsx` a partir de `ConversaWhatsApp.tsx` (evita ciclo, já que `AgendamentosPainel.tsx` importa `ConversaWhatsApp.tsx`); não mudar o texto "Sem mensagens registradas." (Constraint 1); não usar `select('*')` na query (mantém o `select` enxuto já existente); não mexer no intervalo de 30 s nem no canal `contratacao-agendamentos` de `AgendamentosPainel.tsx`.

### Decisões tomadas

- **Assinatura recebe `phone`, não `phoneKey` pronta:** o componente normaliza a chave internamente (função duplicada, ver abaixo) porque os dois usos (painel, ficha) partem de números em formatos diferentes (`s.phone` da sessão; a ficha usa `c.whatsapp || c.phone`, decidido em T06) e a regra de normalização é a mesma nos dois.
- **`history` continua sendo o array inteiro** (não pré-filtrado por `de === 'gestor'`): a lógica original só filtra por `gestor` **quando já existe `wa_log`**; sem `wa_log`, cai no histórico inteiro como fallback (`AgendamentosPainel.tsx:312-316`). Pré-filtrar do lado de fora quebraria esse fallback — `ConversaWhatsApp` reproduz a mesma ternária internamente, sem reescrever a regra.
- **`Hist` muda de dono:** passa a ser exportada por `ConversaWhatsApp.tsx`; `AgendamentosPainel.tsx` importa de lá (`import ConversaWhatsApp, { type Hist } from './ConversaWhatsApp'`) — direção única, sem ciclo. `WaLog` e `phoneKey` seguem o mesmo caminho (saem de `AgendamentosPainel.tsx`, passam a existir só em `ConversaWhatsApp.tsx`) — conferido por `grep` que nenhum dos dois é usado em mais nenhum lugar do arquivo hoje.
- **Cache por sessão muda de "por id" para "por montagem":** hoje `logs: Record<string, WaLog[]>` guarda por `session.id`, então reabrir a mesma linha não refaz a query. Como `ConversaWhatsApp` vira um componente próprio, montado só quando a linha está aberta (`{open && (...)}`, `AgendamentosPainel.tsx:299`), a consulta roda de novo a cada abrir/fechar — troca consciente e aceitável (dado sempre fresco, mesmas bolhas), sem violar nenhuma constraint.

### Interfaces

**Produces** (usado por `AgendamentosPainel.tsx` nesta própria task e por T06):
```ts
// src/pages/contratacao/components/ConversaWhatsApp.tsx
export interface Hist { at: string; de: string; texto: string }
interface Props {
  phone: string | null;   // número já resolvido por quem chama; a phoneKey é calculada aqui dentro
  history?: Hist[];       // respostas do entrevistador fora do wa_log (AgendamentosPainel passa `s.history`; a ficha não passa nada)
}
export default function ConversaWhatsApp({ phone, history = [] }: Props): JSX.Element
```

**Consumes:** nenhuma (independente).

### Steps

1. **Criar `ConversaWhatsApp.tsx` — helpers movidos verbatim.** `MODELOS`/`textoModelo` de `AgendamentosPainel.tsx:14-24`; `phoneKey` de `:34-39`; `ORIGEM` de `:40`; `WaLog` de `:32`; `Hist` de `:10` (agora `export`); `quando` **duplicado** de `:44` com comentário citando a origem. Import de `supabase` (`@/lib/supabase`). Invariante: mover o JSX/lógica sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

2. **Estado e query (origem verbatim `AgendamentosPainel.tsx:152-159`).** Adicionar:
   ```ts
   const [logs, setLogs] = useState<WaLog[] | null>(null);
   useEffect(() => {
     if (!phone) { setLogs([]); return; }
     let vivo = true;
     supabase.from('wa_log').select('id, direction, origin, kind, text, at').eq('phone_key', phoneKey(phone)).order('at').order('id').limit(500)
       .then(({ data }) => { if (vivo) setLogs((data ?? []) as WaLog[]); });
     return () => { vivo = false; };
   }, [phone]);
   ```
   Invariante: mesmo `select`/`order`/`limit` de hoje — só a origem do número (`phone` prop em vez de `sess.find(...).phone`) e o formato do estado (array simples em vez de `Record` por `session.id`, ver Decisões).

3. **Bolhas (origem verbatim `AgendamentosPainel.tsx:308-333`, amostra E5 — conferido no arquivo real, ver Context pack).** Mover o JSX inteiro para o corpo de `ConversaWhatsApp`, trocando `logs[s.id]` por `logs` (state local do Step 2) e `(s.history ?? [])` por `(history ?? [])` (prop) — resto idêntico, incluindo a condicional "sem `wa_log` usa o histórico inteiro" e o texto "Sem mensagens registradas." Manter o mesmo invólucro `<div className="space-y-1.5 max-h-80 overflow-y-auto">`. Enquanto `logs === null` (ainda carregando), pode reaproveitar o texto "Carregando…" já usado em `AgendamentosPainel.tsx:247` — não inventar texto novo. Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

4. **`AgendamentosPainel.tsx` — remover o que migrou.** Apagar `MODELOS`, `textoModelo`, `phoneKey`, `ORIGEM`, `WaLog`, a interface `Hist` local, o estado `logs`/`setLogs` e o `useEffect` de `:152-159` (todos migraram no Step 1/2). Trocar a declaração de `Hist` usada por `interface Sess { ...; history: Hist[]; ... }` por um import: `import ConversaWhatsApp, { type Hist } from './ConversaWhatsApp';` — a forma de `Sess` não muda, só a origem do tipo `Hist`.

5. **`AgendamentosPainel.tsx` — trocar o bloco de bolhas pelo componente.** Trocar o JSX de `:308-333` por `<ConversaWhatsApp phone={s.phone} history={s.history} />`, no mesmo lugar da árvore (dentro do `{open && (...)}`, logo depois do bloco "tentativa(s) / código"). Invariante: mesma posição, mesmo resultado visual, `history` é o array inteiro (não filtrado — ver Decisões).

6. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — 0 failed, sem encolher.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [x] `ConversaWhatsApp` renderiza as mesmas bolhas de hoje (cores por remetente, tag de origem, `textoModelo`) a partir de `phone` + `history`.
- [x] `AgendamentosPainel.tsx` mostra exatamente a mesma conversa de antes ao abrir uma linha (conferência visual manual — sem teste automatizado nesta fase, Constraint 3).
- [x] Nenhum import de `AgendamentosPainel.tsx` dentro de `ConversaWhatsApp.tsx` — conferir com `grep -n "from '../AgendamentosPainel'\|from './AgendamentosPainel'" src/pages/contratacao/components/ConversaWhatsApp.tsx` → esperado nenhuma linha (sem ciclo).
- [x] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [x] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos.
- [x] Nada desapareceu (Constraint 11): mesmas bolhas, mesmo fallback sem `wa_log`, mesmo texto "Sem mensagens registradas."
- [x] Assinatura de `CandidatoDrawer` (Props) não é tocada nesta task — o arquivo nem é tocado.
- [x] Rastreio: RF-04, US-04 (parte "Conversa" — a aba em si, com o texto "Sem histórico" do edge case, é T06).

---

## T05: `ficha/*` — blocos do drawer em 5 sub-componentes

| Campo | Valor |
|---|---|
| **Entregável** | 4 sub-componentes da ficha (`FichaResumo`, `FichaCurriculo`, `FichaEntrevistas`, `FichaHistorico`) com o corpo dos blocos 1(parcial)/2/3(parcial)/4/5/6/7/8/9/10(parcial)/11-19 movido verbatim de `CandidatoDrawer.tsx` |
| **Onde** | `src/pages/contratacao/components/ficha/FichaResumo.tsx`, `.../ficha/FichaCurriculo.tsx`, `.../ficha/FichaEntrevistas.tsx`, `.../ficha/FichaHistorico.tsx` (todos criar) |
| **Depende de** | — (independente de T04; roda em paralelo com a Fase 1 inteira, arquivos disjuntos) |
| **Bloqueia** | T06 (consome os 4 componentes) |
| **Paralelo com** | T04 (arquivos disjuntos: T05 não toca `AgendamentosPainel.tsx`/`ConversaWhatsApp.tsx`) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-04, US-04 |

### Context pack

- Spec: RF-04 e o mapa bloco→aba de `spec.md` §2 (`#c-spec-filtrada`) — é o checklist desta task para os blocos 1-6/9-19 (7 e 8 completam o quadro, mas moram junto porque compartilham arquivo com blocos vizinhos).
- Global Constraints: `#global-constraints` #1 (nenhuma classe/ícone/texto novo — só realocação), #5 (citada aqui pelo motivo certo, **conferido no código**: `contratacao_rascunho_entrevista_*` **não** existe em `CandidatoDrawer.tsx` — `grep -n localStorage src/pages/contratacao/components/CandidatoDrawer.tsx` volta vazio; o rascunho mora inteiro em `EntrevistasDoDia.tsx:38-41`, arquivo **fora do Mapa** desta fase, e não é tocado por nenhuma task da Fase 2. `RegistroEntrevista` (`CandidatoDrawer.tsx:440-490`) é só **leitura** de `iv.answers`/`iv.notes`/`iv.scores` já salvos — não tem textarea de rascunho. O que esta task não pode regredir é a **exibição** do registro já salvo — `RegistroEntrevista`, que fica inteira dentro de `FichaEntrevistas` — e o histórico por gatilhos, dentro de `HistoricoCandidato`, que fica inteiro dentro de `FichaHistorico`), #8, #9, #11 (checklist dos 20 blocos no DoD de T06, que é quem monta a árvore final — aqui a garantia é "todo bloco tem um arquivo de destino"), #12.
- Padrão do repo: `Section` (amostra E3, `CandidatoDrawer.tsx:702-709`, conferido — linhas exatas) — duplicada, não movida (ver Decisão 1). Todo Step cita a origem verbatim das linhas movidas.
- Arquivos vizinhos: `CandidatoDrawer.tsx` é a única fonte (leitura integral já feita nesta fase de plano). Nenhum dos 4 arquivos novos importa de outro `ficha/*` nem de `CandidatoDrawer.tsx` — isso é o que evita o ciclo com T06 (que importa os 4).
- **Não fazer:** não criar um 5º arquivo (`ficha/Section.tsx` ou `ficha/shared.ts`) — está fora do Mapa desta fase, proibido; não exportar nada de `CandidatoDrawer.tsx` para estes arquivos importarem (fecharia ciclo com T06); não mudar nenhuma classe/ícone/texto dos blocos movidos; não alterar o comportamento interno de `HistoricoCandidato`/`RegistroEntrevista`/`AgendamentoIA`/`DadosMinimosForm` — só o arquivo em que vivem.

### Decisões tomadas

1. **`Section` (`CandidatoDrawer.tsx:702-709`) é duplicada**, não movida/exportada, em cada um dos 4 arquivos que a usam (todos, exceto nenhum — os quatro usam `Section` pelo menos uma vez). Cada cópia leva um comentário: `// Section: mesmo componente de CandidatoDrawer.tsx:702-709 (pré-Fase 2), duplicado para não fechar ciclo de import com o shell (T06) nem criar um 5º arquivo fora do Mapa desta fase.` Motivo: exportar de `CandidatoDrawer.tsx` fecharia ciclo (`CandidatoDrawer → ficha/FichaX → CandidatoDrawer`, já que T06 importa os 4 `ficha/*`); um módulo `Section.tsx` novo não está no Mapa de arquivos desta fase.
2. **Helpers usados por um único bloco/arquivo movem inteiros e verbatim, privados (sem `export`), para dentro do arquivo que os usa** — sem módulo compartilhado, porque nenhum é reaproveitado por mais de um dos 4 arquivos:
   - `EV_STYLE`, `quemFez`, `quando` (`CandidatoDrawer.tsx:493-507`) e `HistoricoCandidato` (`:509-579`) → `FichaHistorico.tsx`.
   - `SESS_LABEL` (`:584-589`), `firstNameOf` (`:638`) e `AgendamentoIA` (`:590-637`) → `FichaResumo.tsx`.
   - `DadosMinimosForm` (`:642-700`) → `FichaResumo.tsx` (usado pelo bloco 2, "Dados mínimos").
   - `RegistroEntrevista` (`:440-490`) → `FichaEntrevistas.tsx`.
   > **Aviso para depois (fora do escopo desta task):** a cópia de `SESS_LABEL`/`AGENDAMENTO_IA` feita por T18 em `CandidatosLista.tsx` cita como origem "`CandidatoDrawer.tsx:584-589`" num comentário. Depois desta task, `SESS_LABEL` mora em `FichaResumo.tsx` — o comentário de T18 fica com a linha desatualizada (o conteúdo continua correto). T18 está travada (`nenhuma` — não mexer); só registrando aqui para quem for consolidar os dois mapas de status no futuro.
3. **Estado local de cada bloco se realoca junto do bloco**, com os mesmos resets por `c.id` que já existem hoje (`notes`: `CandidatoDrawer.tsx:66`; `iaErro`/`verTexto`: `:67`; `editando`: `:92`) — cada `useEffect` de reset migra para o arquivo que recebeu o bloco correspondente. Os 4 componentes `ficha/*` **ficam sempre montados** pelo shell (T06 alterna a aba visível com uma classe CSS `hidden`, não com renderização condicional) — assim nenhum estado local (ex.: `editando` aberto, texto do currículo expandido) se perde ao trocar de aba; a troca de **candidato** continua resetando pelo mesmo padrão de `useEffect` por `c.id` de hoje, não por remount.

### Interfaces

**Consumes:** nenhuma de T01-T04 (os únicos tipos usados vêm de `../../shared`, já existente e fora do Mapa desta fase — `shared.ts` permanece intocado).

**Produces** (assinaturas exatas — consumidas por T06):
```ts
// src/pages/contratacao/components/ficha/FichaResumo.tsx
interface Props {
  c: Candidate; companies: Company[]; stages: Stage[]; ficha: FichaCfg; jobs: Job[]; applications: Application[];
  analyzing: Set<string>; empresa: string;
  onApply: (jobId: string) => void; onOpenJob: (jobId: string) => void;
  onUpdate: (patch: Partial<Candidate>) => void; onOrganizar: () => Promise<void>;
}
export default function FichaResumo(props: Props): JSX.Element

// src/pages/contratacao/components/ficha/FichaCurriculo.tsx
interface Props {
  c: Candidate; ficha: FichaCfg; idade: number | null; wa: string | null;
  loja: Company | null; lojaTemPin: boolean; temEndereco: boolean;
  dist: Distance | null; distBusy: boolean; distErro: string | null; onCalcular: () => void;
}
export default function FichaCurriculo(props: Props): JSX.Element

// src/pages/contratacao/components/ficha/FichaEntrevistas.tsx
interface Props {
  interviews: Interview[]; settings: Settings; empresa: string;
  onOpenInterview: (iv: Interview) => void; onAgendar: () => void;
}
export default function FichaEntrevistas(props: Props): JSX.Element

// src/pages/contratacao/components/ficha/FichaHistorico.tsx
interface Props { c: Candidate; applications: Application[]; interviews: Interview[] }
export default function FichaHistorico(props: Props): JSX.Element
```

### Steps

> Ordem pensada para o maior risco desta task (perder um bloco ao dividir ~500 linhas em 4 arquivos): um Step por grupo pequeno de blocos, cada um com sua própria conferência de `tsc` no fim do arquivo, em vez de "mover tudo" de uma vez (decisão 8 do enunciado).

1. **Criar `FichaResumo.tsx` — esqueleto + `Section` duplicada + blocos 1(parcial)/3(parcial)/4.** Imports de `../../shared` (`Candidate, Company, Stage, FichaCfg, Job, Application, DECISIONS, type Decision, decisionOf, withEmpresa, fieldsOf, faltasFicha, fitOf, FIT`) e `Props` conforme **Interfaces**. Corpo: bloco 1 **sem** o `<select>` de fase (origem verbatim `CandidatoDrawer.tsx:120-132` — estrelas + empresa; o `<select>` de fase de `:116-119` vai para a barra de ações em T06, não para esta aba — ver Correção do orquestrador em T06); bloco 3 (Tomada de decisão, `:153-166`); bloco 4 (banner IA, `:168-181`), com `iaBusy`/`iaErro` locais e a função `organizar` (origem verbatim `:73-76`, adaptada para chamar `props.onOrganizar` em vez de `onOrganizar` direto). Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

2. **`FichaResumo.tsx` — bloco 2 (Dados mínimos, `:134-151`) + `DadosMinimosForm` (`:642-700`).** Mover os dois verbatim; `DadosMinimosForm` fica privada (sem `export`) no mesmo arquivo; estado `editando` (`:91`) com o mesmo reset `useEffect(() => setEditando(false), [c.id])` (`:92`). Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

3. **`FichaResumo.tsx` — bloco 5 (Vagas, `:184-215`) e bloco 6 (`AgendamentoIA` + `SESS_LABEL` + `firstNameOf`, chamada `:218-219`, definições `:584-638`).** Mover os dois grupos verbatim; `AgendamentoIA` recebe `stages`, `applications`, `jobs` já vindos das Props de `FichaResumo`, e `onSend={(stageId) => props.onUpdate({ stage_id: stageId })}` (mesma composição de hoje, `CandidatoDrawer.tsx:219`). O bloco 5 usa `vagasAbertas`, que **não** é uma das linhas do próprio bloco — é uma variável calculada mais cedo no shell hoje (`CandidatoDrawer.tsx:61`, `const vagasAbertas = jobs.filter((j) => j.status !== 'fechada' && !applications.some((a) => a.job_id === j.id));`); mover essa linha junto (verbatim) para dentro de `FichaResumo`, calculada a partir de `props.jobs`/`props.applications`. Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

4. **`FichaResumo.tsx` — blocos 11/12/19 (`:323`, `:325-340`, `:415-420`) + `Section` duplicada (Decisão 1).** Bloco 19 ("Minhas anotações") mantém o `notes`/`onBlur` local exatamente como hoje (`:62`, `:66`, `:416-419`) — o `onBlur` já salva antes de qualquer perda ao trocar de aba (o clique num botão de aba dispara blur no textarea). Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos. Rodar `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` isolado (deve continuar ≤ 287; se `FichaResumo.tsx` ainda não é importado por ninguém nesta task, o número não deve mudar).

5. **Criar `FichaCurriculo.tsx` — `Section` duplicada + blocos 9/10(parcial)/13-18.** Imports de `../../shared`: `type Candidate, type FichaCfg, type Company, type Distance, fmtPhone, onlyDigits, fmtKm, distCls, PRECISION_LABEL, fmtMonths` (mesmo nível de detalhe do Step 1 — `wa` já chega pronto via Props, calculado no shell com `whatsLink`, então `FichaCurriculo` não precisa importar `whatsLink`; `fmtPhone`/`onlyDigits` são do bloco 9, `fmtKm`/`distCls`/`PRECISION_LABEL` do bloco 10, `fmtMonths` do bloco 13). Bloco 9 (Contato, `:262-288`, usa `idade`/`wa` das Props); bloco 10 (Distância, `:290-321`, usa `loja`/`lojaTemPin`/`temEndereco`/`dist`/`distBusy`/`distErro`/`onCalcular` das Props — o cálculo automático ao abrir a ficha **não** muda de lugar, continua no shell, T06); blocos 13 (Experiência, `:342-359`), 14 (Formação, `:361-372`), 15 (Outros cursos, `:374-378`), 16 (Habilidades, `:380-388`), 17 (Outras informações, `:390-402`, usa `extras` calculado dentro do próprio componente a partir de `ficha.custom_fields`/`c.extra_fields`, mesma expressão de `:90`), 18 (Texto do currículo, `:404-413`, com `verTexto` local, sem `useEffect` de reset — ver Decisão 3, componente sempre montado, reset por `c.id` não é obrigatório aqui porque não há exigência de reset explícito além do padrão já citado; se ao testar aparecer vazamento de `verTexto=true` entre candidatos, acrescentar `useEffect(() => setVerTexto(false), [c.id])` igual ao de hoje `:67`). Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

6. **Criar `FichaEntrevistas.tsx` — `Section` duplicada + bloco 7 + `RegistroEntrevista`.** Bloco 7 (`:222-254`, usa `interviews` das Props, ordenado internamente com `const minhas = [...interviews].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));`, mesma expressão de `:85`); `RegistroEntrevista` (`:440-490`) movida verbatim, privada. Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos (preserva a **exibição** do registro já salvo, que é o que a Constraint 5 exige aqui — `RegistroEntrevista` não tem rascunho, ver Context pack).

7. **Criar `FichaHistorico.tsx` — `Section` duplicada + bloco 8 + `EV_STYLE`/`quemFez`/`quando`/`HistoricoCandidato`.** `HistoricoCandidato` (`:509-579`) movida verbatim; o `refreshKey` (hoje montado na chamada, `CandidatoDrawer.tsx:258-259`) passa a ser calculado dentro de `FichaHistorico` a partir das Props `applications`/`interviews`, com a mesma expressão: `[c.stage_id, c.decision, c.rating, c.company_id, applications.length, ...interviews.map((iv) => \`${iv.status}|${iv.scheduled_at}|${iv.recommendation}|${Object.keys(iv.answers ?? {}).length}\`)].join('~')`. Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos.

8. Rodar o gate completo (Constraint 9) com os 4 arquivos prontos:
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos** (os 4 arquivos ainda não são importados por ninguém nesta task — se o número subir, é erro de tipo dentro dos próprios arquivos novos, não de integração).
   - `npx vitest run` — 0 failed, sem encolher.
   - `npx vite build` — exit 0 (arquivo não referenciado não quebra o build, mas confirma que compila).
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [x] Os 4 arquivos existem com as assinaturas exatas de **Interfaces**; cada bloco do mapa bloco→aba (seção C) tem um destino entre os 4 (conferir 1 a 1: blocos 1(parcial)/2/3(parcial)/4/5/6 → `FichaResumo`; 9/10(parcial)/13-18 → `FichaCurriculo`; 7 → `FichaEntrevistas`; 8 → `FichaHistorico`).
- [x] Nenhum dos 4 arquivos importa de outro `ficha/*` nem de `../CandidatoDrawer` — conferir com `grep -rn "from '\.\./CandidatoDrawer'\|from '\./Ficha" src/pages/contratacao/components/ficha/` → esperado nenhuma linha (sem ciclo com T06).
- [x] `Section` está duplicada (não importada) nos 4 arquivos, cada cópia com o comentário de origem.
- [x] `RegistroEntrevista` (exibição do registro já salvo — não tem rascunho, ver Context pack) e `HistoricoCandidato` (histórico por gatilhos) foram movidos **inteiros**, sem alteração de comportamento — Constraint 5.
- [x] `vagasAbertas` (`CandidatoDrawer.tsx:61`) foi movida junto do bloco 5 para dentro de `FichaResumo.tsx` — conferir que o shell (T06) não precisa mais dessa variável.
- [x] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [x] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos.
- [x] Nada desapareceu (Constraint 11): todo bloco de hoje tem um arquivo de destino nesta task (a montagem final na árvore de abas é T06).
- [x] Assinatura de `CandidatoDrawer` (Props) não é tocada nesta task — o arquivo nem é tocado.
- [x] Rastreio: RF-04, US-04 cobertos (montagem final das abas é T06).

---

## T06: Shell da ficha — cabeçalho fixo, barra de ações e 5 abas

| Campo | Valor |
|---|---|
| **Entregável** | `CandidatoDrawer.tsx` reorganizado (cabeçalho fixo com nome/idade/bairro/distância/nota/decisão, barra de ações, menu "⋯", 5 abas) + `FichaConversa.tsx` novo |
| **Onde** | `src/pages/contratacao/components/CandidatoDrawer.tsx` (modificar), `src/pages/contratacao/components/ficha/FichaConversa.tsx` (criar) |
| **Depende de** | T04 (`ConversaWhatsApp`), T05 (`ficha/*`) |
| **Bloqueia** | — |
| **Paralelo com** | — (consome os dois arquivos das outras tasks desta fase; pode rodar em paralelo com a Fase 1 inteira, que não toca nenhum destes arquivos) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-04, US-04 |

### Context pack

- Spec: RF-04 verbatim (`#c-spec-filtrada`) — cabeçalho fixo, barra de ações, 5 abas; critérios de aceite de US-04 (checklist do DoD).
- Global Constraints: `#global-constraints` #1, #5 (citada pelo motivo certo — **conferido no código**, `CandidatoDrawer.tsx` não tem `localStorage`; o rascunho `contratacao_rascunho_entrevista_*` mora em `EntrevistasDoDia.tsx`, fora do Mapa desta fase, e não é tocado. O que esta task não pode regredir é a **exibição** do registro de entrevista já salvo e o histórico por gatilhos — ambos ficam dentro de `FichaEntrevistas`/`FichaHistorico`, sempre montados), #8 (nenhuma tabela nova — `wa_log` já autorizado por T04), #9, #11 (checklist dos 20 blocos + confirmação de que "Ver currículo original"/"Excluir" continuam existindo, só que na barra de ações/menu), #12 (abas com `<button>`/`border-b-2`, padrão `page.tsx:564-571` citado em E4; menu "⋯" com `<button>` + estado local, sem Radix).
- **Nota para o `/sdd-07-spec-review`:** o edge case da spec ("candidato sem `wa_log` → aba Conversa vazia com mensagem 'Sem histórico'") é lido literalmente como **um** caso; esta task desdobra em **dois** (ver Decisão 7): "Sem histórico." quando o candidato não tem número nenhum, e "Sem mensagens registradas." (texto já existente, `ConversaWhatsApp`/T04) quando tem número mas a consulta não acha nada. Registrado aqui explicitamente para o revisor final não marcar como divergência do edge case.
- Padrão do repo: E1 (Props travadas), E2 (invólucro do drawer, `CandidatoDrawer.tsx:94-113`), E4 (padrão de aba).
- Arquivos vizinhos: `../aderencia` (Fase 1, `melhorAderencia`/`Aderencia` — já pronta e testada por T01).
- **Não fazer:** não mudar a assinatura de `Props` de `CandidatoDrawer` (E1) — `page.tsx` não é tocado; não usar Radix; não recalcular `melhorAderencia` fora do padrão de `aderencia.ts` (chamar a função, não reimplementar a lógica); não duplicar a query de `wa_log` fora de `ConversaWhatsApp`/`FichaConversa`.

### Decisões tomadas

- **5. Cabeçalho fixo:** usa `melhorAderencia(applications, jobs)` (Fase 1) para "melhor nota/vaga" — chamado uma vez no topo do shell (`const aderencia = melhorAderencia(applications, jobs);`). Diferente de T02 (que agrega por `Map` para uma lista de milhares de candidatos), aqui `applications`/`jobs` já chegam filtrados/prontos para **um** candidato (Props de `CandidatoDrawer`, `page.tsx:751`), então não precisa de agregação por `Map`. Distância "resumida" no cabeçalho reaproveita a mesma variável `dist` já calculada no shell (bloco 10 original) — só `fmtKm(dist.km)`, sem o texto de precisão/método, que fica no detalhe (`FichaCurriculo`, bloco 10); não há segundo cálculo.
  > **Correção do orquestrador (2026-09-20, nesta sessão de plano):** a linha do Mapa bloco→aba "1 | Fase / estrelas / empresa | Cabeçalho fixo (**fase**/decisão) + aba Resumo (estrelas, empresa)" diverge do RF-04 verbatim, que só lista "fase" na **barra de ações** ("fase, WhatsApp, agendar pela IA, currículo original, editar dados") — o cabeçalho fixo, por RF-04, é "nome, idade, bairro, distância, melhor nota/vaga, decisão", sem fase. Sigo o RF-04 (é o texto de aceite da US-04, fonte mais forte que a coluna "Destino" do mapa): o `<select>` de fase vai para a barra de ações; o cabeçalho fixo mostra só o que RF-04 lista.
- **6. Barra de ações** (novo `<div>` entre o cabeçalho e a barra de abas, mesma família de classes do invólucro — `flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-zinc-100`, nada novo):
  - **Fase** — o mesmo `<select>` de hoje (`CandidatoDrawer.tsx:116-119`), movido verbatim.
  - **WhatsApp** — atalho novo: `<a href={wa} target="_blank" rel="noopener noreferrer">` com o mesmo padrão de link já usado no bloco Contato (`:274`, `text-emerald-600`), com moldura de botão igual à de "Editar dados" (`border border-zinc-200 hover:bg-zinc-50`, `ri-whatsapp-line`); não aparece se `!wa`.
  - **Agendar pela IA** — atalho que troca a aba ativa para `resumo` (`onClick={() => setAba('resumo')}`, `ri-robot-2-line`, texto "Agendamento pela IA"); **não** duplica a lógica de elegibilidade de `AgendamentoIA` (que fica só dentro de `FichaResumo`, evitando dois fetches de `hiring_job_scheduling`/`hiring_scheduling_sessions` para a mesma informação).
  - **Currículo original** — mesma função `abrirArquivo()` de hoje (`:78-83`, permanece no shell, inalterada), mesmo texto/ícone do rodapé antigo (`:425-427`); só muda de lugar (rodapé → barra de ações); não aparece se `!c.file_path`.
  - **Editar dados** — o mesmo botão de hoje (`:104-107`), só realocado do cabeçalho para a barra de ações.
  - **Menu "⋯"** — novo, só com "Excluir" (mesmo texto/classe do rodapé antigo, `:429-431`, `text-red-600 hover:bg-red-50`). Sem Radix: `const [menuAberto, setMenuAberto] = useState(false)`; botão `<button onClick={() => setMenuAberto((v) => !v)}><i className="ri-more-2-fill" /></button>`; painel condicional `{menuAberto && (<><div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)} /><div className="absolute right-5 mt-10 z-20 rounded-lg border border-zinc-200 bg-white shadow-2xl">…</div></>)}` — mesmo padrão "overlay + painel para fechar ao clicar fora" já usado no módulo (`CandidatoDrawer.tsx:96`, o overlay do próprio drawer, aqui sem o escurecido) e as mesmas classes de cartão já usadas em outros lugares do módulo (`rounded-lg border-zinc-200 shadow-2xl`, ex. `aside` do drawer).
- **7. `FichaConversa` e o texto de "sem histórico":** dois textos que **não se contradizem** — se o candidato não tem `whatsapp` nem `phone` (nenhum número pra consultar), `FichaConversa` mostra **"Sem histórico."** (edge case da spec) sem nem montar `ConversaWhatsApp`; se tem número mas a consulta não acha nada, quem mostra é `ConversaWhatsApp` (T04) com o texto que já existe hoje no painel, **"Sem mensagens registradas."** (Constraint 1 — não mudar texto já em produção). São dois casos diferentes (sem número vs. número sem histórico). `FichaConversa` só monta `ConversaWhatsApp` na primeira vez que a aba Conversa é visitada (`ativa` prop) e mantém montado depois — evita puxar `wa_log` de todo candidato aberto que nunca visita essa aba, e evita refazer a query ao alternar de aba pra frente e para trás.
- **3. Aba default = Resumo**, resetada a cada troca de candidato: `const [aba, setAba] = useState<'resumo' | 'curriculo' | 'entrevistas' | 'conversa' | 'historico'>('resumo'); useEffect(() => setAba('resumo'), [c.id]);` — mesmo padrão dos outros resets por `c.id` já existentes no arquivo (`:60`, `:66`, `:71`, `:92`). Não há requisito de persistir a última aba entre candidatos diferentes (RF-04/US-04 não pedem isso).

### Interfaces

**Consumes** (de T04 e T05, mais Fase 1):
```ts
import ConversaWhatsApp from './ConversaWhatsApp';
import FichaResumo from './ficha/FichaResumo';
import FichaCurriculo from './ficha/FichaCurriculo';
import FichaEntrevistas from './ficha/FichaEntrevistas';
import FichaHistorico from './ficha/FichaHistorico';
import { type Aderencia, melhorAderencia } from '../aderencia';
```

**Produces:**
```ts
// src/pages/contratacao/components/ficha/FichaConversa.tsx
interface Props { c: Candidate; ativa: boolean }
export default function FichaConversa({ c, ativa }: Props): JSX.Element

// CandidatoDrawer.tsx — Props (E1) INALTERADA. Nenhuma mudança de assinatura; page.tsx não é tocado.
```

### Steps

1. **Criar `ficha/FichaConversa.tsx`.** `const phone = c.whatsapp || c.phone;` (mesma prioridade já usada em `CandidatoDrawer.tsx:69`, `whatsLink(c.whatsapp || c.phone)`); `const [visitou, setVisitou] = useState(false); useEffect(() => { if (ativa) setVisitou(true); }, [ativa]);`; se `!phone`, renderizar `<p className="text-xs text-zinc-400">Sem histórico.</p>` (edge case da spec); senão `{visitou && <ConversaWhatsApp phone={phone} />}`. Import `ConversaWhatsApp` de `../ConversaWhatsApp` (T04). Invariante: nenhum texto/classe novo além do citado; reaproveita `ConversaWhatsApp` sem alterá-lo.

2. **`CandidatoDrawer.tsx` — imports.** Acrescentar os 5 imports de **Consumes**. Reconferir símbolo a símbolo a lista de `../shared` (`CandidatoDrawer.tsx:4-10`, 36 símbolos hoje) contra o que o shell efetivamente usa **depois** dos Steps 1-8 desta task (a versão anterior desta task tinha `fmtKm` nas duas listas — "manter" e "remover" — e não listava `fmtPhone`/`onlyDigits`/`JobScheduling`/`faltasAgendamento`/`stageByKind`/`CandidateEvent`; corrigido abaixo com a lista completa):
   - **Manter (17):** `type Application, type Candidate, type Company, type Interview, type Job, type Stage, type Distance, type FichaCfg, type Settings` (tipos usados pela `Props` que não muda, E1, e pelas variáveis locais que continuam no shell — `loja: Company | null`, `dist: Distance | null`) + `BUCKET` (`abrirArquivo`, `:78-83`, fica no shell), `fmtKm` (cabeçalho fixo, Step 3 — `dist ? fmtKm(dist.km) : null`), `whatsLink` (`wa`, `:69`, fica no shell — usado no botão WhatsApp da barra de ações), `stageOf` (`<select>` de fase, `:116`, fica na barra de ações), `decisionOf` (`dec`, `:88`, cabeçalho), `withEmpresa` (`title` do badge de decisão, `:103`), `ageOf` (`idade`, `:87`), `companyName` (`empresa`, `:86`).
   - **Remover (19) — migram para dentro do `ficha/*` que os usa, T05:** `type Decision` e `DECISIONS` (bloco 3, `FichaResumo`), `FIT` e `fitOf` (bloco 5, `FichaResumo`), `distCls` e `PRECISION_LABEL` (bloco 10 detalhe, `FichaCurriculo`), `fmtPhone` (bloco 9, `FichaCurriculo`), `fmtMonths` (bloco 13, `FichaCurriculo`), `fmtDateTime`, `interviewStatusInfo`, `avgScore`, `FORMATS` (bloco 7, `FichaEntrevistas`), `fieldsOf` e `faltasFicha` (bloco 2/`DadosMinimosForm`, `FichaResumo` — `faltasFicha` **não** fica no shell: o cabeçalho fixo de RF-04 não mostra "faltam X dados", só nome/idade/bairro/distância/nota/decisão), `onlyDigits` (`DadosMinimosForm`, `FichaResumo`), `type JobScheduling` e `faltasAgendamento` e `stageByKind` (`AgendamentoIA`, `FichaResumo`), `type CandidateEvent` (`HistoricoCandidato`, `FichaHistorico`).
   - Confirmar com `npx tsc --noEmit --project tsconfig.app.json` que nada da lista "manter" ficou faltando (import inexistente quebra o build, isso o `tsc` acusa) e conferir visualmente que nenhum símbolo da lista "remover" sobrou (import não lido **não** quebra o build — `noUnusedLocals: false` — por isso a conferência aqui é manual, não só pelo `tsc`).

3. **Cabeçalho fixo (origem verbatim `CandidatoDrawer.tsx:98-111`).** Manter o mesmo invólucro (`flex items-start gap-3 px-5 py-4 border-b border-zinc-100`, `text-lg font-black`, `text-xs text-zinc-500`) e acrescentar à mesma lista `.filter(Boolean).join(' · ')` da linha de subtítulo (`:101`, hoje `[c.desired_role, idade, c.marital_status]`) os itens novos exigidos por RF-04: `c.neighborhood` (bairro) e `dist ? fmtKm(dist.km) : null` (distância resumida) e `aderencia ? \`Aderência ${aderencia.score.toFixed(1).replace('.', ',')} · ${aderencia.jobTitle}\` : null` (melhor nota/vaga, texto puro, sem o componente `Chip` de T02 — aqui é cabeçalho, não card). O badge de decisão (`dec.sigla`, `:103`) fica onde está. O botão "Editar dados" (`:104-107`) **sai** do cabeçalho (vai para a barra de ações, Step 4); o botão fechar (`:108-110`) fica onde está. Invariante: mover/ajustar sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos; só a lista de itens do subtítulo cresce.

4. **Barra de ações — novo `<div>`** entre o cabeçalho (Step 3) e a barra de abas (Step 5), com os 6 itens da Decisão 6: fase (verbatim `:116-119`); WhatsApp (novo, ver Decisão 6); Agendar pela IA (novo, atalho `setAba('resumo')`); Currículo original (mesmo `abrirArquivo`/`c.file_path`, texto/ícone de `:425-427`, só realocado); Editar dados (mesmo botão de `:104-107`, só realocado); menu "⋯" com Excluir (mesmo texto/classe de `:429-431`, painel descrito na Decisão 6). Invariante: mover/ajustar sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos; nenhum controle perde funcionalidade.

5. **Barra de abas — novo bloco**, reproduzindo o padrão de `page.tsx:564-571` (amostra E4) com as 5 abas: `resumo` (`ri-file-user-line`, "Resumo"), `curriculo` (`ri-file-text-line`, "Currículo"), `entrevistas` (`ri-calendar-event-line`, "Entrevistas"), `conversa` (`ri-whatsapp-line`, "Conversa"), `historico` (`ri-history-line`, "Histórico"). Estado conforme Decisão 3 (`aba`, default `resumo`, reset por `c.id`). Invariante: mesmo padrão de `<button>`/`border-b-2` de `page.tsx:564-571`, nenhuma classe nova.

6. **Corpo — trocar o `<div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">{/* ~20 blocos */}</div>` único (`:113-421`) pelos 5 componentes de T04/T05, cada um dentro do mesmo invólucro de rolagem, condicional só por classe `hidden`:**
   ```tsx
   <div className={aba === 'resumo' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
     <FichaResumo c={c} companies={companies} stages={stages} ficha={ficha} jobs={jobs} applications={applications}
       analyzing={analyzing} empresa={empresa} onApply={onApply} onOpenJob={onOpenJob} onUpdate={onUpdate} onOrganizar={onOrganizar} />
   </div>
   <div className={aba === 'curriculo' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
     <FichaCurriculo c={c} ficha={ficha} idade={idade} wa={wa} loja={loja} lojaTemPin={lojaTemPin} temEndereco={temEndereco}
       dist={dist} distBusy={distBusy} distErro={distErro} onCalcular={calcular} />
   </div>
   <div className={aba === 'entrevistas' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
     <FichaEntrevistas interviews={interviews} settings={settings} empresa={empresa} onOpenInterview={onOpenInterview} onAgendar={onAgendar} />
   </div>
   <div className={aba === 'conversa' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
     <FichaConversa c={c} ativa={aba === 'conversa'} />
   </div>
   <div className={aba === 'historico' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
     <FichaHistorico c={c} applications={applications} interviews={interviews} />
   </div>
   ```
   `onOrganizar={onOrganizar}` passa a Prop **crua** de `CandidatoDrawer` direto para `FichaResumo` (o wrapper com `iaBusy`/`iaErro`/try-catch, hoje `:73-76`, mudou de dono para dentro de `FichaResumo` em T05 — o shell não tem mais função `organizar` própria). `calcular`/`distBusy`/`distErro`/`loja`/`lojaTemPin`/`temEndereco`/`dist` continuam sendo calculados no shell exatamente como hoje (`:42-60`) — não migram, só passam a ser lidos por `FichaCurriculo` também. Invariante: mesmo invólucro de rolagem de hoje, repetido 5x com `hidden` condicional; nenhum bloco reescrito (cada `Ficha*` já traz seu JSX verbatim de T04/T05).

7. **Remover o rodapé antigo (`:423-432`).** "Ver currículo original" e "Excluir" migraram para a barra de ações/menu (Step 4) — cumpre a Constraint 11 ("nada desaparece... existe depois, em outro lugar").

8. **Remover as declarações órfãs em `CandidatoDrawer.tsx:439-709`.** Rodar **só depois** dos Steps 6 e 7 (com as abas já montadas e o corpo antigo/rodapé já fora, o `tsc` consegue acusar se alguma dessas declarações ainda estiver em uso). Tudo entre o `}` que fecha o `export default function CandidatoDrawer` (`:437`) e o fim do arquivo (`:709`, 271 linhas) deixou de ter call-site no shell depois dos Steps 1-7 — apagar por inteiro, na ordem em que aparecem:
   - `RegistroEntrevista` (comentário `:439` + função `:440-490`) — mora em `FichaEntrevistas.tsx` desde T05.
   - `EV_STYLE`, `quemFez`, `quando` (comentário `:492` + `:493-507`) — moram em `FichaHistorico.tsx` desde T05.
   - `HistoricoCandidato` (`:509-579`) — mora em `FichaHistorico.tsx` desde T05.
   - `SESS_LABEL`, `AgendamentoIA`, `firstNameOf` (comentário `:581-583` + `:584-589` + `:590-637` + `:638`) — moram em `FichaResumo.tsx` desde T05.
   - `DadosMinimosForm` (comentário `:640-641` + `:642-700`) — mora em `FichaResumo.tsx` desde T05.
   - `Section` (`:702-709`) — **não** fica no shell (diferente das outras quatro cópias, que foram *duplicadas* por decisão de T05): depois dos Steps 3-6 desta task, nenhuma linha de `CandidatoDrawer.tsx` chama `<Section>` — o cabeçalho fixo, a barra de ações e a barra de abas não usam esse wrapper, só os `ficha/*` usam (e cada um já tem sua própria cópia duplicada, T05). Apagar também, sem duplicar.
   Conferir com `grep -n "function RegistroEntrevista\|function HistoricoCandidato\|function AgendamentoIA\|function DadosMinimosForm\|function Section\|const EV_STYLE\|const SESS_LABEL" src/pages/contratacao/components/CandidatoDrawer.tsx` → esperado **nenhuma linha**.

9. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — 0 failed, sem encolher; `src/test/components/entrevistasDoDia.test.tsx` continua verde (não referencia `CandidatoDrawer`, mas confirmar que a suíte inteira passa).
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [x] Cabeçalho fixo mostra nome, idade, bairro, distância (resumida), melhor nota/vaga (via `melhorAderencia`) e decisão — presentes em **todas** as 5 abas (é fixo, fora do `overflow-y-auto` de cada aba).
- [x] Barra de ações mostra fase, WhatsApp, agendar pela IA (atalho para a aba Resumo), currículo original, editar dados; Excluir só aparece no menu "⋯".
- [x] As 5 abas trocam de conteúdo sem perder estado local (ex.: abrir "Dados mínimos › editar" na aba Resumo, trocar para Currículo e voltar — o formulário continua aberto; expandir "Mostrar texto completo" no Currículo, trocar de aba e voltar — continua expandido).
- [x] **Checklist dos 20 blocos** (mapa bloco→aba da seção C) — todos aparecem em alguma aba/cabeçalho/barra de ações: 1 (cabeçalho: fase¹/decisão; Resumo: estrelas/empresa), 2 (Resumo), 3 (cabeçalho: decisão; Resumo: ação de mudar), 4 (Resumo), 5 (Resumo), 6 (barra: atalho; Resumo: estado), 7 (Entrevistas), 8 (Histórico), 9 (Currículo), 10 (cabeçalho: resumida; Currículo: detalhe), 11 (Resumo), 12 (Resumo), 13 (Currículo), 14 (Currículo), 15 (Currículo), 16 (Currículo), 17 (Currículo), 18 (Currículo), 19 (Resumo), 20 (barra de ações: currículo original; menu "⋯": excluir). ¹ fase vai para a barra de ações, não o cabeçalho — ver Correção do orquestrador acima.
- [x] Aba Conversa mostra "Sem histórico." quando o candidato não tem telefone nem WhatsApp; mostra "Sem mensagens registradas." (via `ConversaWhatsApp`) quando tem número mas não há `wa_log` — os dois casos do edge case da spec, ver Context pack.
- [x] Nenhuma declaração órfã ficou em `CandidatoDrawer.tsx` (Step 8) — `grep` do Step 8 sem resultado; o arquivo caiu de 709 linhas para aproximadamente 190-210 (estimativa: remove 271 linhas de declarações órfãs + ~300 linhas do corpo antigo de blocos/rodapé, acrescenta ~90-110 linhas de cabeçalho ampliado, barra de ações, barra de abas e as 5 chamadas de componente — conferir a contagem real com `wc -l` ao terminar e registrar se destoar muito do estimado).
- [x] Exibição do registro de entrevista já salvo (`RegistroEntrevista`, sem rascunho — ver Context pack) e histórico por gatilhos (`HistoricoCandidato`) continuam funcionando dentro de `FichaEntrevistas`/`FichaHistorico` (Constraint 5) — testar manualmente: abrir uma entrevista com registro já salvo, trocar de aba e voltar, o registro continua visível.
- [x] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher (`entrevistasDoDia.test.tsx` continua verde); `npx vite build` limpo.
- [x] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos.
- [x] Assinatura de `CandidatoDrawer` (Props, E1) não mudou — `page.tsx` não foi tocado nesta task (conferir que o diff não lista `page.tsx`).
- [x] Rastreio: RF-04, US-04 cobertos (todos os critérios de aceite da US-04).

---

## T07: `navegacao.ts` — áreas novas e mapa dos `aba` antigos

| Campo | Valor |
|---|---|
| **Entregável** | `navegacao.ts` — tipos `Area`/`SubAbaEntrevistas`/`ModoCandidatos`/`SecaoConfig`, as constantes `AREAS`/`AREA_CONFIG` e `destinoDeAbaAntiga()` (mapa de compatibilidade `?aba=`/localStorage) |
| **Onde** | `src/pages/contratacao/navegacao.ts` (criar), `src/test/lib/contratacaoNavegacao.test.ts` (criar) |
| **Depende de** | — |
| **Bloqueia** | T09 (consome tipos, `AREAS`/`AREA_CONFIG` e `destinoDeAbaAntiga`); T10 (consome `SecaoConfig`) |
| **Paralelo com** | T08 (arquivos disjuntos: T07 só mexe em `navegacao.ts` + teste; T08 não toca nenhum dos dois) |
| **Profundidade** | `snippets` (override desta task — ver `#profundidade-do-plano`) |
| **Requisitos** | RF-01, RF-05, RF-07, US-01, US-07 |

### Context pack

- Spec: RF-01 (`#c-spec-filtrada`) — mapa de compatibilidade verbatim (seção C, tabela "Valor antigo → Destino novo") é o alvo exato do teste desta task; RF-05 (sub-abas de Entrevistas); RF-07 (seções de Configurações); US-07 (critérios de aceite do deep link).
- Global Constraints: `#global-constraints` #1 (visual — N/A, é lógica pura, mas os ícones `AREAS`/`AREA_CONFIG` têm que ser Remix `ri-*` já em uso no produto), #3 (teste só em lógica pura — este é o caso), #4 (compatibilidade de links — é exatamente o que `destinoDeAbaAntiga` implementa), #8 (sem banco — módulo puro), #9 (gate), #12 (N/A, sem JSX).
- Padrão do repo: imitar `src/test/lib/tipoEmpresa.test.ts` (import relativo, `describe`/`it` em pt-BR, casos curtos) e o próprio `aderencia.ts` (T01 — módulo de lógica pura com tipos + função exportada, doc-comment explicando a regra).
- Arquivos vizinhos: nenhum — módulo novo, sem dependência de `page.tsx` nem de `shared.ts` (os tipos daqui não precisam de `Candidate`/`Job`/etc., só strings literais).
- **Não fazer:** não importar nada de `page.tsx` (fecharia ciclo, já que T09 importa `navegacao.ts`); não ler/escrever `localStorage` dentro deste módulo (é lógica pura — a leitura/escrita fica em `page.tsx`, T09); não incluir JSX nem `ri-*` novo fora do já usado no produto; não modelar o efeito de "Hoje ainda não existir" aqui — o contrato de `destinoDeAbaAntiga` é o de **destino final** (RF-01: "ausente/inválido → Hoje"); quem decide o que fazer enquanto a área Hoje não existe é T09 (ver Decisão 3 lá).

### Decisões tomadas

1. **Assinatura do destino:** `Destino` é um objeto composto (`{ area, subabaEntrevistas?, modoCandidatos?, secaoConfig? }`), não só a `Area`. Motivo: os valores antigos `kanban`/`agenda`/`agendamentos` carregam informação além da área (o modo de Candidatos, a sub-aba de Entrevistas) — um retorno só com `Area` obrigaria T09 a reimplementar essa segunda tradução fora do módulo testado. Com o objeto composto, o teste unitário (Step 2) trava o contrato inteiro (área **e** sub-estado) numa função só.
2. **Onde fica `AREAS`/`AREA_CONFIG`:** neste módulo (`navegacao.ts`), não em `page.tsx`. Motivo: é dado puro (label + ícone), sem JSX — o mesmo papel que `ABAS` tem hoje em `page.tsx:43-53`, só que exportado, porque `BarraInferior.tsx` (T15) e o menu de `AreaConfiguracoes.tsx` (T10, com uma lista análoga `ITENS`/`SecaoConfig`) vão precisar da mesma fonte depois; manter em `page.tsx` obrigaria esses arquivos futuros a importar de `page.tsx` (import de shell por um componente — direção errada, risco de ciclo). `page.tsx` (T09) só importa e faz `.map`, como já faz hoje com `ABAS`.
3. **`AREA_CONFIG` é um objeto à parte, não o 6º item de `AREAS`.** RF-01 é explícito: "5 abas... + ícone de engrenagem" — são dois conceitos diferentes na UI (T09 renderiza a engrenagem com tratamento visual distinto, só ícone). Separar os dois na origem evita que `AREAS.map(...)` inclua a engrenagem por engano em algum lugar futuro (ex.: `BarraInferior.tsx`, T15, que também precisa dessa distinção).
4. **Ícone de "Hoje": `ri-sun-line`.** Já usado no produto para o conceito "hoje" (`src/pages/financeiro/components/VisaoGeralFinTab.tsx:550`, chip "Receita Hoje (caixa)") — reaproveitado em vez de inventar ícone novo (Constraint 1/12). Os outros 4 ícones de `AREAS` e o da engrenagem são os mesmos já usados nas abas de hoje (`page.tsx:44-52`, amostra E1): `ri-group-line` (Candidatos), `ri-briefcase-4-line` (Vagas), `ri-chat-voice-line` (Entrevistas), `ri-bar-chart-2-line` (Relatórios), `ri-settings-3-line` (engrenagem).
5. **`?aba=links` sem seção certa ainda (T12 pendente).** `SecaoConfig` desta task só tem as 4 seções que já existem hoje (`empresas`, `fases`, `dados-minimos`, `entrevista`) — `'whatsapp'` só nasce em T12 (Fase 4, ver spec.md RF-07/Nota do orquestrador). Por isso `destinoDeAbaAntiga('links')` devolve `{ area: 'config' }` sem `secaoConfig` (cai na 1ª seção do menu, que T10 define como default) — **não** é um TBD: é o comportamento definitivo até T12, quando essa linha do `switch` ganha `secaoConfig: 'whatsapp'` (acréscimo de uma palavra, task de T12, registrado aqui para quem for mexer depois). US-07 já é satisfeito literalmente ("`?aba=links` → Configurações"), sem exigir a seção certa antes de T12 existir.
6. **`destinoDeAbaAntiga` nunca lança.** Valor desconhecido, `undefined` ou `null` caem no mesmo `default` (RF-01: "valor inválido/ausente → Hoje") — sem `throw`, sem `console.error`, para que `page.tsx` (T09) possa chamar a função direto no corpo de um `useState(() => ...)` sem `try/catch`.

### Interfaces

**Produces** (consumido por T09 e T10):
```ts
// src/pages/contratacao/navegacao.ts
export type Area = 'hoje' | 'candidatos' | 'vagas' | 'entrevistas' | 'relatorios' | 'config';
export type SubAbaEntrevistas = 'dia' | 'calendario' | 'conversas';
export type ModoCandidatos = 'cards' | 'tabela' | 'kanban';
export type SecaoConfig = 'empresas' | 'fases' | 'dados-minimos' | 'entrevista'; // 'whatsapp' entra em T12

export interface Destino {
  area: Area;
  subabaEntrevistas?: SubAbaEntrevistas;
  modoCandidatos?: ModoCandidatos;
  secaoConfig?: SecaoConfig;
}

export interface AreaDef { id: Area; label: string; icon: string }
export const AREAS: AreaDef[];       // as 5 abas da barra (sem a engrenagem) — 5 itens, nesta ordem
export const AREA_CONFIG: AreaDef;   // a engrenagem — objeto à parte (Decisão 3)

export function destinoDeAbaAntiga(valor: string | null): Destino
```

**Consumes:** nenhuma (independente).

### Steps

1. **Criar `src/pages/contratacao/navegacao.ts`** com o corpo completo:
   ```ts
   // Navegação de Contratação: as 5 áreas novas (+ engrenagem) e o mapa de compatibilidade dos
   // valores antigos de `?aba=`/localStorage `contratacao_aba` (as 9 abas de antes da Fase 3)
   // para o destino novo. Lógica pura — sem JSX, sem localStorage, sem import de page.tsx.
   export type Area = 'hoje' | 'candidatos' | 'vagas' | 'entrevistas' | 'relatorios' | 'config';
   export type SubAbaEntrevistas = 'dia' | 'calendario' | 'conversas';
   export type ModoCandidatos = 'cards' | 'tabela' | 'kanban';
   // 'whatsapp' entra na Fase 4 (T12) — ver spec.md RF-07 e a Nota do orquestrador.
   export type SecaoConfig = 'empresas' | 'fases' | 'dados-minimos' | 'entrevista';

   export interface Destino {
     area: Area;
     /** Só relevante quando area === 'entrevistas'. */
     subabaEntrevistas?: SubAbaEntrevistas;
     /** Só relevante quando area === 'candidatos'. */
     modoCandidatos?: ModoCandidatos;
     /** Só relevante quando area === 'config'. */
     secaoConfig?: SecaoConfig;
   }

   export interface AreaDef { id: Area; label: string; icon: string }

   // As 5 abas da barra (RF-01: "5 abas... + ícone de engrenagem" — a engrenagem é
   // AREA_CONFIG, à parte, não o 6º item aqui). Ícones Remix já em uso no módulo
   // (page.tsx:44-52, ABAS pré-Fase-3); "Hoje" reaproveita ri-sun-line, já usado no produto
   // para o conceito "hoje" (src/pages/financeiro/components/VisaoGeralFinTab.tsx:550).
   export const AREAS: AreaDef[] = [
     { id: 'hoje', label: 'Hoje', icon: 'ri-sun-line' },
     { id: 'candidatos', label: 'Candidatos', icon: 'ri-group-line' },
     { id: 'vagas', label: 'Vagas', icon: 'ri-briefcase-4-line' },
     { id: 'entrevistas', label: 'Entrevistas', icon: 'ri-chat-voice-line' },
     { id: 'relatorios', label: 'Relatórios', icon: 'ri-bar-chart-2-line' },
   ];
   export const AREA_CONFIG: AreaDef = { id: 'config', label: 'Configurações', icon: 'ri-settings-3-line' };

   /**
    * Traduz um valor antigo de `?aba=`/localStorage `contratacao_aba` (as 9 abas de antes da
    * Fase 3) — ou já um id de área nova, que para 5 dos 9 valores antigos é a MESMA string
    * (`entrevistas`, `candidatos`, `vagas`, `relatorios`, `config`) — para o destino na
    * navegação nova. Nunca lança; valor desconhecido ou ausente cai no default (RF-01:
    * "valor inválido/ausente → Hoje"). Quem chama decide o que fazer com area === 'hoje'
    * enquanto a área Hoje não existir (T14/T15) — ver T09, Decisão 3.
    */
   export function destinoDeAbaAntiga(valor: string | null): Destino {
     switch (valor) {
       case 'entrevistas': return { area: 'entrevistas', subabaEntrevistas: 'dia' };
       // Sem modoCandidatos de propósito: a tabela de compatibilidade (spec RF-01, linha 2) diz que o
       // modo "vem do localStorage contratacao_view, sem mudança". Devolver 'cards' aqui mataria a
       // preferência de quem tem contratacao_view='tabela' gravado, porque o `??` de
       // estadoInicialDeNavegacao (T09) nunca cairia no fallback que lê o localStorage.
       // Só 'kanban' força um modo — é o único valor antigo que ERA uma aba própria.
       case 'candidatos': return { area: 'candidatos' };
       case 'vagas': return { area: 'vagas' };
       case 'kanban': return { area: 'candidatos', modoCandidatos: 'kanban' };
       case 'agenda': return { area: 'entrevistas', subabaEntrevistas: 'calendario' };
       case 'agendamentos': return { area: 'entrevistas', subabaEntrevistas: 'conversas' };
       case 'relatorios': return { area: 'relatorios' };
       // WhatsApp (RF-07) só existe como seção a partir de T12; até lá cai na 1ª seção do
       // menu (T10 decide qual). Quando T12 acrescentar 'whatsapp' a SecaoConfig, esta linha
       // ganha `secaoConfig: 'whatsapp'`.
       case 'links': return { area: 'config' };
       case 'config': return { area: 'config' };
       default: return { area: 'hoje' };
     }
   }
   ```

2. **Criar `src/test/lib/contratacaoNavegacao.test.ts`** com o corpo completo:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { destinoDeAbaAntiga, AREAS, AREA_CONFIG } from '../../pages/contratacao/navegacao';

   describe('destinoDeAbaAntiga — mapa de compatibilidade das 9 abas antigas (RF-01)', () => {
     it('entrevistas → Entrevistas › Dia', () => {
       expect(destinoDeAbaAntiga('entrevistas')).toEqual({ area: 'entrevistas', subabaEntrevistas: 'dia' });
     });
     it('candidatos → Candidatos SEM forçar modo (o modo vem do localStorage contratacao_view)', () => {
       // Regressão: se voltar a devolver modoCandidatos aqui, quem tem contratacao_view='tabela'
       // gravado no aparelho passa a abrir sempre em Cards e perde a preferência em silêncio.
       expect(destinoDeAbaAntiga('candidatos')).toEqual({ area: 'candidatos' });
       expect(destinoDeAbaAntiga('candidatos').modoCandidatos).toBeUndefined();
     });
     it('vagas → Vagas', () => {
       expect(destinoDeAbaAntiga('vagas')).toEqual({ area: 'vagas' });
     });
     it('kanban → Candidatos, modo kanban', () => {
       expect(destinoDeAbaAntiga('kanban')).toEqual({ area: 'candidatos', modoCandidatos: 'kanban' });
     });
     it('agenda → Entrevistas › Calendário', () => {
       expect(destinoDeAbaAntiga('agenda')).toEqual({ area: 'entrevistas', subabaEntrevistas: 'calendario' });
     });
     it('agendamentos → Entrevistas › Conversas da IA', () => {
       expect(destinoDeAbaAntiga('agendamentos')).toEqual({ area: 'entrevistas', subabaEntrevistas: 'conversas' });
     });
     it('relatorios → Relatórios', () => {
       expect(destinoDeAbaAntiga('relatorios')).toEqual({ area: 'relatorios' });
     });
     it('links → Configurações (seção WhatsApp só a partir de T12)', () => {
       expect(destinoDeAbaAntiga('links')).toEqual({ area: 'config' });
     });
     it('config → Configurações', () => {
       expect(destinoDeAbaAntiga('config')).toEqual({ area: 'config' });
     });
     it('valor inválido cai em Hoje', () => {
       expect(destinoDeAbaAntiga('nao-existe')).toEqual({ area: 'hoje' });
     });
     it('ausente (null) cai em Hoje', () => {
       expect(destinoDeAbaAntiga(null)).toEqual({ area: 'hoje' });
     });
   });

   describe('AREAS / AREA_CONFIG — a barra de 5 áreas + engrenagem (RF-01)', () => {
     it('AREAS tem exatamente 5 itens, sem a engrenagem', () => {
       expect(AREAS).toHaveLength(5);
       expect(AREAS.map((a) => a.id)).not.toContain('config');
     });
     it('a engrenagem é um item à parte, id "config"', () => {
       expect(AREA_CONFIG.id).toBe('config');
     });
   });
   ```

3. Rodar `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` — esperado `Test Files 1 passed (1)` e `Tests 13 passed (13)`, sem falha.

4. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **520 ou mais** (os 507 depois da Fase 1 — 500 de hoje + 7 de T01 — mais os 13 novos desta task), 0 failed.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] `navegacao.ts` e o teste criados exatamente como nos Steps 1/2; `Area`/`SubAbaEntrevistas`/`ModoCandidatos`/`SecaoConfig`/`Destino`/`AreaDef`/`AREAS`/`AREA_CONFIG`/`destinoDeAbaAntiga` exportados com a assinatura de **Interfaces**.
- [ ] `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` → `Tests 13 passed (13)`.
- [ ] As 9 linhas da tabela de compatibilidade (seção C do material do orquestrador) têm um `it()` correspondente — conferir 1 a 1.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher (≥ 507 antes desta task + 13 novos); `npx vite build` limpo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos (N/A nesta task: é lógica pura, sem JSX).
- [ ] Nada desapareceu (Constraint 11): task só adiciona arquivos novos, não mexe em nada existente.
- [ ] Rastreio: RF-01, RF-05, RF-07, US-01, US-07 — cobertos pelo mapa de compatibilidade e pelas constantes (a navegação em si, consumindo isto, é T09/T10).

---

## T08: Extrair as áreas de `page.tsx` (sem mudar comportamento)

> **Aviso sobre números de linha:** todas as linhas de `page.tsx` citadas nesta task são do As Is medido em **2026-09-20, antes das Fases 1 e 2** (T01-T06, T18 ainda não rodaram). As Fases 1 e 2 mexem em `page.tsx` (T02/T18 acrescentam props e `Map`s; T03 remove a faixa tracejada + fila de `page.tsx:628-685` e troca o botão/`onChange` de upload; T06 não toca `page.tsx`). Quando esta task rodar, **localize cada trecho pelo conteúdo citado, não pelo número da linha** — em especial o bloco de Candidatos (Step 3), cujo início desliza para cima porque o bloco de upload que vinha antes dele (T03) já saiu do arquivo.

| Campo | Valor |
|---|---|
| **Entregável** | `AreaCandidatos.tsx`, `AreaEntrevistas.tsx`, `AreaConfiguracoes.tsx` (1ª versão de cada, só extração) substituindo os 3 branches correspondentes do `if/else` de `page.tsx`; as 9 abas de hoje continuam idênticas |
| **Onde** | `src/pages/contratacao/areas/AreaCandidatos.tsx` (criar), `src/pages/contratacao/areas/AreaEntrevistas.tsx` (criar), `src/pages/contratacao/areas/AreaConfiguracoes.tsx` (criar), `src/pages/contratacao/page.tsx` (modificar) |
| **Depende de** | Fases 1 e 2 (T01-T06, T18); pode rodar em paralelo com T07 (arquivos disjuntos) |
| **Bloqueia** | T09 (consome os 3 componentes e os evolui) |
| **Paralelo com** | T07 (arquivos disjuntos: T08 não toca `navegacao.ts` nem o teste dele) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-01 (preparação), US-01, US-07 (preparação — a extração não muda a navegação ainda) |

### Context pack

- Spec: nenhum RF novo é entregue nesta task — é puramente a "Consolidação das abas" de preparação da Fase 3 (Plano de execução, linha Fase 3). O comportamento visível ao usuário não muda em nada; RF-01/US-01/US-07 só ficam "prontos para receber" a navegação nova em T09.
- Global Constraints: `#global-constraints` #1 (mover, não reescrever — nenhuma classe/ícone/texto novo), #9 (gate, com o cuidado extra do impacto "Extração de `page.tsx` para `areas/*`" já registrado na tabela de Impactos da spec — "maior chance de perder um prop, um `useMemo` ou um `onClick` no caminho"), #11 (nada desaparece — é o risco #1 desta task), #12 (sem Radix).
- Padrão do repo: E6 do material do orquestrador (a cadeia de `if/else` inteira, `page.tsx:582-740` do As Is) é o mapa de onde cada branch vai parar; E1 (Props travadas de `CandidatoDrawer`, mesmo espírito de "assinatura exata" aqui para os 3 componentes novos).
- Arquivos vizinhos: `../aderencia` (T01, `Aderencia`) e as props que T02/T18 já acrescentaram a `page.tsx` (`aderenciaDe`, `faltasDe`, `agendamentoIADe`) — **entram na assinatura de `AreaCandidatos`** porque já existem em `page.tsx` quando esta task roda (ver Consequência para T08 no material do orquestrador). `EntrevistaModal.tsx` (`type CandidatePatch`, já importado por `page.tsx`).
- **Não fazer:** não mudar nenhuma classe/ícone/texto do JSX movido; não introduzir `Aba`/`navegacao.ts` nesta task (isso é T09 — aqui a navegação continua sendo o `aba`/`ABAS` de hoje); não remover a faixa "kanban é `aba==='kanban'`, candidatos é o resto do `else`" — os dois continuam juntos dentro de `AreaCandidatos` exatamente como estão hoje (T09 é quem funde `kanban` como modo de `view`); não tocar em `Vagas.tsx`, `LinksWhatsApp.tsx`, `AgendaEntrevistas.tsx`, `AgendamentosPainel.tsx`, `RelatoriosContratacao.tsx` nem nos branches deles em `page.tsx` — ficam exatamente onde estão até T09/T11/T12; não remover `type Aba`/`ABAS`/a barra de abas de 9 itens (T09); não mover `EntrevistasDoDia` para dentro de `AreaEntrevistas` com sub-abas ainda — isso é T09 (aqui é só um wrapper 1:1).

### Decisões tomadas

5. **Ordem dos Steps — um Step por área, do menor risco para o maior, cada um terminando em `tsc` verde e as 9 abas ainda idênticas:** (1) `AreaConfiguracoes` (wrapper mais simples, mesma `Props` de `ConfiguracoesContratacao`); (2) `AreaEntrevistas` (wrapper 1:1 de `EntrevistasDoDia`, só a aba `entrevistas`); (3) `AreaCandidatos` (o maior risco — ~50 linhas com busca, filtro, alternância de view, chips de fase e o `if` `kanban`/lista). Ao final de cada Step, `tsc` tem que continuar ≤ 287 e uma conferência visual rápida (ou, no mínimo, releitura do diff) confirma que a aba trocada continua pixel-a-pixel igual — **é possível** garantir isso a cada Step porque cada área é extraída e recolocada isoladamente, sem tocar nas outras 8 abas no mesmo Step.
6. **O `else` que hoje serve `candidatos` **e** `kanban` continua servindo os dois, junto, dentro de `AreaCandidatos`.** Não é separado em dois componentes: as duas abas compartilham busca, filtro de decisão e (no caso de `candidatos`) o alternador Cards/Tabela — separar agora obrigaria duplicar esse cabeçalho comum só para juntá-lo de novo em T09 quando `kanban` virar o 3º modo de `view`. `AreaCandidatos` recebe dois booleanos (`modoKanban`, `mostrarAlternanciaView`) calculados em `page.tsx` a partir de `aba` (`aba === 'kanban'`, `aba === 'candidatos'`) — T09 troca esses dois booleanos por um único `view: ModoCandidatos` de três valores (ver T09).

### Interfaces

**Consumes** (de T01/T02/T18, já existentes em `page.tsx` quando esta task roda):
```ts
import { type Aderencia } from '../aderencia'; // T01
```

**Produces** (assinaturas exatas — T09 evolui as três):
```ts
// src/pages/contratacao/areas/AreaConfiguracoes.tsx (1ª versão — T10 adiciona o menu)
interface Props {
  companies: Company[]; stages: Stage[]; settings: Settings; candidates: Candidate[];
  onReload: () => Promise<void>; onSettingsSaved: (s: Settings) => void; onRecalcCompany: (companyId: string) => Promise<void>;
}
export default function AreaConfiguracoes(props: Props): JSX.Element

// src/pages/contratacao/areas/AreaEntrevistas.tsx (1ª versão — T09 acrescenta as sub-abas)
interface Props {
  interviews: Interview[]; candidates: Candidate[]; companies: Company[]; stages: Stage[]; settings: Settings;
  applications: Application[]; jobs: Job[];
  onSaved: (iv: Interview, candidatePatch?: CandidatePatch) => void;
  onOpenCandidate: (id: string) => void;
  onNewInterview: (date: string) => void;
  focoId: string | null;
  onFocoUsado: () => void;
}
export default function AreaEntrevistas(props: Props): JSX.Element

// src/pages/contratacao/areas/AreaCandidatos.tsx (1ª versão — T09 funde kanban em `view`)
interface Props {
  busca: string; onBuscaChange: (v: string) => void;
  decisaoFiltro: string; onDecisaoFiltroChange: (v: string) => void;
  view: 'cards' | 'tabela'; onViewChange: (v: 'cards' | 'tabela') => void;
  mostrarAlternanciaView: boolean;  // aba === 'candidatos' — Decisão 6
  modoKanban: boolean;              // aba === 'kanban' — Decisão 6
  items: Candidate[]; buscados: Candidate[]; filtrados: Candidate[]; daEmpresa: Candidate[];
  stages: Stage[]; companies: Company[]; mostrarEmpresa: boolean;
  faseFiltro: string; onFaseFiltroChange: (v: string) => void;
  counts: Record<string, number>;
  proximaEntrevista: Map<string, Interview>; ultimaAvaliacao: Map<string, Interview>;
  distanciaLista: (c: Candidate) => Distance | null;
  vagasDe: (c: Candidate) => string[];
  aderenciaDe: (c: Candidate) => Aderencia | null;   // T02
  faltasDe: (c: Candidate) => number;                // T02
  agendamentoIADe: (c: Candidate) => string | null;  // T18
  onOpen: (id: string) => void;
  onMove: (candidateId: string, stageId: string) => void;
}
export default function AreaCandidatos(props: Props): JSX.Element
```

### Steps

1. **Criar `src/pages/contratacao/areas/AreaConfiguracoes.tsx` — wrapper 1:1.** Corpo completo:
   ```tsx
   import ConfiguracoesContratacao from '../components/ConfiguracoesContratacao';
   import type { Candidate, Company, Settings, Stage } from '../shared';

   interface Props {
     companies: Company[]; stages: Stage[]; settings: Settings; candidates: Candidate[];
     onReload: () => Promise<void>; onSettingsSaved: (s: Settings) => void; onRecalcCompany: (companyId: string) => Promise<void>;
   }

   export default function AreaConfiguracoes(props: Props) {
     return <ConfiguracoesContratacao {...props} />;
   }
   ```
   Invariante: mesma árvore de componentes de hoje (`ConfiguracoesContratacao` recebe exatamente as mesmas props) — zero mudança de comportamento.

2. **`page.tsx` — trocar o branch `config` (origem verbatim `page.tsx:586-589` do As Is pré-Fases 1/2 — localize pelo conteúdo, a linha pode ter deslizado com T02/T03/T18).** Trocar:
   ```tsx
   ) : aba === 'config' ? (
     <ConfiguracoesContratacao companies={companies} stages={stages} settings={settings} candidates={items}
       onReload={async () => { await carregarConfig(); const { data } = await supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000); if (data) setItems(data as Candidate[]); }}
       onSettingsSaved={setSettings} onRecalcCompany={recalcCompany} />
   ```
   por (só o nome do componente muda; props idênticas):
   ```tsx
   ) : aba === 'config' ? (
     <AreaConfiguracoes companies={companies} stages={stages} settings={settings} candidates={items}
       onReload={async () => { await carregarConfig(); const { data } = await supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000); if (data) setItems(data as Candidate[]); }}
       onSettingsSaved={setSettings} onRecalcCompany={recalcCompany} />
   ```
   Importar `AreaConfiguracoes` de `./areas/AreaConfiguracoes`; remover o import de `ConfiguracoesContratacao` de `page.tsx` (`import ConfiguracoesContratacao from './components/ConfiguracoesContratacao';`, `page.tsx:32` do As Is) — deixou de ser usado direto neste arquivo. Rodar `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` isolado (≤ 287) e conferir visualmente a aba Configurações — idêntica.

3. **Criar `src/pages/contratacao/areas/AreaEntrevistas.tsx` — wrapper 1:1.** Corpo completo:
   ```tsx
   import EntrevistasDoDia from '../components/EntrevistasDoDia';
   import type { Application, Candidate, Company, Interview, Job, Settings, Stage } from '../shared';
   import type { CandidatePatch } from '../components/EntrevistaModal';

   interface Props {
     interviews: Interview[]; candidates: Candidate[]; companies: Company[]; stages: Stage[]; settings: Settings;
     applications: Application[]; jobs: Job[];
     onSaved: (iv: Interview, candidatePatch?: CandidatePatch) => void;
     onOpenCandidate: (id: string) => void;
     onNewInterview: (date: string) => void;
     focoId: string | null;
     onFocoUsado: () => void;
   }

   export default function AreaEntrevistas(props: Props) {
     return (
       <EntrevistasDoDia interviews={props.interviews} candidates={props.candidates} companies={props.companies} stages={props.stages}
         settings={props.settings} applications={props.applications} jobs={props.jobs} onSaved={props.onSaved} onOpenCandidate={props.onOpenCandidate}
         onNewInterview={props.onNewInterview} focoId={props.focoId} onFocoUsado={props.onFocoUsado} />
     );
   }
   ```
   Invariante: mesmas props, mesma ordem, para o mesmo componente (`EntrevistasDoDia`) — **`src/test/components/entrevistasDoDia.test.tsx` continua verde e não é tocado**, porque ele renderiza `EntrevistasDoDia` diretamente (`@/pages/contratacao/components/EntrevistasDoDia`), nunca `AreaEntrevistas` nem `page.tsx`.

4. **`page.tsx` — trocar o branch `entrevistas` (origem verbatim `page.tsx:613-617` do As Is pré-Fases 1/2, amostra E3 — localize pelo conteúdo).** Trocar:
   ```tsx
   ) : aba === 'entrevistas' ? (
     <EntrevistasDoDia interviews={ivsDaEmpresa} candidates={items} companies={companies} stages={stages} settings={settings}
       applications={applications} jobs={jobs} onSaved={onInterviewSaved} onOpenCandidate={setSelId}
       onNewInterview={(date) => setModal({ interview: null, date })}
       focoId={focoEntrevista} onFocoUsado={() => setFocoEntrevista(null)} />
   ```
   por (só o nome do componente muda; props idênticas):
   ```tsx
   ) : aba === 'entrevistas' ? (
     <AreaEntrevistas interviews={ivsDaEmpresa} candidates={items} companies={companies} stages={stages} settings={settings}
       applications={applications} jobs={jobs} onSaved={onInterviewSaved} onOpenCandidate={setSelId}
       onNewInterview={(date) => setModal({ interview: null, date })}
       focoId={focoEntrevista} onFocoUsado={() => setFocoEntrevista(null)} />
   ```
   Importar `AreaEntrevistas` de `./areas/AreaEntrevistas`; remover o import de `EntrevistasDoDia` de `page.tsx` (`page.tsx:29` do As Is). Rodar `tsc` isolado (≤ 287) e conferir visualmente a aba Entrevistas (inclusive abrir um link com `?entrevista=` para confirmar que `focoEntrevista`/`onFocoUsado` ainda funcionam através do wrapper) e o gate de regressão: `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde.

5. **Criar `src/pages/contratacao/areas/AreaCandidatos.tsx` — extração do maior bloco (origem verbatim `page.tsx:687-738` do As Is pré-Fases 1/2 — aviso do topo: T03 já removeu o bloco de upload que vinha logo antes; localize pelo conteúdo "Busca (+ fases e modo de visualização..." e não pela linha 687).** Corpo completo (JSX movido, trocando referências de estado direto por props conforme **Interfaces**):
   ```tsx
   import { type Distance, type Candidate, type Company, type Interview, type Stage, DECISIONS } from '../shared';
   import type { Aderencia } from '../aderencia';
   import CandidatosLista from '../components/CandidatosLista';
   import Kanban from '../components/Kanban';

   interface Props {
     busca: string; onBuscaChange: (v: string) => void;
     decisaoFiltro: string; onDecisaoFiltroChange: (v: string) => void;
     view: 'cards' | 'tabela'; onViewChange: (v: 'cards' | 'tabela') => void;
     mostrarAlternanciaView: boolean;
     modoKanban: boolean;
     items: Candidate[]; buscados: Candidate[]; filtrados: Candidate[]; daEmpresa: Candidate[];
     stages: Stage[]; companies: Company[]; mostrarEmpresa: boolean;
     faseFiltro: string; onFaseFiltroChange: (v: string) => void;
     counts: Record<string, number>;
     proximaEntrevista: Map<string, Interview>; ultimaAvaliacao: Map<string, Interview>;
     distanciaLista: (c: Candidate) => Distance | null;
     vagasDe: (c: Candidate) => string[];
     aderenciaDe: (c: Candidate) => Aderencia | null;
     faltasDe: (c: Candidate) => number;
     agendamentoIADe: (c: Candidate) => string | null;
     onOpen: (id: string) => void;
     onMove: (candidateId: string, stageId: string) => void;
   }

   export default function AreaCandidatos(props: Props) {
     return (
       <>
         {/* Busca (+ fases e modo de visualização na aba Candidatos) */}
         <div className="flex flex-wrap items-center gap-2 mb-3">
           <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px]">
             <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
             <input value={props.busca} onChange={(e) => props.onBuscaChange(e.target.value)}
               placeholder="Buscar por nome, cargo, cidade, empresa, palavra do currículo…"
               className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-rose-300" />
           </div>
           <select value={props.decisaoFiltro} onChange={(e) => props.onDecisaoFiltroChange(e.target.value)} title="Tomada de decisão"
             className="flex-1 sm:flex-none min-w-0 h-10 px-3 rounded-xl border border-zinc-200 text-sm text-zinc-700 cursor-pointer">
             <option value="todas">Toda decisão</option>
             {DECISIONS.map((d) => <option key={d.id} value={d.id}>{d.sigla} — {d.label.replace(' à {empresa}', '')}</option>)}
             <option value="sem">Sem decisão</option>
           </select>
           {props.mostrarAlternanciaView && (
             <div className="flex rounded-xl border border-zinc-200 overflow-hidden">
               {([['cards', 'ri-layout-grid-line', 'Cards'], ['tabela', 'ri-table-line', 'Tabela']] as const).map(([v, icon, label]) => (
                 <button key={v} onClick={() => props.onViewChange(v)} title={label}
                   className={`px-3 h-10 text-sm cursor-pointer ${props.view === v ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:text-zinc-800'}`}>
                   <i className={icon} />
                 </button>
               ))}
             </div>
           )}
         </div>

         {props.modoKanban ? (
           <Kanban items={props.buscados} stages={props.stages} companies={props.companies} mostrarEmpresa={props.mostrarEmpresa}
             proximaEntrevista={props.proximaEntrevista} onOpen={props.onOpen} onMove={props.onMove}
             aderenciaDe={props.aderenciaDe} faltasDe={props.faltasDe} agendamentoIADe={props.agendamentoIADe} />
         ) : (
           <>
             <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
               {[{ id: 'todas', name: 'Todas' }, ...props.stages].map((s) => (
                 <button key={s.id} onClick={() => props.onFaseFiltroChange(s.id)}
                   className={`px-3 h-8 rounded-full text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors ${
                     props.faseFiltro === s.id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}>
                   {s.name} <span className="opacity-60">{props.counts[s.id] ?? 0}</span>
                 </button>
               ))}
             </div>
             {props.filtrados.length === 0 ? (
               <div className="py-16 text-center text-zinc-400">
                 <i className="ri-inbox-line text-4xl" />
                 <p className="text-sm font-semibold mt-2">{props.daEmpresa.length ? 'Nenhum candidato com esses filtros' : 'Nenhum currículo ainda'}</p>
               </div>
             ) : (
               <CandidatosLista view={props.view} items={props.filtrados} companies={props.companies} stages={props.stages} mostrarEmpresa={props.mostrarEmpresa}
                 distancia={props.distanciaLista} vagasDe={props.vagasDe} proximaEntrevista={props.proximaEntrevista} ultimaAvaliacao={props.ultimaAvaliacao}
                 onOpen={props.onOpen} aderenciaDe={props.aderenciaDe} faltasDe={props.faltasDe} />
             )}
           </>
         )}
       </>
     );
   }
   ```
   Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos; `<Kanban>`/`<CandidatosLista>` recebem exatamente as mesmas props de hoje (incluindo `aderenciaDe`/`faltasDe`/`agendamentoIADe`, já existentes em `page.tsx` desde T02/T18), só repassadas via `props.` em vez de variáveis do escopo do componente.

6. **`page.tsx` — calcular os dois booleanos e trocar o branch `else` (origem verbatim `page.tsx:687-738` do As Is pré-Fases 1/2, mesmo aviso do Step 5 — o que resta no `else` depois de T03 já não tem mais a faixa de upload).** No corpo do componente, perto de `mostrarEmpresa`/`sel` (`page.tsx:507-508` do As Is), acrescentar:
   ```ts
   const modoKanban = aba === 'kanban';
   const mostrarAlternanciaView = aba === 'candidatos';
   ```
   Trocar o `else` inteiro (que hoje começa com `<>{/* Área de soltar */}...` antes de T03 e, depois de T03, começa direto em `{/* Busca... */}`) por:
   ```tsx
   ) : (
     <AreaCandidatos
       busca={busca} onBuscaChange={setBusca}
       decisaoFiltro={decisaoFiltro} onDecisaoFiltroChange={setDecisaoFiltro}
       view={view} onViewChange={setView}
       mostrarAlternanciaView={mostrarAlternanciaView} modoKanban={modoKanban}
       items={items} buscados={buscados} filtrados={filtrados} daEmpresa={daEmpresa}
       stages={stages} companies={companies} mostrarEmpresa={mostrarEmpresa}
       faseFiltro={faseFiltro} onFaseFiltroChange={setFaseFiltro} counts={counts}
       proximaEntrevista={proximaEntrevista} ultimaAvaliacao={ultimaAvaliacao}
       distanciaLista={distanciaLista} vagasDe={vagasDe}
       aderenciaDe={aderenciaDe} faltasDe={faltasDe} agendamentoIADe={agendamentoIADe}
       onOpen={setSelId}
       onMove={(id, stageId) => { const c = items.find((x) => x.id === id); if (c && c.stage_id !== stageId) updateCandidate(id, { stage_id: stageId }); }}
     />
   )}
   ```
   Importar `AreaCandidatos` de `./areas/AreaCandidatos`; remover de `page.tsx` os imports que só serviam a este bloco (`CandidatosLista` de `page.tsx:25`, `Kanban` de `page.tsx:31`, `DECISIONS` de `page.tsx:18` — conferir se `DECISIONS` não é usado em mais nenhum lugar de `page.tsx` antes de remover). Rodar `tsc` isolado (≤ 287) e conferir visualmente as duas abas (Candidatos: cards, tabela, busca, filtro de decisão, chips de fase; Kanban: colunas, arrastar).

7. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **520 ou mais** (mesmo total de depois de T07 — esta task não cria nem apaga teste), 0 failed; `src/test/components/entrevistasDoDia.test.tsx` verde.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] **As 9 abas de hoje mostram exatamente a mesma tela antes e depois** (checklist — conferir visualmente cada uma, já que `tsc` pega prop faltando mas não pega prop passada com valor errado):
  - [ ] `entrevistas` — via `AreaEntrevistas` → `EntrevistasDoDia`, idêntica, `focoEntrevista`/`onFocoUsado` funcionando.
  - [ ] `candidatos` (cards) — via `AreaCandidatos`, idêntica.
  - [ ] `candidatos` (tabela) — via `AreaCandidatos`, idêntica.
  - [ ] `vagas` — inalterada (branch não tocado nesta task).
  - [ ] `kanban` — via `AreaCandidatos` (`modoKanban`), idêntica.
  - [ ] `agenda` — inalterada (branch não tocado nesta task).
  - [ ] `agendamentos` — inalterada (branch não tocado nesta task).
  - [ ] `relatorios` — inalterada (branch não tocado nesta task).
  - [ ] `links` — inalterada (branch não tocado nesta task).
  - [ ] `config` — via `AreaConfiguracoes`, idêntica.
- [ ] Os 3 componentes novos existem com as assinaturas exatas de **Interfaces**; nenhum importa `page.tsx` nem `Aba`/`ABAS`.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] **`npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.**
- [ ] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos.
- [ ] Nada desapareceu (Constraint 11): as 9 abas continuam existindo e fazendo exatamente o que faziam; só a organização interna do arquivo mudou.
- [ ] Rastreio: RF-01/US-01/US-07 (preparação — a navegação nova em si é T09).

---

## T09: Navegação de 5 áreas + engrenagem + compatibilidade

> **Aviso sobre números de linha:** as linhas de `page.tsx` citadas nesta task são do As Is medido em **2026-09-20, antes das Fases 1 e 2**. Depois de T02/T03/T08/T18, os números deslizaram — **localize cada trecho pelo conteúdo citado**, não pelo número.

| Campo | Valor |
|---|---|
| **Entregável** | Barra de 5 áreas + engrenagem (RF-01); `AreaEntrevistas` com 3 sub-abas (RF-05); Candidatos com 3 modos (Cards/Tabela/Kanban); compatibilidade completa de `?aba=`/localStorage (RF-01, US-07) |
| **Onde** | `src/pages/contratacao/page.tsx` (modificar), `src/pages/contratacao/areas/AreaEntrevistas.tsx` (modificar), `src/pages/contratacao/areas/AreaCandidatos.tsx` (modificar) |
| **Depende de** | T07 (`navegacao.ts`), T08 (os 3 componentes `areas/*`) |
| **Bloqueia** | T10 (a engrenagem já existe e abre `AreaConfiguracoes`; T10 acrescenta o menu lateral dentro dela), T11 (a barra de 5 áreas é o chão sobre o qual "vaga por dentro" e o fim de Links WhatsApp são construídos) |
| **Paralelo com** | — (sequencial: depende de T07 e T08, mexe nos mesmos 3 arquivos) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-01, RF-05, US-01, US-02 (preparação — a barra em si; a barra inferior do celular é T15), US-06, US-07 |

### Context pack

- Spec: RF-01 verbatim (`#c-spec-filtrada`) — 5 abas + engrenagem, sem rolagem horizontal em ≥ 1366px, compatibilidade de `?aba=`; RF-05 (sub-abas de Entrevistas, atalho "Ir para a próxima" já existente dentro de `EntrevistasDoDia` — não mexer); US-01, US-06, US-07 (critérios de aceite, viram checklist do DoD); Edge cases (tabela) — os 5 estão cobertos pelos Steps desta task.
- Global Constraints: `#global-constraints` #1 (a barra nova usa **exatamente** o padrão de hoje, amostra E4 — `<button>`/`border-b-2`, mesmas classes), #4 (é o núcleo desta task), #5 (não quebrar rascunho local/tempo real/polling — nenhum deles é tocado, só a camada de navegação por cima), #9 (gate), #10 (`entrevistasDoDia.test.tsx` continua verde e intocado — a task 10 desta task, DoD explícito), #11 (a aba "Links WhatsApp" **é** explicitamente autorizada a desaparecer por esta constraint — "Remover só o que a spec manda... aba 'Links WhatsApp'"; a função reaparece em Configurações › WhatsApp só em T12 — **atenção: esse intervalo é decisão do orquestrador SDD, NÃO foi aprovado pelo dono** (ele está ausente desde 2026-09-20); ver "Intervalo sem a tela de links" abaixo e o item para o `/sdd-05-review`), #12 (sem Radix — sub-abas de Entrevistas usam o mesmo padrão `<button>`/`border-b-2` de E4).
- Padrão do repo: E2 (deep link, `page.tsx:93-109` do As Is), E4 (barra de abas, `page.tsx:563-572` do As Is — padrão único do módulo, reproduzido para a barra de 5 áreas e para as sub-abas de Entrevistas), E5 (cabeçalho e condições por aba, `page.tsx:529-580` do As Is).
- Arquivos vizinhos: `navegacao.ts` (T07 — `Area`, `Destino`, `SubAbaEntrevistas`, `ModoCandidatos`, `AREAS`, `AREA_CONFIG`, `destinoDeAbaAntiga`); `areas/AreaCandidatos.tsx`, `areas/AreaEntrevistas.tsx` (T08 — 1ª versão, evoluídas aqui); `AgendaEntrevistas.tsx`, `AgendamentosPainel.tsx` (usados sem alteração de assinatura, só passam a ser chamados de dentro de `AreaEntrevistas` em vez de `page.tsx`).
- **Não fazer:** não mudar a assinatura de `EntrevistasDoDia`/`AgendaEntrevistas`/`AgendamentosPainel`/`RelatoriosContratacao`/`Vagas` (Constraint do material — nenhum desses 5 muda nesta fase); não tocar em `src/test/components/entrevistasDoDia.test.tsx`; não implementar a área Hoje de verdade (T14) nem a barra inferior do celular (T15) — só preparar o terreno (ver Decisão 3); não remover `LinksWhatsApp.tsx` nem seu conteúdo (só o botão de nav some, o arquivo continua existindo até T11/T12 mexerem nele); não perder a regra `cand && a !== 'agendamentos'` (E2) — traduzir para a sub-aba nova (Decisão 8).

### Decisões tomadas

3. **Área "Hoje" nesta fase e default efetivo.** `destinoDeAbaAntiga` (T07) já devolve `{ area: 'hoje' }` para ausente/inválido — é o contrato final (RF-01). Como `AreaHoje` só nasce em T14, esta task faz `page.tsx` **corrigir** esse destino no momento de aplicá-lo: sempre que o resultado for `area === 'hoje'`, usa `'entrevistas'` no lugar (o "1 clique a mais" citado na tabela de Impactos da spec é assumido até T14/T15 existirem). Isso vale tanto para o estado inicial quanto para o deep link `?aba=` sem valor (RF-01 "ausente" também cai em `hoje`). **Nenhum item novo aparece na barra de 5 áreas por causa disso** — `AREAS` (T07) já lista as 5 corretas, incluindo "Hoje": a barra mostra a aba "Hoje" desde já (RF-01 diz "5 abas"), só que clicar nela hoje não tem conteúdo próprio ainda — **decisão revista:** para não expor uma aba clicável sem tela atrás dela antes de T14 (o que seria pior que "1 clique a mais": seria uma aba morta), a barra desta task usa `AREAS.filter((a) => a.id !== 'hoje')` — 4 áreas visíveis + engrenagem — e a 5ª (Hoje) só entra na barra em T14/T15, quando tiver conteúdo. Isso é temporário e documentado: **T14 remove o `.filter` e some com esta observação.** US-01 ("5 abas") só vale como critério de aceite **a partir de T14/T15** — antes disso é uma etapa intermediária inevitável (não dá para mostrar uma aba sem tela).
7. **Sub-abas de Entrevistas guardam a escolha em estado local de `AreaEntrevistas`** (`useState<SubAbaEntrevistas>('dia')`), não em `localStorage` — a spec não pede persistir a sub-aba entre sessões (RF-05/US-06 só pedem as 3 sub-abas existirem e o conteúdo de cada uma ser o componente de hoje). O deep link (`?aba=agenda`/`?aba=agendamentos`) chega por uma prop `subabaInicial: SubAbaEntrevistas | null` (mesmo padrão de `focoId`/`onFocoUsado` já usado para `focoEntrevista`): `page.tsx` seta `subabaInicial` a partir de `destinoDeAbaAntiga(...).subabaEntrevistas` e `AreaEntrevistas` consome com `useEffect` + `onSubabaInicialUsada()` para não reabrir a mesma sub-aba a cada nova renderização.
8. **Tradução das condições do cabeçalho (E5) para a navegação nova:**
   - `aba !== 'config' && aba !== 'links' && companies.length > 0` (seletor de empresa) → `area !== 'config' && companies.length > 1` — duas mudanças: a cláusula `&& aba !== 'links'` desaparece porque `links` deixou de ser um destino possível de `area` (Constraint 11 autoriza a remoção da aba); e o `> 0` vira **`> 1`**, que é o **briefing §3.8, item (a): "Filtro de empresa no topo só aparece com mais de uma empresa"**. Hoje o seletor aparece já com **uma** empresa cadastrada (`page.tsx:540`, `companies.length > 0`), o que é um seletor de uma opção só — foi isso que o dono pediu para sumir. O `> 1` é exatamente o critério que a variável irmã `mostrarEmpresa` já usa (`page.tsx:508`, `empresaFiltro === 'todas' && companies.length > 1`), então não é número novo: é alinhar as duas. **Correção do orquestrador em 2026-09-20, depois de o gate `cross` apontar que o item (a) do §3.8 não tinha task em nenhuma fase.**
   - `aba !== 'config'` (botão "Adicionar currículos", já restrito por T03 a `aba === 'candidatos' || aba === 'vagas'`) → `area === 'candidatos' || area === 'vagas'`.
   - `semEmpresas && aba !== 'config'` (aviso "Cadastre as empresas...") → `semEmpresas && area !== 'config'`.
   - `onClick={() => setAba('config')}` (botão "Ir para Configurações" do aviso) → `onClick={() => setArea('config')}` — funciona direto porque `'config'` é ao mesmo tempo o id da `Area` e o id de `AREA_CONFIG` (T07, Decisão 3 de T07); não precisa de uma função `abrirConfig()` à parte.
   - `if (cand && a !== 'agendamentos')` (E2, deep link) → `if (cand && dest?.subabaEntrevistas !== 'conversas')` — a condição antiga testava a aba antiga `agendamentos`; a nova testa a sub-aba equivalente (Decisão 7/Step 2).

### Interfaces

**Consumes** (de T07 e T08):
```ts
import { type Area, type Destino, type SubAbaEntrevistas, type ModoCandidatos, AREAS, AREA_CONFIG, destinoDeAbaAntiga } from './navegacao';
import AreaCandidatos from './areas/AreaCandidatos';
import AreaEntrevistas from './areas/AreaEntrevistas';
import AreaConfiguracoes from './areas/AreaConfiguracoes'; // usada como está, T10 mexe nela por dentro
```

**Produces** (assinaturas exatas):
```ts
// page.tsx — troca `type Aba`/`ABAS`/o estado `aba` por:
const [area, setArea] = useState<Area>(/* ver Step 1 */);
const [view, setView] = useState<ModoCandidatos>(/* ver Step 1 — 3 valores agora */);
const [focoSubabaEntrevistas, setFocoSubabaEntrevistas] = useState<SubAbaEntrevistas | null>(null);

// areas/AreaEntrevistas.tsx — Props cresce (Interfaces de T08 +):
interface Props {
  // ...props de T08 inalteradas (EntrevistasDoDia)...
  mostrarEmpresa: boolean;                       // AgendaEntrevistas / AgendamentosPainel
  onOpenInterview: (iv: Interview) => void;      // AgendaEntrevistas
  subabaInicial: SubAbaEntrevistas | null;
  onSubabaInicialUsada: () => void;
}

// areas/AreaCandidatos.tsx — Props troca os 2 booleanos de T08 por 1 campo:
interface Props {
  // ...props de T08 inalteradas, EXCETO:
  view: ModoCandidatos;         // era 'cards' | 'tabela'
  onViewChange: (v: ModoCandidatos) => void;
  // mostrarAlternanciaView e modoKanban SAEM daqui (T08) — não existem mais
}
```

### Steps

1. **`page.tsx` — trocar o estado de navegação.** Remover `interface QueueItem`/`type Aba`/`const ABAS`/`lsGet`/`lsSet` **não** — `lsGet`/`lsSet` continuam (são genéricos); só `type Aba` e `const ABAS` (`page.tsx:37,43-53` do As Is) são removidos. Substituir a declaração de `aba`/`view` (`page.tsx:78-79` do As Is) por:
   ```ts
   function estadoInicialDeNavegacao(): { area: Area; view: ModoCandidatos } {
     const dest = destinoDeAbaAntiga(lsGet('contratacao_aba'));
     return {
       // 'hoje' ainda não existe como tela (T14) — cai em 'entrevistas' até lá (Decisão 3).
       area: dest.area === 'hoje' ? 'entrevistas' : dest.area,
       view: dest.modoCandidatos ?? (lsGet('contratacao_view') === 'tabela' ? 'tabela' : lsGet('contratacao_view') === 'kanban' ? 'kanban' : 'cards'),
     };
   }
   // dentro do componente:
   const [area, setArea] = useState<Area>(() => estadoInicialDeNavegacao().area);
   const [view, setView] = useState<ModoCandidatos>(() => estadoInicialDeNavegacao().view);
   const [focoSubabaEntrevistas, setFocoSubabaEntrevistas] = useState<SubAbaEntrevistas | null>(null);
   ```
   Trocar os dois `useEffect` de persistência (`page.tsx:111-112` do As Is) por:
   ```ts
   useEffect(() => { lsSet('contratacao_view', view); }, [view]);
   useEffect(() => { lsSet('contratacao_aba', area); }, [area]);
   ```
   Importar `type Area, type Destino, type SubAbaEntrevistas, type ModoCandidatos, AREAS, AREA_CONFIG, destinoDeAbaAntiga` de `./navegacao`. Invariante: mesmo padrão de `useState(() => ...)`/`useEffect` de persistência já usado no arquivo — só a fonte do valor muda (função pura em vez de comparação direta contra uma lista fixa).

2. **`page.tsx` — deep link (origem verbatim `page.tsx:93-109` do As Is, amostra E2).** Trocar:
   ```tsx
   useEffect(() => {
     const a = searchParams.get('aba');
     const ent = searchParams.get('entrevista');
     const cand = searchParams.get('candidato');
     if (!a && !ent && !cand) return;
     if (a && ABAS.some((x) => x.id === a)) setAba(a as Aba);
     if (ent) {
       setFocoEntrevista(ent);
       setEmpresaFiltro('todas');
     }
     if (cand && a !== 'agendamentos') setSelId(cand);
     setSearchParams({}, { replace: true });
   }, [searchParams, setSearchParams]);
   ```
   por:
   ```tsx
   useEffect(() => {
     const a = searchParams.get('aba');
     const ent = searchParams.get('entrevista');
     const cand = searchParams.get('candidato');
     if (!a && !ent && !cand) return;
     const dest: Destino | null = a ? destinoDeAbaAntiga(a) : null;
     if (dest) {
       setArea(dest.area === 'hoje' ? 'entrevistas' : dest.area); // Decisão 3 — Hoje só a partir de T14
       if (dest.subabaEntrevistas) setFocoSubabaEntrevistas(dest.subabaEntrevistas);
       if (dest.modoCandidatos) setView(dest.modoCandidatos);
     }
     if (ent) {
       setFocoEntrevista(ent);
       // Com filtro de outra empresa a entrevista não apareceria na lista.
       setEmpresaFiltro('todas');
     }
     // Em Conversas da IA (sub-aba de Entrevistas, antes aba própria "agendamentos") o
     // candidato só dá contexto; abrir a ficha por cima esconderia o pedido.
     if (cand && dest?.subabaEntrevistas !== 'conversas') setSelId(cand);
     setSearchParams({}, { replace: true });
   }, [searchParams, setSearchParams]);
   ```
   Invariante: mesmo formato de efeito único disparado por `searchParams` — só a tradução `a → dest` entra no meio; o comportamento de `ent`/`cand` é preservado (Decisão 8, último item).

3. **`page.tsx` — barra de áreas (origem verbatim `page.tsx:563-572` do As Is, amostra E4).** Trocar:
   ```tsx
   <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
     {ABAS.map((t) => (
       <button key={t.id} onClick={() => setAba(t.id)}
         className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
           aba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
         <i className={t.icon} /> {t.label}
       </button>
     ))}
   </div>
   ```
   por (mesmo padrão de `<button>`, 4 áreas visíveis — "Hoje" some do `.filter` até T14, Decisão 3 — mais a engrenagem, ícone só, empurrada para o fim da barra com `ml-auto`):
   ```tsx
   <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
     {AREAS.filter((a) => a.id !== 'hoje').map((t) => (
       <button key={t.id} onClick={() => setArea(t.id)}
         className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
           area === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
         <i className={t.icon} /> {t.label}
       </button>
     ))}
     <button onClick={() => setArea('config')} title={AREA_CONFIG.label}
       className={`flex items-center justify-center w-10 h-10 -mb-px border-b-2 cursor-pointer ml-auto flex-shrink-0 ${
         area === 'config' ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
       <i className={AREA_CONFIG.icon} />
     </button>
   </div>
   ```
   Invariante: mesmas classes de `<button>`/`border-b-2`/cores ativas de hoje (E4) — a engrenagem reaproveita a mesma família de classes, só sem o `<span>` de texto (RF-01: "5 abas... + ícone de engrenagem", os dois elementos são visualmente distintos por design da própria spec, não por classe nova) e com `ml-auto` para ficar no fim da barra (utilitário Tailwind já usado no repo, não é design novo).

4. **`page.tsx` — cabeçalho (origem verbatim `page.tsx:529-580` do As Is, amostra E5).** Aplicar as 4 traduções da Decisão 8: `aba !== 'config' && aba !== 'links' && companies.length > 0` → `area !== 'config' && companies.length > 1` (atenção ao **`> 1`**: é o briefing §3.8(a), "filtro de empresa só aparece com mais de uma empresa" — ver Decisão 8); `aba !== 'config'` (botão upload, já `aba === 'candidatos' || aba === 'vagas'` desde T03) → `area === 'candidatos' || area === 'vagas'`; `semEmpresas && aba !== 'config'` → `semEmpresas && area !== 'config'`; `onClick={() => setAba('config')}` → `onClick={() => setArea('config')}`. Invariante: mesmas classes/textos/ícones — só a condição booleana muda de fonte (`area` no lugar de `aba`).

5. **`areas/AreaEntrevistas.tsx` — acrescentar as sub-abas.** Reescrever o corpo (mantendo a chamada a `EntrevistasDoDia` do Step 3 de T08 intacta) para:
   ```tsx
   import { useEffect, useState } from 'react';
   import EntrevistasDoDia from '../components/EntrevistasDoDia';
   import AgendaEntrevistas from '../components/AgendaEntrevistas';
   import AgendamentosPainel from '../components/AgendamentosPainel';
   import type { Application, Candidate, Company, Interview, Job, Settings, Stage } from '../shared';
   import type { CandidatePatch } from '../components/EntrevistaModal';
   import type { SubAbaEntrevistas } from '../navegacao';

   interface Props {
     interviews: Interview[]; candidates: Candidate[]; companies: Company[]; stages: Stage[]; settings: Settings;
     applications: Application[]; jobs: Job[]; mostrarEmpresa: boolean;
     onSaved: (iv: Interview, candidatePatch?: CandidatePatch) => void;
     onOpenCandidate: (id: string) => void;
     onOpenInterview: (iv: Interview) => void;
     onNewInterview: (date: string) => void;
     focoId: string | null;
     onFocoUsado: () => void;
     subabaInicial: SubAbaEntrevistas | null;
     onSubabaInicialUsada: () => void;
   }

   const SUBABAS: { id: SubAbaEntrevistas; label: string; icon: string }[] = [
     { id: 'dia', label: 'Do dia', icon: 'ri-calendar-event-line' },
     { id: 'calendario', label: 'Calendário', icon: 'ri-calendar-2-line' },
     { id: 'conversas', label: 'Conversas da IA', icon: 'ri-chat-check-line' },
   ];

   export default function AreaEntrevistas(props: Props) {
     const [subaba, setSubaba] = useState<SubAbaEntrevistas>('dia');
     useEffect(() => {
       if (props.subabaInicial) { setSubaba(props.subabaInicial); props.onSubabaInicialUsada(); }
     }, [props.subabaInicial]);

     return (
       <>
         <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
           {SUBABAS.map((t) => (
             <button key={t.id} onClick={() => setSubaba(t.id)}
               className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
                 subaba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
               <i className={t.icon} /> {t.label}
             </button>
           ))}
         </div>
         {subaba === 'dia' ? (
           <EntrevistasDoDia interviews={props.interviews} candidates={props.candidates} companies={props.companies} stages={props.stages}
             settings={props.settings} applications={props.applications} jobs={props.jobs} onSaved={props.onSaved} onOpenCandidate={props.onOpenCandidate}
             onNewInterview={props.onNewInterview} focoId={props.focoId} onFocoUsado={props.onFocoUsado} />
         ) : subaba === 'calendario' ? (
           <AgendaEntrevistas interviews={props.interviews} candidates={props.candidates} companies={props.companies} mostrarEmpresa={props.mostrarEmpresa}
             onOpenInterview={props.onOpenInterview} onNew={props.onNewInterview} />
         ) : (
           <AgendamentosPainel candidates={props.candidates} jobs={props.jobs} companies={props.companies} stages={props.stages}
             mostrarEmpresa={props.mostrarEmpresa} onOpenCandidate={props.onOpenCandidate} />
         )}
       </>
     );
   }
   ```
   Invariante: `EntrevistasDoDia`/`AgendaEntrevistas`/`AgendamentosPainel` recebem exatamente as props que recebiam em `page.tsx` (E3, e os branches `agenda`/`agendamentos` do As Is) — mesmas classes/ícones/textos na barra de sub-abas (mesmo padrão E4). **`entrevistasDoDia.test.tsx` continua verde** — ele renderiza `EntrevistasDoDia` direto, não passa por aqui.

6. **`page.tsx` — remover os branches `agenda`/`agendamentos` e ligar `AreaEntrevistas` com as novas props (origem verbatim dos branches `page.tsx:604-622` do As Is: `links`/`entrevistas`/`agenda`/`agendamentos`).** Remover o branch `aba === 'links'` inteiro (Constraint 11 autoriza — Context pack); remover os branches `aba === 'agenda'` e `aba === 'agendamentos'` (o conteúdo deles migrou para dentro de `AreaEntrevistas`, Step 5); a condição do branch de Entrevistas passa a ser `area === 'entrevistas'` chamando:
   ```tsx
   ) : area === 'entrevistas' ? (
     <AreaEntrevistas interviews={ivsDaEmpresa} candidates={items} companies={companies} stages={stages} settings={settings}
       applications={applications} jobs={jobs} mostrarEmpresa={mostrarEmpresa}
       onSaved={onInterviewSaved} onOpenCandidate={setSelId}
       onOpenInterview={(iv) => setModal({ interview: iv })}
       onNewInterview={(date) => setModal({ interview: null, date })}
       focoId={focoEntrevista} onFocoUsado={() => setFocoEntrevista(null)}
       subabaInicial={focoSubabaEntrevistas} onSubabaInicialUsada={() => setFocoSubabaEntrevistas(null)} />
   ```
   Remover o import de `LinksWhatsApp` de `page.tsx` (o arquivo `LinksWhatsApp.tsx` continua existindo, só não é mais chamado daqui — T11/T12 decidem o destino final dele). Trocar `aba === 'vagas'`/`aba === 'relatorios'`/`aba === 'config'` (branches inalterados, só a variável) por `area === 'vagas'`/`area === 'relatorios'`/`area === 'config'`.

7. **`page.tsx` — ligar `AreaCandidatos` com `view` de 3 modos (o branch final `else`, criado por T08).** Trocar a chamada de T08:
   ```tsx
   mostrarAlternanciaView={mostrarAlternanciaView} modoKanban={modoKanban}
   ```
   por (remove as duas linhas de `const modoKanban`/`const mostrarAlternanciaView` do Step 6 de T08 — não existem mais):
   ```tsx
   view={view} onViewChange={setView}
   ```
   (o restante das props de `AreaCandidatos` continua igual). Invariante: `view` agora tem 3 valores possíveis; `AreaCandidatos` decide internamente (Step 8) se mostra `Kanban` ou `CandidatosLista`+chips a partir de `view === 'kanban'`.

8. **`areas/AreaCandidatos.tsx` — trocar os 2 booleanos por `view` de 3 modos e acrescentar o 3º botão do alternador.** Trocar a assinatura (`mostrarAlternanciaView`/`modoKanban` saem, `view`/`onViewChange` mudam de tipo — ver **Interfaces**); trocar o alternador de 2 para 3 botões:
   ```tsx
   {([['cards', 'ri-layout-grid-line', 'Cards'], ['tabela', 'ri-table-line', 'Tabela'], ['kanban', 'ri-layout-column-line', 'Kanban']] as const).map(([v, icon, label]) => (
     <button key={v} onClick={() => props.onViewChange(v)} title={label}
       className={`px-3 h-10 text-sm cursor-pointer ${props.view === v ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:text-zinc-800'}`}>
       <i className={icon} />
     </button>
   ))}
   ```
   sempre visível (Candidatos é uma área só agora, com 3 modos — não há mais um "modo kanban só existe fora do alternador"; remover o `{props.mostrarAlternanciaView && (...)}` que envolvia o bloco). Trocar `{props.modoKanban ? <Kanban .../> : (...)}` por `{props.view === 'kanban' ? <Kanban .../> : (...)}` — o TypeScript estreita `props.view` para `'cards' | 'tabela'` no `else`, compatível com a prop `view` de `CandidatosLista` sem cast. Ícone `ri-layout-column-line` reaproveitado do antigo item `kanban` de `ABAS` (`page.tsx:47` do As Is). Invariante: mesmas classes do alternador de hoje, só um botão a mais, mesmo ícone que a aba Kanban já usava.

9. **`page.tsx` — remover `type Aba`/`ABAS` de vez** (se algum uso restar fora dos Steps já cobertos, remover; ele não é mais referenciado por nada no arquivo depois dos Steps 1-8). Rodar `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — se subir acima de 287, é sinal de referência esquecida a `aba`/`Aba`/`ABAS`.

10. Rodar o gate completo (Constraint 9):
    - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
    - `npx vitest run` — esperado **520 ou mais** (mesmo total desde T07 — esta task não cria nem apaga teste), 0 failed.
    - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não editado.
    - `npx vite build` — exit 0, sem erro.
    - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Barra mostra Candidatos, Vagas, Entrevistas, Relatórios + engrenagem (4 + engrenagem nesta task; "Hoje" entra na barra em T14/T15 — Decisão 3, documentada, não é regressão).
- [ ] Nenhuma rolagem horizontal na barra em viewport ≥ 1366px (US-01) — conferir visualmente em 1366px e 1365px (edge case da spec).
- [ ] Engrenagem abre `AreaConfiguracoes` (mesmos cards de hoje, ainda empilhados — o menu lateral é T10).
- [ ] Entrevistas mostra as 3 sub-abas (Do dia / Calendário / Conversas da IA); Do dia = `EntrevistasDoDia` intacta; Calendário = `AgendaEntrevistas` intacta; Conversas = `AgendamentosPainel` intacta (US-06).
- [ ] Candidatos mostra o alternador de 3 modos (Cards/Tabela/Kanban); Kanban tem o mesmo conteúdo de antes (chips de aderência/vaga/falta/agendamento IA de T02/T18 continuam aparecendo).
- [ ] `?aba=kanban` → Candidatos, modo Kanban; `?aba=agenda` → Entrevistas › Calendário; `?aba=agendamentos` → Entrevistas › Conversas da IA; `?aba=links`/`?aba=config` → Configurações; `localStorage contratacao_aba` respeita valores antigos (testar manualmente gravando `kanban`/`agenda`/`agendamentos`/`links` antes de abrir a tela); `focoEntrevista` abre a ficha + Entrevistas › Do dia com a entrevista em destaque (US-07).
- [ ] Aparelho com `contratacao_aba='kanban'` gravado antes desta task: ao abrir, cai em Candidatos/modo Kanban (não em branco, não em erro) — Decisão de T07/T09 sobre compatibilidade.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] **`npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.**
- [ ] Visual inalterado — reaproveitou classes/componentes existentes (mesmo padrão de abas E4, mesmas cores), não criou novos.
- [ ] Nada desapareceu (Constraint 11) além do explicitamente autorizado (aba "Links WhatsApp" — a função volta em Configurações › WhatsApp, T12).
- [ ] **Filtro de empresa no topo só aparece com mais de uma empresa** (briefing §3.8(a)): com **1** empresa cadastrada o `<select>` "Todas as empresas" **não** aparece; com **2 ou mais**, aparece igual a hoje. Conferir os dois casos na tela (a loja de teste tem quantas empresas? criar uma segunda `hiring_companies` de teste se precisar — nunca mexer nas empresas reais).
- [ ] Rastreio: RF-01, RF-05, US-01, US-06, US-07 cobertos; US-02 preparado (barra inferior é T15); briefing §3.8(a) coberto.

---

## T10: Configurações na engrenagem com menu lateral

> **Aviso sobre números de linha:** as linhas de `ConfiguracoesContratacao.tsx` citadas aqui foram conferidas no arquivo real (não sofrem o mesmo deslize de `page.tsx`, porque nenhuma task anterior desta spec o modifica — só T10). As linhas de `page.tsx` não se aplicam a esta task (não a toca).

| Campo | Valor |
|---|---|
| **Entregável** | `AreaConfiguracoes` com menu lateral (desktop) / lista (celular) mostrando um card por vez: Empresas, Fases, Dados mínimos, Entrevista (o 5º item, WhatsApp, entra em T12) |
| **Onde** | `src/pages/contratacao/components/ConfiguracoesContratacao.tsx` (modificar), `src/pages/contratacao/areas/AreaConfiguracoes.tsx` (modificar) |
| **Depende de** | T09 (a engrenagem já abre `AreaConfiguracoes`) |
| **Bloqueia** | T12 (acrescenta o 5º item, WhatsApp, ao mesmo menu) |
| **Paralelo com** | — (sequencial, fecha a Fase 3) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-07, US-01 |

### Context pack

- Spec: RF-07 verbatim (`#c-spec-filtrada`) — "Menu lateral (celular = lista): Empresas, Fases, Dados mínimos, Entrevista, WhatsApp. Mesmos cards de hoje, um por vez." US-01 (`[ ] Engrenagem abre Configurações (mesmos cards de hoje)`).
- Global Constraints: `#global-constraints` #1 (nenhuma classe/ícone/texto novo além do estritamente necessário para o menu — que não existia antes; reaproveitar o padrão de indicador ativo de aba, E4, adaptado de horizontal para vertical, e o tom `bg-rose-50`/`border-rose-200` já usado no cabeçalho do módulo, `page.tsx:530` do As Is), #9 (gate), #11 ("nada dentro dos cards muda" — os 4 `Card`s continuam produzindo exatamente o mesmo HTML de hoje, só um por vez em vez de empilhados), #12 (sem Radix — menu é `<button>` + estado local).
- Padrão do repo: os 4 cards já são funções separadas em `ConfiguracoesContratacao.tsx` (Mapa de arquivos, linha `ConfiguracoesContratacao.tsx`) — `Empresas` (`:43-158`), `Fases` (`:163-229`), `DadosMinimos` (`:257-346`), `FichaEConvite` (`:351-481`, título do `Card` "Entrevistas" — o item do menu usa o rótulo "Entrevista" da spec, RF-07, sem mudar o `titulo` do `Card` em si); o empilhamento de hoje é `ConfiguracoesContratacao.tsx:25-33` (conferido no arquivo). Padrão "celular empilha, desktop lado a lado": `flex flex-col sm:flex-row` já usado amplamente no repo (ex. `src/pages/cardapio/components/CategoriasTab.tsx:108`).
- Arquivos vizinhos: `navegacao.ts` (T07 — `SecaoConfig`, hoje com 4 valores; T12 acrescenta `'whatsapp'`); `areas/AreaConfiguracoes.tsx` (T08 — wrapper 1:1 que esta task substitui pela versão com menu).
- **Não fazer:** não mudar nada dentro de `Empresas`/`Fases`/`DadosMinimos`/`FichaEConvite` (só a forma de renderizá-los, um por vez); não exportar as 4 funções (usar a prop `secao` em vez disso — decisão abaixo, mais simples e sem aumentar a superfície pública do módulo); não criar o item "WhatsApp" no menu nem a seção correspondente (T12); não introduzir Radix (Tabs/Accordion) para o menu; não mudar `titulo`/`desc` de nenhum `Card`.

### Decisões tomadas

9. **`AreaConfiguracoes` guarda a seção escolhida em estado local** (`useState<SecaoConfig>('empresas')`), sem persistir em `localStorage` (RF-07 não pede lembrar a última seção entre sessões — diferente da aba principal, que tem esse requisito histórico via `contratacao_aba`). Default = `'empresas'` (1º item da lista, mesma ordem de hoje). No celular, a spec pede "lista" — decisão: **não é uma tela de lista separada com navegação para outra tela** (isso exigiria um componente de navegação novo, fora do padrão do módulo); é o mesmo menu, só que empilhado verticalmente **acima** do conteúdo em vez de ao lado (`flex flex-col sm:flex-row`, padrão já citado) — no celular o menu vira uma faixa de botões com rolagem horizontal se necessário (mesma classe `overflow-x-auto` já usada na barra de abas principal, E4) por cima do card ativo; no desktop vira uma coluna estreita à esquerda (`sm:w-48 sm:flex-col`). "Menu lateral (desktop) / lista (celular)" da spec é satisfeito pela mudança de eixo do `flex`, não por dois componentes diferentes.
   - **Escolha de estilo do item do menu:** reaproveita a mesma família de classes do indicador ativo das abas (E4: `border-rose-600 text-rose-700` para o ativo, `border-transparent text-zinc-500 hover:text-zinc-800` para o inativo), mudando só o lado da borda (`border-l-2` em vez de `border-b-2`, coerente com a orientação vertical do menu) e acrescentando o tom de fundo `bg-rose-50/60` já usado no módulo (`page.tsx:530` do As Is, `bg-rose-50 border border-rose-200` no ícone do cabeçalho) para o item ficar legível também no celular (onde a borda lateral sozinha, numa lista compacta, é pouco visível). Mesma paleta (`rose`), nenhuma classe fora do que já circula no módulo.

### Interfaces

**Consumes** (de T07):
```ts
import type { SecaoConfig } from '../navegacao'; // T07 — 4 valores nesta task; T12 acrescenta 'whatsapp'
```

**Produces** (assinatura exata — consumida por T12):
```ts
// components/ConfiguracoesContratacao.tsx — Props ganha `secao` opcional
interface Props {
  companies: Company[]; stages: Stage[]; settings: Settings; candidates: Candidate[];
  onReload: () => Promise<void>; onSettingsSaved: (s: Settings) => void; onRecalcCompany: (companyId: string) => Promise<void>;
  secao?: SecaoConfig; // undefined = comportamento antigo (empilha os 4) — mantido para não quebrar quem ainda chamar sem secao
}
export default function ConfiguracoesContratacao(props: Props): JSX.Element

// areas/AreaConfiguracoes.tsx — Props (herdada de T08, inalterada); ganha estado interno `secao`
// e a lista de itens do menu (T12 acrescenta o 5º):
const ITENS_MENU: { id: SecaoConfig; label: string; icon: string }[]; // 4 itens nesta task
```

### Steps

1. **`ConfiguracoesContratacao.tsx` — acrescentar `secao?: SecaoConfig` à `Props` e ramificar o corpo (origem verbatim `:14-33`, conferido no arquivo).** Trocar:
   ```tsx
   interface Props {
     companies: Company[];
     stages: Stage[];
     settings: Settings;
     candidates: Candidate[];
     onReload: () => Promise<void>;
     onSettingsSaved: (s: Settings) => void;
     onRecalcCompany: (companyId: string) => Promise<void>;
   }

   export default function ConfiguracoesContratacao({ companies, stages, settings, candidates, onReload, onSettingsSaved, onRecalcCompany }: Props) {
     return (
       <div className="space-y-5 max-w-3xl">
         <Empresas companies={companies} candidates={candidates} onReload={onReload} onRecalcCompany={onRecalcCompany} />
         <Fases stages={stages} candidates={candidates} onReload={onReload} />
         <DadosMinimos settings={settings} candidates={candidates} stages={stages} onSaved={onSettingsSaved} />
         <FichaEConvite settings={settings} onSaved={onSettingsSaved} />
       </div>
     );
   }
   ```
   por:
   ```tsx
   import type { SecaoConfig } from '../navegacao';

   interface Props {
     companies: Company[];
     stages: Stage[];
     settings: Settings;
     candidates: Candidate[];
     onReload: () => Promise<void>;
     onSettingsSaved: (s: Settings) => void;
     onRecalcCompany: (companyId: string) => Promise<void>;
     /** undefined = comportamento antigo, empilha os 4 cards (compatibilidade). */
     secao?: SecaoConfig;
   }

   export default function ConfiguracoesContratacao({ companies, stages, settings, candidates, onReload, onSettingsSaved, onRecalcCompany, secao }: Props) {
     if (!secao) {
       return (
         <div className="space-y-5 max-w-3xl">
           <Empresas companies={companies} candidates={candidates} onReload={onReload} onRecalcCompany={onRecalcCompany} />
           <Fases stages={stages} candidates={candidates} onReload={onReload} />
           <DadosMinimos settings={settings} candidates={candidates} stages={stages} onSaved={onSettingsSaved} />
           <FichaEConvite settings={settings} onSaved={onSettingsSaved} />
         </div>
       );
     }
     return (
       <div className="max-w-3xl">
         {secao === 'empresas' && <Empresas companies={companies} candidates={candidates} onReload={onReload} onRecalcCompany={onRecalcCompany} />}
         {secao === 'fases' && <Fases stages={stages} candidates={candidates} onReload={onReload} />}
         {secao === 'dados-minimos' && <DadosMinimos settings={settings} candidates={candidates} stages={stages} onSaved={onSettingsSaved} />}
         {secao === 'entrevista' && <FichaEConvite settings={settings} onSaved={onSettingsSaved} />}
       </div>
     );
   }
   ```
   Invariante: os 4 `Card`s (`Empresas`/`Fases`/`DadosMinimos`/`FichaEConvite`) não são tocados por dentro — só a função que os empilha ganha um segundo modo de renderização (um por vez). O modo `!secao` fica como rede de segurança (nenhum outro arquivo desta spec chama `ConfiguracoesContratacao` sem `secao` depois de T10, mas remover essa opção não é pedido por nenhum RF, e mantê-la custa 4 linhas).

2. **`areas/AreaConfiguracoes.tsx` — trocar o wrapper 1:1 de T08 pelo menu.** Corpo completo:
   ```tsx
   import { useState } from 'react';
   import ConfiguracoesContratacao from '../components/ConfiguracoesContratacao';
   import type { Candidate, Company, Settings, Stage } from '../shared';
   import type { SecaoConfig } from '../navegacao';

   interface Props {
     companies: Company[]; stages: Stage[]; settings: Settings; candidates: Candidate[];
     onReload: () => Promise<void>; onSettingsSaved: (s: Settings) => void; onRecalcCompany: (companyId: string) => Promise<void>;
   }

   // 5º item (WhatsApp) entra em T12, quando SecaoConfig ganha 'whatsapp' (navegacao.ts).
   const ITENS_MENU: { id: SecaoConfig; label: string; icon: string }[] = [
     { id: 'empresas', label: 'Empresas', icon: 'ri-building-line' },
     { id: 'fases', label: 'Fases', icon: 'ri-layout-column-line' },
     { id: 'dados-minimos', label: 'Dados mínimos', icon: 'ri-file-list-3-line' },
     { id: 'entrevista', label: 'Entrevista', icon: 'ri-chat-voice-line' },
   ];

   export default function AreaConfiguracoes(props: Props) {
     const [secao, setSecao] = useState<SecaoConfig>('empresas');
     return (
       <div className="flex flex-col sm:flex-row gap-5">
         <nav className="flex flex-row sm:flex-col gap-1 overflow-x-auto sm:overflow-visible sm:w-48 flex-shrink-0 border-b sm:border-b-0 sm:border-r border-zinc-200 pb-2 sm:pb-0 sm:pr-3">
           {ITENS_MENU.map((item) => (
             <button key={item.id} onClick={() => setSecao(item.id)}
               className={`flex items-center gap-2 px-3 h-10 border-l-2 -ml-px text-sm font-bold whitespace-nowrap cursor-pointer text-left flex-shrink-0 ${
                 secao === item.id ? 'border-rose-600 text-rose-700 bg-rose-50/60' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
               <i className={item.icon} /> {item.label}
             </button>
           ))}
         </nav>
         <div className="flex-1 min-w-0">
           <ConfiguracoesContratacao {...props} secao={secao} />
         </div>
       </div>
     );
   }
   ```
   Invariante visual: mesma família de classes do indicador ativo de aba (E4: cor `rose-600`/`rose-700` na borda, `zinc-500`/`zinc-800` no inativo), só a borda muda de `border-b-2` para `border-l-2` (orientação vertical) e ganha `bg-rose-50/60` (tom já usado no cabeçalho do módulo, `page.tsx:530` do As Is) para legibilidade também na lista do celular; layout `flex flex-col sm:flex-row` (empilha no celular, lado a lado no desktop) é o mesmo par de classes já usado em `src/pages/cardapio/components/CategoriasTab.tsx:108` para o mesmo problema ("celular empilha, desktop lado a lado").

3. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **520 ou mais** (mesmo total desde T07 — esta task não cria nem apaga teste), 0 failed.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Engrenagem abre o menu com 4 itens (Empresas, Fases, Dados mínimos, Entrevista); clicar em cada um mostra só o card correspondente, sem empilhar os outros 3 (RF-07).
- [ ] Nenhum dado/comportamento de `Empresas`/`Fases`/`DadosMinimos`/`FichaEConvite` mudou — mesmos formulários, mesmos botões Salvar, mesma validação (conferir 1 a 1: cadastrar empresa, reordenar fase, marcar dado mínimo, editar pergunta de entrevista).
- [ ] No celular (< sm), o menu aparece **acima** do card ativo, em linha com rolagem horizontal se não couber; no desktop (≥ sm), aparece como coluna estreita à esquerda — mesma barra de classes citada nos Steps, sem componente novo.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] `npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo (não é tocado por esta task, mas confirmar que a suíte inteira passa).
- [ ] Visual inalterado nos 4 cards — reaproveitou classes/componentes existentes (inclusive o próprio padrão de indicador ativo de aba, adaptado de orientação); o menu em si é a única peça de UI nova desta task, construída só com classes já circulando no módulo (citadas nos Steps).
- [ ] Nada desapareceu (Constraint 11): os 4 cards continuam com o mesmo conteúdo; só passaram a ser mostrados um por vez.
- [ ] Rastreio: RF-07 (4 dos 5 itens — WhatsApp é T12), US-01 (parte "engrenagem abre Configurações").

---

## T11: Vaga por dentro — 4 sub-abas

> **Aviso sobre números de linha:** as linhas de `page.tsx` citadas nesta task são do As Is de **2026-09-20, antes das Fases 1, 2 e 3**. A Fase 3 (T08/T09) já extraiu o roteamento para `areas/*` e trocou `aba`/`ABAS` por `area`/`AREAS`/`AREA_CONFIG`; a Fase 1 (T02/T03) já trocou o botão de upload (`pendingJobRef` não existe mais) e acrescentou `aderenciaDe`/`faltasDe`/`agendamentoIADe`. **Localize todo trecho de `page.tsx` pelo conteúdo citado, nunca pela linha.** Para `Vagas.tsx`, `VagaModal.tsx`, `AgendamentoVaga.tsx` e `LinksWhatsApp.tsx` as linhas citadas foram conferidas no arquivo real em 2026-09-20 e valem (nenhuma fase anterior os toca).
>
> **Achado desta fase que corrige a Tabela da fase/seção C do material do orquestrador:** o material pede uma "regra de segurança" para que a remoção da aba "Links WhatsApp" seja o último Step de T12. Isso já não é possível de cumprir literalmente: **T09 (Fase 3, já escrita e travada) já removeu o branch `aba === 'links'` e o `import LinksWhatsApp` de `page.tsx`** (T09 Step 6, com a justificativa de que a Constraint 11 autoriza essa remoção; a função só reaparece em Configurações › WhatsApp em T12 — **intervalo que é decisão do orquestrador SDD, não aprovação do dono**, ver T07 Decisão 5, T09 Context pack e o item "Intervalo sem a tela de links" registrado para o `/sdd-05-review`). Não há branch/import para remover em T11 nem em T12: o arquivo `LinksWhatsApp.tsx` já está órfão (sem nenhum import em `page.tsx`) desde o fim da Fase 3. A "regra de segurança" desta fase, portanto, vira **checklist de verificação** (DoD de T12): confirmar que os dois destinos novos (`VagaDivulgacao` aqui, `ConfigWhatsApp` em T12) estão funcionando antes de considerar a Fase 4 concluída — não um Step de código.

| Campo | Valor |
|---|---|
| **Entregável** | Vaga por dentro com 4 sub-abas (Candidatos · Divulgação · Agendamento pela IA · Dados da vaga); formulário de `VagaModal` reaproveitado sem o invólucro de modal; fim do toggle "Ver/Esconder dados da vaga" (substituído pela aba "Dados da vaga", que edita em vez de só mostrar) |
| **Onde** | `src/pages/contratacao/components/Vagas.tsx` (modificar), `src/pages/contratacao/components/VagaDetalhe.tsx` (criar), `src/pages/contratacao/components/VagaDivulgacao.tsx` (criar), `src/pages/contratacao/components/VagaModal.tsx` (modificar), `src/pages/contratacao/components/LinksWhatsApp.tsx` (modificar), `src/pages/contratacao/page.tsx` (modificar) |
| **Depende de** | Fase 3 (T07-T10) — consome `area === 'vagas'` já existente em `page.tsx` e o padrão de sub-abas que `AreaEntrevistas` (T09) já estabeleceu |
| **Bloqueia** | T12 (consome `EscopoWhatsApp`/`LinksWhatsApp` modificados aqui e o handler `abrirCandidatoDoBot` criado aqui em `page.tsx`) |
| **Paralelo com** | — (sequencial, abre a Fase 4; T12 depende desta) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-06 (Candidatos/Divulgação/Agendamento pela IA/Dados da vaga), US-05 (parte: botão de upload "e dentro da Vaga") |

### Context pack

- Spec: RF-06 verbatim (`#c-spec-filtrada`) — as 4 sub-abas, "Links WhatsApp deixa de existir (conteúdo move para Divulgação)", a regra de não duplicar listagem entre vaga e Configurações; Briefing §3.4 (o dono: sub-abas + aviso de exclusão de vaga sobre agendamento/link); US-05 (parte: "Botão aparece em Candidatos... e dentro da Vaga").
- Global Constraints: `#global-constraints` #1 (mesmo padrão de sub-abas `<button>`/`border-b-2` de `AreaEntrevistas`, T09, amostra E5 do material desta fase; mesmos cards/classes de `Vagas.tsx`/`VagaModal.tsx`/`LinksWhatsApp.tsx`, nada reescrito), #8 (nada de banco — `bot_channels`/`hiring_job_scheduling` já são lidos hoje, só reorganização de UI), #9 (gate), #11 (nada desaparece: o toggle "Ver dados da vaga" vira a aba "Dados da vaga", agora editável; o botão "Editar vaga" (lápis) some do cabeçalho porque a função dele — editar os campos — passa a viver inteira na aba "Dados da vaga", não é uma perda, é a mesma ação com um caminho só; a busca de candidato ainda não carregado, que hoje só existe no branch `links` de `page.tsx`, precisa sobreviver mesmo com o branch já removido por T09 — Decisão 6 abaixo), #12 (sem Radix — sub-abas são `<button>`).
- Padrão do repo: E1 (`Vagas.tsx:9-36`, Props/switch lista↔detalhe — não mexer nessa navegação, só no que `DetalheVaga` renderiza por dentro), E2 (`Vagas.tsx:98-140`, início de `DetalheVaga` — cabeçalho + botões de ação), E3 (`LinksWhatsApp.tsx`, ver leitura completa abaixo), E4 (`AgendamentoVaga.tsx:19`, `VagaModal.tsx:6,16`, assinaturas travadas), E5 (padrão de sub-abas `<button>`/`border-b-2`, igual ao que `AreaEntrevistas.tsx` já usa desde T09 — mesmas classes, só o array de itens muda).
- Arquivos vizinhos: `page.tsx` já declara `setEmpresaUpload`/`setVagaUpload`/`setUploadOpen` (T03) — `VagaDivulgacao` não usa nada disso (é outro fluxo, currículo por WhatsApp, não upload de PDF); `jobs`/`companies`/`items` (candidatos) já carregados no shell.
- **Não fazer:** não mudar a assinatura de `AgendamentoVaga` (Constraint do material — "`AgendamentoVaga` não muda de assinatura"); não tocar em `navegacao.ts` nesta task (a sub-aba da vaga é estado local de `VagaDetalhe`, não participa do mapa de compatibilidade `?aba=`); não remover `LinksWhatsApp.tsx` (continua existindo, ganha um prop novo); não duplicar a carga de `bot_channels`/`bot_conversations` (Decisão 1 abaixo); não criar um 5º arquivo fora do Mapa desta fase; não mexer em `AgendaEntrevistas.tsx`/`AgendamentosPainel.tsx`/`RelatoriosContratacao.tsx`/`ConfiguracoesContratacao.tsx` (fora do escopo de T11).

### Decisões tomadas

1. **Caminho (a) do E3 (material do orquestrador): `LinksWhatsApp` ganha um prop `escopo`, não é recortado em dois arquivos.** `EscopoWhatsApp = { tipo: 'vaga'; jobId: string; companyId: string | null } | { tipo: 'sem-vaga' }`. Motivo (as duas linhas pedidas pelo material): recortar duplicaria a carga de `bot_channels`/`bot_conversations` e a lógica de exclusividade do `is_default` (`LinksWhatsApp.tsx:122`) em dois arquivos que teriam que ficar sincronizados manualmente; com um prop de escopo, a única mudança é **qual fatia da mesma lista** cada tela mostra — sem duplicar a listagem (RF-06) e sem duplicar código. `VagaDivulgacao.tsx` (aqui) e `ConfigWhatsApp.tsx` (T12) são **invólucros finos**: só escolhem o `escopo` e repassam `companies`/`jobs`/`onOpenCandidate`.
2. **Filtro do escopo:** `tipo: 'vaga'` → `channels.filter((ch) => ch.job_id === jobId)`; `tipo: 'sem-vaga'` → `channels.filter((ch) => !ch.job_id || ch.is_default)`. **Edge case aceito e documentado:** um canal com `job_id` de uma vaga **e** `is_default = true` aparece nos dois lugares — isso não é a duplicação que o RF-06 proíbe (que é sobre a listagem normal, canal-com-vaga vs. canal-sem-vaga); é `is_default` sendo, por natureza, uma configuração **global** ("atende quem escrever sem código", `LinksWhatsApp.tsx:359`) que extrapola a vaga a que o canal também pertence. Caso raro (a maioria dos canais padrão não tem vaga), registrado aqui para quem revisar depois.
3. **`VagaModal` sem o invólucro de modal:** o formulário (`VagaModal.tsx:44-101`, sem o bloco `AgendamentoVaga`/aviso de `:102-108`) sai para um componente exportado `VagaFormulario({ d, set, companies, job })`, usado (a) dentro de `VagaModal` (que mantém o invólucro de modal, chrome inalterado, só para "Nova vaga") e (b) dentro da aba "Dados da vaga" de `VagaDetalhe`, sem chrome de modal — cada chamador embrulha `VagaFormulario` no seu próprio container (`<div className="flex-1 overflow-y-auto px-5 py-4">` no modal — inalterado; `<div className="max-w-2xl">` na aba — novo, porque fora do modal não há scroll de cartão a limitar). O bloco `job?.id ? <AgendamentoVaga .../> : <aviso amber>` (`VagaModal.tsx:102-108`) **não entra** em `VagaFormulario` — ver Decisão 4.
4. **`AgendamentoVaga` sai de dentro do `VagaModal`.** Hoje só aparece quando `job?.id` é verdadeiro (ou seja, nunca no fluxo de criação, já que `VagaModal` só existe para "Nova vaga" a partir desta task — Decisão 6 do Mapa). Como o agendamento ganha sub-aba própria em `VagaDetalhe` ("Agendamento pela IA", sempre com `job.id` real), o bloco inteiro (`AgendamentoVaga` + o aviso amber alternativo) sai de `VagaFormulario`/`VagaModal` — não haveria mais nenhum caminho em que `job?.id` fosse verdadeiro dentro do modal. Fica só o parágrafo informativo de "IA compara..." (`VagaModal.tsx:98-101`). `VagaModal.tsx` deixa de importar `AgendamentoVaga`.
5. **Como a sub-aba "Candidatos" abre a janela de upload com a vaga certa (RF-03/US-05, contrato de T03):** reaproveita **literalmente** o mecanismo que T03 já define para `Vagas`/`onUploadToJob` — `onUploadToJob={(job) => { setEmpresaUpload(job.company_id ?? ''); setVagaUpload(job.id); setUploadOpen(true); }}` (T03, Step 6). Esse callback já é uma prop de `Vagas`/`VagaDetalhe` (`onUploadToJob: (job: Job) => void`) e o botão "Enviar currículos" do cabeçalho da vaga (E2) já o chama com `job` — nada muda aqui, T11 só preserva essa fiação ao mover o cabeçalho de `DetalheVaga` para `VagaDetalhe`. Não existe (nem é preciso) uma prop nova tipo `presetJobId` — T03 já previu isso.
6. **`abrirCandidatoDoBot` — o `onOpenCandidate` com busca do candidato ainda não carregado precisa ser recriado em `page.tsx`.** O branch `aba === 'links'` de `page.tsx` (As Is, `page.tsx:604-612`) tinha essa lógica embutida (`onOpenCandidate={async (id) => { if (!items.some(...)) { const { data } = await supabase...; if (data) setItems(...) } setSelId(id); }}`) — **T09 já apagou esse branch inteiro** (Step 6 de T09) porque a aba "links" foi extinta antes de T12 recriar o destino. Essa lógica não pode simplesmente sumir (ela existe porque um candidato pode chegar por uma conversa do WhatsApp antes do realtime/reload trazê-lo para `items`) — e agora ela é necessária em **dois** lugares novos: dentro de `VagaDivulgacao` (aba da vaga) e dentro de `ConfigWhatsApp` (T12). Por isso esta task recria a função, nomeada e reutilizável, em `page.tsx`, e troca **todos** os usos de `onOpenCandidate` que hoje vão para `Vagas` (tanto o ranking quanto, agora, `VagaDivulgacao`) para usá-la — ela é estritamente mais segura que `setSelId` puro (mesmo comportamento quando o candidato já está em `items`, com fallback quando não está), então não há problema em trocar o `onOpenCandidate` do ranking de candidatos da vaga por ela também (não é uma segunda prop, é a mesma, mais completa).
7. **Texto novo da confirmação de excluir vaga (Briefing §3.4).** Migrations conferidas nesta fase (não são "não confirmadas" — o achado do `spec.md` §1 está desatualizado, ver rodapé): `bot_channels.job_id` é `references public.hiring_jobs(id) on delete set null` (`supabase/migrations/20260914120000_bot_canais_publicos.sql:13`) e `hiring_job_scheduling.job_id` é `references public.hiring_jobs(id) on delete cascade` (`supabase/migrations/20260914210000_hiring_agendamento_assistente.sql:8`). O texto (Step 6) passa a avisar as duas consequências reais, sem hedge.
8. **Sub-aba default e persistência ao trocar de vaga.** Default = `'candidatos'` (mesmo lugar em que se cai hoje ao abrir uma vaga — o ranking). Estado local `useState<SubAbaVaga>('candidatos')` dentro de `VagaDetalhe`, **sem** `localStorage` (RF-06 não pede lembrar). Não precisa de `useEffect` de reset ao trocar de vaga: `Vagas()` (E1) só renderiza `<VagaDetalhe>` quando `selectedJobId` aponta para um job; para ir de uma vaga a outra o fluxo sempre passa por `onSelectJob(null)` (botão "Todas as vagas", E2) antes de escolher a próxima no `ListaVagas` — ou seja, `VagaDetalhe` desmonta e remonta a cada vaga diferente, e o `useState('candidatos')` volta ao default sozinho.
9. **"Enviar currículos" e "Do banco de currículos" continuam no cabeçalho comum (não migram para dentro da aba Candidatos).** Ficam visíveis em todas as 4 sub-abas, exatamente como hoje (E2, botões fora do bloco `verDados`) — satisfaz literalmente US-05 "e dentro da Vaga" sem depender de em qual sub-aba a pessoa está.
10. **O botão "Editar vaga" (lápis, `onEditJob`) sai do cabeçalho.** A função dele (editar os campos da vaga) passa a viver inteira na aba "Dados da vaga" — não é uma remoção de funcionalidade (Constraint 11 permite mover), é a mesma ação com um único caminho em vez de dois (lápis→modal vs. aba). `onEditJob` sai da `Props` de `Vagas`/`VagaDetalhe`; `page.tsx` não passa mais essa prop nem chama `setJobModal({ job })` a partir daqui — `jobModal`/`VagaModal` (T09/hoje) continuam existindo só para o fluxo "Nova vaga" (`onNewJob`, em `ListaVagas`).

### Interfaces

**Consumes** (de Fase 3, T07/T09 — só o necessário, sem reimportar `navegacao.ts` diretamente em `VagaDetalhe`):
```ts
// page.tsx já importa/usa (T09): area === 'vagas' continua chamando <Vagas ... />, sem mudança de rota
```

**Produces** (assinaturas exatas — consumidas por T12):
```ts
// src/pages/contratacao/components/LinksWhatsApp.tsx
export type EscopoWhatsApp =
  | { tipo: 'vaga'; jobId: string; companyId: string | null }
  | { tipo: 'sem-vaga' };
interface Props { companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void; escopo: EscopoWhatsApp }
export default function LinksWhatsApp(props: Props): JSX.Element

// src/pages/contratacao/components/VagaDivulgacao.tsx
interface Props { job: Job; companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void }
export default function VagaDivulgacao(props: Props): JSX.Element

// src/pages/contratacao/components/VagaModal.tsx — acrescenta export
export interface VagaFormularioProps {
  d: JobDraft;
  set: <K extends keyof JobDraft>(k: K, v: JobDraft[K]) => void;
  companies: Company[];
  job: Job | null; // null = ainda não existe (modal "Nova vaga"); com id = edição inline ("Dados da vaga")
}
export function VagaFormulario(props: VagaFormularioProps): JSX.Element
// export default function VagaModal(...) inalterado na assinatura

// src/pages/contratacao/components/Vagas.tsx — Props (troca onEditJob por onSaveJob)
interface Props {
  jobs: Job[]; companies: Company[]; candidates: Candidate[]; applications: Application[]; stages: Stage[];
  mostrarEmpresa: boolean; analyzing: Set<string>; distancia: (candidateId: string, companyId: string | null) => Distance | null;
  selectedJobId: string | null; onSelectJob: (id: string | null) => void; onNewJob: () => void;
  onDeleteJob: (job: Job) => void; onAddFromBank: (job: Job) => void; onUploadToJob: (job: Job) => void;
  onReanalyze: (app: Application) => void; onRemoveApplication: (app: Application) => void;
  onOpenCandidate: (id: string) => void;
  onSaveJob: (draft: JobDraft) => Promise<boolean>; // NOVO — alimenta a aba "Dados da vaga"
  // onEditJob REMOVIDA — a função dela agora é a aba "Dados da vaga" (Decisão 10)
}

// src/pages/contratacao/components/VagaDetalhe.tsx
interface Props {
  job: Job; companies: Company[]; candidates: Candidate[]; applications: Application[]; stages: Stage[]; jobs: Job[];
  analyzing: Set<string>; distancia: (candidateId: string, companyId: string | null) => Distance | null;
  onSelectJob: (id: string | null) => void; onDeleteJob: (job: Job) => void; onAddFromBank: (job: Job) => void;
  onUploadToJob: (job: Job) => void; onReanalyze: (app: Application) => void; onRemoveApplication: (app: Application) => void;
  onOpenCandidate: (id: string) => void; onSaveJob: (draft: JobDraft) => Promise<boolean>;
}
export default function VagaDetalhe(props: Props): JSX.Element

// page.tsx — novo handler (Decisão 6), reaproveitado por T12
const abrirCandidatoDoBot = useCallback(async (id: string) => {
  if (!items.some((c) => c.id === id)) {
    const { data } = await supabase.from('hiring_candidates').select('*').eq('id', id).maybeSingle();
    if (data) setItems((prev) => [data as Candidate, ...prev]);
  }
  setSelId(id);
}, [items]);
```

### Steps

1. **`VagaModal.tsx` — extrair `VagaFormulario`.** Trocar o corpo de `<div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">...</div>` (`VagaModal.tsx:44-110`, todo o conteúdo entre esse `<div>` e o `{erro && ...}` inclusive) por uma chamada a `VagaFormulario` + o `erro` fora dela:
   ```tsx
   <div className="flex-1 overflow-y-auto px-5 py-4">
     <VagaFormulario d={d} set={set} companies={companies} job={job} />
     {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
   </div>
   ```
   Logo abaixo do `export default function VagaModal`, criar a função exportada com o conteúdo movido verbatim (`VagaModal.tsx:45-101`, os 5 blocos de `<Field>`/`<div className="grid...">` do Cargo até o parágrafo "A IA compara...") **dentro de** `<div className="space-y-3">` (o `space-y-3` que hoje está no wrapper do modal migra para este `<div>`, já que o wrapper do modal passa a ser só `overflow-y-auto`) e, no fim, o aviso amber **só quando `!job`** (Decisão 4 — remove o `job?.id ? <AgendamentoVaga.../> : ...` e mantém só o ramo do aviso):
   ```tsx
   export function VagaFormulario({ d, set, companies, job }: VagaFormularioProps) {
     return (
       <div className="space-y-3">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
           <Field label="Cargo" className="sm:col-span-2">
             <input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Atendente de salão" className={inputCls} autoFocus />
           </Field>
           <Field label="Empresa / loja">
             <select value={d.company_id ?? ''} onChange={(e) => set('company_id', e.target.value || null)} className={inputCls}>
               <option value="">Sem empresa</option>
               {companies.filter((c) => c.is_active || c.id === d.company_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
             </select>
           </Field>
         </div>
         <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
           <Field label="Contrato">
             <select value={d.contract_type ?? ''} onChange={(e) => set('contract_type', e.target.value || null)} className={inputCls}>
               <option value="">—</option>
               {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
             </select>
           </Field>
           <Field label="Nº de vagas">
             <input type="number" min={1} value={d.openings} onChange={(e) => set('openings', Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
           </Field>
           <Field label="Salário">
             <input value={d.salary ?? ''} onChange={(e) => set('salary', e.target.value)} placeholder="Ex.: R$ 1.900 + gorjeta" className={inputCls} />
           </Field>
           <Field label="Situação">
             <select value={d.status} onChange={(e) => set('status', e.target.value as JobStatus)} className={inputCls}>
               {JOB_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
             </select>
           </Field>
         </div>
         <Field label="Horário / escala">
           <input value={d.schedule ?? ''} onChange={(e) => set('schedule', e.target.value)} placeholder="Ex.: 6x1, das 17h às 23h, folga durante a semana" className={inputCls} />
         </Field>
         <Field label="Atividades da função">
           <textarea value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={3}
             placeholder="O que a pessoa vai fazer no dia a dia" className={areaCls} />
         </Field>
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
           <Field label="Requisitos obrigatórios">
             <textarea value={d.requirements ?? ''} onChange={(e) => set('requirements', e.target.value)} rows={3}
               placeholder="Ex.: experiência com atendimento, disponibilidade à noite e fins de semana" className={areaCls} />
           </Field>
           <Field label="Desejável (diferenciais)">
             <textarea value={d.desirable ?? ''} onChange={(e) => set('desirable', e.target.value)} rows={3}
               placeholder="Ex.: já ter trabalhado em restaurante, curso de manipulação de alimentos" className={areaCls} />
           </Field>
         </div>
         <Field label="Benefícios">
           <input value={d.benefits ?? ''} onChange={(e) => set('benefits', e.target.value)} placeholder="Ex.: VT, refeição no local, bônus por meta" className={inputCls} />
         </Field>
         <Field label="Observações internas (não vão para a IA)">
           <textarea value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={2} className={areaCls} />
         </Field>
         <p className="text-[11px] text-zinc-400">
           A IA compara cada currículo com estes dados e com o endereço e a descrição da loja (Configurações › Empresas).
           Idade, estado civil e filhos nunca entram na comparação.
         </p>
         {!job && (
           <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
             <i className="ri-robot-2-line" /> Depois de abrir a vaga, edite-a para configurar as entrevistas pelo assistente (dias, horários e entrevistadores).
           </p>
         )}
       </div>
     );
   }
   ```
   Remover `import AgendamentoVaga from './AgendamentoVaga';` do topo (não é mais usado neste arquivo). Acrescentar a interface `VagaFormularioProps` (ver **Interfaces**) logo acima. Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos; único conteúdo que **não** migra é o bloco `AgendamentoVaga`/aviso alternativo (Decisão 4, justificada).

2. **`LinksWhatsApp.tsx` — acrescentar `EscopoWhatsApp` e filtrar a lista (origem verbatim `LinksWhatsApp.tsx:63-69,102-111,181-217`).** No topo, logo após as constantes (`LinksWhatsApp.tsx:59-61`), acrescentar:
   ```ts
   export type EscopoWhatsApp = { tipo: 'vaga'; jobId: string; companyId: string | null } | { tipo: 'sem-vaga' };
   ```
   Trocar `Props`/assinatura (`:63-69`):
   ```ts
   interface Props { companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void; escopo: EscopoWhatsApp }
   export default function LinksWhatsApp({ companies, jobs, onOpenCandidate, escopo }: Props) {
   ```
   Logo após `stats` (`:102-111`), acrescentar o filtro:
   ```ts
   const channelsDoEscopo = useMemo(
     () => channels.filter((ch) => (escopo.tipo === 'vaga' ? ch.job_id === escopo.jobId : (!ch.job_id || ch.is_default))),
     [channels, escopo],
   );
   ```
   No JSX (`:174-217`), trocar as 3 ocorrências de `channels` por `channelsDoEscopo` (a checagem `channels.length === 0`, o `.map`, e nenhuma outra — `stats`/`carregar`/`salvar`/`alternar`/`excluir` continuam operando sobre a lista completa, só a exibição é filtrada). Invariante: mesmo grid, mesmos cards, mesmos `Btn`; só a fonte da lista muda.

3. **`LinksWhatsApp.tsx` — repassar `escopo` ao `CanalModal` e adaptar o formulário de canal (origem verbatim `LinksWhatsApp.tsx:224,252-312`).** Trocar a chamada (`:224`):
   ```tsx
   {editing && <CanalModal ch={editing.ch} companies={companies} jobs={jobs} escopo={escopo} onClose={() => setEditing(null)} onSave={salvar} />}
   ```
   Em `CanalModal` (`:252-258`), acrescentar `escopo: EscopoWhatsApp` à assinatura e usar no valor padrão do rascunho:
   ```tsx
   function CanalModal({ ch, companies, jobs, escopo, onClose, onSave }: {
     ch: BotChannel | null; companies: Company[]; jobs: Job[]; escopo: EscopoWhatsApp; onClose: () => void; onSave: (d: Partial<BotChannel>) => Promise<boolean>;
   }) {
     const [d, setD] = useState<Partial<BotChannel>>(() => ch ? { ...ch } : {
       purpose: 'curriculos', name: '', code: newCode(), start_text: '', welcome: '',
       company_id: escopo.tipo === 'vaga' ? escopo.companyId : (companies.find((c) => c.is_active)?.id ?? null),
       job_id: escopo.tipo === 'vaga' ? escopo.jobId : null,
       share_fields: DEFAULT_SHARE, extra_info: '', forbidden: '', notify_owner: true, is_active: true, is_default: false,
     });
   ```
   Trocar o bloco de Empresa/Vaga (`:296-312`, o `<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">` com os dois `<Field>`) por (escopo `vaga`: linha fixa em vez de selects, já que empresa e vaga não mudam por dentro da vaga; escopo `sem-vaga`: só o select de Empresa, sem o de Vaga — canal criado aqui é sempre sem vaga, RF-06):
   ```tsx
   {escopo.tipo === 'vaga' ? (
     <p className="text-xs text-zinc-600 bg-zinc-50 rounded-lg px-3 py-2">
       <i className="ri-briefcase-4-line" /> Vaga: <b>{job?.title}</b>{company ? ` — ${company.name}` : ''}
     </p>
   ) : (
     <Field label="Empresa / loja">
       <select value={d.company_id ?? ''} onChange={(e) => set('company_id', e.target.value || null)} className={inputCls}>
         <option value="">Sem empresa</option>
         {companies.filter((c) => c.is_active || c.id === d.company_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
       </select>
     </Field>
   )}
   ```
   `company`/`job`/`vagas` (`:264-267`) continuam calculados exatamente como hoje (usam `d.company_id`/`d.job_id`, que já vêm fixos no escopo `vaga`) — não mudam. Invariante: mesmo `Field`/`inputCls`, mesmo `SHARE_OPTIONS`/`Toggle`/exclusividade do `is_default` (`:119-129`, não tocado) — só a origem de empresa/vaga muda de "escolhida na hora" para "fixa pelo escopo" quando dentro da vaga.

4. **Criar `src/pages/contratacao/components/VagaDivulgacao.tsx` — invólucro fino (Decisão 1).** Corpo completo:
   ```tsx
   // Aba "Divulgação" da vaga: link wa.me + QR + primeira resposta — o mesmo LinksWhatsApp de sempre,
   // só que mostrando apenas o(s) canal(is) desta vaga (escopo 'vaga'). Ver Decisão 1 de T11: em vez de
   // duplicar a carga/lógica de bot_channels, LinksWhatsApp ganhou um prop de escopo.
   import LinksWhatsApp from './LinksWhatsApp';
   import type { Company, Job } from '../shared';

   interface Props { job: Job; companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void }

   export default function VagaDivulgacao({ job, companies, jobs, onOpenCandidate }: Props) {
     return (
       <LinksWhatsApp companies={companies} jobs={jobs} onOpenCandidate={onOpenCandidate}
         escopo={{ tipo: 'vaga', jobId: job.id, companyId: job.company_id }} />
     );
   }
   ```

5. **Criar `src/pages/contratacao/components/VagaDetalhe.tsx`.** Corpo completo — cabeçalho (E2, verbatim, **sem** o botão "Editar vaga"/lápis e **sem** o toggle `verDados`/`<dl>`, Decisões 9/10/2), sub-abas (padrão E5, igual a `AreaEntrevistas`) e o conteúdo de cada uma:
   ```tsx
   // Vaga por dentro: sub-abas Candidatos (ranking, movido verbatim de Vagas.tsx pré-Fase-4) ·
   // Divulgação (VagaDivulgacao) · Agendamento pela IA (AgendamentoVaga, como já era usado dentro do
   // VagaModal) · Dados da vaga (VagaFormulario, sem invólucro de modal — substitui o toggle "Ver
   // dados da vaga" de hoje por uma versão editável).
   import { useMemo, useState } from 'react';
   import {
     type Application, type Candidate, type Company, type Distance, type Job, type Stage,
     FIT, JOB_STATUS, jobStatusInfo, companyName, fmtDateTime, ageOf, colorOf, stageOf, decisionOf, fitOf, fmtKm, distCls,
   } from '../shared';
   import { VagaFormulario, type JobDraft } from './VagaModal';
   import AgendamentoVaga from './AgendamentoVaga';
   import VagaDivulgacao from './VagaDivulgacao';

   interface Props {
     job: Job; companies: Company[]; candidates: Candidate[]; applications: Application[]; stages: Stage[]; jobs: Job[];
     analyzing: Set<string>; distancia: (candidateId: string, companyId: string | null) => Distance | null;
     onSelectJob: (id: string | null) => void; onDeleteJob: (job: Job) => void; onAddFromBank: (job: Job) => void;
     onUploadToJob: (job: Job) => void; onReanalyze: (app: Application) => void; onRemoveApplication: (app: Application) => void;
     onOpenCandidate: (id: string) => void; onSaveJob: (draft: JobDraft) => Promise<boolean>;
   }

   type SubAbaVaga = 'candidatos' | 'divulgacao' | 'agendamento' | 'dados';
   // Ícones já usados no módulo: ri-user-search-line (LinksWhatsApp.tsx:482, "Abrir candidato"),
   // ri-whatsapp-line (LinksWhatsApp.tsx, várias), ri-robot-2-line (AgendamentoVaga.tsx:90), ri-file-list-3-line
   // (ConfiguracoesContratacao.tsx, item "Dados mínimos" do menu de T10) — nenhum ícone novo.
   const SUBABAS_VAGA: { id: SubAbaVaga; label: string; icon: string }[] = [
     { id: 'candidatos', label: 'Candidatos', icon: 'ri-user-search-line' },
     { id: 'divulgacao', label: 'Divulgação', icon: 'ri-whatsapp-line' },
     { id: 'agendamento', label: 'Agendamento pela IA', icon: 'ri-robot-2-line' },
     { id: 'dados', label: 'Dados da vaga', icon: 'ri-file-list-3-line' },
   ];

   export default function VagaDetalhe({
     job, companies, candidates, applications, stages, jobs, analyzing, distancia, onSelectJob, onDeleteJob,
     onAddFromBank, onUploadToJob, onReanalyze, onRemoveApplication, onOpenCandidate, onSaveJob,
   }: Props) {
     const [subaba, setSubaba] = useState<SubAbaVaga>('candidatos'); // Decisão 8: default = ranking, sem persistir
     const [aberto, setAberto] = useState<string | null>(null);
     const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
     const apps = applications
       .filter((a) => a.job_id === job.id && byId.has(a.candidate_id))
       .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
     const st = jobStatusInfo(job.status);
     const comp = companies.find((c) => c.id === job.company_id) ?? null;

     return (
       <div>
         <button onClick={() => onSelectJob(null)} className="flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-800 mb-3 cursor-pointer">
           <i className="ri-arrow-left-line" /> Todas as vagas
         </button>

         <div className="rounded-2xl border border-zinc-200 bg-white p-4 mb-4">
           <div className="flex flex-wrap items-start gap-3">
             <div className="flex-1 min-w-[200px]">
               <div className="flex items-center gap-2">
                 <h2 className="text-lg font-black text-zinc-900">{job.title}</h2>
                 <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
               </div>
               <p className="text-xs text-zinc-500">
                 {[companyName(companies, job.company_id), job.contract_type, job.openings > 1 ? `${job.openings} vagas` : null, job.salary].filter(Boolean).join(' · ')}
               </p>
               {job.schedule && <p className="text-xs text-zinc-500"><i className="ri-time-line" /> {job.schedule}</p>}
             </div>
             {/* Editar vaga (lápis) saiu daqui — a aba "Dados da vaga" abaixo é o único caminho agora (Decisão 10). */}
             <div className="flex flex-wrap gap-2">
               <button onClick={() => onUploadToJob(job)} className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer">
                 <i className="ri-upload-2-line" /> Enviar currículos
               </button>
               <button onClick={() => onAddFromBank(job)} className="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
                 <i className="ri-database-2-line" /> Do banco de currículos
               </button>
               <button onClick={() => onDeleteJob(job)} title="Excluir vaga" className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-red-50 text-red-500 cursor-pointer"><i className="ri-delete-bin-line" /></button>
             </div>
           </div>
         </div>

         <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
           {SUBABAS_VAGA.map((t) => (
             <button key={t.id} onClick={() => setSubaba(t.id)}
               className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
                 subaba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
               <i className={t.icon} /> {t.label}
             </button>
           ))}
         </div>

         {subaba === 'candidatos' ? (
           apps.length === 0 ? (
             <div className="py-14 text-center text-zinc-400 rounded-2xl border border-dashed border-zinc-200">
               <i className="ri-user-add-line text-4xl" />
               <p className="text-sm font-semibold mt-2">Nenhum candidato nesta vaga ainda</p>
               <p className="text-xs mt-1">Envie currículos novos ou escolha do banco; a IA compara cada um com a vaga.</p>
             </div>
           ) : (
             <div className="space-y-2">
               <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Ranking por aderência · {apps.length} candidato{apps.length === 1 ? '' : 's'}</p>
               {apps.map((a, i) => {
                 const c = byId.get(a.candidate_id)!;
                 const loading = analyzing.has(`${a.job_id}:${a.candidate_id}`);
                 const fit = a.fit ?? fitOf(a.score);
                 const stg = stageOf(stages, c.stage_id);
                 const dec = decisionOf(c.decision);
                 const idade = ageOf(c);
                 const dist = distancia(c.id, job.company_id);
                 const open = aberto === a.id;
                 return (
                   <div key={a.id} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                     <div className="flex items-center gap-3 p-3">
                       <span className="w-6 text-center text-xs font-black text-zinc-400">{i + 1}</span>
                       <ScoreRing score={a.score} loading={loading} />
                       <button onClick={() => onOpenCandidate(c.id)} className="flex-1 min-w-0 text-left cursor-pointer">
                         <p className="font-bold text-zinc-900 truncate hover:text-rose-700">{c.full_name}</p>
                         <p className="text-xs text-zinc-500 truncate">
                           {[c.desired_role, idade != null ? `${idade} anos` : null, c.neighborhood || c.city].filter(Boolean).join(' · ') || '—'}
                         </p>
                         <div className="sm:hidden flex flex-wrap gap-1 mt-1">
                           {dist && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${distCls(dist.km)}`}><i className="ri-car-line" /> {fmtKm(dist.km)}</span>}
                           {stg && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${colorOf(stg.color).cls}`}>{stg.name}</span>}
                           {dec && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${dec.cls}`}>{dec.sigla}</span>}
                         </div>
                       </button>
                       <div className="hidden sm:flex items-center gap-1.5">
                         {dist && (
                           <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${distCls(dist.km)}`}
                             title={dist.precision === 'bairro' || dist.precision === 'cidade' ? 'Endereço aproximado' : 'Rota de carro até a loja'}>
                             <i className="ri-car-line" /> {fmtKm(dist.km)}{dist.minutes != null ? ` · ${dist.minutes} min` : ''}
                           </span>
                         )}
                         {fit &&<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
                         {stg && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorOf(stg.color).cls}`}>{stg.name}</span>}
                         {dec && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${dec.cls}`}>{dec.sigla}</span>}
                       </div>
                       <button onClick={() => setAberto(open ? null : a.id)} title="Ver análise"
                         className="w-8 h-8 rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
                         <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                       </button>
                     </div>
                     {a.error && !loading && (
                       <p className="px-4 pb-2 text-xs text-red-600">Análise falhou: {a.error} <button onClick={() => onReanalyze(a)} className="font-bold underline cursor-pointer">tentar de novo</button></p>
                     )}
                     {open && (
                       <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 space-y-3 text-sm">
                         {a.analysis ? (
                           <>
                             <p className="text-zinc-700">{a.analysis.resumo}</p>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                               <Lista titulo="Pontos a favor" itens={a.analysis.pontos_fortes} cls="text-emerald-800" />
                               <Lista titulo="Lacunas" itens={a.analysis.lacunas} cls="text-orange-800" />
                             </div>
                             {a.analysis.deslocamento && <p className="text-xs text-zinc-600"><i className="ri-map-pin-line" /> <b>Deslocamento:</b> {a.analysis.deslocamento}</p>}
                             <Lista titulo="Perguntas para a entrevista" itens={a.analysis.perguntas_entrevista} cls="text-zinc-700" />
                             {a.analysis.alertas.length > 0 && <Lista titulo="Alertas" itens={a.analysis.alertas} cls="text-red-700" />}
                           </>
                         ) : <p className="text-xs text-zinc-400">{loading ? 'Analisando…' : 'Ainda sem análise.'}</p>}
                         <div className="flex flex-wrap items-center gap-2 pt-1">
                           {a.analyzed_at && <span className="text-[10px] text-zinc-400">analisado em {fmtDateTime(a.analyzed_at)}</span>}
                           <button onClick={() => onReanalyze(a)} disabled={loading} className="ml-auto px-3 h-8 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 disabled:opacity-50 cursor-pointer">
                             <i className="ri-refresh-line" /> Reanalisar
                           </button>
                           <button onClick={() => onRemoveApplication(a)} className="px-3 h-8 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer">
                             Tirar da vaga
                           </button>
                         </div>
                       </div>
                     )}
                   </div>
                 );
               })}
             </div>
           )
         ) : subaba === 'divulgacao' ? (
           <VagaDivulgacao job={job} companies={companies} jobs={jobs} onOpenCandidate={onOpenCandidate} />
         ) : subaba === 'agendamento' ? (
           <AgendamentoVaga jobId={job.id} defaultLocation={comp?.address ?? null} />
         ) : (
           <div className="max-w-2xl">
             <AbaDadosVaga job={job} companies={companies} onSave={onSaveJob} />
           </div>
         )}

         <p className="text-[11px] text-zinc-400 mt-3">
           A nota é uma ajuda para a triagem, calculada só com critérios profissionais (experiência, requisitos, horário, salário, deslocamento).
           Cada análise custa uns centavos. <span className="whitespace-nowrap">Situações: {JOB_STATUS.map((s) => s.label).join(', ')}.</span>
         </p>
       </div>
     );
   }

   // "Dados da vaga": VagaFormulario sem invólucro de modal + botão Salvar próprio. Substitui o
   // toggle "Ver/Esconder dados da vaga" de hoje — agora edita em vez de só mostrar (Decisão 2/9 de T11).
   > **Correção do orquestrador (2026-09-20), Constraint 11.** O gate de compliance da Fase 4 pegou um dado que desaparecia: o `<dl>` do toggle `verDados` (`Vagas.tsx:143-152`) mostra **6** linhas via `Dado`, e uma delas **não** é campo da vaga —
   > `<Dado t="Loja" v={comp ? [comp.address, comp.city].filter(Boolean).join(', ') || 'Endereço não cadastrado (Configurações › Empresas)' : null} />` (`Vagas.tsx:149`).
   > As outras 5 (`description`, `requirements`, `desirable`, `benefits`, `notes`) viram campos editáveis no `VagaFormulario`; o endereço da loja **não**, porque o formulário só tem o `<select>` "Empresa / loja" (escolher a empresa ≠ ver o endereço dela), e o aviso "Endereço não cadastrado (Configurações › Empresas)" — que é o que diz ao dono por que a distância dos candidatos não calcula — sumiria sem destino.
   > **Portanto `AbaDadosVaga` tem que renderizar esse mesmo texto, verbatim, abaixo do `<select>` de empresa**, reagindo à empresa escolhida no formulário (não à do `job`, para o texto acompanhar a troca antes de salvar). Use as mesmas classes do `Dado` de origem (`Vagas.tsx:274-281` — confira e reproduza) para não inventar visual.

   function AbaDadosVaga({ job, companies, onSave }: { job: Job; companies: Company[]; onSave: (draft: JobDraft) => Promise<boolean> }) {
     const [d, setD] = useState<JobDraft>(() => ({ ...job }));
     const [saving, setSaving] = useState(false);
     const [erro, setErro] = useState<string | null>(null);
     const set = <K extends keyof JobDraft>(k: K, v: JobDraft[K]) => setD((x) => ({ ...x, [k]: v }));
     const salvar = async () => {
       if (!d.title.trim()) { setErro('Informe o cargo da vaga.'); return; }
       setSaving(true); setErro(null);
       const ok = await onSave({ ...d, title: d.title.trim() });
       setSaving(false);
       if (ok) setErro(null);
     };
     return (
       <>
         <VagaFormulario d={d} set={set} companies={companies} job={job} />
         {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
         <div className="flex justify-end pt-3">
           <button onClick={salvar} disabled={saving} className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-bold cursor-pointer">
             {saving ? 'Salvando…' : 'Salvar'}
           </button>
         </div>
       </>
     );
   }

   function ScoreRing({ score, loading }: { score: number | null; loading: boolean }) {
     if (loading) return <div className="w-11 h-11 flex items-center justify-center"><div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>;
     if (score == null) return <div className="w-11 h-11 rounded-full border-2 border-dashed border-zinc-200 flex items-center justify-center text-[10px] text-zinc-400">—</div>;
     const fit = fitOf(score)!;
     const color = fit === 'alta' ? '#10b981' : fit === 'media' ? '#f59e0b' : '#a1a1aa';
     return (
       <div className="relative w-11 h-11 flex-shrink-0" title={`${score}/100`}>
         <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
           <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f4f4f5" strokeWidth="4" />
           <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
             strokeDasharray={`${(score / 100) * 97.4} 97.4`} />
         </svg>
         <span className="absolute inset-0 flex items-center justify-center text-xs font-black text-zinc-800">{score}</span>
       </div>
     );
   }

   function Lista({ titulo, itens, cls }: { titulo: string; itens: string[]; cls: string }) {
     if (!itens.length) return null;
     return (
       <div>
         <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">{titulo}</p>
         <ul className={`space-y-0.5 text-xs ${cls}`}>{itens.map((t, i) => <li key={i}>• {t}</li>)}</ul>
       </div>
     );
   }
   ```
   Invariante: todo o bloco "Candidatos" é `DetalheVaga`/`Vagas.tsx:155-243` movido **verbatim** (mesmas classes, ícones, textos); `ScoreRing`/`Lista` também verbatim (`Vagas.tsx:247-273`). **`Dado` (`Vagas.tsx:274-281`) não é movido para cá com uso ativo** — o Mapa desta fase pede que os 3 helpers "acompanhem o detalhe (ou sejam exportados)"; como o bloco que consumia `Dado` (o `<dl>` do toggle `verDados`) é substituído pela aba "Dados da vaga" (Decisão 2), `Dado` fica sem chamador. Não há gate de lint neste repo (`scripts/check.mjs` só roda `tsc`+`vitest`, e `tsconfig.app.json` tem `noUnusedLocals: false`), então isso não quebra nada — mas para não deixar código morto sem necessidade, **não copiar `Dado` para este arquivo**; ele deixa de existir junto com o toggle que o usava (é a mesma decisão de mover a funcionalidade, não perdê-la — a informação que `Dado` renderizava como texto agora é editável em `VagaFormulario`). **Exceção conferida pelo gate de compliance e corrigida:** 5 das 6 linhas do `<dl>` são campos da vaga e viram campos do formulário, mas a 6ª (`<Dado t="Loja" …>`, `Vagas.tsx:149`) mostra o **endereço da empresa** e o aviso "Endereço não cadastrado (Configurações › Empresas)" — isso **não** é campo da vaga e **não** aparece no formulário, então tem que ser renderizado explicitamente em `AbaDadosVaga` (ver a "Correção do orquestrador" no Step 5). Antes de apagar o `<dl>`, confira uma a uma as 6 linhas e confirme o destino de cada uma; esse é um item do DoD.

6. **`Vagas.tsx` — recortar para `ListaVagas` + o switch, com `VagaDetalhe` no lugar de `DetalheVaga`.** Trocar as importações (`Vagas.tsx:3-7`) por:
   ```tsx
   import { useState } from 'react';
   import { type Application, type Candidate, type Company, type Job, type Stage, type Distance, jobStatusInfo, companyName, fmtDate } from '../shared';
   import type { JobDraft } from './VagaModal';
   import VagaDetalhe from './VagaDetalhe';
   ```
   Trocar `Props` (`:9-28`) conforme **Interfaces** (remove `onEditJob`, acrescenta `onSaveJob: (draft: JobDraft) => Promise<boolean>`). Trocar o corpo de `Vagas` (`:32-36`) por:
   ```tsx
   export default function Vagas(props: Props) {
     const { jobs, selectedJobId } = props;
     const job = jobs.find((j) => j.id === selectedJobId) ?? null;
     return job ? <VagaDetalhe {...props} job={job} /> : <ListaVagas {...props} />;
   }
   ```
   (mesma lógica de hoje — só `DetalheVaga` local vira `VagaDetalhe` importado). Manter `ListaVagas` (`:38-96`) **exatamente igual** (não usa `onEditJob` nem `onSaveJob`, então não é afetada pela troca de Props). **Apagar** `DetalheVaga`, `ScoreRing`, `Lista`, `Dado` (`:98-282`, tudo que sobrou depois de mover para `VagaDetalhe.tsx` no Step 5) e o `export const appKey` **se** nada mais o importar (`grep -rn "appKey" src/pages/contratacao` para confirmar antes de remover — se algo ainda usar, mantém). Rodar `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` isolado (≤ 287).

7. **`page.tsx` — criar `abrirCandidatoDoBot` e trocar os dois usos de `onOpenCandidate` que hoje vão para `Vagas` (conteúdo, não linha — ver aviso do topo).** Localizar `const saveJob = useCallback(...)` (conteúdo idêntico ao do As Is, `page.tsx:396-413`) e, logo abaixo dele (ou junto de outros `useCallback` do shell), acrescentar:
   ```ts
   // Candidato pode ter chegado por uma conversa do WhatsApp (bot_conversations) antes do realtime
   // trazê-lo para `items` — busca uma vez antes de abrir a ficha. Recriado aqui porque o branch
   // aba === 'links' que tinha essa lógica foi removido em T09 (Fase 3); agora dois lugares
   // precisam dela: VagaDivulgacao (aqui) e ConfigWhatsApp (T12).
   const abrirCandidatoDoBot = useCallback(async (id: string) => {
     if (!items.some((c) => c.id === id)) {
       const { data } = await supabase.from('hiring_candidates').select('*').eq('id', id).maybeSingle();
       if (data) setItems((prev) => [data as Candidate, ...prev]);
     }
     setSelId(id);
   }, [items]);
   ```
   Localizar a chamada de `<Vagas .../>` no branch `area === 'vagas'` (conteúdo do As Is, `page.tsx:590-603`, com `onUploadToJob` já na forma de T03 — `setEmpresaUpload(...); setVagaUpload(...); setUploadOpen(true);` — e `onOpenCandidate={setSelId}`) e trocar: remover a linha `onEditJob={(job) => setJobModal({ job })}` (Decisão 10), acrescentar `onSaveJob={saveJob}`, e trocar `onOpenCandidate={setSelId}` por `onOpenCandidate={abrirCandidatoDoBot}` (Decisão 6):
   ```tsx
   ) : area === 'vagas' ? (
     <Vagas
       jobs={jobsDaEmpresa} companies={companies} candidates={items} applications={applications} stages={stages}
       mostrarEmpresa={mostrarEmpresa} analyzing={analyzing} distancia={distancia}
       selectedJobId={selectedJobId} onSelectJob={setSelectedJobId}
       onNewJob={() => setJobModal({ job: null })}
       onDeleteJob={deleteJob}
       onAddFromBank={setAddToJob}
       onUploadToJob={(job) => { setEmpresaUpload(job.company_id ?? ''); setVagaUpload(job.id); setUploadOpen(true); }}
       onReanalyze={(a) => analyze(a.job_id, a.candidate_id)}
       onRemoveApplication={removeApplication}
       onOpenCandidate={abrirCandidatoDoBot}
       onSaveJob={saveJob}
     />
   ```
   Invariante: `saveJob`/`deleteJob` já existem e não mudam de corpo — só passam a alimentar, respectivamente, `onSaveJob` (novo) e `onDeleteJob` (já existia). O texto da confirmação de exclusão (Step 8) é a única mudança de comportamento visível desta task fora da navegação da vaga.

8. **`page.tsx` — texto novo da confirmação de excluir vaga (Decisão 7, Briefing §3.4).** Localizar `deleteJob` (conteúdo idêntico ao As Is, `page.tsx:415-428`) e trocar a mensagem:
   ```tsx
   const deleteJob = useCallback(async (job: Job) => {
     const n = applications.filter((a) => a.job_id === job.id).length;
     const ok = await confirmar({
       titulo: `Excluir a vaga ${job.title}?`,
       mensagem: n
         ? `As ${n} inscrições e análises desta vaga serão apagadas. O agendamento pela IA desta vaga também será apagado e os links de WhatsApp criados para ela deixam de estar ligados a uma vaga (continuam existindo, sem vaga). Os currículos continuam no banco.`
         : 'A vaga será apagada. O agendamento pela IA desta vaga também será apagado e os links de WhatsApp criados para ela deixam de estar ligados a uma vaga (continuam existindo, sem vaga).',
       confirmarLabel: 'Excluir', perigo: true,
     });
     if (!ok) return;
     const { error } = await supabase.from('hiring_jobs').delete().eq('id', job.id);
     if (error) { avisar(`Não foi possível excluir: ${error.message}`); return; }
     setJobs((prev) => prev.filter((j) => j.id !== job.id));
     setApplications((prev) => prev.filter((a) => a.job_id !== job.id));
     setSelectedJobId(null);
   }, [applications]);
   ```
   Só o texto de `mensagem` muda (é mudança de texto, autorizada pelo próprio Briefing — não é comportamento novo, é avisar sobre um comportamento que já existe hoje, confirmado nas migrations citadas na Decisão 7).

9. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **520 ou mais** (mesmo total desde T07/T09/T10 — esta task não cria nem apaga teste), 0 failed.
   - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não tocado.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Abrir uma vaga mostra as 4 sub-abas (Candidatos · Divulgação · Agendamento pela IA · Dados da vaga), default em Candidatos; o ranking é pixel-a-pixel igual ao `DetalheVaga` de antes (mesmos chips, `ScoreRing`, análise expandível, "Reanalisar"/"Tirar da vaga").
- [ ] Divulgação mostra só o(s) canal(is) desta vaga (`job_id` = o `id` da vaga); "Novo link" criado por aqui já vem com empresa/vaga fixas nesta vaga; copiar link, QR Code, Conversas, Editar, Pausar/Ativar, Excluir e o número do assistente funcionam iguais a `LinksWhatsApp` de antes.
- [ ] Agendamento pela IA é `AgendamentoVaga` sem alteração nenhuma (mesma assinatura `{ jobId, defaultLocation }`), configurações salvas aqui continuam valendo para o WhatsApp mandar convite ao candidato.
- [ ] Dados da vaga mostra o mesmo formulário de `VagaModal` (mesmos campos, mesmos placeholders), edita e salva com `onSaveJob` (`saveJob` de `page.tsx`, sem duplicar lógica de salvar); "Nova vaga" (`ListaVagas` → `onNewJob`) continua abrindo `VagaModal` como modal, inalterado.
- [ ] **As 6 linhas do `<dl>` do antigo "Ver dados da vaga" (`Vagas.tsx:143-152`) conferidas uma a uma**, com destino confirmado: `description`, `requirements`, `desirable`, `benefits` e `notes` viraram campos editáveis do formulário; e a 6ª — `<Dado t="Loja" …>` (`Vagas.tsx:149`), que mostra o endereço/cidade da empresa **ou** o aviso "Endereço não cadastrado (Configurações › Empresas)" — aparece em `AbaDadosVaga` abaixo do `<select>` de empresa, com o mesmo texto e as mesmas classes. **Conferir na tela nos dois casos:** empresa com endereço cadastrado (mostra o endereço) e empresa sem endereço (mostra o aviso, que é o que explica ao dono por que a distância dos candidatos não calcula).
- [ ] Botão "Enviar currículos" abre `UploadCurriculosModal` (T03) com a empresa/vaga já pré-selecionadas, visível em qualquer sub-aba da vaga (US-05 "dentro da Vaga").
- [ ] Botão "Editar vaga" (lápis) não existe mais no cabeçalho — a mesma ação (editar campos) está inteira na aba "Dados da vaga" (Constraint 11: movida, não perdida).
- [ ] Excluir vaga mostra o aviso novo sobre agendamento (apagado em cascata) e link de WhatsApp (perde a vaga, `job_id` vira `null`), confirmado nas migrations citadas na Decisão 7.
- [ ] Um candidato que chegou por uma conversa do WhatsApp na aba Divulgação, ainda não presente na lista carregada, abre a ficha corretamente ao clicar em "Abrir candidato" (via `abrirCandidatoDoBot`) — mesma garantia que existia no branch `links` antes de T09 remover.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] `npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos.
- [ ] Nada desapareceu (Constraint 11): ranking, agendamento, link de WhatsApp da vaga e dados da vaga continuam todos acessíveis — cada um em sua sub-aba; "Editar vaga" e "Ver dados da vaga" viraram a aba "Dados da vaga" (uma ação só, não duas).
- [ ] Rastreio: RF-06 (as 4 sub-abas), US-05 (parte: botão dentro da Vaga).

---

## T12: Configurações › WhatsApp e fim da aba Links WhatsApp

> **Achado desta fase (repete o aviso de T11):** a "aba Links WhatsApp" já não existe em `page.tsx` desde T09 (Fase 3) — não há nenhum branch/import para remover nesta task. O que esta task fecha é o **destino** que faltava (Configurações › WhatsApp) e a **verificação** de que os dois destinos (`VagaDivulgacao`, T11, e `ConfigWhatsApp`, aqui) cobrem tudo o que a aba antiga oferecia — é isso que substitui o Step de remoção que o material pedia como "último Step de T12".
>
> **Aviso sobre números de linha:** as linhas de `page.tsx` são do As Is de 2026-09-20, antes das Fases 1-3 — localizar pelo conteúdo (ver aviso completo em T11). `navegacao.ts` e `ConfiguracoesContratacao.tsx`/`AreaConfiguracoes.tsx` (T07/T10) não sofrem esse deslize — as linhas citadas deles foram conferidas no arquivo real.

| Campo | Valor |
|---|---|
| **Entregável** | `ConfigWhatsApp.tsx` (Configurações › WhatsApp, escopo `sem-vaga`); 5º item "WhatsApp" no menu de `AreaConfiguracoes`; `SecaoConfig` ganha `'whatsapp'`; `destinoDeAbaAntiga('links')` aponta para a seção certa |
| **Onde** | `src/pages/contratacao/components/ConfigWhatsApp.tsx` (criar), `src/pages/contratacao/areas/AreaConfiguracoes.tsx` (modificar), `src/pages/contratacao/navegacao.ts` (modificar — ver nota abaixo), `src/pages/contratacao/page.tsx` (modificar) |
| **Depende de** | T11 (`LinksWhatsApp`/`EscopoWhatsApp`, `abrirCandidatoDoBot`) |
| **Bloqueia** | — (fecha a Fase 4) |
| **Paralelo com** | — (sequencial, último da Fase 4) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-06 (Configurações › WhatsApp), RF-07 (5º item do menu, "WhatsApp") |

### Context pack

- Spec: RF-06 verbatim (`#c-spec-filtrada`) — "Configurações › WhatsApp, tela nova... reaproveitar a mesma renderização/comportamento de `LinksWhatsApp.tsx`... nenhum recurso novo"; RF-07 ("Menu lateral... Empresas, Fases, Dados mínimos, Entrevista, **WhatsApp**").
- Global Constraints: `#global-constraints` #1 (reaproveita o mesmo `LinksWhatsApp`/`escopo` de T11, mesmo padrão de item de menu de T10 — `border-l-2`/`bg-rose-50/60`), #8 (nada de banco — mesmas tabelas já lidas), #9 (gate), #11 (**o checklist item-a-item abaixo é o DoD extra desta task**, exigido pelo material do orquestrador), #12 (sem Radix).
- Padrão do repo: T10 já define `ITENS_MENU`/`SecaoConfig`/o `<nav>` de `AreaConfiguracoes.tsx` (ler o Step 2 de T10 antes de editar — esta task só acrescenta um item e um `if` de renderização, não reescreve o `<nav>`); T11 já define `EscopoWhatsApp`/`LinksWhatsApp` (escopo `sem-vaga` é exatamente o caso desta task).
- Arquivos vizinhos: `navegacao.ts` (T07) — **não está no Mapa de arquivos desta fase que o material me passou**, mas T07 Decisão 5 já registra explicitamente que "quando T12 acrescentar `'whatsapp'` a `SecaoConfig`, esta linha [`destinoDeAbaAntiga('links')`] ganha `secaoConfig: 'whatsapp'`" — ou seja, o próprio T07 (já travado) atribui essa edição a T12. Ver "Linhas do material desatualizadas" no retorno desta task.
- **Não fazer:** não reescrever `ConfiguracoesContratacao.tsx` (os 4 cards ali são de T10, fora do escopo); não duplicar a listagem de canais entre a vaga e Configurações (Decisão 2 de T11 já resolve isso); não remover nada de `LinksWhatsApp.tsx` (só reusa o que T11 já preparou); não criar coluna/RPC/Edge Function nova.

### Decisões tomadas

1. **`ConfigWhatsApp.tsx` é um invólucro fino** (mesmo raciocínio de `VagaDivulgacao`, T11 Decisão 1): só escolhe `escopo: { tipo: 'sem-vaga' }` e repassa `companies`/`jobs`/`onOpenCandidate` para `LinksWhatsApp`.
2. **Onde o item "WhatsApp" entra no menu (pergunta 9 do material):** em `src/pages/contratacao/areas/AreaConfiguracoes.tsx`, no array `ITENS_MENU` que T10 já criou (`AreaConfiguracoes.tsx`, Step 2 de T10) — acrescenta `{ id: 'whatsapp', label: 'WhatsApp', icon: 'ri-whatsapp-line' }` como 5º item. `SecaoConfig` (`navegacao.ts`, T07) ganha o valor `'whatsapp'`. O `<nav>` em si (classes, ordem de renderização) não muda — só a lista de itens cresce em 1.
3. **Como `AreaConfiguracoes` decide entre `ConfiguracoesContratacao` (4 seções) e `ConfigWhatsApp` (a 5ª):** `AreaConfiguracoes` já tem `useState<SecaoConfig>('empresas')` e renderiza `<ConfiguracoesContratacao {...props} secao={secao} />` (T10). Como `ConfigWhatsApp` **não** é um dos 4 cards de `ConfiguracoesContratacao.tsx` (é `LinksWhatsApp` por baixo, arquivo totalmente diferente — Mapa desta fase o mantém como componente à parte), `AreaConfiguracoes` passa a decidir **antes** de chamar `ConfiguracoesContratacao`: `secao === 'whatsapp' ? <ConfigWhatsApp .../> : <ConfiguracoesContratacao ... secao={secao} />`. `ConfiguracoesContratacao.tsx` (T10) não é tocado por esta task — seu `secao === 'whatsapp'` nunca ocorre na prática (o `if (!secao)` e os 4 `secao === ...` de T10 continuam exatamente iguais), mas o tipo `SecaoConfig` que ele importa de `navegacao.ts` agora tem 5 valores — inofensivo, TypeScript não obriga tratar todos os valores de um tipo num `&&`/`===` em cadeia.
4. **`AreaConfiguracoes` precisa de `jobs`/`onOpenCandidate`, que não tinha (T08/T10).** `ConfigWhatsApp` (via `LinksWhatsApp`) precisa da lista de vagas (para o `CanalModal`, mesmo com o select de vaga oculto no escopo `sem-vaga` — a prop `jobs: Job[]` é obrigatória na assinatura de `LinksWhatsApp`) e de um `onOpenCandidate` com busca de candidato ainda não carregado (mesma necessidade de `VagaDivulgacao`, T11 Decisão 6). Os dois entram nas `Props` de `AreaConfiguracoes` (acréscimo, não mudança dos campos existentes) e `page.tsx` passa `jobs={jobs}` e `onOpenCandidate={abrirCandidatoDoBot}` (a mesma função criada em T11) no `useState`/branch `area === 'config'`.
5. **`destinoDeAbaAntiga('links')` ganha `secaoConfig: 'whatsapp'`** (`navegacao.ts`, T07 Decisão 5) — quem gravou `contratacao_aba='links'` no aparelho antes desta spec, ao abrir a tela agora, cai direto em Configurações › WhatsApp em vez de na 1ª seção do menu (Empresas). Isso exige que `AreaConfiguracoes` (ou `page.tsx`) aceite um `secaoInicial` opcional — ver Step 4.

### Interfaces

**Consumes** (de T07/T10/T11):
```ts
import type { SecaoConfig } from '../navegacao'; // T07 — ganha 'whatsapp' nesta task
import LinksWhatsApp, { type EscopoWhatsApp } from './LinksWhatsApp'; // T11
```

**Produces** (assinaturas exatas):
```ts
// navegacao.ts — SecaoConfig ganha o 5º valor
export type SecaoConfig = 'empresas' | 'fases' | 'dados-minimos' | 'entrevista' | 'whatsapp';
// destinoDeAbaAntiga: o case 'links' passa a devolver { area: 'config', secaoConfig: 'whatsapp' }

// components/ConfigWhatsApp.tsx
interface Props { companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void }
export default function ConfigWhatsApp(props: Props): JSX.Element

// areas/AreaConfiguracoes.tsx — Props ganha jobs/onOpenCandidate/secaoInicial
interface Props {
  companies: Company[]; stages: Stage[]; settings: Settings; candidates: Candidate[];
  onReload: () => Promise<void>; onSettingsSaved: (s: Settings) => void; onRecalcCompany: (companyId: string) => Promise<void>;
  jobs: Job[];                                    // NOVO — alimenta ConfigWhatsApp
  onOpenCandidate: (id: string) => void;           // NOVO — alimenta ConfigWhatsApp (via ConversasDrawer)
  secaoInicial?: SecaoConfig | null;               // NOVO — Decisão 5, deep link ?aba=links
  onSecaoInicialUsada?: () => void;                // NOVO — mesmo padrão de focoId/onFocoUsado
}
```

### Steps

1. **`navegacao.ts` — acrescentar `'whatsapp'` a `SecaoConfig` e atualizar `destinoDeAbaAntiga`.** Trocar (`navegacao.ts`, linha da declaração do tipo, conferida em T07 Step 1):
   ```ts
   export type SecaoConfig = 'empresas' | 'fases' | 'dados-minimos' | 'entrevista';
   ```
   por:
   ```ts
   export type SecaoConfig = 'empresas' | 'fases' | 'dados-minimos' | 'entrevista' | 'whatsapp';
   ```
   E, dentro de `destinoDeAbaAntiga`, trocar o `case 'links'` (T07 Step 1):
   ```ts
   case 'links': return { area: 'config' };
   ```
   por:
   ```ts
   case 'links': return { area: 'config', secaoConfig: 'whatsapp' };
   ```
   Em `src/test/lib/contratacaoNavegacao.test.ts` (T07 Step 2, arquivo de teste **travado por T07** — mas o `it()` de `'links'` precisa acompanhar essa mudança, senão quebra), trocar:
   ```ts
   it('links → Configurações (seção WhatsApp só a partir de T12)', () => {
     expect(destinoDeAbaAntiga('links')).toEqual({ area: 'config' });
   });
   ```
   por:
   ```ts
   it('links → Configurações › WhatsApp', () => {
     expect(destinoDeAbaAntiga('links')).toEqual({ area: 'config', secaoConfig: 'whatsapp' });
   });
   ```
   (O comentário do teste antigo já previa essa atualização — "só a partir de T12" — não é uma mudança fora de escopo, é o próprio T07 dizendo que T12 devolveria aqui.) Rodar `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` — 13 testes, 0 falhas (o total não muda, só o valor esperado num `it()` já existente).

2. **Criar `src/pages/contratacao/components/ConfigWhatsApp.tsx` — invólucro fino (Decisão 1).** Corpo completo:
   ```tsx
   // Configurações › WhatsApp: canais sem vaga (bot_channels.job_id = null) e/ou canal padrão
   // (is_default = true) — RF-06. Mesmo LinksWhatsApp de sempre, escopo 'sem-vaga' (ver T11 Decisão 1/2).
   import LinksWhatsApp from './LinksWhatsApp';
   import type { Company, Job } from '../shared';

   interface Props { companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void }

   export default function ConfigWhatsApp({ companies, jobs, onOpenCandidate }: Props) {
     return <LinksWhatsApp companies={companies} jobs={jobs} onOpenCandidate={onOpenCandidate} escopo={{ tipo: 'sem-vaga' }} />;
   }
   ```

3. **`areas/AreaConfiguracoes.tsx` — acrescentar o 5º item e o `if` de renderização (origem verbatim de T10, Step 2).** Trocar `ITENS_MENU` e a `Props`/corpo:
   ```tsx
   import { useEffect, useState } from 'react';
   import ConfiguracoesContratacao from '../components/ConfiguracoesContratacao';
   import ConfigWhatsApp from '../components/ConfigWhatsApp';
   import type { Candidate, Company, Job, Settings, Stage } from '../shared';
   import type { SecaoConfig } from '../navegacao';

   interface Props {
     companies: Company[]; stages: Stage[]; settings: Settings; candidates: Candidate[];
     onReload: () => Promise<void>; onSettingsSaved: (s: Settings) => void; onRecalcCompany: (companyId: string) => Promise<void>;
     jobs: Job[]; onOpenCandidate: (id: string) => void;
     secaoInicial?: SecaoConfig | null; onSecaoInicialUsada?: () => void;
   }

   const ITENS_MENU: { id: SecaoConfig; label: string; icon: string }[] = [
     { id: 'empresas', label: 'Empresas', icon: 'ri-building-line' },
     { id: 'fases', label: 'Fases', icon: 'ri-layout-column-line' },
     { id: 'dados-minimos', label: 'Dados mínimos', icon: 'ri-file-list-3-line' },
     { id: 'entrevista', label: 'Entrevista', icon: 'ri-chat-voice-line' },
     { id: 'whatsapp', label: 'WhatsApp', icon: 'ri-whatsapp-line' },
   ];

   export default function AreaConfiguracoes(props: Props) {
     const [secao, setSecao] = useState<SecaoConfig>('empresas');
     useEffect(() => {
       if (props.secaoInicial) { setSecao(props.secaoInicial); props.onSecaoInicialUsada?.(); }
     }, [props.secaoInicial]);
     return (
       <div className="flex flex-col sm:flex-row gap-5">
         <nav className="flex flex-row sm:flex-col gap-1 overflow-x-auto sm:overflow-visible sm:w-48 flex-shrink-0 border-b sm:border-b-0 sm:border-r border-zinc-200 pb-2 sm:pb-0 sm:pr-3">
           {ITENS_MENU.map((item) => (
             <button key={item.id} onClick={() => setSecao(item.id)}
               className={`flex items-center gap-2 px-3 h-10 border-l-2 -ml-px text-sm font-bold whitespace-nowrap cursor-pointer text-left flex-shrink-0 ${
                 secao === item.id ? 'border-rose-600 text-rose-700 bg-rose-50/60' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
               <i className={item.icon} /> {item.label}
             </button>
           ))}
         </nav>
         <div className="flex-1 min-w-0">
           {secao === 'whatsapp' ? (
             <ConfigWhatsApp companies={props.companies} jobs={props.jobs} onOpenCandidate={props.onOpenCandidate} />
           ) : (
             <ConfiguracoesContratacao {...props} secao={secao} />
           )}
         </div>
       </div>
     );
   }
   ```
   Invariante: mesmas classes do `<nav>`/item de T10, só o array ganha 1 item e o `<div className="flex-1 min-w-0">` ganha um `if` antes de chamar `ConfiguracoesContratacao`. `secaoInicial`/`onSecaoInicialUsada` seguem o mesmo padrão de `focoId`/`onFocoUsado` que `EntrevistasDoDia`/`AreaEntrevistas` já usam (T09) — opcionais, para não quebrar quem não precisar (nenhum teste chama `AreaConfiguracoes` hoje).

4. **`page.tsx` — passar `jobs`/`onOpenCandidate`/`secaoInicial` para `AreaConfiguracoes` (conteúdo do branch `area === 'config'`, ver aviso de linhas em T11).** Localizar a chamada (conteúdo idêntico ao que T09 deixou — `<AreaConfiguracoes companies={...} stages={...} settings={...} candidates={items} onReload={...} onSettingsSaved={setSettings} onRecalcCompany={recalcCompany} />`) e trocar por:
   ```tsx
   ) : area === 'config' ? (
     <AreaConfiguracoes companies={companies} stages={stages} settings={settings} candidates={items}
       onReload={async () => { await carregarConfig(); const { data } = await supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000); if (data) setItems(data as Candidate[]); }}
       onSettingsSaved={setSettings} onRecalcCompany={recalcCompany}
       jobs={jobs} onOpenCandidate={abrirCandidatoDoBot}
       secaoInicial={focoSecaoConfig} onSecaoInicialUsada={() => setFocoSecaoConfig(null)} />
   ```
   Acrescentar o estado `focoSecaoConfig` junto de `focoSubabaEntrevistas` (T09): `const [focoSecaoConfig, setFocoSecaoConfig] = useState<SecaoConfig | null>(null);` (importar `type SecaoConfig` de `./navegacao`, já importado se T09 já trouxe `Destino`/`Area`/etc. — acrescentar `SecaoConfig` à mesma linha de import). No deep link (T09 Step 2, conteúdo `if (dest) { setArea(...); if (dest.subabaEntrevistas) ...; if (dest.modoCandidatos) ...; }`), acrescentar `if (dest.secaoConfig) setFocoSecaoConfig(dest.secaoConfig);` — assim `?aba=links` (ou `?aba=config`, que nunca carrega `secaoConfig`, permanecendo em Empresas) abre Configurações › WhatsApp de verdade, não só a área.

5. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **520 ou mais** (mesmo total desde T07 — esta task só troca o valor esperado de 1 `it()` já existente, não cria nem apaga teste), 0 failed.
   - `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` — `Tests 13 passed (13)`.
   - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não tocado.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Engrenagem → menu de Configurações mostra 5 itens (Empresas, Fases, Dados mínimos, Entrevista, **WhatsApp**); clicar em WhatsApp mostra `ConfigWhatsApp` (canais sem vaga e/ou padrão), sem empilhar os outros 4 cards.
- [ ] `?aba=links` (e `localStorage contratacao_aba='links'` gravado antes desta spec) abre Configurações **já na seção WhatsApp** (não mais só em Empresas).
- [ ] **Checklist item a item do que a aba "Links WhatsApp" oferecia — nada sumiu, cada item tem endereço novo (Constraint 11 + DoD extra obrigatório desta task):**
  - [ ] Criar canal ("Novo link") → `VagaDivulgacao` (canal da vaga, T11) **e** `ConfigWhatsApp` (canal sem vaga, aqui) — mesmo `CanalModal`, escopo diferente.
  - [ ] Editar canal → mesmo `Btn` "Editar" em ambos os escopos.
  - [ ] Copiar link → mesmo `Btn` "Copiar link" em ambos.
  - [ ] QR Code → mesmo `Btn`/`QrModal` em ambos.
  - [ ] Ver conversas → mesmo `Btn` "Conversas" → `ConversasDrawer`, em ambos.
  - [ ] Marcar como resolvida → dentro de `ConversasDrawer` (`resolver`), inalterado, em ambos.
  - [ ] Pausar/Ativar → mesmo `Btn`, em ambos.
  - [ ] Excluir canal → mesmo `Btn`, em ambos.
  - [ ] Badge "Padrão" (`is_default`) → mesmo badge no card, em ambos (inclusive no card de uma vaga, se aquele canal também for padrão — Decisão 2 de T11).
  - [ ] Toggle `is_default` com exclusividade (só 1 padrão por vez) → mesma lógica em `salvar` (`LinksWhatsApp.tsx:119-129`, não duplicada, um só lugar) — funciona a partir do `CanalModal` em qualquer dos dois escopos.
  - [ ] Número do assistente (campo "Número", `contratacao_wa_number`) → aparece nas duas telas (Divulgação da vaga e Configurações › WhatsApp) porque é 1 campo compartilhado via `localStorage`, não uma lista — não fere a regra de não duplicar **listagem**.
  - [ ] Estatísticas por canal (conversas/currículos/pedem atenção) → mesmo `Stat`, em ambos.
  - [ ] Aviso de modo teste (rodapé "mande #sair...") → mesmo texto, em ambos.
- [ ] `VagaDivulgacao` (T11) e `ConfigWhatsApp` (aqui) estão **os dois** funcionando antes de considerar a Fase 4 concluída — é a verificação que substitui o Step de remoção da aba (já removida em T09, ver aviso do topo desta task).
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] `npx vitest run src/test/lib/contratacaoNavegacao.test.ts` → `Tests 13 passed (13)` (1 `it()` com expectativa atualizada, não um teste novo).
- [ ] `npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes (menu de T10, `LinksWhatsApp`/escopo de T11), não criou novos.
- [ ] Rastreio: RF-06 (Configurações › WhatsApp), RF-07 (5º item do menu).

## T13: `hoje.ts` — contagens e "Precisa de você"

| Campo | Valor |
|---|---|
| **Entregável** | `contagensHoje()` (3 números), `proximoDiaComEntrevistas()`/`formatarDiaCurto()` (atalho "próxima: seg 21/09 · 7") e `montarPrecisaDeVoce()` (as 3 fontes de dado puras de "Precisa de você") |
| **Onde** | `src/pages/contratacao/hoje.ts` (criar), `src/test/lib/contratacaoHoje.test.ts` (criar) |
| **Depende de** | — |
| **Bloqueia** | T14 |
| **Paralelo com** | — (única task disjunta da Fase 5, mas a Fase 5 é sequencial pela ordem do briefing — não há outra task da fase pra rodar ao lado) |
| **Profundidade** | `snippets` (override desta task — ver `#profundidade-do-plano`) |
| **Requisitos** | RF-08, US-08 (implícito em RF-08 — a spec não numera US para Hoje além dos critérios de sucesso) |

### Context pack

- Spec: RF-08 verbatim (`#c-spec-filtrada`) — 3 números, as 4 fontes de "Precisa de você" (`aguardando_gestor`, `needs_human`, sessão `erro`, `BotaoAvisos` — as 3 primeiras são lógica pura desta task; `BotaoAvisos` **não** entra aqui, é componente à parte, ver Decisão abaixo); RF-05 última linha (atalho "Ir para a próxima: seg 21/09 · 7 entrevistas" — a conta é a mesma usada no "dia vazio" dos 3 números, por isso a função nasce aqui e não dentro de `EntrevistasDoDia.tsx`); Critérios de sucesso ("Testes unitários para... composição 'Precisa de você'"; "`BotaoAvisos` continua funcional... dentro de 'Precisa de você'").
- Global Constraints: `#global-constraints` #1 (N/A — lógica pura, sem JSX), #3 (teste só em lógica pura — este é o caso, junto com T01/T07), #8 (nada de banco — função pura, recebe dados já carregados pelo shell; os tipos de sessão/conversa aqui são cópias estruturais, não uma query nova), #9 (gate), #10 (não toca `entrevistasDoDia.test.tsx`).
- **AGENTS.md, linha 75:** "Datas em horário de Brasília (não UTC 'cru') em toda exibição e regra de negócio com corte por dia." — RF-08 é regra de corte por dia (entrevistas "de hoje", currículos "novos" = de hoje) → **Decisão 2** abaixo fixa `America/Sao_Paulo` explícito, independente do fuso de quem roda o teste ou o navegador.
- Padrão do repo: `src/test/lib/tipoEmpresa.test.ts` (E7) e `src/test/lib/contratacaoAderencia.test.ts` (T01, mesmo padrão: `describe`/`it` em pt-BR, fábricas `job()`/`app()` curtas) — este teste imita os dois. Padrão de corte por dia com TZ explícito: `AgendamentosPainel.tsx:35-37` (`TZ = 'America/Sao_Paulo'`, `quando`/`quandoLongo` com `toLocaleString(..., { timeZone: TZ, ... })`) e o cálculo de hora corrente `AgendamentosPainel.tsx:150` (`new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date())`) — mesma família de API (`Intl`/`toLocaleString` com `timeZone` explícito), aqui usada para o dia (`en-CA` dá `AAAA-MM-DD` direto, sem *parsing* manual). Rótulo curto de dia ("seg 21/09"): mesmo padrão de `EntrevistasDoDia.tsx` (semana da tira de datas, `new Date(`${k}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')`) — **só citado como padrão a imitar, arquivo não editado nem importado** (é "nenhuma" no Mapa).
- Tipos consumidos (verbatim de `shared.ts`, **não editar esse arquivo**): `Interview`/`InterviewStatus` (`shared.ts:227-246`), `Candidate` (`shared.ts:169-211`, em especial `created_at`), `Job` (`shared.ts:99-114`), `FichaCfg`/`faltasFicha` (`shared.ts:295,318-332`).
- Tabelas já lidas pelo módulo cujas colunas moldam os tipos estruturais desta task (Constraint 8 — nenhuma é nova): `hiring_scheduling_sessions` (colunas confirmadas em `supabase/migrations/20260914210000_hiring_agendamento_assistente.sql:30-46`: `id, candidate_id, job_id, status, interview_id, pending_request, error, updated_at` + `confirmed_at`/`confirm_requested_at`, já lidas em `EntrevistasDoDia.tsx:75` e em `AgendamentosPainel.tsx` via `Sess`); `bot_conversations` (`Conversation`, `LinksWhatsApp.tsx:27-41`).
- Arquivos vizinhos: nenhum — módulo novo, sem dependência de `page.tsx` (mesma regra de T01/T07: evita ciclo, já que é `page.tsx`/`AreaHoje.tsx` quem vai importar `hoje.ts`, nunca o contrário).
- **Não fazer:** não importar nada de `page.tsx`, `AgendamentosPainel.tsx` ou `LinksWhatsApp.tsx` (os tipos de sessão/conversa são cópias estruturais mínimas, documentadas com a origem, mesma técnica de T18 com `AGENDAMENTO_IA`/`SESS_LABEL`); não fazer `new Date()` dentro das funções de contagem (recebe `agora: Date` de fora — é o que permite ao teste fixar a virada de dia sem depender do relógio da máquina); não incluir `BotaoAvisos` na lista de itens (Decisão abaixo: ele é renderizado à parte por quem chama, em T14); não formatar texto final de UI dentro de `montarPrecisaDeVoce` além do que está explicitamente nas Interfaces (a função devolve dado, não string pronta para o pedido de horário — ver Decisão 1).

### Decisões tomadas

1. **Modelo dos itens de "Precisa de você" é dado, não JSX** (mandado pelo material, seção G item 1). `ItemPrecisaDeVoce` é uma união discriminada por `tipo` (`'aguardando_gestor' | 'needs_human' | 'erro'`); cada variante carrega só os campos que o item precisa para render + ação (`sessionId`/`conversationId` para agir, `candidateId` para abrir a ficha, textos já resolvidos contra os mapas de candidato/vaga). O pedido de horário (`aguardando_gestor`) chega em dois campos mutuamente exclusivos — `pedidoDataHora: string | null` (ISO, quando o candidato disse data/hora exata) e `pedidoTextoLivre: string | null` (quando não disse) — em vez de uma string já formatada, porque formatar data/hora é decisão de exibição (locale, `Intl`) que pertence a quem renderiza (T14), não à função pura; o teste verifica **qual dos dois campos vem preenchido**, não o texto formatado.
2. **Convenção de fuso: `America/Sao_Paulo` explícito em toda função de corte por dia** (AGENTS.md linha 75), via `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', ... })` — `en-CA` devolve `AAAA-MM-DD` direto, mesma forma de `dayKey` (`shared.ts:429`), mas sem depender do fuso do processo que roda o código (o `dayKey` de `shared.ts`, usado por `EntrevistasDoDia.tsx`, é local ao navegador — divergência pré-existente entre páginas do módulo, fora do escopo desta task consertar; `hoje.ts` é código novo e segue a regra do AGENTS.md à risca). O teste fixa a virada de dia com um horário perto da meia-noite em Brasília cujo UTC já caiu no dia seguinte (Step 2, caso "fuso"), provando que a função usa o fuso certo e não `getUTCDate`/`getDate` cru.
3. **`agora: Date` é parâmetro, nunca `new Date()` interno** — mesma razão do item 2: testabilidade determinística. Quem chama (`AreaHoje.tsx`, T14) passa `new Date()` uma vez por renderização/*tick* do polling de 60 s já existente no shell.
4. **`BotaoAvisos` fica fora de `montarPrecisaDeVoce`.** RF-08 item 4 é claro que o componente "já esconde a si mesmo" — não há dado a montar, só um lugar para renderizar. Modelar um item fake para ele obrigaria `hoje.ts` a saber sobre `tenantId`/estados de push, que são de infraestrutura de notificação, não de "Precisa de você" como conteúdo do módulo. T14 renderiza `<BotaoAvisos>` como um item a mais na lista, ao lado dos itens desta função, sem passar por aqui.
5. **Ordem e desempate:** grupos na ordem do RF-08 (`aguardando_gestor` → `needs_human` → `erro`); dentro de cada grupo, mais recente primeiro (`updated_at`/`last_message_at` decrescente) — mesmo critério de "mais recente vence" já usado em `melhorAderencia` (T01) e no `Map` de T18.
6. **Candidato removido / vaga apagada:** mesmo padrão de T01/T18 — não inventa nome; usa `'Candidato removido'` (texto já usado em `AgendamentosPainel.tsx`, ex. linha do `cand?.full_name ?? 'Candidato removido'`) e `jobTitle: null` quando a vaga não está mais em `jobs` (o card não mostra vaga, não trava).
7. **`proximoDiaComEntrevistas`/`formatarDiaCurto` são exportados separadamente** de `contagensHoje` (que os usa por dentro, só quando `entrevistasHoje === 0`) — RF-05 pede o mesmo cálculo dentro de `EntrevistasDoDia.tsx` em dia vazio ("atalho 'Ir para a próxima'"), mas essa tela está protegida (Mapa: "nenhuma"; testada por `entrevistasDoDia.test.tsx`, que não pode ser editado). **BLOQUEIO de escopo, registrado aqui e não implementado:** o atalho *dentro* de `EntrevistasDoDia.tsx` exigiria alterar um arquivo marcado "nenhuma" no Mapa e tocar o componente que o teste de regressão cobre — precisa de decisão do dev para incluir `EntrevistasDoDia.tsx` no "Onde" desta spec (ou de uma spec futura). Esta task só garante que a função existe, testada, pronta para ser chamada dali quando o dev autorizar; T14 já a usa (dentro da tela Hoje, que não tem essa restrição).

### Interfaces

**Produces** (consumido por T14):
```ts
// src/pages/contratacao/hoje.ts
export function diaKeyBR(iso: string): string; // AAAA-MM-DD em horário de Brasília
export function formatarDiaCurto(diaKey: string): string; // "seg 21/09"

export interface ProximoDiaComEntrevistas { diaKey: string; quantidade: number }
export function proximoDiaComEntrevistas(interviews: Interview[], apartirDe: Date): ProximoDiaComEntrevistas | null;

export interface ContagensHoje {
  entrevistasHoje: number;
  proximaComEntrevistas: ProximoDiaComEntrevistas | null; // só preenchido quando entrevistasHoje === 0
  curriculosNovos: number;
  curriculosComFichaIncompleta: number;
  entrevistasPassadasSemRegistro: number;
}
export function contagensHoje(interviews: Interview[], candidates: Candidate[], ficha: FichaCfg, agora: Date): ContagensHoje;

// "Precisa de você" — tipos estruturais próprios (não importados de page.tsx/AgendamentosPainel/LinksWhatsApp).
export interface SessaoAgendamento {
  id: string; candidate_id: string; job_id: string; status: string; error: string | null;
  pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
  updated_at: string;
}
export interface ConversaNeedsHuman {
  id: string; contact_name: string | null; contact_phone: string | null; candidate_ids: string[]; last_message_at: string;
}

export type TipoPrecisaDeVoce = 'aguardando_gestor' | 'needs_human' | 'erro';
export interface ItemAguardandoGestor {
  tipo: 'aguardando_gestor'; sessionId: string; candidateId: string; candidateName: string; jobTitle: string | null;
  pedidoDataHora: string | null; pedidoTextoLivre: string | null;
}
export interface ItemNeedsHuman {
  tipo: 'needs_human'; conversationId: string; nome: string; candidateId: string | null; atualizadoEm: string;
}
export interface ItemErro {
  tipo: 'erro'; sessionId: string; candidateId: string; candidateName: string; jobTitle: string | null; mensagem: string;
}
export type ItemPrecisaDeVoce = ItemAguardandoGestor | ItemNeedsHuman | ItemErro;

export function montarPrecisaDeVoce(input: {
  sessoes: SessaoAgendamento[]; candidates: Candidate[]; jobs: Job[]; conversas: ConversaNeedsHuman[];
}): ItemPrecisaDeVoce[];
```
**Nota para T14 (Interfaces cross-task):** `SessaoAgendamento` é um **subconjunto estrutural** de `AgendamentoIASessao` (T18, `page.tsx`) depois de T14 estender o `select` — T14 passa o array de `schedSessions` direto (TypeScript aceita por compatibilidade estrutural, os campos extras de `AgendamentoIASessao` não atrapalham); `ConversaNeedsHuman` é o que `AreaHoje.tsx` lê de `bot_conversations` por conta própria (T14, Decisão de "Onde" abaixo) — não vem do shell.

### Steps

1. **Criar `src/pages/contratacao/hoje.ts`** com o corpo completo:
   ```ts
   // Tela Hoje de Contratação (RF-08): os 3 números e a montagem de "Precisa de você". Lógica pura —
   // recebe os dados já carregados pelo shell/AreaHoje, nunca faz query, nunca importa page.tsx (evita
   // ciclo, mesma regra de aderencia.ts/navegacao.ts). Datas em horário de Brasília (AGENTS.md linha 75:
   // corte por dia nunca em UTC cru) — fuso fixo, não depende da máquina que roda o código/teste.
   import { type Candidate, type FichaCfg, type Interview, type Job, faltasFicha } from './shared';

   const TZ = 'America/Sao_Paulo';

   /** Chave AAAA-MM-DD do dia, em horário de Brasília, a partir de um ISO qualquer. */
   export function diaKeyBR(iso: string): string {
     return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
   }

   /**
    * "seg 21/09" — mesmo formato da tira de dias de EntrevistasDoDia.tsx (dia às 12h locais só para
    * achar o nome da semana; a chave em si já veio de diaKeyBR, então não precisa de TZ aqui de novo).
    */
   export function formatarDiaCurto(diaKey: string): string {
     const [, m, d] = diaKey.split('-');
     const semana = new Date(`${diaKey}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
     return `${semana} ${d}/${m}`;
   }

   export interface ProximoDiaComEntrevistas { diaKey: string; quantidade: number }

   /**
    * 1º dia estritamente depois de `apartirDe` (Brasília) com pelo menos 1 entrevista não cancelada.
    * RF-05 (dia vazio: "Ir para a próxima: seg 21/09 · 7 entrevistas") e RF-08 (3º número, mesma conta).
    */
   export function proximoDiaComEntrevistas(interviews: Interview[], apartirDe: Date): ProximoDiaComEntrevistas | null {
     const hojeKey = diaKeyBR(apartirDe.toISOString());
     const porDia = new Map<string, number>();
     for (const iv of interviews) {
       if (iv.status === 'cancelada') continue;
       const k = diaKeyBR(iv.scheduled_at);
       if (k <= hojeKey) continue; // só estritamente depois de hoje
       porDia.set(k, (porDia.get(k) ?? 0) + 1);
     }
     const diaKey = [...porDia.keys()].sort()[0];
     return diaKey ? { diaKey, quantidade: porDia.get(diaKey)! } : null;
   }

   export interface ContagensHoje {
     entrevistasHoje: number;
     /** Só preenchido quando entrevistasHoje === 0 (RF-08: o atalho só faz sentido em dia vazio). */
     proximaComEntrevistas: ProximoDiaComEntrevistas | null;
     curriculosNovos: number;
     curriculosComFichaIncompleta: number;
     entrevistasPassadasSemRegistro: number;
   }

   /**
    * Os 3 números da tela Hoje (RF-08). `agora` é injetado (nunca `new Date()` interno) para o teste
    * fixar a virada de dia sem depender do relógio de quem roda o teste.
    */
   export function contagensHoje(interviews: Interview[], candidates: Candidate[], ficha: FichaCfg, agora: Date): ContagensHoje {
     const hojeKey = diaKeyBR(agora.toISOString());
     const agoraIso = agora.toISOString();
     const entrevistasDeHoje = interviews.filter((iv) => iv.status !== 'cancelada' && diaKeyBR(iv.scheduled_at) === hojeKey);
     const curriculosDeHoje = candidates.filter((c) => diaKeyBR(c.created_at) === hojeKey);
     return {
       entrevistasHoje: entrevistasDeHoje.length,
       proximaComEntrevistas: entrevistasDeHoje.length === 0 ? proximoDiaComEntrevistas(interviews, agora) : null,
       curriculosNovos: curriculosDeHoje.length,
       curriculosComFichaIncompleta: curriculosDeHoje.filter((c) => faltasFicha(c, ficha).length > 0).length,
       // "agendada" e o horário já passou: ninguém marcou realizada/faltou/cancelada.
       entrevistasPassadasSemRegistro: interviews.filter((iv) => iv.status === 'agendada' && iv.scheduled_at < agoraIso).length,
     };
   }

   // ── "Precisa de você" (RF-08) ───────────────────────────────────────────────
   // Tipos estruturais próprios (não importados de page.tsx/AgendamentosPainel.tsx/LinksWhatsApp.tsx —
   // evita ciclo e evita este módulo depender do shell). Colunas confirmadas em
   // supabase/migrations/20260914210000_hiring_agendamento_assistente.sql:30-46 (hiring_scheduling_sessions)
   // e em LinksWhatsApp.tsx:27-41 (Conversation, bot_conversations) — nenhuma tabela nova (Constraint 8).
   export interface SessaoAgendamento {
     id: string;
     candidate_id: string;
     job_id: string;
     status: string;
     error: string | null;
     pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
     updated_at: string;
   }
   export interface ConversaNeedsHuman {
     id: string;
     contact_name: string | null;
     contact_phone: string | null;
     candidate_ids: string[];
     last_message_at: string;
   }

   export type TipoPrecisaDeVoce = 'aguardando_gestor' | 'needs_human' | 'erro';
   export interface ItemAguardandoGestor {
     tipo: 'aguardando_gestor';
     sessionId: string;
     candidateId: string;
     candidateName: string;
     jobTitle: string | null;
     /** Mutuamente exclusivos: o candidato disse data/hora exata, ou só um texto livre. Formatar para
      * exibição é decisão de quem renderiza (AreaHoje.tsx), não desta função. */
     pedidoDataHora: string | null;
     pedidoTextoLivre: string | null;
   }
   export interface ItemNeedsHuman {
     tipo: 'needs_human';
     conversationId: string;
     nome: string;
     /** 1º candidato vinculado à conversa, para abrir a ficha; null = conversa sem candidato ainda. */
     candidateId: string | null;
     atualizadoEm: string;
   }
   export interface ItemErro {
     tipo: 'erro';
     sessionId: string;
     candidateId: string;
     candidateName: string;
     jobTitle: string | null;
     mensagem: string;
   }
   export type ItemPrecisaDeVoce = ItemAguardandoGestor | ItemNeedsHuman | ItemErro;

   const CANDIDATO_REMOVIDO = 'Candidato removido'; // mesmo texto de AgendamentosPainel.tsx

   /**
    * Monta "Precisa de você" (RF-08) a partir dos dados já carregados — nenhuma query aqui. Ordem:
    * pedidos de horário (aguardando_gestor) → conversas que a IA não segue sozinha (needs_human) →
    * convites/agendamentos com erro; dentro de cada grupo, mais recente primeiro. O aviso de
    * notificações (BotaoAvisos) NÃO entra aqui — é componente à parte que já esconde a si mesmo
    * quando não há nada a fazer; quem chama (AreaHoje.tsx) o renderiza ao lado desta lista.
    */
   export function montarPrecisaDeVoce(input: {
     sessoes: SessaoAgendamento[];
     candidates: Candidate[];
     jobs: Job[];
     conversas: ConversaNeedsHuman[];
   }): ItemPrecisaDeVoce[] {
     const { sessoes, candidates, jobs, conversas } = input;
     const candNome = new Map(candidates.map((c) => [c.id, c.full_name]));
     const jobTitulo = new Map(jobs.map((j) => [j.id, j.title]));

     const aguardando: ItemAguardandoGestor[] = sessoes
       .filter((s) => s.status === 'aguardando_gestor')
       .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
       .map((s) => ({
         tipo: 'aguardando_gestor' as const,
         sessionId: s.id,
         candidateId: s.candidate_id,
         candidateName: candNome.get(s.candidate_id) ?? CANDIDATO_REMOVIDO,
         jobTitle: jobTitulo.get(s.job_id) ?? null,
         pedidoDataHora: s.pending_request?.starts_at ?? null,
         pedidoTextoLivre: s.pending_request?.starts_at ? null : (s.pending_request?.texto ?? ''),
       }));

     const precisamDeHumano: ItemNeedsHuman[] = conversas
       .slice()
       .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
       .map((c) => ({
         tipo: 'needs_human' as const,
         conversationId: c.id,
         nome: c.contact_name || c.contact_phone || 'Sem nome',
         candidateId: c.candidate_ids[0] ?? null,
         atualizadoEm: c.last_message_at,
       }));

     const comErro: ItemErro[] = sessoes
       .filter((s) => s.status === 'erro')
       .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
       .map((s) => ({
         tipo: 'erro' as const,
         sessionId: s.id,
         candidateId: s.candidate_id,
         candidateName: candNome.get(s.candidate_id) ?? CANDIDATO_REMOVIDO,
         jobTitle: jobTitulo.get(s.job_id) ?? null,
         mensagem: s.error ?? 'Falhou ao enviar.',
       }));

     return [...aguardando, ...precisamDeHumano, ...comErro];
   }
   ```

2. **Criar `src/test/lib/contratacaoHoje.test.ts`** com o corpo completo:
   ```ts
   import { describe, it, expect } from 'vitest';
   import {
     contagensHoje, diaKeyBR, formatarDiaCurto, montarPrecisaDeVoce, proximoDiaComEntrevistas,
     type ConversaNeedsHuman, type SessaoAgendamento,
   } from '../../pages/contratacao/hoje';
   import type { Candidate, FichaCfg, Interview, Job } from '../../pages/contratacao/shared';

   const ficha: FichaCfg = { required_fields: ['full_name', 'phone'], custom_fields: [] };

   const iv = (over: Partial<Interview>): Interview => ({
     id: over.id ?? 'iv1', candidate_id: over.candidate_id ?? 'c1', company_id: null,
     scheduled_at: over.scheduled_at ?? '2026-09-21T15:00:00Z', duration_min: 30, format: 'presencial', location: null,
     interviewer: null, status: over.status ?? 'agendada', scores: {}, answers: {}, recommendation: null, notes: null,
     created_at: '2026-09-01T00:00:00Z',
   });
   const cand = (over: Partial<Candidate>): Candidate => ({
     id: over.id ?? 'c1', company_id: null, stage_id: null, full_name: over.full_name ?? 'Fulana', email: null,
     phone: over.phone ?? '41999999999', city: null, neighborhood: null, address: null, marital_status: null, decision: null,
     lat: null, lng: null, geo_label: null, geo_precision: null, birth_date: null, age: null, desired_role: null, summary: null,
     experiences: [], education: [], skills: [], languages: [], courses: [], availability: null, salary_expectation: null,
     driver_license: null, total_experience_months: null, strengths: [], concerns: [], rating: null, notes: null, file_path: null,
     file_name: null, file_type: null, raw_text: null, ai_processed: false,
     created_at: over.created_at ?? '2026-09-21T12:00:00Z',
   });
   const job = (id: string, title: string): Job => ({
     id, company_id: null, title, description: null, requirements: null, desirable: null, schedule: null, salary: null,
     benefits: null, contract_type: null, openings: 1, status: 'aberta', notes: null, opened_at: '2026-01-01', closed_at: null,
     created_at: '2026-01-01',
   });

   describe('diaKeyBR — corte por dia em horário de Brasília (AGENTS.md linha 75)', () => {
     it('23h30 de um dia em Brasília, mesmo com UTC já no dia seguinte, fica no dia de Brasília', () => {
       // 2026-09-21T02:30:00Z = 2026-09-20T23:30 em America/Sao_Paulo (UTC-3)
       expect(diaKeyBR('2026-09-21T02:30:00Z')).toBe('2026-09-20');
     });
     it('meio-dia UTC de um dia é meio-dia em Brasília no mesmo dia civil', () => {
       expect(diaKeyBR('2026-09-21T15:00:00Z')).toBe('2026-09-21');
     });
   });

   describe('formatarDiaCurto', () => {
     it('formata "seg 21/09" (21/09/2026 é uma segunda-feira)', () => {
       expect(formatarDiaCurto('2026-09-21')).toBe('seg 21/09');
     });
   });

   describe('proximoDiaComEntrevistas', () => {
     const agora = new Date('2026-09-21T15:00:00Z'); // 2026-09-21 12:00 em Brasília

     it('sem entrevista futura, devolve null', () => {
       expect(proximoDiaComEntrevistas([iv({ scheduled_at: '2026-09-21T15:00:00Z' })], agora)).toBeNull();
     });
     it('acha o primeiro dia futuro com entrevista e conta quantas tem', () => {
       const ivs = [
         iv({ id: 'a', scheduled_at: '2026-09-24T14:00:00Z' }),
         iv({ id: 'b', scheduled_at: '2026-09-24T15:00:00Z' }),
         iv({ id: 'c', scheduled_at: '2026-09-28T14:00:00Z' }),
       ];
       expect(proximoDiaComEntrevistas(ivs, agora)).toEqual({ diaKey: '2026-09-24', quantidade: 2 });
     });
     it('ignora entrevista cancelada ao contar', () => {
       const ivs = [iv({ id: 'a', scheduled_at: '2026-09-24T14:00:00Z', status: 'cancelada' })];
       expect(proximoDiaComEntrevistas(ivs, agora)).toBeNull();
     });
     it('não conta hoje nem dias passados como "próxima"', () => {
       const ivs = [iv({ id: 'a', scheduled_at: '2026-09-21T18:00:00Z' }), iv({ id: 'b', scheduled_at: '2026-09-19T14:00:00Z' })];
       expect(proximoDiaComEntrevistas(ivs, agora)).toBeNull();
     });
   });

   describe('contagensHoje', () => {
     const agora = new Date('2026-09-21T15:00:00Z'); // 2026-09-21 12:00 em Brasília

     it('conta entrevistas de hoje e ignora as de outros dias e as canceladas', () => {
       const ivs = [
         iv({ id: 'a', scheduled_at: '2026-09-21T14:00:00Z' }),
         iv({ id: 'b', scheduled_at: '2026-09-21T02:30:00Z' }), // 20/09 em Brasília: não é hoje
         iv({ id: 'c', scheduled_at: '2026-09-21T18:00:00Z', status: 'cancelada' }),
       ];
       expect(contagensHoje(ivs, [], ficha, agora).entrevistasHoje).toBe(1);
     });

     it('dia vazio: preenche proximaComEntrevistas com a mesma conta de proximoDiaComEntrevistas', () => {
       const ivs = [iv({ id: 'a', scheduled_at: '2026-09-24T14:00:00Z' }), iv({ id: 'b', scheduled_at: '2026-09-24T15:00:00Z' })];
       expect(contagensHoje(ivs, [], ficha, agora).proximaComEntrevistas).toEqual({ diaKey: '2026-09-24', quantidade: 2 });
     });

     it('dia com entrevista: proximaComEntrevistas fica null (o atalho só serve para dia vazio)', () => {
       const ivs = [iv({ id: 'a', scheduled_at: '2026-09-21T14:00:00Z' })];
       expect(contagensHoje(ivs, [], ficha, agora).proximaComEntrevistas).toBeNull();
     });

     it('currículos novos: só os criados hoje, e quantos têm ficha incompleta', () => {
       const candidatos = [
         cand({ id: 'c1', created_at: '2026-09-21T12:00:00Z', phone: '' }), // hoje, incompleta (telefone vazio)
         cand({ id: 'c2', created_at: '2026-09-21T13:00:00Z', phone: '41999999999' }), // hoje, completa
         cand({ id: 'c3', created_at: '2026-09-20T12:00:00Z', phone: '' }), // ontem: não conta
       ];
       const r = contagensHoje([], candidatos, ficha, agora);
       expect(r.curriculosNovos).toBe(2);
       expect(r.curriculosComFichaIncompleta).toBe(1);
     });

     it('entrevistas passadas sem registro: agendada com horário já passado', () => {
       const ivs = [
         iv({ id: 'a', scheduled_at: '2026-09-20T14:00:00Z', status: 'agendada' }), // passou, sem registro
         iv({ id: 'b', scheduled_at: '2026-09-20T14:00:00Z', status: 'realizada' }), // passou, já registrada
         iv({ id: 'c', scheduled_at: '2026-09-22T14:00:00Z', status: 'agendada' }), // ainda não passou
       ];
       expect(contagensHoje(ivs, [], ficha, agora).entrevistasPassadasSemRegistro).toBe(1);
     });
   });

   describe('montarPrecisaDeVoce', () => {
     const jobs = [job('j1', 'Atendente')];
     const candidates = [cand({ id: 'c1', full_name: 'Ana' }), cand({ id: 'c2', full_name: 'Bruna' })];
     const sess = (over: Partial<SessaoAgendamento>): SessaoAgendamento => ({
       id: over.id ?? 's1', candidate_id: over.candidate_id ?? 'c1', job_id: over.job_id ?? 'j1',
       status: over.status ?? 'aguardando_gestor', error: over.error ?? null,
       pending_request: over.pending_request ?? null, updated_at: over.updated_at ?? '2026-09-21T10:00:00Z',
     });
     const conversa = (over: Partial<ConversaNeedsHuman>): ConversaNeedsHuman => ({
       id: over.id ?? 'cv1', contact_name: over.contact_name ?? 'Carlos', contact_phone: over.contact_phone ?? '41988887777',
       candidate_ids: over.candidate_ids ?? [], last_message_at: over.last_message_at ?? '2026-09-21T09:00:00Z',
     });

     it('sem nenhuma fonte, lista vazia', () => {
       expect(montarPrecisaDeVoce({ sessoes: [], candidates: [], jobs: [], conversas: [] })).toEqual([]);
     });

     it('aguardando_gestor com data exata: pedidoDataHora preenchido, pedidoTextoLivre nulo', () => {
       const s = sess({ pending_request: { starts_at: '2026-09-22T14:00:00Z' } });
       const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
       expect(item).toEqual({
         tipo: 'aguardando_gestor', sessionId: 's1', candidateId: 'c1', candidateName: 'Ana', jobTitle: 'Atendente',
         pedidoDataHora: '2026-09-22T14:00:00Z', pedidoTextoLivre: null,
       });
     });

     it('aguardando_gestor sem data exata: pedidoTextoLivre preenchido, pedidoDataHora nulo', () => {
       const s = sess({ pending_request: { texto: 'semana que vem' } });
       const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
       expect(item.pedidoDataHora).toBeNull();
       expect((item as { pedidoTextoLivre: string }).pedidoTextoLivre).toBe('semana que vem');
     });

     it('needs_human vira item com o nome da conversa e o candidato vinculado', () => {
       const c = conversa({ candidate_ids: ['c2'] });
       const [item] = montarPrecisaDeVoce({ sessoes: [], candidates, jobs: [], conversas: [c] });
       expect(item).toEqual({ tipo: 'needs_human', conversationId: 'cv1', nome: 'Carlos', candidateId: 'c2', atualizadoEm: '2026-09-21T09:00:00Z' });
     });

     it('sessão erro vira item com a mensagem', () => {
       const s = sess({ status: 'erro', error: 'número inválido' });
       const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
       expect(item).toEqual({ tipo: 'erro', sessionId: 's1', candidateId: 'c1', candidateName: 'Ana', jobTitle: 'Atendente', mensagem: 'número inválido' });
     });

     it('sessão erro sem mensagem cai no texto padrão', () => {
       const s = sess({ status: 'erro', error: null });
       const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
       expect((item as { mensagem: string }).mensagem).toBe('Falhou ao enviar.');
     });

     it('candidato removido não trava: usa o texto padrão', () => {
       const s = sess({ candidate_id: 'c-removido' });
       const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
       expect((item as { candidateName: string }).candidateName).toBe('Candidato removido');
     });

     it('vaga apagada não trava: jobTitle fica null', () => {
       const s = sess({ job_id: 'j-apagada' });
       const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
       expect((item as { jobTitle: string | null }).jobTitle).toBeNull();
     });

     it('status fora das 3 chaves (ex.: "convidado") não vira item nenhum', () => {
       const s = sess({ status: 'convidado' });
       expect(montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] })).toEqual([]);
     });

     it('ordem: aguardando_gestor, depois needs_human, depois erro; mais recente primeiro dentro do grupo', () => {
       const s1 = sess({ id: 's-velha', status: 'aguardando_gestor', updated_at: '2026-09-20T10:00:00Z' });
       const s2 = sess({ id: 's-nova', status: 'aguardando_gestor', updated_at: '2026-09-21T10:00:00Z' });
       const e1 = sess({ id: 'e1', status: 'erro', updated_at: '2026-09-21T11:00:00Z' });
       const c1 = conversa({ id: 'cv1' });
       const itens = montarPrecisaDeVoce({ sessoes: [s1, e1, s2], candidates, jobs, conversas: [c1] });
       expect(itens.map((i) => i.tipo)).toEqual(['aguardando_gestor', 'aguardando_gestor', 'needs_human', 'erro']);
       expect((itens[0] as { sessionId: string }).sessionId).toBe('s-nova');
     });
   });
   ```

3. Rodar `npx vitest run src/test/lib/contratacaoHoje.test.ts` — esperado `Test Files 1 passed (1)` e `Tests 24 passed (24)`, sem falha.

4. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **o total acumulado desde T12 + 24 novos** (esta task não apaga teste nenhum; conferir o total exato rodando `npx vitest run` antes de começar, como manda a Constraint 9), 0 failed.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] `hoje.ts` e o teste criados exatamente como nos Steps 1/2; todos os exports de **Interfaces** presentes com a assinatura exata.
- [ ] `npx vitest run src/test/lib/contratacaoHoje.test.ts` → `Tests 24 passed (24)`.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher (acumulado + 24 novos); `npx vite build` limpo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos (N/A nesta task: é lógica pura, sem JSX).
- [ ] Nada desapareceu (Constraint 11): task só adiciona arquivos novos, não mexe em nada existente.
- [ ] `entrevistasDoDia.test.tsx` continua verde, sem edição (não é tocado por esta task, mas confirmar que a suíte inteira passa).
- [ ] **BLOQUEIO de escopo registrado** (Decisão 7): o atalho "Ir para a próxima" *dentro* de `EntrevistasDoDia.tsx` não foi implementado — exigiria editar um arquivo "nenhuma" do Mapa protegido por teste; a função que o alimentaria já existe e está testada.
- [ ] Rastreio: RF-08 (3 números + as 3 fontes lógicas de "Precisa de você"), RF-05 última linha (função pronta, uso bloqueado — ver acima).

---

## T14: Área Hoje

> **Aviso sobre números de linha:** as linhas de `page.tsx` citadas nesta task são do As Is medido em **2026-09-20, antes das Fases 1 a 4** (mesma regra de T09/T10). Depois de T02/T03/T08/T09/T18, os números deslizaram — **localize cada trecho pelo conteúdo citado**, não pelo número. As linhas de `AgendamentosPainel.tsx` e `Vagas.tsx` citadas aqui **valem como estão** (nenhuma fase anterior toca os trechos específicos citados — ver Decisões 4/5), mas confira no arquivo real antes de aplicar.

| Campo | Valor |
|---|---|
| **Entregável** | `AreaHoje.tsx` (RF-08 completo: 3 números, "Precisa de você", próximas entrevistas, vagas abertas); `page.tsx` liga a área `hoje` de verdade (sai do `.filter`); `AgendamentosPainel.tsx` exporta `DecidirPedido` com tipo mais estreito |
| **Onde** | `src/pages/contratacao/areas/AreaHoje.tsx` (criar), `src/pages/contratacao/page.tsx` (modificar), `src/pages/contratacao/components/AgendamentosPainel.tsx` (modificar — **AJUSTE DE MAPA**, ver Decisão 4) |
| **Depende de** | T13 (`hoje.ts`), T09 (área `hoje` já existe em `navegacao.ts`/`AREAS`, barra e roteamento por `area` já existem), T18 (leitura de `hiring_scheduling_sessions` já existe no `Promise.all`, esta task só estende o `select`) |
| **Bloqueia** | T15 |
| **Paralelo com** | — (sequencial, mexe em `page.tsx` que T09/T10 já mexeram) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-08, RF-05 (última linha — parcialmente: ver BLOQUEIO em T13), briefing §3.2 |

### Context pack

- Spec: RF-08 verbatim (`#c-spec-filtrada`) — 3 números, as 4 fontes de "Precisa de você" (3 lógicas, já montadas por T13, + `BotaoAvisos`), próximas entrevistas com selo, vagas abertas com números; briefing §3.2 (mesmo texto, "com os cards/listas que já existem" — a Regra nº 1 desta task); Critérios de sucesso (`BotaoAvisos` funcional dentro de "Precisa de você", sem duplicar no cabeçalho; selo Confirmou/Aguardando sem regressão).
- Global Constraints: `#global-constraints` #1 (Regra nº 1 — nenhum card/cor/ícone novo: todo tile e toda seção desta tela reaproveita um padrão que **já existe no módulo**, citado Step a Step), #5 (o selo de presença já existe e não pode regredir), #8 (as únicas leituras novas são de tabelas já lidas pelo módulo: `hiring_scheduling_sessions` — extensão de `select`, já autorizada por T18 — e `bot_conversations`, já lida em `LinksWhatsApp.tsx`), #9 (gate), #10 (`entrevistasDoDia.test.tsx` continua verde, sem edição — esta task não toca `EntrevistasDoDia.tsx`), #11 (`BotaoAvisos` só some do cabeçalho no mesmo Step em que passa a aparecer em "Precisa de você" — DoD extra desta task), #12 (sem Radix — tudo `<button>`/`<div>` com as classes já citadas).
- Padrão do repo (reaproveitado, citado Step a Step): `Kpi`/`Card` de `RelatoriosContratacao.tsx:222-234` (tiles de número + seção com título — **duplicados**, não importados, porque `RelatoriosContratacao.tsx` é "nenhuma" no Mapa); selo Confirmou/Aguardando de `EntrevistasDoDia.tsx:180-188` (E1, **duplicado**, mesmo motivo — arquivo "nenhuma"); card de vaga de `Vagas.tsx:69-90` (E4, **duplicado reduzido** — ver Decisão 5); `DecidirPedido`/status `aguardando_gestor` de `AgendamentosPainel.tsx:49-139,105` (E2, **reaproveitado por import**, não duplicado — ver Decisão 4); cores de status já usadas em `AgendamentosPainel.tsx:104-124` (`statusDe`: âmbar = `aguardando_gestor`, vermelho = `erro`) e em `LinksWhatsApp.tsx:463` (âmbar = "Atenção"/`needs_human`).
- Arquivos vizinhos: `hoje.ts` (T13 — `contagensHoje`, `formatarDiaCurto`, `montarPrecisaDeVoce`, os tipos `SessaoAgendamento`/`ConversaNeedsHuman`/`ItemPrecisaDeVoce`); `navegacao.ts` (T07 — `Area`, `AREAS`); `BotaoAvisos` (`@/components/feature/BotaoAvisos`, já importado em `page.tsx`, "nenhuma" no Mapa — só muda **onde** é chamado).
- **Não fazer:** não editar `EntrevistasDoDia.tsx`, `RelatoriosContratacao.tsx`, `BotaoAvisos.tsx` nem `entrevistasDoDia.test.tsx`; não criar `import` novo entre `AreaHoje.tsx` e esses três arquivos (duplicar em vez de importar, mesma técnica de T05 Decisão 1/`Section` e T18 Decisão do `AGENDAMENTO_IA`); não adicionar `hiring_scheduling_sessions` ao canal `contratacao-tempo-real` (`page.tsx:196-201`, decisão já tomada por T18 — esta task não revisita); não fazer 2ª leitura de `hiring_scheduling_sessions` no shell (estender o `select` de T18, não duplicar a query); não inventar coluna/RPC/Edge nova (Constraint 8) — se alguma parte do RF-08 não couber no que já é lido, marcar BLOQUEIO em vez de inventar (não houve necessidade: todas as 4 fontes couberam, ver Decisão 3).

### Decisões tomadas

3. **Como `AreaHoje` obtém cada uma das 4 fontes de "Precisa de você" (sem query nova proibida):**
   - **`aguardando_gestor` e `erro`** vêm de `schedSessions`, que T14 **estende** (não duplica) a partir da leitura de T18. T18 fez (`page.tsx:137-144` do As Is, já com a leitura de T18 aplicada):
     ```ts
     supabase.from('hiring_scheduling_sessions').select('candidate_id, job_id, status, updated_at').order('updated_at', { ascending: false }).limit(500),
     ```
     T14 troca por (mais colunas, mesmo `order`/`limit`):
     ```ts
     supabase.from('hiring_scheduling_sessions')
       .select('id, candidate_id, job_id, status, updated_at, error, confirmed_at, confirm_requested_at, interview_id, pending_request')
       .order('updated_at', { ascending: false }).limit(500),
     ```
     Colunas confirmadas em `supabase/migrations/20260914210000_hiring_agendamento_assistente.sql:30-46` — nenhuma é nova para a tabela, só para o `select` desta leitura. A agregação de T18 (`agendamentoIAPorCandidato`, usada pelo chip do Kanban) **continua funcionando sem mudança**: ela só lê `s.candidate_id`/`s.status` do mesmo array, e colunas a mais no objeto não quebram um `Map<string, string>` que só usa duas delas.
   - **`needs_human`** vem de uma leitura **própria** de `AreaHoje.tsx` (Decisão do material, seção E3): nenhum outro componente monta a tela Hoje, e centralizar em `page.tsx` obrigaria todo o resto do app a carregar `bot_conversations` mesmo fora da tela Hoje. `select` enxuto — só `id, contact_name, contact_phone, candidate_ids, last_message_at` (a coluna `needs_human` em si **não** entra no `select`: é usada só como filtro do próprio Postgres, `eq('needs_human', true)`, mesma coluna já lida em `LinksWhatsApp.tsx:107,463` — devolvê-la também no `select` seria supérfluo, já que toda linha que voltar é `true` por construção do filtro) e `order('last_message_at', { ascending: false }).limit(50)`; atualiza no mesmo padrão de polling de 60 s do selo de presença (E1, `EntrevistasDoDia.tsx:74-93`, `setInterval` com `!document.hidden`) — **duplicado com comentário de origem**, não importado (arquivo "nenhuma"). **Sem leitura concorrente:** depois da Fase 4 (T11/T12), `LinksWhatsApp.tsx` só é montado dentro de uma vaga (`VagaDivulgacao`) ou dentro de Configurações (`ConfigWhatsApp`) — nunca dentro da área Hoje —, então a leitura de `bot_conversations` que ele faz (`LinksWhatsApp.tsx:85`, `select('*')`) e a leitura enxuta desta task nunca coexistem na mesma tela; não há 2 componentes lendo a mesma tabela ao mesmo tempo, só 2 telas diferentes lendo a mesma tabela em momentos diferentes (igual a `hiring_scheduling_sessions`, lida pelo shell **e** por `AgendamentosPainel.tsx` quando essa aba está aberta).
   - **`BotaoAvisos`** é renderizado direto, sem passar por `hoje.ts` (T13, Decisão 4) — ver Decisão 7 abaixo.
   - **Vagas abertas** vem de `jobs`/`applications` já recebidos como prop do shell (mesmos dados de `Vagas.tsx`, nenhuma leitura nova) — ver Decisão 5.
   - **Próximas entrevistas** vem de `interviews` já recebido como prop (mesmos dados de `EntrevistasDoDia.tsx`/`AgendaEntrevistas.tsx`) — ver Decisão 6.
4. **`DecidirPedido`: exportar de `AgendamentosPainel.tsx`, com o tipo do prop `sess` estreitado.** Das 3 opções do material (exportar / mover para arquivo próprio / levar o usuário ao painel): exportar é a única que atende literalmente a spec ("item com ações Aceitar/Recusar chamando `hiring-scheduler › decide`") sem duplicar a lógica de rede (`supabase.functions.invoke('hiring-scheduler', ...)`, `AgendamentosPainel.tsx:57-61`) nem os 3 botões/estado de "propor outro horário" (`:66-98`) num 2º arquivo que teria que ficar sincronizado manualmente com o 1º — o próprio risco que T11 Decisão 1 (`EscopoWhatsApp`) evitou para `LinksWhatsApp`. Mover para arquivo próprio (`DecidirPedido.tsx`) resolveria o mesmo problema, mas moveria ~90 linhas de um arquivo cuja responsabilidade (Mapa) é só "usa `ConversaWhatsApp`" (T04) — criar um arquivo novo fora do Mapa desta fase para mover uma função que já está pronta é mais risco (ré-import em `AgendamentosPainel.tsx` de volta, dois lugares para vasculhar) do que valor. **AJUSTE DE MAPA NECESSÁRIO:** `AgendamentosPainel.tsx` passa a ser modificado também por **T14** (Mapa hoje só lista T04) — a mudança em si é de 2 linhas:
   ```tsx
   // Sess (AgendamentosPainel.tsx:25-31) não muda de corpo — só DecidirPedido estreita o prop que usa
   // de verdade (id, pending_request), para a tela Hoje poder chamá-lo sem os campos que não tem
   // (phone, code, history, attempts, hiring_interviews — que DecidirPedido nunca lê).
   export function DecidirPedido({ sess, onFeito }: { sess: Pick<Sess, 'id' | 'pending_request'>; onFeito: () => void }) {
   ```
   (troca de `function DecidirPedido({ sess, onFeito }: { sess: Sess; onFeito: () => void })`, `AgendamentosPainel.tsx:49`, por `export function DecidirPedido({ sess, onFeito }: { sess: Pick<Sess, 'id' | 'pending_request'>; onFeito: () => void })` — corpo da função **inalterado**, só a assinatura; o corpo já só lê `sess.id`/`sess.pending_request`, então `Pick` é seguro). Todo uso existente de `DecidirPedido` dentro de `AgendamentosPainel.tsx` (`:118` do As Is, `<DecidirPedido sess={s} onFeito={carregar} />`, `s: Sess`) continua compilando: um `Sess` completo satisfaz `Pick<Sess, 'id' | 'pending_request'>` por subtipagem estrutural.
5. **Card de vaga: duplicado reduzido em `AreaHoje.tsx`, `Vagas.tsx` não é tocado.** Reexportar/expor um `VagaCard` de `Vagas.tsx` exigiria mais um "AJUSTE DE MAPA" sobre um arquivo que a Fase 4 (T11) já reorganizou pouco antes — risco desnecessário para 6 linhas de JSX. A versão em `AreaHoje.tsx` reaproveita as **mesmas classes** do card de `Vagas.tsx:69-90` (E4: `rounded-2xl border border-zinc-200 bg-white p-4`/`hover:border-rose-300`, ícone `ri-briefcase-4-line` no quadrado `bg-rose-50 border-rose-200`) mas **reduzida** — só o nome da vaga, a contagem de candidatos e "melhor: N/100" (RF-08 diz só "com números", não pede repetir "alta aderência"/data de abertura) — clicável, chamando `onAbrirVaga(job.id)` (Decisão de navegação: mesmo `onClick={() => onSelectJob(j.id)}` de `Vagas.tsx:70`, só que troca a área também). Não é "mover o JSX sem reescrever" (não há um `VagaCard` isolado para mover) — é reaproveitar classes já em uso, mesma técnica do menu de T10.
6. **Selo de presença: duplicado dentro de `AreaHoje.tsx`, não extraído para arquivo à parte.** Extrair um `SeloPresenca.tsx` obrigaria `EntrevistasDoDia.tsx` a importá-lo também (para não duplicar) — mas `EntrevistasDoDia.tsx` é "nenhuma" no Mapa e protegido por teste; tocar nele para trocar duas `<span>` por um import é risco sem necessidade (o teste de regressão cobre exatamente o fluxo de `focoEntrevista`, não o selo, mas qualquer edição no arquivo é superfície de regressão evitável). Solução: duplicar as mesmas 2 `<span>` (E1, `EntrevistasDoDia.tsx:180-188`) dentro de `AreaHoje.tsx`, com comentário citando a origem — mesma técnica de T18 (`AGENDAMENTO_IA`, cópia de `SESS_LABEL`). Fonte do `confirmada`/`pedida`: `schedSessions` (Decisão 3) já tem `interview_id`/`confirmed_at`/`confirm_requested_at` depois da extensão do `select` — `AreaHoje` monta o mesmo formato de `Record<string, { confirmada: boolean; pedida: boolean }>` de `EntrevistasDoDia.tsx:75-93`, só que a partir do array já carregado pelo shell (sem 3ª leitura da mesma tabela), filtrando por `interview_id` presente.
7. **`BotaoAvisos` entra em "Precisa de você" como mais um item da mesma lista, renderizado direto (não como dado de `hoje.ts`, T13 Decisão 4) — e sai do cabeçalho no mesmo Step.** O componente já se esconde sozinho (`estado === null || 'ativo' || 'nao-suportado'` → `return null`, `BotaoAvisos.tsx:37`) — colocá-lo sempre no JSX de "Precisa de você" é seguro: quando não há nada a fazer, ele não aparece, e a seção "Precisa de você" simplesmente não aparece vazia por causa dele (ver Step de `AreaHoje.tsx`, condição de exibição da seção). `tenantId` continua vindo de `useAuth()` no shell (`user?.tenantId`, `page.tsx:56`) — `AreaHoje` recebe como prop, não chama `useAuth()` de novo. Sai do cabeçalho: remover a linha `<BotaoAvisos .../>` de `page.tsx:539` (E5) no mesmo Step em que `AreaHoje` passa a renderizá-lo (Constraint 11 — nunca um Step em que ele fica invisível nos dois lugares ao mesmo tempo).
8. **T14 acrescenta a área `hoje` na barra de 5 abas** (fecha o combinado de T09 Decisão 3: "T14 remove o `.filter` e some com esta observação") — ver Step de `page.tsx` abaixo. **O default continua `entrevistas`** até T15 (a correção `dest.area === 'hoje' ? 'entrevistas' : dest.area` de `estadoInicialDeNavegacao`, T09 Step 1, **não é tocada por esta task** — só T15 remove essa correção). Ou seja: depois de T14, clicar em "Hoje" na barra mostra a tela de verdade, mas abrir o módulo do zero (ou um deep link sem `?aba=`) ainda cai em Entrevistas — comportamento intermediário documentado, igual ao que T09 já previu.

### Interfaces

**Consumes** (de T13):
```ts
import {
  contagensHoje, formatarDiaCurto, montarPrecisaDeVoce,
  type ConversaNeedsHuman, type ItemPrecisaDeVoce, type SessaoAgendamento,
} from '../hoje';
```
**Consumes** (de T07): `import type { Area } from '../navegacao';` (só o tipo — `AreaHoje` não decide navegação, recebe callbacks já resolvidos pelo shell).
**Consumes** (de T09/AgendamentosPainel.tsx, após o ajuste de mapa da Decisão 4):
```ts
import { DecidirPedido, type Sess } from '../components/AgendamentosPainel'; // DecidirPedido agora export
```
> `AgendamentosPainel.tsx` não exporta `Sess` hoje (`interface Sess`, sem `export`, `:25`). Esta task acrescenta `export` a `interface Sess` também (1 palavra, mesmo Step da Decisão 4) — só para `AreaHoje.tsx` poder tipar o `Map` de sessões sem duplicar a interface inteira; nenhuma outra mudança em `Sess`.

**Produces (assinaturas exatas):**
```ts
// page.tsx — AgendamentoIASessao (T18) ganha as colunas que faltavam (Decisão 3)
interface AgendamentoIASessao {
  id: string; candidate_id: string; job_id: string; status: string; updated_at: string;
  error: string | null; confirmed_at: string | null; confirm_requested_at: string | null; interview_id: string | null;
  pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
}

// areas/AreaHoje.tsx
interface Props {
  interviews: Interview[];       // ivsDaEmpresa (mesmo filtro por empresa das outras áreas)
  candidates: Candidate[];       // items
  jobs: Job[];                   // jobsDaEmpresa
  applications: Application[];
  companies: Company[];
  mostrarEmpresa: boolean;
  schedSessions: AgendamentoIASessao[]; // do shell, select estendido (Decisão 3)
  tenantId: string | null | undefined;  // repassado a BotaoAvisos (Decisão 7)
  onOpenCandidate: (id: string) => void;
  onAbrirConversas: () => void;   // troca a área para Entrevistas › Conversas da IA (needs_human sem candidato claro)
  onAbrirVaga: (jobId: string) => void; // troca a área para Vagas com essa vaga selecionada
  onNewInterview: (date: string) => void; // "Agendar" a partir de uma próxima entrevista, mesmo padrão das outras áreas (não usado nesta fase, mas mantém a Props alinhada ao restante do módulo — só repassa, sem novo botão)
  onSessaoAtualizada: () => void; // recarrega o shell (carregar(true)) depois de Aceitar/Recusar/Propor
}
export default function AreaHoje(props: Props): JSX.Element
```
```ts
// components/AgendamentosPainel.tsx — só a assinatura muda (Decisão 4)
export interface Sess { /* corpo idêntico a hoje, AgendamentosPainel.tsx:25-31 */ }
export function DecidirPedido({ sess, onFeito }: { sess: Pick<Sess, 'id' | 'pending_request'>; onFeito: () => void }): JSX.Element
```

### Steps

1. **`AgendamentosPainel.tsx` — exportar `Sess` e estreitar `DecidirPedido` (AJUSTE DE MAPA, Decisão 4).** Trocar `interface Sess { ... }` (`AgendamentosPainel.tsx:25`) por `export interface Sess { ... }` (corpo idêntico, só a palavra `export`). Trocar `function DecidirPedido({ sess, onFeito }: { sess: Sess; onFeito: () => void }) {` (`:49`) por `export function DecidirPedido({ sess, onFeito }: { sess: Pick<Sess, 'id' | 'pending_request'>; onFeito: () => void }) {` — corpo da função (`:50-101`) **não muda uma linha**. Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos; o único código novo são as 2 palavras `export`/`Pick<Sess, 'id' | 'pending_request'>`.

2. **`page.tsx` — estender o `select` de `hiring_scheduling_sessions` (origem verbatim: leitura de T18, `page.tsx:137-144` do As Is + a leitura de T18 já aplicada).** Trocar a interface de T18:
   ```ts
   interface AgendamentoIASessao { candidate_id: string; job_id: string; status: string; updated_at: string }
   ```
   por:
   ```ts
   interface AgendamentoIASessao {
     id: string; candidate_id: string; job_id: string; status: string; updated_at: string;
     error: string | null; confirmed_at: string | null; confirm_requested_at: string | null; interview_id: string | null;
     pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
   }
   ```
   e, dentro do `Promise.all` de `carregar()`, trocar a linha de leitura de T18:
   ```ts
   supabase.from('hiring_scheduling_sessions').select('candidate_id, job_id, status, updated_at').order('updated_at', { ascending: false }).limit(500),
   ```
   por:
   ```ts
   supabase.from('hiring_scheduling_sessions')
     .select('id, candidate_id, job_id, status, updated_at, error, confirmed_at, confirm_requested_at, interview_id, pending_request')
     .order('updated_at', { ascending: false }).limit(500),
   ```
   Invariante: mesma posição no `Promise.all`, mesmo `order`/`limit` de T18 — só o `select` cresce. `setSchedSessions((sess.data ?? []) as AgendamentoIASessao[]);` (bloco `else` de T18) não muda de linha, só o tipo por trás mudou. `agendamentoIAPorCandidato`/`agendamentoIADe` (T18, `page.tsx:496-509` região) **não mudam** — continuam lendo só `candidate_id`/`status` do mesmo array.

3. **`page.tsx` — acrescentar a área `hoje` na barra (origem verbatim: barra produzida por T09 Step 3).** T09 deixou:
   ```tsx
   {AREAS.filter((a) => a.id !== 'hoje').map((t) => (
   ```
   Trocar por:
   ```tsx
   {AREAS.map((t) => (
   ```
   (remove só o `.filter(...)`, mantém o resto do bloco de T09 Step 3 idêntico — mesmas classes `border-b-2`/cores ativas, mesmo `<i className={t.icon} />`). Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*`, mesmos textos; a única mudança é a lista deixar de ser filtrada.

4. **`page.tsx` — ligar `AreaHoje` na cadeia de áreas (origem: cadeia de ternários por `area` produzida por T09 Steps 6-7 — `area === 'vagas' ? (<Vagas .../>) : area === 'entrevistas' ? (<AreaEntrevistas .../>) : area === 'relatorios' ? (<RelatoriosContratacao .../>) : area === 'config' ? (<AreaConfiguracoes .../>) : (<AreaCandidatos .../>)`, `else` final de T08).** Acrescentar um branch novo **antes** dos demais (mesma posição de "Hoje" em `AREAS`, T07):
   ```tsx
   {area === 'hoje' ? (
     <AreaHoje interviews={ivsDaEmpresa} candidates={items} jobs={jobsDaEmpresa} applications={applications} companies={companies}
       mostrarEmpresa={mostrarEmpresa} schedSessions={schedSessions} tenantId={user?.tenantId}
       onOpenCandidate={setSelId} onAbrirConversas={() => { setArea('entrevistas'); setFocoSubabaEntrevistas('conversas'); }}
       onAbrirVaga={(jobId) => { setArea('vagas'); setSelectedJobId(jobId); }}
       onNewInterview={(date) => setModal({ interview: null, date })}
       onSessaoAtualizada={() => carregar(true)} />
   ) : area === 'vagas' ? (
   ```
   (o resto da cadeia, a partir de `area === 'vagas' ? (`, é o que T09 já deixou — não reescrever). `setFocoSubabaEntrevistas`/`setArea`/`setSelectedJobId`/`carregar` já existem no shell (T09/página original). Invariante: mesma forma de branch condicional da cadeia de T09 (`area === X ? (<Componente .../>) : ...`), só um branch novo na posição de "Hoje".

5. **`page.tsx` — remover `<BotaoAvisos>` do cabeçalho (origem verbatim `page.tsx:539` do As Is, amostra E5).** Remover a linha:
   ```tsx
   <BotaoAvisos tenantId={user?.tenantId} titulo="Receber no celular os avisos de entrevista (agendada, confirmada, cancelada…)" />
   ```
   e o comentário que a precede (`page.tsx:537-538`, "Entrevistador que é usuário do ERPOS recebe os avisos..."). O `import BotaoAvisos from '@/components/feature/BotaoAvisos';` (`page.tsx:12`) **também é removido, no Step 7** — `AreaHoje.tsx` passa a importar `BotaoAvisos` por conta própria (Step 6), e deixar o import morto no shell não seria acusado pelo `tsc` (`tsconfig.app.json:20-21`, `noUnusedLocals: false`). Invariante: Constraint 11 satisfeita porque o mesmo componente, com o mesmo `titulo`, passa a ser renderizado por `AreaHoje.tsx` (Step 6) **no mesmo Step** — nunca fica ausente dos dois lugares ao mesmo tempo no histórico do working tree.

6. **Criar `src/pages/contratacao/areas/AreaHoje.tsx`** com o corpo completo:
   ```tsx
   // Área "Hoje" (RF-08): porta de entrada do módulo — 3 números, "Precisa de você", próximas
   // entrevistas e vagas abertas. Monta com cards/listas que já existem no módulo (Regra nº 1):
   // Kpi/Card duplicados de RelatoriosContratacao.tsx:222-234, selo de presença duplicado de
   // EntrevistasDoDia.tsx:180-188, card de vaga reduzido a partir de Vagas.tsx:69-90 — nenhum dos três
   // arquivos é importado (todos "nenhuma" no Mapa) nem editado.
   import { useEffect, useMemo, useState } from 'react';
   import { supabase } from '@/lib/supabase';
   import BotaoAvisos from '@/components/feature/BotaoAvisos';
   import { DecidirPedido, type Sess } from '../components/AgendamentosPainel';
   import {
     contagensHoje, formatarDiaCurto, montarPrecisaDeVoce,
     type ConversaNeedsHuman, type ItemPrecisaDeVoce, type SessaoAgendamento,
   } from '../hoje';
   import { type Application, type Candidate, type Company, type Interview, type Job, ageOf, companyName, mergeSettings } from '../shared';

   interface AgendamentoIASessao {
     id: string; candidate_id: string; job_id: string; status: string; updated_at: string;
     error: string | null; confirmed_at: string | null; confirm_requested_at: string | null; interview_id: string | null;
     pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
   }
   interface Props {
     interviews: Interview[]; candidates: Candidate[]; jobs: Job[]; applications: Application[]; companies: Company[];
     mostrarEmpresa: boolean; schedSessions: AgendamentoIASessao[]; tenantId: string | null | undefined;
     onOpenCandidate: (id: string) => void; onAbrirConversas: () => void; onAbrirVaga: (jobId: string) => void;
     onNewInterview: (date: string) => void; onSessaoAtualizada: () => void;
   }

   // Kpi/Card: mesmo componente de RelatoriosContratacao.tsx:222-234 (arquivo "nenhuma" no Mapa,
   // duplicado com comentário — mesma técnica de Section em T05 e AGENDAMENTO_IA em T18).
   function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
     return (
       <div className="rounded-2xl border border-zinc-200 bg-white p-4">
         <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
         <p className="text-2xl font-black text-zinc-900 tabular-nums mt-1">{value}</p>
         {hint && <p className="text-[10px] text-zinc-400 mt-0.5">{hint}</p>}
       </div>
     );
   }
   function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
     return (
       <section className="rounded-2xl border border-zinc-200 bg-white p-4">
         <p className="text-xs font-black uppercase tracking-wider text-zinc-500 mb-3">{titulo}</p>
         {children}
       </section>
     );
   }
   // Selo Confirmou/Aguardando: mesmo par de <span> de EntrevistasDoDia.tsx:180-188 (arquivo
   // "nenhuma" no Mapa, protegido por teste — duplicado, não importado nem editado).
   function SeloPresenca({ confirmada, pedida }: { confirmada: boolean; pedida: boolean }) {
     if (confirmada) return (
       <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200" title="Confirmou presença pelo WhatsApp">
         <i className="ri-checkbox-circle-fill" /> Confirmou
       </span>
     );
     if (pedida) return (
       <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200" title="O assistente pediu a confirmação e ainda não teve resposta">
         <i className="ri-time-line" /> Aguardando
       </span>
     );
     return null;
   }

   export default function AreaHoje(props: Props) {
     const { interviews, candidates, jobs, applications, companies, mostrarEmpresa, schedSessions, tenantId } = props;
     const agora = useMemo(() => new Date(), []); // 1 leitura do relógio por render; o polling de 60s do shell recalcula
     const settings = useMemo(() => mergeSettings(null), []); // dados mínimos: mesmo default do resto do módulo quando settings não é prop aqui
     const contagens = useMemo(() => contagensHoje(interviews, candidates, settings, agora), [interviews, candidates, settings, agora]);

     // needs_human: leitura própria (Decisão 3) — bot_conversations já é lida pelo módulo (LinksWhatsApp.tsx),
     // só que fora desta tela; select enxuto, mesmo padrão de polling do selo de presença (E1).
     const [conversas, setConversas] = useState<ConversaNeedsHuman[]>([]);
     useEffect(() => {
       let vivo = true;
       const carregar = () => {
         supabase.from('bot_conversations').select('id, contact_name, contact_phone, candidate_ids, last_message_at')
           .eq('needs_human', true).order('last_message_at', { ascending: false }).limit(50)
           .then(({ data }) => { if (vivo) setConversas((data ?? []) as ConversaNeedsHuman[]); });
       };
       carregar();
       const t = setInterval(() => { if (!document.hidden) carregar(); }, 60000);
       return () => { vivo = false; clearInterval(t); };
     }, []);

     const sessoesPorId = useMemo(() => new Map(schedSessions.map((s) => [s.id, s])), [schedSessions]);
     const itens: ItemPrecisaDeVoce[] = useMemo(() => montarPrecisaDeVoce({
       sessoes: schedSessions as SessaoAgendamento[], candidates, jobs, conversas,
     }), [schedSessions, candidates, jobs, conversas]);

     const candNome = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
     const jobTitulo = useMemo(() => new Map(jobs.map((j) => [j.id, j.title])), [jobs]);

     // Presença confirmada (selo): a partir de schedSessions (mesma tabela, sem 3ª leitura — Decisão 6).
     const presencaPorEntrevista = useMemo(() => {
       const m = new Map<string, { confirmada: boolean; pedida: boolean }>();
       for (const s of schedSessions) if (s.interview_id) m.set(s.interview_id, { confirmada: !!s.confirmed_at, pedida: !!s.confirm_requested_at });
       return m;
     }, [schedSessions]);
     const proximas = useMemo(() => interviews
       .filter((iv) => iv.status === 'agendada' && iv.scheduled_at >= agora.toISOString())
       .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
       .slice(0, 5), [interviews, agora]);

     // Vagas abertas: mesmos dados de Vagas.tsx (jobs/applications já filtrados pela empresa no shell).
     const vagasAbertas = useMemo(() => jobs.filter((j) => j.status !== 'fechada').map((j) => {
       const apps = applications.filter((a) => a.job_id === j.id);
       const melhor = apps.filter((a) => a.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
       return { job: j, total: apps.length, melhor };
     }), [jobs, applications]);

     const semPrecisaDeVoce = itens.length === 0; // BotaoAvisos ainda pode aparecer sozinho — ver JSX abaixo

     return (
       <div className="space-y-4">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
           <Kpi label="Entrevistas hoje" value={contagens.entrevistasHoje}
             hint={contagens.entrevistasHoje === 0 && contagens.proximaComEntrevistas
               ? `próxima: ${formatarDiaCurto(contagens.proximaComEntrevistas.diaKey)} · ${contagens.proximaComEntrevistas.quantidade}` : undefined} />
           <Kpi label="Currículos novos" value={contagens.curriculosNovos}
             hint={contagens.curriculosComFichaIncompleta > 0 ? `${contagens.curriculosComFichaIncompleta} com ficha incompleta` : undefined} />
           <Kpi label="Entrevistas sem registro" value={contagens.entrevistasPassadasSemRegistro} />
         </div>

         {(!semPrecisaDeVoce || tenantId !== undefined) && (
           <Card titulo="Precisa de você">
             <div className="space-y-2">
               <BotaoAvisos tenantId={tenantId} titulo="Receber no celular os avisos de entrevista (agendada, confirmada, cancelada…)" />
               {semPrecisaDeVoce ? (
                 <p className="text-sm text-zinc-400">Nada pendente por aqui.</p>
               ) : itens.map((item) => {
                 if (item.tipo === 'aguardando_gestor') {
                   const sess = sessoesPorId.get(item.sessionId);
                   return (
                     <div key={item.sessionId} className="p-2.5 rounded-xl border border-amber-200 bg-amber-50">
                       <p className="text-xs font-bold text-amber-900">
                         <button onClick={() => props.onOpenCandidate(item.candidateId)} className="hover:underline cursor-pointer">{item.candidateName}</button>
                         {item.jobTitle ? ` · ${item.jobTitle}` : ''} pediu {item.pedidoDataHora ? new Date(item.pedidoDataHora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : `"${item.pedidoTextoLivre ?? ''}"`}
                       </p>
                       {sess && <DecidirPedido sess={sess} onFeito={props.onSessaoAtualizada} />}
                     </div>
                   );
                 }
                 if (item.tipo === 'needs_human') {
                   return (
                     <button key={item.conversationId}
                       onClick={() => (item.candidateId ? props.onOpenCandidate(item.candidateId) : props.onAbrirConversas())}
                       className="w-full text-left flex items-center gap-2 p-2.5 rounded-xl border border-amber-200 bg-amber-50 cursor-pointer hover:bg-amber-100">
                       <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">Atenção</span>
                       <span className="text-xs font-bold text-amber-900">{item.nome} — o assistente não conseguiu seguir sozinho</span>
                     </button>
                   );
                 }
                 return (
                   <button key={item.sessionId} onClick={() => props.onOpenCandidate(item.candidateId)}
                     className="w-full text-left p-2.5 rounded-xl border border-red-200 bg-red-50 cursor-pointer hover:bg-red-100">
                     <p className="text-xs font-bold text-red-700">{item.candidateName}{item.jobTitle ? ` · ${item.jobTitle}` : ''}: {item.mensagem}</p>
                   </button>
                 );
               })}
             </div>
           </Card>
         )}

         <Card titulo="Próximas entrevistas">
           {proximas.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma entrevista agendada.</p> : (
             <ul className="divide-y divide-zinc-100">
               {proximas.map((iv) => {
                 const c = candNome.get(iv.candidate_id);
                 const presenca = presencaPorEntrevista.get(iv.id);
                 return (
                   <li key={iv.id}>
                     <button onClick={() => props.onOpenCandidate(iv.candidate_id)} className="w-full text-left px-2 py-2.5 flex items-center gap-2 hover:bg-zinc-50 cursor-pointer">
                       <span className="flex-1 min-w-0 flex items-center gap-1.5">
                         <span className="text-sm font-semibold text-zinc-800 truncate">{c?.full_name ?? 'Candidato removido'}</span>
                         {presenca && <SeloPresenca confirmada={presenca.confirmada} pedida={presenca.pedida} />}
                       </span>
                       <span className="text-[11px] text-zinc-500">
                         {new Date(iv.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                         {mostrarEmpresa && iv.company_id ? ` · ${companyName(companies, iv.company_id)}` : ''}
                       </span>
                     </button>
                   </li>
                 );
               })}
             </ul>
           )}
         </Card>

         <Card titulo="Vagas abertas">
           {vagasAbertas.length === 0 ? <p className="text-sm text-zinc-400">Nenhuma vaga aberta.</p> : (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
               {vagasAbertas.map(({ job, total, melhor }) => (
                 <button key={job.id} onClick={() => props.onAbrirVaga(job.id)}
                   className="text-left p-4 rounded-2xl border border-zinc-200 bg-white hover:border-rose-300 hover:shadow-sm transition-all cursor-pointer">
                   <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center flex-shrink-0">
                       <i className="ri-briefcase-4-line text-lg" />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="font-bold text-zinc-900 truncate">{job.title}</p>
                       <p className="text-xs text-zinc-500">
                         <b className="text-zinc-800">{total}</b> candidato{total === 1 ? '' : 's'}
                         {melhor && <> · melhor: <b className="text-zinc-800">{melhor.score}</b>/100</>}
                       </p>
                     </div>
                   </div>
                 </button>
               ))}
             </div>
           )}
         </Card>
       </div>
     );
   }
   ```
   Invariante por bloco (já citado no comentário de topo do arquivo e nas notas de cada função duplicada acima): `Kpi`/`Card` mesmas classes de `RelatoriosContratacao.tsx:222-234`; `SeloPresenca` mesmas duas `<span>` de `EntrevistasDoDia.tsx:180-188`; card de vaga mesma família de classes de `Vagas.tsx:69-90`, reduzido; `DecidirPedido` reaproveitado por import (Step 1), sem reescrever. `ageOf` importado de `shared.ts` fica sem uso nesta versão — **remover do import** se `tsc`/lint acusar (conferir no Step 8; a idade não é um dos "3 números" nem aparece nas listas desta tela, RF-08 não pede).

7. **`page.tsx` — remover a linha `import BotaoAvisos from '@/components/feature/BotaoAvisos';` (`page.tsx:12`).** Não é opcional e não depende do gate: depois do Step 5 o shell não renderiza mais `BotaoAvisos` em lugar nenhum (quem renderiza é `AreaHoje.tsx`, Step 6), então o import fica morto. **Conferido pelo orquestrador em 2026-09-20: `tsconfig.app.json:20-21` tem `"noUnusedLocals": false` e `"noUnusedParameters": false`** — ou seja, o `tsc` **não** vai acusar, e deixar o import decidiria por inércia. Remova e confirme com `grep -n "BotaoAvisos" src/pages/contratacao/page.tsx` → esperado **nenhuma linha**. (Este é o mesmo tipo de código órfão que o gate da Fase 2 pegou: o `tsc` do projeto não protege contra isso, então o plano protege.)

8. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado o mesmo total acumulado desde T13 (esta task não cria nem apaga teste), 0 failed.
   - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não editado.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Barra de 5 áreas mostra "Hoje" clicável (Decisão 8) e abre `AreaHoje` com conteúdo real.
- [ ] 3 números aparecem (entrevistas hoje, currículos novos + ficha incompleta, entrevistas passadas sem registro); dia sem entrevista mostra "próxima: seg 21/09 · N" no hint do 1º Kpi.
- [ ] "Precisa de você" mostra os 3 tipos de item quando existem dados (`aguardando_gestor` com Aceitar/Recusar funcionando de verdade — chama `hiring-scheduler › decide`; `needs_human` abre candidato ou o painel de Conversas; `erro` abre o candidato) e some quando não há nada (exceto `BotaoAvisos`, que aparece/some por conta própria).
- [ ] **DoD extra desta task:** `BotaoAvisos` só sai do cabeçalho (`page.tsx`) no mesmo Step em que passa a aparecer em "Precisa de você" (Step 5 + Step 6, aplicados juntos); conferir os 3 estados visíveis — `inativo` (grava `localStorage`/permissão do navegador como "default" antes de abrir, botão mostra "Ativar avisos"), `negado` (bloquear notificações do site nas configurações do navegador antes de abrir, botão mostra "Bloqueadas"), erro de registro (difícil de forçar manualmente; conferir ao menos que o texto "Tentar de novo" existe no componente, `BotaoAvisos.tsx:70`) — em todos, o botão aparece dentro do card "Precisa de você", nunca no cabeçalho.
- [ ] Próximas entrevistas mostra o selo Confirmou/Aguardando igual ao de Entrevistas › Do dia (mesma cor/ícone), sem regressão no selo original (`entrevistasDoDia.test.tsx` continua verde).
- [ ] Vagas abertas mostra as vagas não fechadas com candidatos + melhor nota; clicar leva para Vagas com aquela vaga já selecionada.
- [ ] `AgendamentoIAPorCandidato`/chip do Kanban (T18) continuam funcionando sem alteração de comportamento (o `select` cresceu, a agregação não mudou).
- [ ] **Nenhum import novo entre `AreaHoje.tsx` e `EntrevistasDoDia.tsx`/`RelatoriosContratacao.tsx`/`BotaoAvisos.tsx` além do próprio `BotaoAvisos`** (que é "nenhuma" no Mapa, mas seu import é esperado — é o único dos três realmente importado, não duplicado). Conferir com `grep -n "from '../components/EntrevistasDoDia'\|from '../components/RelatoriosContratacao'" src/pages/contratacao/areas/AreaHoje.tsx` — esperado **nenhuma linha**.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] `npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes (`Kpi`/`Card` de `RelatoriosContratacao.tsx`, selo de `EntrevistasDoDia.tsx`, card de vaga de `Vagas.tsx`, `DecidirPedido`/cores de status de `AgendamentosPainel.tsx`), não criou "design system" novo.
- [ ] Nada desapareceu (Constraint 11): `BotaoAvisos` continua acessível (agora dentro de "Precisa de você"); nenhum dado/ação existente foi removido.
- [ ] Rastreio: RF-08 completo (3 números, 4 fontes de "Precisa de você", próximas entrevistas, vagas abertas), briefing §3.2.
- [ ] **AJUSTE DE MAPA aplicado e registrado:** `AgendamentosPainel.tsx` passou a ser "modificar" também por T14 (Decisão 4) — 1 `export` em `Sess`, 1 `export` + 1 `Pick<>` em `DecidirPedido`, corpo de ambos inalterado.

---

## T15: Barra inferior no celular e default Hoje

> **Aviso sobre números de linha:** as linhas de `page.tsx` citadas nesta task são do As Is medido em **2026-09-20, antes das Fases 1 a 4** (mesma regra de T09/T10/T14). Localize cada trecho pelo conteúdo citado, não pelo número — em particular, os dois trechos desta task já foram **reescritos por T09** (Steps 1 e 2 daquela task) antes de chegar aqui; a citação é do texto que T09 produziu, não do As Is original.

| Campo | Valor |
|---|---|
| **Entregável** | `BarraInferior.tsx` (navegação fixa no celular, < sm, com as 5 áreas + engrenagem — RF-01/US-02); `page.tsx` liga a barra e remove a correção "Hoje → Entrevistas" (default passa a ser Hoje de verdade) |
| **Onde** | `src/pages/contratacao/components/BarraInferior.tsx` (criar), `src/pages/contratacao/page.tsx` (modificar) |
| **Depende de** | T14 (`AreaHoje` já existe e tem conteúdo — só agora faz sentido virar o default), T07 (`AREAS`/`AREA_CONFIG`), T09 (barra de 5 áreas + roteamento por `area` já existem) |
| **Bloqueia** | — (fecha a Fase 5) |
| **Paralelo com** | — (sequencial, fecha `page.tsx` desta fase) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-01, US-02 |

### Context pack

- Spec: RF-01 ("Celular (< sm = 640px): barra fixa embaixo com 5 ícones + menu engrenagem"; "valor inválido/ausente → Hoje... muda o default de `entrevistas` para `hoje`"); US-02 verbatim (`#c-spec-filtrada`) — barra fixa com 5 ícones, engrenagem abre Configurações, sem rolagem horizontal; Edge cases (tabela, `#c-spec-filtrada`) — "Desktop 1365px: sem rolagem, pode ter *scroll* do conteúdo" (já resolvido por T09, esta task não mexe na barra de cima) e "Celular sem JavaScript: abas desktop visíveis (graceful degradation)" — por isso a barra de cima (`overflow-x-auto`, T09) **continua visível em todos os tamanhos**; a barra inferior é aditiva, só para telas `< sm`, nunca substitui a de cima.
- Global Constraints: `#global-constraints` #1 (nenhuma cor/ícone fora do que já circula no módulo — `AREAS`/`AREA_CONFIG` de T07 já são Remix `ri-*` em uso), #9 (gate), #11 (nada some — a barra de cima continua existindo para todos os tamanhos; a barra de baixo é só um atalho a mais no celular), #12 (sem Radix, sem dependência nova — `BarraInferior.tsx` é `<nav>`/`<button>` puro).
- Padrão do repo (E8 — procurado antes de desenhar): já existe uma barra de navegação inferior no projeto, `src/pages/tarefas/components/MobileNav.tsx:27-56` (`BottomNav`) — `md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]`, um `<nav>` com `flex`, cada item `flex-1 flex flex-col items-center gap-0.5 py-2`, rótulo `text-[10px] font-medium` embaixo do ícone. **Reaproveitado só o esqueleto de layout** (estrutura fixa/`safe-area`/proporção dos itens) — as classes de cor (`slate`/`indigo`) e a biblioteca de ícone (`lucide-react`) são de outro design system (módulo Tarefas) e não podem entrar em Contratação (Constraint 1/12: paleta `rose`/`zinc`, ícones Remix `ri-*`). `BarraInferior.tsx` usa `sm:hidden` (não `md:hidden` — o corte desta spec é 640px, RF-01, diferente do corte de 768px de Tarefas) e a mesma família de classes do indicador ativo já usada em Contratação (E4: `rose-600`/`zinc-500`).
- Arquivos vizinhos: `navegacao.ts` (T07 — `AREAS`, `AREA_CONFIG`, `Area`); `AreaHoje.tsx` (T14 — só passa a ser o destino padrão, não é tocada por esta task); `CandidatoDrawer.tsx:96-97` (`z-40` backdrop / `z-50` `<aside>`) e `AdicionarCandidatosModal.tsx:34-35` (`z-[60]`/`z-[70]`) — usados só para escolher um `z-index` que não conflite (Decisão abaixo), nenhum dos dois arquivos é tocado.
- **Não fazer:** não copiar classes/ícones de `MobileNav.tsx` (`slate`/`indigo`/`lucide-react`) — só a estrutura de layout; não usar `md:hidden` (o corte é `sm`, 640px, RF-01); não esconder a barra de cima (`overflow-x-auto`, T09) em nenhum tamanho de tela (edge case "sem JavaScript" exige que ela continue no HTML); não adicionar rolagem horizontal na barra de baixo (5 itens fixos, `flex` sem `overflow-x-auto` — cabem sempre, ao contrário da barra de cima que pode crescer).

### Decisões tomadas

8. **T15 troca o default de `entrevistas` para `hoje`, fechando o combinado de T07/T09/T14.** T09 (Decisão 3) tinha corrigido `estadoInicialDeNavegacao()` e o deep link (`?aba=` ausente/inválido) para cair em `'entrevistas'` enquanto `AreaHoje` não existia; T14 fez a tela existir mas **não tocou** essa correção (Decisão 8 de T14). Esta task remove as **duas** ocorrências da correção (Step 1/2 abaixo) — a partir daqui, abrir o módulo do zero, um deep link `?aba=` inválido/ausente, ou um aparelho sem `localStorage contratacao_aba` gravado caem em **Hoje** de verdade (RF-01, US-01 completo). **Quem já tem `contratacao_aba` gravado com um valor válido continua indo para onde sempre foi** (`destinoDeAbaAntiga` só usa o default "hoje" para valor ausente/inválido — Constraint de compatibilidade, T07) — ou seja, ninguém que já usa o módulo é redirecionado à força para Hoje; só quem abre pela primeira vez (ou zera o `localStorage`) recebe o novo default.
9. **Padrão da barra inferior: layout de `MobileNav.tsx` (Tarefas), paleta/ícones de Contratação.** Ver Context pack (E8) — decisão já justificada ali. `z-index`: **`z-30`**, abaixo do backdrop do drawer da ficha (`z-40`, `CandidatoDrawer.tsx:96`) e dos modais (`z-[60]`/`z-[70]`) — assim, quando a ficha ou um modal abre por cima, o backdrop escurece a barra inferior junto com o resto da tela (mesmo efeito visual de qualquer conteúdo por trás de um modal), em vez de a barra ficar "flutuando" por cima do backdrop. Acima do conteúdo normal da página (`z-0`/estático), então nunca fica escondida atrás de um card. Padding do container: `pb-20 sm:pb-0` no `<div className="max-w-6xl mx-auto">` raiz de `page.tsx` — 20 (5rem) cobre a altura da barra (ícone + rótulo + `padding` vertical, igual ao cálculo de `MobileNav.tsx`) mais uma folga; `sm:pb-0` porque a barra some a partir de `sm` e o espaço reservado deixaria de ser necessário.

### Interfaces

**Consumes** (de T07): `import { AREAS, AREA_CONFIG, type Area } from '../navegacao';`

**Produces (assinatura exata):**
```ts
// components/BarraInferior.tsx
interface Props { area: Area; onArea: (a: Area) => void }
export default function BarraInferior({ area, onArea }: Props): JSX.Element
```

### Steps

1. **`page.tsx` — remover a correção "Hoje → Entrevistas" de `estadoInicialDeNavegacao()` (origem verbatim: função produzida por T09 Step 1).** T09 deixou:
   ```ts
   function estadoInicialDeNavegacao(): { area: Area; view: ModoCandidatos } {
     const dest = destinoDeAbaAntiga(lsGet('contratacao_aba'));
     return {
       // 'hoje' ainda não existe como tela (T14) — cai em 'entrevistas' até lá (Decisão 3).
       area: dest.area === 'hoje' ? 'entrevistas' : dest.area,
       view: dest.modoCandidatos ?? (lsGet('contratacao_view') === 'tabela' ? 'tabela' : lsGet('contratacao_view') === 'kanban' ? 'kanban' : 'cards'),
     };
   }
   ```
   Trocar por (remove a linha comentada e a condição — `area` passa a ser `dest.area` puro):
   ```ts
   function estadoInicialDeNavegacao(): { area: Area; view: ModoCandidatos } {
     const dest = destinoDeAbaAntiga(lsGet('contratacao_aba'));
     return {
       area: dest.area, // 'hoje' já existe (T14) — é o default real a partir daqui (RF-01)
       view: dest.modoCandidatos ?? (lsGet('contratacao_view') === 'tabela' ? 'tabela' : lsGet('contratacao_view') === 'kanban' ? 'kanban' : 'cards'),
     };
   }
   ```
   Invariante: mesma assinatura/uso (`useState(() => estadoInicialDeNavegacao().area)`, T09 Step 1) — só o corpo da função simplifica.

2. **`page.tsx` — remover a mesma correção no deep link (origem verbatim: efeito produzido por T09 Step 2).** T09 deixou:
   ```tsx
   if (dest) {
     setArea(dest.area === 'hoje' ? 'entrevistas' : dest.area); // Decisão 3 — Hoje só a partir de T14
     if (dest.subabaEntrevistas) setFocoSubabaEntrevistas(dest.subabaEntrevistas);
     if (dest.modoCandidatos) setView(dest.modoCandidatos);
   }
   ```
   Trocar por:
   ```tsx
   if (dest) {
     setArea(dest.area); // 'hoje' já existe (T14) — RF-01
     if (dest.subabaEntrevistas) setFocoSubabaEntrevistas(dest.subabaEntrevistas);
     if (dest.modoCandidatos) setView(dest.modoCandidatos);
   }
   ```
   Invariante: mesmo efeito único disparado por `searchParams` (T09 Step 2) — só a linha do `setArea` perde a condição.

3. **`page.tsx` — reservar espaço para a barra e renderizá-la (origem: `<div className="max-w-6xl mx-auto">` raiz, `page.tsx:527` do As Is, e o fim do JSX antes de `<DialogHost />`, `page.tsx:795` do As Is — aviso "antes das Fases 1-4" vale aqui, localizar pelo conteúdo).** Trocar:
   ```tsx
   return (
     <div className="max-w-6xl mx-auto">
   ```
   por:
   ```tsx
   return (
     <div className="max-w-6xl mx-auto pb-20 sm:pb-0">
   ```
   E, imediatamente antes de `<DialogHost />` (fim do JSX):
   ```tsx
       <DialogHost />
     </div>
   );
   ```
   por:
   ```tsx
       <BarraInferior area={area} onArea={setArea} />
       <DialogHost />
     </div>
   );
   ```
   Importar `BarraInferior` de `./components/BarraInferior`. Invariante: mesma raiz/fim de JSX do arquivo, só acrescenta `pb-20 sm:pb-0` (utilitário Tailwind já usado no repo, não é design novo) e o componente novo antes de `DialogHost`.

4. **Criar `src/pages/contratacao/components/BarraInferior.tsx`** com o corpo completo:
   ```tsx
   // Barra fixa de navegação no celular (< sm = 640px), RF-01/US-02. Layout (fixed bottom-0, safe-area,
   // proporção dos itens) reaproveitado de src/pages/tarefas/components/MobileNav.tsx:27-56 (único
   // padrão de bottom nav já existente no projeto) — paleta (rose/zinc) e ícones (Remix ri-*) são os de
   // Contratação, não os de Tarefas (slate/indigo/lucide-react), por causa da Constraint 1/12. Aditiva:
   // a barra de abas de cima (overflow-x-auto, T09) continua visível em todos os tamanhos (edge case
   // "celular sem JavaScript: abas desktop visíveis").
   import { AREAS, AREA_CONFIG, type Area } from '../navegacao';

   interface Props { area: Area; onArea: (a: Area) => void }

   export default function BarraInferior({ area, onArea }: Props) {
     const itens = [...AREAS, AREA_CONFIG];
     return (
       <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-zinc-200 pb-[env(safe-area-inset-bottom)]">
         <div className="flex">
           {itens.map((t) => {
             const ativo = area === t.id;
             const config = t.id === 'config';
             // "Configurações" não cabe em 1/6 da largura em 375px sem quebrar linha (a spec não pede
             // um nome novo — Regra nº 1); "Config" (abreviação do mesmo nome) cabe, do mesmo jeito que
             // "Candidatos"/"Entrevistas"/"Relatórios" já cabem nas outras 4 colunas sem truncar.
             return (
               <button key={t.id} onClick={() => onArea(t.id)}
                 title={config ? t.label : undefined} aria-label={t.label}
                 className={`flex-1 flex flex-col items-center gap-0.5 py-2 cursor-pointer ${ativo ? 'text-rose-700' : 'text-zinc-500'}`}>
                 <i className={`${t.icon} text-lg`} />
                 <span className="text-[10px] font-bold">{config ? 'Config' : t.label}</span>
               </button>
             );
           })}
         </div>
       </nav>
     );
   }
   ```
   Invariante: estrutura (`fixed bottom-0 inset-x-0`, `pb-[env(safe-area-inset-bottom)]`, `flex-1 flex flex-col items-center gap-0.5 py-2`) idêntica à de `MobileNav.tsx:29-37`, só trocando `md:hidden` → `sm:hidden` (corte de 640px desta spec), `z-40` → `z-30` (Decisão 9), `slate`/`indigo` → `rose`/`zinc` (cores já em uso em Contratação, E4) e ícone `lucide-react` → `<i className="ri-*" />` (Remix, já em uso em `AREAS`/`AREA_CONFIG`, T07). O ícone da engrenagem é o mesmo `ri-settings-3-line` já usado hoje (`page.tsx:52` do As Is, item `config` de `ABAS`) — nenhum ícone novo. O rótulo é **"Config"**, abreviação do nome que já existe ("Configurações" — a Regra nº 1 proíbe um nome novo, não uma abreviação por espaço, e as 5 colunas de área já cabem seus rótulos completos sem `hidden`/breakpoint extra: `tailwind.config.ts` **não** tem um breakpoint `xs`, então esta task não inventa um); `title`/`aria-label` carregam o nome completo "Configurações" (tooltip e leitor de tela), o texto visível na coluna é só "Config".

5. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado o mesmo total acumulado desde T14 (esta task não cria nem apaga teste), 0 failed.
   - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não editado.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Abrir o módulo pela primeira vez (sem `localStorage contratacao_aba` gravado) cai em **Hoje** (RF-01, US-01 completo a partir daqui).
- [ ] Aparelho com `contratacao_aba` já gravado (qualquer valor válido, incluindo os antigos `kanban`/`agenda`/etc.) continua caindo no destino de sempre — não foi puxado para Hoje à força.
- [ ] `?aba=` ausente/inválido cai em Hoje; `?aba=` com valor antigo válido continua indo para o destino de compatibilidade (T09), sem alteração de comportamento.
- [ ] **DoD extra desta task — 375px:** barra inferior visível, com as 5 áreas + "Config" (ícone `ri-settings-3-line`, o mesmo de sempre), sem rolagem horizontal; tocar em cada ícone troca de área; o conteúdo da página não fica coberto pela barra (rodapé com `pb-20` visível acima dela).
- [ ] **DoD extra desta task — 1366px:** barra inferior **não** aparece (`sm:hidden`); barra de abas de cima continua sem rolagem horizontal (comportamento de T09, não alterado por esta task).
- [ ] Barra de cima (`overflow-x-auto`, T09) continua visível em qualquer tamanho de tela — a barra de baixo é aditiva, não substitui (edge case "celular sem JavaScript").
- [ ] `z-index` da barra (`z-30`) não conflita: abrir a ficha do candidato (drawer) ou um modal escurece a barra inferior junto com o resto (backdrop por cima, `z-40`/`z-[60]`), a barra nunca fica "flutuando" sobre um backdrop.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] `npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.
- [ ] Visual inalterado além do estritamente pedido pela spec (barra inferior é UI genuinamente nova, RF-01/US-02 pedem explicitamente; construída só com classes/paleta/ícones já circulando no módulo, layout emprestado do único padrão de bottom-nav já existente no projeto, citado e adaptado).
- [ ] Nada desapareceu (Constraint 11): barra de cima continua existindo para todos os tamanhos; nenhuma área ficou inacessível.
- [ ] Rastreio: RF-01 (default Hoje, compatibilidade preservada), US-02 (barra inferior com 5 ícones + engrenagem, sem rolagem horizontal).

---

## T16: Filtros em etiquetas

> **Fase adicional (spec.md §2):** "Fase 6 (filtros + ações em lote) é adicional se der tempo, senão fica para spec futura." Nenhuma task anterior (T01–T15, T18, T19) depende de T16/T17 — a spec inteira já está completa e entregável sem esta fase.

| Campo | Valor |
|---|---|
| **Entregável** | Etiquetas de filtro por vaga e "ficha incompleta" + etiqueta "ordenar por aderência", em cima de `AreaCandidatos` (fase já existe); contagem dos chips de fase passa a refletir também os filtros novos |
| **Onde** | `src/pages/contratacao/components/FiltrosCandidatos.tsx` (criar), `src/pages/contratacao/areas/AreaCandidatos.tsx` (modificar) |
| **Depende de** | Fase 5 (T13–T15, T19) |
| **Bloqueia** | T17 (mesmos arquivos: `AreaCandidatos.tsx`) |
| **Paralelo com** | — |
| **Profundidade** | `contracts`, com override `snippets` no Step 1 (as duas funções puras de `FiltrosCandidatos.tsx` são lógica pura nova — Constraint 3) |
| **Requisitos** | briefing §3.3 (item 1) |

**AJUSTE DE MAPA NECESSÁRIO: `src/test/lib/contratacaoFiltrosCandidatos.test.ts` (criar) — teste das duas funções puras novas (`aplicarFiltrosNovos`, `ordenarPorAderencia`). O Mapa de arquivos da Fase 6 não listava um arquivo de teste porque a decisão de onde a lógica pura mora (Decisão 1 abaixo) só foi tomada agora, no planejamento desta task — mesma situação de T01/T07/T13, que já têm teste próprio no Mapa "Lógica pura".**

### Context pack

- Spec: briefing §3.3 item 1 (verbatim, `#c-spec-filtrada`) — "Filtros em etiquetas: fase (já existe), vaga, decisão, 'ficha incompleta'; ordenar por nota." Decisão (vaga apagada nota) — nota do orquestrador na seção C: "separe" o que é adicional/barato do que exigiria tocar contratos já fechados.
- Global Constraints: `#global-constraints` #1 (reaproveitar a etiqueta de fase, amostra E1 — mesmas classes `px-3 h-8 rounded-full text-xs font-bold...`, nenhuma cor/ícone novo fora do conjunto Remix já usado no módulo), #3 (teste só em lógica pura — as duas funções de filtro/ordenação), #8 (nada de banco — só reorganiza dados já carregados por `page.tsx` e já repassados a `AreaCandidatos` desde T08/T09), #9 (gate), #11 (busca/decisão/fase/empresa continuam iguais; os filtros novos são aditivos, aplicados **depois** deles na cadeia).
- Padrão do repo: amostra E1 (chip de fase, `page.tsx:719-727` do As Is — reaproduzido em `AreaCandidatos.tsx` desde T08 Step 5) é o padrão de etiqueta a clonar para vaga/ficha incompleta/ordenar; amostra E5 (a Tabela já ordena por "nota" de entrevista, `CandidatosLista.tsx:9,62`) é o que a nota nova **não pode** confundir (Decisão 3).
- Arquivos vizinhos e contratos que este task **consome sem reabrir**:
  - De **T02** (`tasks.md` Interfaces, linha 428-455): `aderenciaDe: (c: Candidate) => Aderencia | null` e `faltasDe: (c: Candidate) => number` — já são props de `AreaCandidatos` desde T08 (Interfaces de T08, linha 1269-1271: `aderenciaDe`, `faltasDe`).
  - De **T08/T09** (`tasks.md` Interfaces de T08 linha 1256-1275, evoluídas por T09 linha 1558-1565): `AreaCandidatos` já recebe `busca/onBuscaChange`, `decisaoFiltro/onDecisaoFiltroChange`, `view: ModoCandidatos` (3 valores desde T09), `faseFiltro/onFaseFiltroChange`, `counts`, `items/buscados/filtrados/daEmpresa`, `stages`, `vagaIdsDe: (c: Candidate) => string[]` (IDs de vagas do candidato — `job_id` — necessários para evitar ambiguidade quando duas vagas de empresas diferentes têm o mesmo título). **Não existe** `jobs: Job[]` na assinatura de `AreaCandidatos`, mas o filtro usa **job_id** via `vagaIdsDe`, que mapeia candidatos aos IDs exatos (Decisão 2).
  - Amostra E2 do material do orquestrador (`page.tsx:439-462` do As Is) — a cadeia `daEmpresa → buscados → filtrados`: **Kanban usa `buscados`, Lista/Tabela usa `filtrados`** (regra que já vale hoje, herdada por `AreaCandidatos` desde T08 Step 5, linha 1412 e 1433 de `tasks.md`).
- **Não fazer:** não tocar `page.tsx` (os filtros novos só reorganizam o que `AreaCandidatos` já recebe — nenhuma leitura nova, nenhuma prop nova de `page.tsx`); não tocar `shared.ts`, `aderencia.ts`, `navegacao.ts`, `hoje.ts`; não adicionar `job_id`/`Job[]` à assinatura de `AreaCandidatos` (exigiria reabrir o contrato de T08/T09 e mexer em `page.tsx` — fora do "Onde" desta task); não mudar a cor/ícone dos chips de fase existentes; não alterar o comportamento de ordenação **interna** da Tabela (`CandidatosLista.tsx` `Tabela`/`SortKey`, incluindo a coluna "Nota" de entrevista) — a etiqueta nova de ordenação é anterior a essa tela, não um substituto dela (Decisão 3).

### Decisões tomadas

1. **Onde mora a lógica pura:** dentro de `FiltrosCandidatos.tsx`, exportada ao lado do componente visual (mesmo arquivo — não é grande o bastante para justificar um módulo `contratacao/filtros.ts` à parte, e mantém a responsabilidade "filtros de candidatos" num só lugar, junto do componente que a spec já atribuiu a este path no Mapa). Duas funções: `aplicarFiltrosNovos(items, filtro, vagasDe, faltasDe)` (filtro de vaga + ficha incompleta) e `ordenarPorAderencia(items, aderenciaDe)` (a ordenação). Ambas puras (sem `useState`/JSX), exportadas do mesmo arquivo do componente — o teste importa só as funções, não o componente (mesmo padrão de `aderencia.ts`/`hoje.ts`, que também não têm JSX).
2. **Filtro de vaga usa `job_id`, não título.** A função `vagaIdsDe: (c: Candidate) => string[]` retorna os IDs das vagas (`job_id`) a que o candidato se inscreveu. Comparar por ID evita a ambiguidade de duas vagas de empresas diferentes com o mesmo título (cenário raro, mas possível: "Gerente" na loja A vs. "Gerente" na loja B) caírem na mesma etiqueta. A etiqueta exibe o rótulo/título da vaga (via `VagaEtiqueta.label`), mas filtra pelo `VagaEtiqueta.id` (o `job_id`), garantindo precisão mesmo com nomes duplicados.
3. **Qual nota a ordenação usa, e como não confunde com a coluna "Nota" da Tabela.** Usa `aderenciaDe(c)?.score` (a mesma nota do chip "Aderência: X,X · Vaga" de T02) — **não** a nota de entrevista (`avgScore`/`c.rating`) que já é a coluna "Nota" da Tabela (com `title` distinguindo as duas desde T02, Decisão de T02 linha 417). O rótulo da etiqueta é **"Ordenar por aderência"** (não "ordenar por nota", apesar do texto do briefing) exatamente para não reabrir a confusão que T02 já resolveu com o `title` da coluna; a etiqueta ganha `title="Ordena pela aderência do currículo (mesma nota do chip do card) — não é a nota da entrevista"` reforçando por acessibilidade. Candidato sem candidatura válida (`aderenciaDe(c) === null`) entra no fim da lista (`score` tratado como `-1`), nunca no topo.
4. **A ordenação vale para Kanban e para Cards; a Tabela mantém o próprio controle.** O array que `AreaCandidatos` passa para `Kanban` (`buscados`, pós-filtro) e para `CandidatosLista` (`filtrados`, pós-filtro) já sai pré-ordenado quando a etiqueta está ativa. No Kanban, cada coluna filtra o array recebido preservando a ordem (`Kanban.tsx:28`, `list = items.filter(...)`), então a pré-ordenação aparece dentro de cada coluna automaticamente — nenhuma mudança em `Kanban.tsx` é necessária para isso. Na visão Cards de `CandidatosLista` o array é usado na ordem recebida (`CandidatosLista.tsx:37`, `.map`) — mesma coisa. A **Tabela** tem sua própria ordenação interna (`Tabela`, `CandidatosLista.tsx:47-71`, `useState<{key: SortKey}>`) que **sempre** reordena o array de entrada pelo `sort.key` atual (padrão `'recebido'`) — ela ignora a ordem de chegada, então a etiqueta "Ordenar por aderência" não tem efeito visível na Tabela **por design já existente** (não é regressão desta task); quem quiser ordenar a Tabela por aderência clica no cabeçalho, mas isso exigiria uma nova `SortKey` em `CandidatosLista.tsx`, fora do "Onde" desta task — registrado em "Fica para spec futura".
5. **Onde cada filtro novo entra na cadeia `daEmpresa → buscados → filtrados`:** os filtros novos (vaga, ficha incompleta) e a ordenação são um **estágio a mais**, depois de `buscados`/`filtrados` (que já chegam prontos de `page.tsx`), calculado dentro de `AreaCandidatos`: `buscadosComFiltrosNovos` (a partir de `props.buscados`, alimenta o Kanban) e `filtradosComFiltrosNovos` (a partir de `props.filtrados`, alimenta Lista/Tabela). Isso preserva a regra existente (Kanban vê antes do filtro de fase, Lista/Tabela vê depois) sem tocar `page.tsx`.
6. **Contagem dos chips de fase (`counts`) passa a refletir os filtros novos.** `props.counts` (calculado em `page.tsx`, considera só busca+decisão+empresa) ficaria incoerente com a lista visível quando vaga/ficha incompleta estão ativos. `AreaCandidatos` recalcula localmente `countsAjustados` a partir de `buscadosComFiltrosNovos` (mesmo algoritmo de `page.tsx:455-459` do As Is, citado na amostra E2) e usa esse valor nos chips de fase em vez de `props.counts`. Sem filtro novo ativo, `countsAjustados` é idêntico a `props.counts` — nenhuma regressão visível.
7. **Etiquetas de vaga são calculadas a partir de `props.buscados`** (não `props.filtrados`), para que a lista de vagas oferecidas como etiqueta não encolha quando o usuário já escolheu uma fase — mesma lógica de "amplitude" que already vale para os chips de fase (que também usam `buscados`/`counts` antes do filtro de fase se aplicar).

### Interfaces

**Consumes** (de T02/T08/T09, já existentes em `AreaCandidatos.tsx` — ver Context pack):
```ts
import type { Aderencia } from '../aderencia'; // T01/T02
// props já existentes de AreaCandidatos (T08/T09): buscados, filtrados, vagasDe, aderenciaDe, faltasDe, stages, view
```

**Produces** (novo arquivo — consumido só por `AreaCandidatos.tsx`, e pelo teste):
```ts
// src/pages/contratacao/components/FiltrosCandidatos.tsx
export interface FiltrosNovosValor {
  vaga: string | null;          // job_id (ID exato da vaga, via vagaIdsDe(c)); null = todas as vagas
  fichaIncompleta: boolean;     // true = só quem tem faltasDe(c) > 0
  ordenarPorAderencia: boolean; // true = ordena decrescente por aderenciaDe(c)?.score
}
export const FILTROS_NOVOS_INICIAL: FiltrosNovosValor;

export function aplicarFiltrosNovos(
  items: Candidate[],
  filtro: Pick<FiltrosNovosValor, 'vaga' | 'fichaIncompleta'>,
  vagasDe: (c: Candidate) => string[],
  faltasDe: (c: Candidate) => number,
): Candidate[];

export function ordenarPorAderencia(items: Candidate[], aderenciaDe: (c: Candidate) => Aderencia | null): Candidate[];

interface Props {
  vagas: string[]; // títulos distintos já calculados pelo caller (AreaCandidatos, a partir de buscados)
  valor: FiltrosNovosValor;
  onChange: (v: FiltrosNovosValor) => void;
}
export default function FiltrosCandidatos(props: Props): JSX.Element;
```

**Produces** (evolução de `AreaCandidatos.tsx` — Props ganham, sobre as de T09; `view`/`onViewChange`/demais campos de T09 continuam inalterados):
```ts
// areas/AreaCandidatos.tsx — nenhum campo novo em Props (T16 é só estado interno);
// T17 é quem acrescenta props (onMoverLote) — ver T17.
```

### Steps

1. **Criar `src/pages/contratacao/components/FiltrosCandidatos.tsx` — lógica pura (Profundidade `snippets` neste Step).** Corpo completo:
   ```tsx
   // Filtros novos de Candidatos (briefing §3.3): vaga, ficha incompleta, ordenar por aderência.
   // Lógica pura (sem query, sem JSX) separada do componente só para poder ser testada (Constraint 3).
   import type { Candidate } from '../shared';
   import type { Aderencia } from '../aderencia';

   export interface FiltrosNovosValor {
     vaga: string | null;
     fichaIncompleta: boolean;
     ordenarPorAderencia: boolean;
   }

   export const FILTROS_NOVOS_INICIAL: FiltrosNovosValor = { vaga: null, fichaIncompleta: false, ordenarPorAderencia: false };

   /** Filtro de vaga (por título — AreaCandidatos não tem job_id, só vagasDe) + ficha incompleta. */
   export function aplicarFiltrosNovos(
     items: Candidate[],
     filtro: Pick<FiltrosNovosValor, 'vaga' | 'fichaIncompleta'>,
     vagasDe: (c: Candidate) => string[],
     faltasDe: (c: Candidate) => number,
   ): Candidate[] {
     return items
       .filter((c) => !filtro.vaga || vagasDe(c).includes(filtro.vaga))
       .filter((c) => !filtro.fichaIncompleta || faltasDe(c) > 0);
   }

   /** Ordena por aderência (nota do currículo, T02) decrescente; sem candidatura válida vai para o fim. */
   export function ordenarPorAderencia(items: Candidate[], aderenciaDe: (c: Candidate) => Aderencia | null): Candidate[] {
     return [...items].sort((a, b) => (aderenciaDe(b)?.score ?? -1) - (aderenciaDe(a)?.score ?? -1));
   }

   interface Props {
     vagas: string[];
     valor: FiltrosNovosValor;
     onChange: (v: FiltrosNovosValor) => void;
   }

   /** Etiquetas de filtro — mesmo padrão visual dos chips de fase (page.tsx:719-727 do As Is / AreaCandidatos.tsx). */
   export default function FiltrosCandidatos({ vagas, valor, onChange }: Props) {
     const base = 'px-3 h-8 rounded-full text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors';
     const ativo = 'bg-zinc-900 text-white border-zinc-900';
     const inativo = 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300';
     return (
       <div className="flex flex-wrap gap-1.5 mb-3">
         <button onClick={() => onChange({ ...valor, vaga: null })} className={`${base} ${valor.vaga === null ? ativo : inativo}`}>
           Todas as vagas
         </button>
         {vagas.map((v) => (
           <button key={v} onClick={() => onChange({ ...valor, vaga: v })} className={`${base} ${valor.vaga === v ? ativo : inativo}`}>
             {v}
           </button>
         ))}
         <button onClick={() => onChange({ ...valor, fichaIncompleta: !valor.fichaIncompleta })}
           className={`${base} ${valor.fichaIncompleta ? ativo : inativo}`}>
           <i className="ri-error-warning-line" /> Ficha incompleta
         </button>
         <button onClick={() => onChange({ ...valor, ordenarPorAderencia: !valor.ordenarPorAderencia })}
           title="Ordena pela aderência do currículo (mesma nota do chip do card) — não é a nota da entrevista"
           className={`${base} ${valor.ordenarPorAderencia ? ativo : inativo}`}>
           <i className="ri-percent-line" /> Ordenar por aderência
         </button>
       </div>
     );
   }
   ```
   Invariante: mesmas classes do chip de fase (E1) reaproveitadas literalmente (`base`/`ativo`/`inativo` são as mesmas 4 classes condicionais de `page.tsx:719-727`, só fatoradas em variáveis para não repetir a string 4 vezes); ícones `ri-error-warning-line` (já usado no chip "falta X" de T02) e `ri-percent-line` (já usado no chip "Aderência" de T02) — nenhum ícone novo.

2. **Criar `src/test/lib/contratacaoFiltrosCandidatos.test.ts`** (AJUSTE DE MAPA — ver acima) com o corpo completo:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { aplicarFiltrosNovos, ordenarPorAderencia } from '../../pages/contratacao/components/FiltrosCandidatos';
   import type { Aderencia } from '../../pages/contratacao/aderencia';
   import type { Candidate } from '../../pages/contratacao/shared';

   const cand = (over: Partial<Candidate> & { id: string }): Candidate => ({
     company_id: null, stage_id: null, full_name: over.full_name ?? 'Fulana', email: null, phone: null, city: null,
     neighborhood: null, address: null, marital_status: null, decision: null, lat: null, lng: null, geo_label: null,
     geo_precision: null, birth_date: null, age: null, desired_role: null, summary: null, experiences: [], education: [],
     skills: [], languages: [], courses: [], availability: null, salary_expectation: null, driver_license: null,
     total_experience_months: null, strengths: [], concerns: [], rating: null, notes: null, file_path: null,
     file_name: null, file_type: null, raw_text: null, ai_processed: false, created_at: '2026-09-01T00:00:00Z',
     ...over,
   });
   const vagasDe = (map: Record<string, string[]>) => (c: Candidate) => map[c.id] ?? [];
   const faltasDe = (map: Record<string, number>) => (c: Candidate) => map[c.id] ?? 0;
   const aderenciaDe = (map: Record<string, number | undefined>) => (c: Candidate): Aderencia | null =>
     map[c.id] == null ? null : { score: map[c.id]!, fit: 'alta', jobId: 'j1', jobTitle: 'Vaga' };

   describe('aplicarFiltrosNovos', () => {
     const items = [cand({ id: 'c1' }), cand({ id: 'c2' }), cand({ id: 'c3' })];

     it('sem filtro nenhum, devolve a lista inteira', () => {
       expect(aplicarFiltrosNovos(items, { vaga: null, fichaIncompleta: false }, vagasDe({}), faltasDe({}))).toEqual(items);
     });

     it('filtra por vaga (título exato)', () => {
       const vd = vagasDe({ c1: ['Atendente'], c2: ['Caixa'], c3: ['Atendente', 'Caixa'] });
       const r = aplicarFiltrosNovos(items, { vaga: 'Atendente', fichaIncompleta: false }, vd, faltasDe({}));
       expect(r.map((c) => c.id)).toEqual(['c1', 'c3']);
     });

     it('filtra por ficha incompleta (faltasDe > 0)', () => {
       const fd = faltasDe({ c1: 2, c2: 0, c3: 1 });
       const r = aplicarFiltrosNovos(items, { vaga: null, fichaIncompleta: true }, vagasDe({}), fd);
       expect(r.map((c) => c.id)).toEqual(['c1', 'c3']);
     });

     it('combina vaga + ficha incompleta (E lógico)', () => {
       const vd = vagasDe({ c1: ['Atendente'], c2: ['Atendente'], c3: ['Caixa'] });
       const fd = faltasDe({ c1: 1, c2: 0, c3: 1 });
       const r = aplicarFiltrosNovos(items, { vaga: 'Atendente', fichaIncompleta: true }, vd, fd);
       expect(r.map((c) => c.id)).toEqual(['c1']);
     });
   });

   describe('ordenarPorAderencia', () => {
     const items = [cand({ id: 'c1' }), cand({ id: 'c2' }), cand({ id: 'c3' })];

     it('ordena decrescente pelo score de aderência', () => {
       const ad = aderenciaDe({ c1: 50, c2: 90, c3: 70 });
       expect(ordenarPorAderencia(items, ad).map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
     });

     it('candidato sem candidatura válida (aderência null) vai para o fim', () => {
       const ad = aderenciaDe({ c1: 60, c2: undefined, c3: 80 });
       expect(ordenarPorAderencia(items, ad).map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
     });

     it('não muta o array recebido', () => {
       const original = [...items];
       ordenarPorAderencia(items, aderenciaDe({ c1: 10, c2: 90, c3: 50 }));
       expect(items).toEqual(original);
     });
   });
   ```

3. Rodar `npx vitest run src/test/lib/contratacaoFiltrosCandidatos.test.ts` — esperado `Test Files 1 passed (1)` e `Tests 7 passed (7)`, sem falha.

4. **`areas/AreaCandidatos.tsx` — consumir os filtros novos (Profundidade `contracts`).** Acrescentar ao topo (imports): `useCallback, useEffect, useMemo, useState` de `'react'`; `stageOf` de `'../shared'` (junto dos outros símbolos já importados de `'../shared'` desde T08); `FiltrosCandidatos, { type FiltrosNovosValor, FILTROS_NOVOS_INICIAL, aplicarFiltrosNovos, ordenarPorAderencia }` de `'../components/FiltrosCandidatos'`. Dentro do componente, antes do `return`:
   ```ts
   const [filtrosNovos, setFiltrosNovos] = useState<FiltrosNovosValor>(FILTROS_NOVOS_INICIAL);

   // Etiquetas de vaga: títulos distintos vindos de `buscados` (Decisão 7 — mesma amplitude dos chips de fase).
   const vagasDisponiveis = useMemo(
     () => [...new Set(props.buscados.flatMap(props.vagasDe))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
     [props.buscados, props.vagasDe],
   );

   const buscadosComFiltrosNovos = useMemo(
     () => aplicarFiltrosNovos(props.buscados, filtrosNovos, props.vagasDe, props.faltasDe),
     [props.buscados, filtrosNovos, props.vagasDe, props.faltasDe],
   );
   const buscadosParaKanban = filtrosNovos.ordenarPorAderencia
     ? ordenarPorAderencia(buscadosComFiltrosNovos, props.aderenciaDe) : buscadosComFiltrosNovos;

   const filtradosComFiltrosNovos = useMemo(
     () => aplicarFiltrosNovos(props.filtrados, filtrosNovos, props.vagasDe, props.faltasDe),
     [props.filtrados, filtrosNovos, props.vagasDe, props.faltasDe],
   );
   const filtradosParaLista = filtrosNovos.ordenarPorAderencia
     ? ordenarPorAderencia(filtradosComFiltrosNovos, props.aderenciaDe) : filtradosComFiltrosNovos;

   // Contagem dos chips de fase considerando os filtros novos (Decisão 6) — sem filtro novo ativo é
   // idêntico a props.counts (mesmo algoritmo de page.tsx:455-459 do As Is).
   const countsAjustados = useMemo(() => {
     const m: Record<string, number> = { todas: buscadosComFiltrosNovos.length };
     for (const c of buscadosComFiltrosNovos) { const s = stageOf(props.stages, c.stage_id)?.id ?? ''; m[s] = (m[s] ?? 0) + 1; }
     return m;
   }, [buscadosComFiltrosNovos, props.stages]);
   ```
   Invariante: nenhuma leitura nova, nenhum estado além do necessário para os 3 valores da etiqueta; `props.buscados`/`props.filtrados` continuam vindo prontos de `page.tsx`, só ganham um estágio a mais dentro de `AreaCandidatos`.

5. **`areas/AreaCandidatos.tsx` — trocar os pontos de uso.** No bloco de chips de fase (`page.tsx:1418-1426`/`AreaCandidatos.tsx` desde T08), trocar `props.counts[s.id]` por `countsAjustados[s.id]` (e `props.counts['todas']` → `countsAjustados['todas']`, se usado em algum "Todas"). Logo abaixo da busca/alternância (antes do `{props.modoKanban ? ... : ...}`, que desde T09 é `{props.view === 'kanban' ? ... : ...}`), inserir:
   ```tsx
   <FiltrosCandidatos vagas={vagasDisponiveis} valor={filtrosNovos} onChange={setFiltrosNovos} />
   ```
   Trocar `<Kanban items={props.buscados} .../>` por `<Kanban items={buscadosParaKanban} .../>` (só o array muda; as demais props do Kanban continuam as mesmas). Trocar a condição `props.filtrados.length === 0` (mensagem "Nenhum candidato/currículo") por `filtradosParaLista.length === 0`, e `<CandidatosLista view={props.view} items={props.filtrados} .../>` por `<CandidatosLista view={props.view} items={filtradosParaLista} .../>`. Invariante: mesma estrutura condicional, mesmas classes/textos da mensagem de vazio — só a fonte do array muda.

6. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado **o total acumulado até T19 + 7 novos** desta task (conferir o total exato com `npx vitest run` antes de começar, como manda a Constraint 9), 0 failed.
   - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não editado.
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Etiquetas "Todas as vagas" + 1 por vaga distinta, "Ficha incompleta" e "Ordenar por aderência" aparecem acima da lista/Kanban de Candidatos, no mesmo padrão visual dos chips de fase (E1).
- [ ] Filtro de vaga funciona em Cards, Tabela e Kanban (vale para `buscadosParaKanban` e `filtradosParaLista`); filtro de ficha incompleta idem.
- [ ] "Ordenar por aderência" reordena Cards e Kanban pela nota de aderência (T02), decrescente, candidato sem candidatura no fim; a coluna "Nota" da Tabela (entrevista) e a ordenação própria da Tabela continuam funcionando exatamente como hoje, sem qualquer alteração de comportamento (Decisão 4).
- [ ] Contadores dos chips de fase (`countsAjustados`) batem com a lista efetivamente visível quando um filtro novo está ativo; sem filtro novo ativo, os números são idênticos aos de antes desta task.
- [ ] `npx vitest run src/test/lib/contratacaoFiltrosCandidatos.test.ts` → `Tests 7 passed (7)`.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] **`npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.**
- [ ] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos.
- [ ] Nada desapareceu (Constraint 11): busca, filtro de decisão, chips de fase e alternância de view continuam funcionando exatamente como hoje; os filtros novos são puramente aditivos.
- [ ] Rastreio: briefing §3.3 item 1 (filtros: fase/vaga/decisão/ficha incompleta/ordenar por nota) coberto.

### Fica para spec futura

- **Ordenar a Tabela por aderência pelo próprio cabeçalho** (uma `SortKey` nova em `CandidatosLista.tsx`, ex. `'aderencia'`): fora do "Onde" desta task (exigiria mexer na `Tabela` interna e no `SortKey` da Tabela, hoje limitada à nota de entrevista); a etiqueta "Ordenar por aderência" já cobre Cards/Kanban, que é o pedido do briefing.
- **Filtro de vaga por `job_id`** (em vez de título): exigiria expandir a assinatura de `AreaCandidatos` com `jobs`/mapa de `job_id` por candidato, reabrindo o contrato fechado de T08/T09 — fora do escopo "adicional" desta fase.
- **Persistir os filtros novos entre sessões** (localStorage): não pedido pelo briefing; mesma decisão de não persistir já tomada para as sub-abas de Entrevistas em T09 (Decisão 7 de T09).

---

## T17: Seleção múltipla e ações em lote

> **Fase adicional (spec.md §2)**, igual a T16 — nenhuma task anterior depende desta.

| Campo | Valor |
|---|---|
| **Entregável** | Checkbox de seleção em Cards, Tabela e Kanban; barra de ações em lote (selecionar todos os visíveis, enviar para a IA agendar, mover de fase, descartar) respeitando a trava de dados mínimos com **uma única** pergunta por lote |
| **Onde** | `src/pages/contratacao/components/AcoesEmLote.tsx` (criar), `src/pages/contratacao/areas/AreaCandidatos.tsx` (modificar), `src/pages/contratacao/components/CandidatosLista.tsx` (modificar), `src/pages/contratacao/components/Kanban.tsx` (modificar) |
| **Depende de** | T16 (mesmos arquivos: `AreaCandidatos.tsx` recebe `buscadosParaKanban`/`filtradosParaLista` de T16, que são a base da seleção "visível" desta task) |
| **Bloqueia** | — |
| **Paralelo com** | — |
| **Profundidade** | `contracts`, com override `snippets` no Step da função pura `candidatosTravadosNoLote` (lógica pura nova, Constraint 3) |
| **Requisitos** | briefing §3.3 (item 2) |

**AJUSTE DE MAPA NECESSÁRIO: `src/pages/contratacao/page.tsx` (modificar) — precisa de uma nova função `moveLote(ids, stageId)` que escreve o lote com UMA pergunta só (E3/E7 do material: `updateCandidate` pergunta um por um, o que abriria até N janelas em sequência para um lote). Essa orquestração (achar quem está travado, perguntar uma vez, gravar em até 2 chamadas `update().in()`) só pode morar onde vivem `confirmar()`/`avisar()`/`supabase`/`items`/`stages`/`faltasDe` já carregados — isto é, `page.tsx` — porque `AreaCandidatos.tsx` não recebe nenhum desses (suas Props, T08/T09, não incluem `settings`, `confirmar`/`avisar` nem acesso direto ao Supabase). `AreaCandidatos` recebe só o resultado como uma prop de callback, mesmo mecanismo já usado para `onMove` (T08, uma função de `page.tsx` passada como prop).**

**AJUSTE DE MAPA NECESSÁRIO: `src/test/lib/contratacaoAcoesEmLote.test.ts` (criar) — teste da função pura `candidatosTravadosNoLote` (mesma situação de T16: a decisão de onde a lógica pura mora só foi tomada agora).**

### Context pack

- Spec: briefing §3.3 item 2 (verbatim) — "Seleção múltipla com ações em lote: enviar para a IA agendar (mover para fase `agendar`), mover de fase, descartar. Respeitar a trava dos dados mínimos (`required_waived_at` / 'Mover mesmo assim')."
- Global Constraints: `#global-constraints` #1 (reaproveitar classes de `AdicionarCandidatosModal.tsx` — o **padrão de seleção que já existe** no módulo, amostra E4), #5 (não quebrar a trava de dados mínimos — constraint central desta task), #8 (a escrita em lote usa as mesmas tabelas/colunas que a tela já escreve hoje: `hiring_candidates.stage_id`/`required_waived_at`/`updated_at`, nenhuma coluna nova), #9 (gate), #11 (nada desaparece — a seleção é aditiva; nenhum filtro/contador some).
- **Padrão de seleção já existente no módulo** (`AdicionarCandidatosModal.tsx`, lido nesta task):
  - `Set<string>` + `toggle` (linha 18, 30): `const [sel, setSel] = useState<Set<string>>(new Set());` e `const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });` — **mesmo mecanismo** desta task (`selecionados`/`toggleSelecao` em `AreaCandidatos.tsx`).
  - Checkbox por linha (linha 58-59): `<label className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-50 cursor-pointer"><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="accent-rose-600 w-4 h-4" />...` — a classe `accent-rose-600 w-4 h-4` do `<input>` é reaproveitada literalmente nos checkboxes de Cards/Tabela/Kanban desta task.
  - Rodapé com contagem e ações (linha 71-83): `"Marcar todos"`/`"Limpar"` (`sel.size === lista.length ? 'Limpar' : 'Marcar todos'`, classe `text-xs font-bold text-zinc-500 hover:text-zinc-800 cursor-pointer`, linha 73-76); botão secundário `px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer` (linha 78); botão primário `px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer` com `disabled={!sel.size}` (linha 79-82) — **as três classes são reaproveitadas literalmente** em `AcoesEmLote.tsx`.
- Amostra E3 do material do orquestrador (`page.tsx:317-348` do As Is, `updateCandidate`) — a trava: sai de fase `native_kind === 'novo'` para uma que não é `novo` nem `descartado`, com `faltasFicha` não vazio, pergunta `confirmar()` e grava `required_waived_at` no aceite. **Esta é a regra que `candidatosTravadosNoLote` (abaixo) replica para N candidatos de uma vez**, sem duplicar a leitura de `faltasFicha`/`settings` — reaproveita o `faltasDe: (c: Candidate) => number` que T02 já calculou uma vez em `page.tsx` (`page.tsx:473-478` do material, `faltasPorCandidato`/`faltasDe`).
- Amostra E7 do material (`page.tsx:231-243` do As Is, `upsert` em lote de `hiring_applications`) — o padrão de escrita em lote do módulo (`supabase.from(...).upsert(...)`/`.update(...).in(...)`), citado para justificar a Decisão 6 abaixo (`update().in()` em vez de N chamadas).
- **Não fazer:** não duplicar a lógica de `updateCandidate` (ela continua intocada, cobrindo o caminho de 1 candidato); não abrir N janelas de confirmação para um lote (é exatamente o problema que a Decisão 5 resolve); não mover para `descartado` passando pela trava (a trava nunca se aplica a esse destino, igual ao comportamento de hoje); não tocar `shared.ts`/`dialog.tsx`/`EntrevistaModal.tsx`/`AdicionarCandidatosModal.tsx` (só lidos, como padrão); não adicionar Radix nem um novo componente de checkbox — `<input type="checkbox" className="accent-rose-600 ...">` nativo, mesmo de `AdicionarCandidatosModal.tsx`.

### Decisões tomadas

1. **Onde mora a lógica pura da trava (Decisão central, ver E3):** `candidatosTravadosNoLote(candidatos, stageDestinoId, stages, faltasDe)`, exportada de `AcoesEmLote.tsx` (é o arquivo do Mapa responsável por "respeitando a trava de dados mínimos"). Recebe `faltasDe` como parâmetro (a mesma função que T02 já calcula em `page.tsx` e repassa a `AreaCandidatos`) em vez de recalcular `faltasFicha`+`settings` — evita duplicar a regra, e permite testar a função com um `faltasDe` de mentira (fixture), sem precisar de `Settings` real. Regra idêntica à de `updateCandidate` (E3): candidato está travado quando `stageOf(stages, c.stage_id)?.native_kind === 'novo'` **e** o destino não é `'novo'` nem `'descartado'` **e** `faltasDe(c) > 0`; candidato já no destino não conta (nada a mover).
2. **Como fica a trava no lote — uma pergunta só (resolve o "problema de projeto" de E3):** `page.tsx` chama `candidatosTravadosNoLote` **antes** de escrever; se a lista vier vazia, escreve direto (sem pergunta) — igual ao caminho de 1 candidato sem ficha faltando. Se vier não vazia, mostra **um único** `confirmar()` listando os primeiros nomes: `"${travados.length} de ${alvo.length} candidato(s) têm ficha incompleta: Fulana, Beltrano, Ciclana. Quer mover mesmo assim?"`, com `confirmarLabel: 'Mover mesmo assim'` — mesmo texto/botão do caminho individual (E3), só que descrevendo o grupo. Se o dono cancelar, **nada é gravado** (nem os candidatos sem trava) — comportamento conservador: um "não" vale para o lote inteiro, para não surpreender com uma gravação parcial silenciosa. Se aceitar, os candidatos travados ganham `required_waived_at`; os demais (do mesmo lote) são gravados normalmente, sem o campo.
3. **`update().in()` em vez de `updateCandidate` em laço (ver E7).** Como o patch difere só pela presença de `required_waived_at`, a escrita usa **no máximo 2 chamadas** a `supabase.from('hiring_candidates').update(...).in('id', ids)`: uma para quem não precisa de `required_waived_at`, outra para quem precisa (grupo vindo de `candidatosTravadosNoLote`) — em vez de N chamadas (uma por candidato) ou de reaproveitar `updateCandidate` (que só sabe lidar com 1 id e 1 pergunta por vez). O estado local (`items`) é atualizado de forma otimista antes das chamadas (mesmo padrão de `updateCandidate`); em caso de erro numa das duas chamadas, `avisar()` mostra quantos falharam e `carregar()` (já existente) resincroniza tudo no fim — igual ao tratamento de erro do caminho individual.
4. **Mover para "IA agendar" e "Descartar" são o mesmo `moveLote`**, só variando o `stageId`: `stageByKind(stages, 'agendar')?.id` e `stageByKind(stages, 'descartado')?.id` respectivamente (`shared.ts:162`, já usado em `page.tsx`/`AdicionarCandidatosModal.tsx`). Descartar nunca aciona a trava (native_kind `descartado` é sempre exceção, igual hoje) — nenhuma pergunta extra além da já existente para outros destinos.
5. **Visual da seleção — onde aparece e onde ficam as ações.**
   - Checkbox: em `CandidateCard` (Cards e Kanban), um `<input type="checkbox" className="accent-rose-600 w-4 h-4">` (mesma classe do checkbox de `AdicionarCandidatosModal.tsx:59`) posicionado em `<div className="relative"><input className="absolute top-3 right-3 z-10 ..." />...<button>(o card de hoje, inalterado)</button></div>` — **fora** do `<button>` do card (um `<input>` dentro de `<button>` não é HTML válido; o wrapper `relative`/`absolute` evita reescrever o card em si). Na Tabela, uma coluna nova à esquerda com `<td onClick={(e) => e.stopPropagation()}><input type="checkbox" .../></td>` — mesmo padrão de `stopPropagation` já usado na coluna do assistente (`CandidatosLista.tsx:144`).
   - Barra de ações: **acima** da lista/Kanban (não um rodapé fixo — o módulo não tem paginação nem rodapé fixo hoje, e um rodapé fixo novo seria um elemento de design não previsto pela Constraint 1), sempre visível quando há pelo menos 1 candidato na visão atual, com os botões de ação **desabilitados** (`disabled:opacity-40`, mesma classe de `AdicionarCandidatosModal.tsx:80`) enquanto nada está selecionado — mesmo padrão do rodapé do modal (E4), só que fixado no topo em vez de um rodapé de modal (aqui não há modal).
6. **Seleção é compartilhada entre os 3 modos** (Cards/Tabela/Kanban) — o mesmo `Set<string>` vale nos três, porque o pedido é "selecionar candidatos", não "selecionar linhas da Tabela". Quando o usuário troca de modo ou muda qualquer filtro (busca, decisão, fase, vaga, ficha incompleta), a seleção é **podada** (não zerada) para a interseção com o que está visível agora — quem já estava selecionado e continua visível permanece selecionado; quem saiu de vista é removido da seleção (evita agir sobre um candidato que o usuário não vê mais). Implementado com um único `useEffect` que reage à lista "visível atual" (`buscadosParaKanban` no Kanban, `filtradosParaLista` na Lista/Tabela), sem precisar distinguir "o que mudou".
7. **Seleção não persiste em localStorage** — mesma decisão de T09 (sub-abas) e T16 (filtros novos): estado efêmero, reinicia a cada visita à tela.

### Interfaces

**Consumes** (de T16, já existentes em `AreaCandidatos.tsx`): `buscadosParaKanban`, `filtradosParaLista` (os arrays "visíveis" desta task nasce sobre eles); de T02/T08: `faltasDe: (c: Candidate) => number`; de `shared.ts`: `stageOf`, `stageByKind`.

**Produces** (assinaturas exatas):
```ts
// src/pages/contratacao/components/AcoesEmLote.tsx
export function candidatosTravadosNoLote(
  candidatos: Candidate[],
  stageDestinoId: string,
  stages: Stage[],
  faltasDe: (c: Candidate) => number,
): Candidate[]; // subconjunto de `candidatos` que cairia na trava (E3) se movido para stageDestinoId

interface Props {
  selecionados: number;
  visiveis: number;
  todosSelecionados: boolean;
  stages: Stage[];
  onSelecionarTodos: () => void;
  onLimpar: () => void;
  onEnviarParaAgendar?: () => void; // undefined quando não existe fase native_kind 'agendar'
  onMoverFase: (stageId: string) => void;
  onDescartar?: () => void;        // undefined quando não existe fase native_kind 'descartado'
}
export default function AcoesEmLote(props: Props): JSX.Element | null;

// src/pages/contratacao/page.tsx — nova função, ao lado de updateCandidate (page.tsx:317)
async function moveLote(ids: string[], stageId: string): Promise<void>;

// areas/AreaCandidatos.tsx — Props ganha (sobre as de T08/T09/T16):
interface Props {
  // ...props existentes inalteradas...
  onMoverLote: (ids: string[], stageId: string) => Promise<void>;
}

// components/CandidatosLista.tsx — Props ganha:
interface Props {
  // ...props existentes inalteradas...
  selecionados: Set<string>;
  onToggleSelecao: (id: string) => void;
}
// CandidateCard ganha:
export function CandidateCard({ /* ...props existentes... */, selecionado = false, onToggleSelecao }: {
  /* ...tipos existentes... */
  selecionado?: boolean;
  onToggleSelecao?: () => void;
})

// components/Kanban.tsx — Props ganha:
interface Props {
  // ...props existentes inalteradas...
  selecionados: Set<string>;
  onToggleSelecao: (id: string) => void;
}
```

### Steps

1. **Criar `src/pages/contratacao/components/AcoesEmLote.tsx` — função pura primeiro (Profundidade `snippets` neste Step).** Corpo completo:
   ```tsx
   // Seleção múltipla + ações em lote (briefing §3.3): enviar p/ IA agendar, mover de fase, descartar.
   // A regra de quem está travado pela ficha incompleta é lógica pura (Constraint 3) — mesma regra de
   // updateCandidate (page.tsx:317-348), replicada aqui para N candidatos de uma vez, reaproveitando o
   // `faltasDe` que T02 já calcula em page.tsx (não recalcula faltasFicha/settings aqui).
   import { type Candidate, type Stage, stageOf } from '../shared';

   /** Candidatos do lote que cairiam na trava de dados mínimos se movidos para `stageDestinoId`. */
   export function candidatosTravadosNoLote(
     candidatos: Candidate[],
     stageDestinoId: string,
     stages: Stage[],
     faltasDe: (c: Candidate) => number,
   ): Candidate[] {
     const destino = stages.find((s) => s.id === stageDestinoId);
     if (!destino) return [];
     return candidatos.filter((c) => {
       if (c.stage_id === stageDestinoId) return false; // já está lá
       const de = stageOf(stages, c.stage_id);
       return de?.native_kind === 'novo' && destino.native_kind !== 'novo' && destino.native_kind !== 'descartado' && faltasDe(c) > 0;
     });
   }

   interface Props {
     selecionados: number;
     visiveis: number;
     todosSelecionados: boolean;
     stages: Stage[];
     onSelecionarTodos: () => void;
     onLimpar: () => void;
     onEnviarParaAgendar?: () => void;
     onMoverFase: (stageId: string) => void;
     onDescartar?: () => void;
   }

   /** Barra de ações em lote — mesmas classes do rodapé de AdicionarCandidatosModal.tsx:71-83. */
   export default function AcoesEmLote({
     selecionados, visiveis, todosSelecionados, stages, onSelecionarTodos, onLimpar, onEnviarParaAgendar, onMoverFase, onDescartar,
   }: Props) {
     if (visiveis === 0) return null;
     return (
       <div className="flex flex-wrap items-center gap-2 mb-3 px-4 py-2.5 rounded-2xl border border-zinc-200 bg-white">
         <button onClick={todosSelecionados ? onLimpar : onSelecionarTodos} className="text-xs font-bold text-zinc-500 hover:text-zinc-800 cursor-pointer">
           {todosSelecionados ? 'Limpar' : `Marcar todos (${visiveis})`}
         </button>
         {selecionados > 0 && <span className="text-xs font-bold text-zinc-600">{selecionados} selecionado{selecionados > 1 ? 's' : ''}</span>}
         <div className="flex-1" />
         <select disabled={!selecionados} defaultValue=""
           onChange={(e) => { if (e.target.value) { onMoverFase(e.target.value); e.target.value = ''; } }}
           className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-700 cursor-pointer disabled:opacity-40">
           <option value="" disabled>Mover para…</option>
           {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
         </select>
         {onEnviarParaAgendar && (
           <button onClick={onEnviarParaAgendar} disabled={!selecionados}
             className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer">
             <i className="ri-robot-2-line" /> Enviar p/ IA agendar
           </button>
         )}
         {onDescartar && (
           <button onClick={onDescartar} disabled={!selecionados}
             className="px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 disabled:opacity-40 cursor-pointer">
             Descartar
           </button>
         )}
       </div>
     );
   }
   ```
   Invariante: `"Marcar todos"`/`"Limpar"` e as 3 classes de botão são as mesmas (literais) de `AdicionarCandidatosModal.tsx:73-82`; `disabled:opacity-40` idem (linha 80); nenhuma cor/ícone fora do que o módulo já usa (`ri-robot-2-line` já usado no chip de T18).

2. **Criar `src/test/lib/contratacaoAcoesEmLote.test.ts`** (AJUSTE DE MAPA — ver acima) com o corpo completo:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { candidatosTravadosNoLote } from '../../pages/contratacao/components/AcoesEmLote';
   import type { Candidate, Stage } from '../../pages/contratacao/shared';

   const stage = (id: string, native_kind: Stage['native_kind']): Stage => ({ id, name: id, color: 'zinc', sort_order: 0, native_kind });
   const stages: Stage[] = [stage('novo', 'novo'), stage('agendar', 'agendar'), stage('entrevista', 'entrevista'), stage('descartado', 'descartado')];

   const cand = (id: string, stage_id: string | null): Candidate => ({
     id, company_id: null, stage_id, full_name: `Candidato ${id}`, email: null, phone: null, city: null, neighborhood: null,
     address: null, marital_status: null, decision: null, lat: null, lng: null, geo_label: null, geo_precision: null,
     birth_date: null, age: null, desired_role: null, summary: null, experiences: [], education: [], skills: [], languages: [],
     courses: [], availability: null, salary_expectation: null, driver_license: null, total_experience_months: null,
     strengths: [], concerns: [], rating: null, notes: null, file_path: null, file_name: null, file_type: null, raw_text: null,
     ai_processed: false, created_at: '2026-09-01T00:00:00Z',
   });

   describe('candidatosTravadosNoLote', () => {
     const faltasDe = (m: Record<string, number>) => (c: Candidate) => m[c.id] ?? 0;

     it('candidato em "novo" indo para "agendar" com ficha incompleta: travado', () => {
       const r = candidatosTravadosNoLote([cand('c1', 'novo')], 'agendar', stages, faltasDe({ c1: 1 }));
       expect(r.map((c) => c.id)).toEqual(['c1']);
     });

     it('candidato em "novo" indo para "agendar" com ficha completa: não travado', () => {
       const r = candidatosTravadosNoLote([cand('c1', 'novo')], 'agendar', stages, faltasDe({ c1: 0 }));
       expect(r).toEqual([]);
     });

     it('indo para "descartado" nunca trava, mesmo com ficha incompleta', () => {
       const r = candidatosTravadosNoLote([cand('c1', 'novo')], 'descartado', stages, faltasDe({ c1: 3 }));
       expect(r).toEqual([]);
     });

     it('candidato que não está em "novo" nunca trava', () => {
       const r = candidatosTravadosNoLote([cand('c1', 'entrevista')], 'agendar', stages, faltasDe({ c1: 5 }));
       expect(r).toEqual([]);
     });

     it('candidato já no destino não conta (nada a mover)', () => {
       const r = candidatosTravadosNoLote([cand('c1', 'agendar')], 'agendar', stages, faltasDe({ c1: 5 }));
       expect(r).toEqual([]);
     });

     it('lote misto: só quem está em "novo" com ficha incompleta é travado', () => {
       const candidatos = [cand('c1', 'novo'), cand('c2', 'novo'), cand('c3', 'entrevista')];
       const r = candidatosTravadosNoLote(candidatos, 'agendar', stages, faltasDe({ c1: 1, c2: 0, c3: 9 }));
       expect(r.map((c) => c.id)).toEqual(['c1']);
     });
   });
   ```

3. Rodar `npx vitest run src/test/lib/contratacaoAcoesEmLote.test.ts` — esperado `Test Files 1 passed (1)` e `Tests 6 passed (6)`, sem falha.

4. **`page.tsx` — criar `moveLote` (ao lado de `updateCandidate`, `page.tsx:317-348`).** Importar `candidatosTravadosNoLote` de `./components/AcoesEmLote`. Corpo completo (mesma forma de `updateCandidate`: otimista + Supabase + `avisar`/`carregar` no erro):
   ```ts
   const moveLote = useCallback(async (ids: string[], stageId: string) => {
     const alvo = items.filter((c) => ids.includes(c.id) && c.stage_id !== stageId);
     if (!alvo.length) return;
     const travados = candidatosTravadosNoLote(alvo, stageId, stages, faltasDe);
     let waiveIds = new Set<string>();
     if (travados.length) {
       const ok = await confirmar({
         titulo: 'Ficha incompleta',
         mensagem: `${travados.length} de ${alvo.length} candidato${alvo.length > 1 ? 's têm' : ' tem'} ficha incompleta: `
           + `${travados.map((c) => c.full_name.split(' ')[0]).join(', ')}. Quer mover mesmo assim?`,
         confirmarLabel: 'Mover mesmo assim',
       });
       if (!ok) return; // Decisão 2: um "não" cancela o lote inteiro, nada é gravado.
       waiveIds = new Set(travados.map((c) => c.id));
     }
     const agora = new Date().toISOString();
     setItems((prev) => prev.map((c) => {
       if (!alvo.some((a) => a.id === c.id)) return c;
       return waiveIds.has(c.id) ? { ...c, stage_id: stageId, required_waived_at: agora } : { ...c, stage_id: stageId };
     }));
     const semTrava = alvo.filter((c) => !waiveIds.has(c.id)).map((c) => c.id);
     const comTrava = alvo.filter((c) => waiveIds.has(c.id)).map((c) => c.id);
     const erros: string[] = [];
     if (semTrava.length) {
       const { error } = await supabase.from('hiring_candidates').update({ stage_id: stageId, updated_at: agora }).in('id', semTrava);
       if (error) erros.push(error.message);
     }
     if (comTrava.length) {
       const { error } = await supabase.from('hiring_candidates')
         .update({ stage_id: stageId, updated_at: agora, required_waived_at: agora }).in('id', comTrava);
       if (error) erros.push(error.message);
     }
     if (erros.length) avisar(`Não foi possível mover ${erros.length === 1 ? '1 grupo' : `${erros.length} grupos`}: ${erros.join('; ')}`);
     carregar();
   }, [items, stages, faltasDe, carregar]);
   ```
   Invariante: `updateCandidate` (caminho de 1 candidato — drag do Kanban, mudança de fase na ficha) **não é tocado nesta task**; `moveLote` é uma função nova, paralela, que não é chamada por nenhum caminho de 1 candidato.

5. **`page.tsx` — repassar `onMoverLote` a `AreaCandidatos`** (mesma linha onde T02/T18/T09 já passam `aderenciaDe`/`faltasDe`/`agendamentoIADe`/`view`). Acrescentar `onMoverLote={moveLote}`.

6. **`areas/AreaCandidatos.tsx` — estado de seleção e integração com `AcoesEmLote`.** Importar `AcoesEmLote` de `'../components/AcoesEmLote'`; `stageByKind` de `'../shared'` (junto de `stageOf`, já importado em T16). Dentro do componente, junto do estado de T16:
   ```ts
   const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
   const toggleSelecao = useCallback((id: string) => setSelecionados((s) => {
     const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
   }), []);

   // Decisão 6: a seleção é podada (não zerada) para a interseção com o que está visível agora,
   // seja porque um filtro mudou, seja porque o modo (Cards/Tabela/Kanban) mudou.
   const visiveis = props.view === 'kanban' ? buscadosParaKanban : filtradosParaLista;
   useEffect(() => {
     setSelecionados((prev) => {
       const idsVisiveis = new Set(visiveis.map((c) => c.id));
       const podado = new Set([...prev].filter((id) => idsVisiveis.has(id)));
       return podado.size === prev.size ? prev : podado;
     });
   }, [visiveis]);

   const agendarStageId = stageByKind(props.stages, 'agendar')?.id ?? null;
   const descartadoStageId = stageByKind(props.stages, 'descartado')?.id ?? null;
   ```
   (`buscadosParaKanban`/`filtradosParaLista` já existem desde T16, Step 4.)

7. **`areas/AreaCandidatos.tsx` — renderizar `AcoesEmLote`** logo acima de `<FiltrosCandidatos .../>` (T16, Step 5), antes do `{props.view === 'kanban' ? ... : ...}`:
   ```tsx
   <AcoesEmLote
     selecionados={selecionados.size}
     visiveis={visiveis.length}
     todosSelecionados={selecionados.size > 0 && selecionados.size === visiveis.length}
     stages={props.stages}
     onSelecionarTodos={() => setSelecionados(new Set(visiveis.map((c) => c.id)))}
     onLimpar={() => setSelecionados(new Set())}
     onEnviarParaAgendar={agendarStageId ? () => props.onMoverLote([...selecionados], agendarStageId) : undefined}
     onMoverFase={(stageId) => props.onMoverLote([...selecionados], stageId)}
     onDescartar={descartadoStageId ? () => props.onMoverLote([...selecionados], descartadoStageId) : undefined}
   />
   ```
   Invariante: a seleção **não** é limpa automaticamente após disparar uma ação (Decisão 2 — se o dono cancelar a pergunta de ficha incompleta, a seleção continua intacta para tentar de novo; se aceitar, a poda do Step 6 remove da seleção quem saiu da fase filtrada, quando houver filtro de fase ativo).

8. **`areas/AreaCandidatos.tsx` — repassar seleção a `Kanban`/`CandidatosLista`.** Acrescentar `selecionados={selecionados} onToggleSelecao={toggleSelecao}` nas duas chamadas (`<Kanban items={buscadosParaKanban} ... selecionados={selecionados} onToggleSelecao={toggleSelecao} />` e `<CandidatosLista view={props.view} items={filtradosParaLista} ... selecionados={selecionados} onToggleSelecao={toggleSelecao} />`).

9. **`components/CandidatosLista.tsx` — Props + visão Cards.** Acrescentar `selecionados: Set<string>; onToggleSelecao: (id: string) => void;` em `Props` (`CandidatosLista.tsx:17-30`). Na visão Cards (`.map`, `CandidatosLista.tsx:37-40`), acrescentar `selecionado={selecionados.has(c.id)} onToggleSelecao={() => onToggleSelecao(c.id)}` na chamada de `CandidateCard`.

10. **`components/CandidatosLista.tsx` — Tabela: coluna de seleção.** No `<thead>` (`CandidatosLista.tsx:84-98`), acrescentar `<th className="px-3 py-2" aria-label="Selecionar" />` como primeira coluna (mesmo padrão da coluna vazia do assistente, linha 97). Em cada `<tr>` do `<tbody>` (`CandidatosLista.tsx:106-158`), acrescentar como primeiro `<td>`:
    ```tsx
    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={selecionados.has(c.id)} onChange={() => onToggleSelecao(c.id)} className="accent-rose-600 w-4 h-4" />
    </td>
    ```
    (mesmo `stopPropagation` já usado na coluna do assistente, `CandidatosLista.tsx:144`, e mesma classe de checkbox de `AdicionarCandidatosModal.tsx:59`). Repassar `selecionados`/`onToggleSelecao` para `<Tabela {...props} />` — já acontece automaticamente porque `Tabela` recebe `{...props}` (`CandidatosLista.tsx:44`) e `Props` ganhou os dois campos no Step 9; só acrescentar `selecionados, onToggleSelecao` à desestruturação de `Tabela` (`CandidatosLista.tsx:47`).

11. **`components/CandidatosLista.tsx` — `CandidateCard`: checkbox fora do `<button>`.** Trocar a assinatura (`CandidatosLista.tsx:167-170`, já modificada por T02/T18) para acrescentar `selecionado = false, onToggleSelecao` (ver **Interfaces**). Envolver o retorno atual (o `<button>...</button>` inteiro, inalterado por dentro) assim:
    ```tsx
    export function CandidateCard({ /* ...props de T02/T18... */, selecionado = false, onToggleSelecao }: { /* ...tipos... */ selecionado?: boolean; onToggleSelecao?: () => void }) {
      const idade = ageOf(c);
      const ultima = c.experiences[0];
      const card = (
        <button onClick={onOpen} className={/* ...classe de hoje, inalterada... */}>
          {/* ...conteúdo de hoje, inalterado (inclui os chips de T02/T18)... */}
        </button>
      );
      if (!onToggleSelecao) return card;
      return (
        <div className="relative">
          <input type="checkbox" checked={selecionado}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelecao()}
            className="absolute top-3 right-3 z-10 accent-rose-600 w-4 h-4" />
          {card}
        </div>
      );
    }
    ```
    Invariante: o `<button>` interno (classes, chips, textos) **não é reescrito** — só passa a ser uma variável `card` retornada com ou sem o wrapper de checkbox; sem `onToggleSelecao` (nenhum caso hoje, já que Cards/Kanban sempre passam), o card continua idêntico ao de antes desta task, sem `<div>` extra. Checkbox fora do `<button>` (irmão dentro do wrapper `relative`) porque `<input>` dentro de `<button>` não é HTML válido.

12. **`components/Kanban.tsx` — Props + chamada do `CandidateCard`.** Acrescentar `selecionados: Set<string>; onToggleSelecao: (id: string) => void;` em `Props` (`Kanban.tsx:8-18`). Na chamada do `CandidateCard` (`Kanban.tsx:52-53`, já modificada por T02/T18), acrescentar `selecionado={selecionados.has(c.id)} onToggleSelecao={() => onToggleSelecao(c.id)}`. Invariante: `draggable`/`onDragStart` do `<div>` pai (`Kanban.tsx:51`) não mudam — clicar no checkbox é um clique simples, não inicia o gesto de arraste HTML5 (que exige `mousedown` + arrastar, não apenas `click`).

13. Rodar o gate completo (Constraint 9):
    - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
    - `npx vitest run` — esperado **o total acumulado até T16 + 6 novos** desta task, 0 failed.
    - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não editado.
    - `npx vite build` — exit 0, sem erro.
    - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Checkbox aparece em cada card (Cards e Kanban) e em cada linha da Tabela; marcar/desmarcar atualiza a barra `AcoesEmLote` (contagem "N selecionados") sem abrir a ficha do candidato (clique não propaga para `onOpen`).
- [ ] "Marcar todos (N)" seleciona todos os candidatos **visíveis no modo atual** (respeitando os filtros de T16); "Limpar" zera a seleção.
- [ ] Trocar de fase (chip), busca, decisão, vaga ou "ficha incompleta", ou trocar de modo (Cards/Tabela/Kanban), **poda** a seleção para quem continua visível — não trava, não reseta candidatos que ainda aparecem.
- [ ] "Enviar p/ IA agendar" move o lote para a fase `native_kind === 'agendar'`; "Descartar" move para `native_kind === 'descartado'` sem perguntar nada (mesma isenção de hoje); o `<select>` "Mover para…" move para qualquer fase escolhida.
- [ ] **Lote com 1 candidato de ficha completa + 1 de ficha incompleta, ambos em "Novo", movidos para uma fase que não é "novo" nem "descartado":** aparece **uma única** pergunta "Ficha incompleta" citando só o nome de quem está incompleto; cancelar não move nenhum dos dois; aceitar move os dois, e só o incompleto grava `required_waived_at` (o completo não ganha o campo).
- [ ] **O caminho de 1 candidato não mudou:** arrastar um card no Kanban continua chamando `updateCandidate` (não `moveLote`) e perguntando individualmente como hoje; mudar a fase pela ficha (`CandidatoDrawer`) idem; "Mover mesmo assim" de 1 candidato grava `required_waived_at` exatamente como antes desta task.
- [ ] `npx vitest run src/test/lib/contratacaoAcoesEmLote.test.ts` → `Tests 6 passed (6)`.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] **`npx vitest run src/test/components/entrevistasDoDia.test.tsx` verde, sem editar o arquivo.**
- [ ] Visual inalterado — reaproveitou classes/componentes existentes (checkbox e rodapé de `AdicionarCandidatosModal.tsx`, chips de T16), não criou novos.
- [ ] Nada desapareceu (Constraint 11): busca, decisão, fase, vaga, ficha incompleta e alternância de view continuam funcionando; a seleção é puramente aditiva.
- [ ] Rastreio: briefing §3.3 item 2 (seleção múltipla, IA agendar, mover de fase, descartar, trava dos dados mínimos) coberto.

### Fica para spec futura

- **Desfazer ("undo") uma ação em lote:** não pedido pelo briefing; o padrão de confirmação única antes de gravar (Decisão 2) já reduz o risco de erro em massa.
- **Seleção entre páginas/paginação:** o módulo não pagina hoje (`limit(2000)` em `page.tsx`); nada a fazer aqui.
- **Atalho de teclado para selecionar em lote (shift-click, ctrl-A):** não pedido pelo briefing; a barra "Marcar todos (N)" já cobre o caso de uso mais comum (agir sobre tudo que está filtrado).

---

## T18: Kanban — chip de estado do agendamento pela IA

> Acrescentada por decisão do orquestrador (2026-09-20) ao risco levantado no Plan da Fase 1: RF-02/US-03 pedem "fase + decisão + estado agendamento IA" no card do Kanban; "fase" e "decisão" já existem hoje, faltava só o estado do agendamento. Cabe na Constraint 8 porque `hiring_scheduling_sessions` **já é lida pelo módulo** hoje, em `AgendamentosPainel.tsx:162-166` — não é tabela nova.

| Campo | Valor |
|---|---|
| **Entregável** | Chip no card do Kanban mostrando o estado da conversa de agendamento pela IA (convite enviado / negociando horário / esperando o entrevistador / entrevista marcada) |
| **Onde** | `src/pages/contratacao/page.tsx` (modificar), `src/pages/contratacao/components/Kanban.tsx` (modificar), `src/pages/contratacao/components/CandidatosLista.tsx` (modificar, só a assinatura do `CandidateCard`) |
| **Depende de** | T02 |
| **Bloqueia** | — |
| **Paralelo com** | — (mexe nos mesmos arquivos de T02) |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-02 (última linha: "Candidatos › Kanban: mesmo + fase + decisão + estado agendamento IA"), US-03, briefing §3.3 |

### Context pack

- Spec: RF-02/US-03 — chip de estado do agendamento IA só no Kanban (briefing §3.3).
- Global Constraints: `#global-constraints` #1 (reaproveitar classes existentes, nenhuma cor nova), #8 ("leitura adicional só de tabela... que já é lida hoje pelo próprio módulo" — `hiring_scheduling_sessions` já é lida em `AgendamentosPainel.tsx:162-166`, então a leitura nova aqui **não** é migration/Edge/coluna/RPC nova), #9 (gate), #5 (não duplicar/mover o tempo real e o canal `contratacao-agendamentos` do `AgendamentosPainel`).
- Padrão do repo: rótulos do estado da conversa de agendamento já existem em `CandidatoDrawer.tsx:584-589` (`SESS_LABEL`, 4 chaves: `convidado`, `negociando`, `aguardando_gestor`, `agendado`) — é o mapa mais próximo semanticamente de "agendamento IA" (o de `AgendamentosPainel.tsx:108-124`, `statusDe()`, é sobre entrega de WhatsApp em geral, painel "Conversas da IA", não sobre o funil de agendamento). Classes de cor por status já existem em `AgendamentosPainel.tsx:116` (violeta, `agendado`/"Agendada"), `:118` (âmbar, `aguardando_gestor`), `:120` (céu, "Respondeu" ⇒ usada aqui para `negociando`), `:123` (azul, "Enviada" ⇒ usada aqui para `convidado`).
- Leitura já existente a imitar: `page.tsx:137-144` (`Promise.all` do `carregar()`, 6 leituras hoje) e `page.tsx:196-201` (canal `contratacao-tempo-real`, 3 tabelas hoje).
- Arquivos vizinhos: `AgendamentosPainel.tsx:162-166` (a leitura de `hiring_scheduling_sessions` já existente, que autoriza esta); `page.tsx:496-509` (`vagasPorCandidato`/`vagasDe`) e os `Map`s de T02 (`aderenciaPorCandidato`, `faltasPorCandidato`) são o padrão de agregação por candidato a repetir aqui.
- **Não fazer:** não usar `select('*')` (a linha de `hiring_scheduling_sessions` tem `history`/`pending_request`, que o chip não usa); não adicionar `hiring_scheduling_sessions` ao canal `contratacao-tempo-real` (`page.tsx:196-201`) — decisão consciente, ver abaixo; não tocar em `AgendamentosPainel.tsx` (canal `contratacao-agendamentos` e o `select('*')` de lá continuam como estão); não mostrar o chip na Lista/Tabela (só Kanban); não inventar rótulo/cor para status fora das 4 chaves de `SESS_LABEL` — sem chip nesse caso (mesmo padrão de "sem chip" já usado para aderência/vaga apagada em T01/T02).

### Decisões tomadas

- **Fonte de dados:** nova leitura de `hiring_scheduling_sessions` dentro do `Promise.all` de `carregar()` (`page.tsx:137-144`), com `select` enxuto — só `candidate_id, job_id, status, updated_at` (nada de `history`/`pending_request`/`phone`, que o chip não usa) — `order('updated_at', { ascending: false }).limit(500)`, mesmo limite já usado para esta tabela em `AgendamentosPainel.tsx:162`.
- **Agregação por candidato:** como a query já vem ordenada por `updated_at` desc, o `Map` guarda só a **primeira** ocorrência de cada `candidate_id` (= a mais recente), no mesmo padrão de `vagasPorCandidato`/`aderenciaPorCandidato`.
- **Rótulo do chip:** duplica (não importa) as 4 chaves/valores de `SESS_LABEL` (`CandidatoDrawer.tsx:584-589`) dentro de `Kanban.tsx`, com comentário citando a origem. Decisão consciente: o "Onde" desta task é só `page.tsx`/`Kanban.tsx`/`CandidatosLista.tsx` (não inclui `CandidatoDrawer.tsx`), então em vez de exportar `SESS_LABEL` de lá (o que exigiria tocar um arquivo fora do escopo desta task) o mesmo texto — já existente no produto, não inventado — é copiado com a linha de origem citada no comentário, para quem for consolidar depois (ex.: numa fase futura) saber que as duas cópias têm que mudar juntas.
- **Status sem chip:** `erro`, `recusou`, `sem_resposta`, `cancelado` (e qualquer status fora das 4 chaves) não têm chip — a conversa de agendamento não está mais ativa; consistente com o padrão "sem candidatura válida → sem chip" de T01/T02, sem inventar rótulo novo.
- **Tempo real:** o chip **não** entra no canal `contratacao-tempo-real` (`page.tsx:196-201`); atualiza só pelo polling de 60s que já existe (`page.tsx:162-169`, mesmo hook `tick`/`setInterval`) e ao recarregar a página. Adicionar `hiring_scheduling_sessions` a esse canal duplicaria a responsabilidade do canal próprio `contratacao-agendamentos` do `AgendamentosPainel.tsx` e é risco de regressão fora do escopo desta task.
- **Escopo do chip:** só aparece em `Kanban.tsx` (`CandidateCard` com `compact`); `CandidatosLista.tsx` só ganha o parâmetro na assinatura do `CandidateCard` (para o TypeScript aceitar o prop opcional vindo de um só lugar), sem renderizar nada na visão Cards/Tabela.

### Interfaces

**Consumes:** nenhuma nova de T01/T02 além dos tipos já existentes (`Candidate`).

**Produces (assinaturas exatas):**
```ts
// page.tsx — novo estado e leitura, ao lado de applications (page.tsx:66) e do Promise.all (page.tsx:137-144)
interface AgendamentoIASessao { candidate_id: string; job_id: string; status: string; updated_at: string }
const [schedSessions, setSchedSessions] = useState<AgendamentoIASessao[]>([]);
const agendamentoIAPorCandidato: Map<string, string>   // candidate_id -> status (só a leitura mais recente)
const agendamentoIADe: (c: Candidate) => string | null

// Kanban.tsx — mapa local (cópia citada de CandidatoDrawer.tsx:584-589) + Props
const AGENDAMENTO_IA: Record<string, { label: string; cls: string }> // 4 chaves: convidado, negociando, aguardando_gestor, agendado
interface Props {
  // ...props existentes + as de T02 (aderenciaDe, faltasDe) inalteradas...
  agendamentoIADe: (c: Candidate) => string | null;
}

// CandidatosLista.tsx — CandidateCard (assinatura, sem uso na Lista/Tabela)
export function CandidateCard({ /* ...props de T02... */, agendamentoIA = null }: {
  /* ...tipos de T02... */
  agendamentoIA?: string | null;
})
```

### Steps

1. **`page.tsx` — novo estado (ao lado de `applications`, `page.tsx:66`).** Acrescentar:
   ```ts
   interface AgendamentoIASessao { candidate_id: string; job_id: string; status: string; updated_at: string }
   const [schedSessions, setSchedSessions] = useState<AgendamentoIASessao[]>([]);
   ```

2. **`page.tsx` — leitura no `Promise.all` de `carregar()` (origem verbatim `page.tsx:137-144`).** Trocar:
   ```ts
   const [cand, ivs, jb, ap, dst, cfgErr] = await Promise.all([
     supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000),
     supabase.from('hiring_interviews').select('*').order('scheduled_at', { ascending: true }).limit(2000),
     supabase.from('hiring_jobs').select('*').order('created_at', { ascending: false }).limit(500),
     supabase.from('hiring_applications').select('*').limit(5000),
     supabase.from('hiring_distances').select('*').limit(20000),
     carregarConfig(),
   ]);
   const err = cand.error ?? ivs.error ?? jb.error ?? ap.error ?? dst.error ?? cfgErr;
   ```
   por (acrescenta a 6ª leitura de dados, `cfgErr` vira o 7º elemento):
   ```ts
   const [cand, ivs, jb, ap, dst, sess, cfgErr] = await Promise.all([
     supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000),
     supabase.from('hiring_interviews').select('*').order('scheduled_at', { ascending: true }).limit(2000),
     supabase.from('hiring_jobs').select('*').order('created_at', { ascending: false }).limit(500),
     supabase.from('hiring_applications').select('*').limit(5000),
     supabase.from('hiring_distances').select('*').limit(20000),
     supabase.from('hiring_scheduling_sessions').select('candidate_id, job_id, status, updated_at').order('updated_at', { ascending: false }).limit(500),
     carregarConfig(),
   ]);
   const err = cand.error ?? ivs.error ?? jb.error ?? ap.error ?? dst.error ?? sess.error ?? cfgErr;
   ```
   E, no bloco `else` que segue (`page.tsx:148-152`), acrescentar `setSchedSessions((sess.data ?? []) as AgendamentoIASessao[]);` junto de `setDistances(...)`.
   Invariante: mesma forma do `Promise.all`/`else` existente — mesmo padrão de `.select()`/`.order()`/`.limit()`, só mais uma linha.

3. **`page.tsx` — NÃO alterar o canal `contratacao-tempo-real` (`page.tsx:196-201`).** Confirmar (não editar) que a assinatura continua só com `hiring_candidates`/`hiring_applications`/`hiring_interviews` — decisão consciente registrada acima. O chip atualiza pelo polling de 60s já existente (`page.tsx:162-169`), que já recarrega `carregar(true)` (e portanto `schedSessions`) a cada minuto.

4. **`page.tsx` — agregação por candidato (ao lado de `vagasPorCandidato`, `page.tsx:496-505`, e dos `Map`s de T02).** Acrescentar:
   ```ts
   const agendamentoIAPorCandidato = useMemo(() => {
     const m = new Map<string, string>();
     for (const s of schedSessions) if (!m.has(s.candidate_id)) m.set(s.candidate_id, s.status);
     return m;
   }, [schedSessions]);
   const agendamentoIADe = useCallback((c: Candidate) => agendamentoIAPorCandidato.get(c.id) ?? null, [agendamentoIAPorCandidato]);
   ```
   (`schedSessions` já vem ordenado por `updated_at` desc da query do Step 2, então a primeira ocorrência de cada `candidate_id` é a mais recente.)

5. **`page.tsx` — repassar `agendamentoIADe` ao `Kanban` (`page.tsx:714`, mesma linha onde T02 acrescentou `aderenciaDe`/`faltasDe`).** Acrescentar `agendamentoIADe={agendamentoIADe}`.

6. **`CandidatosLista.tsx` — mapa de rótulo/cor (cópia citada de `CandidatoDrawer.tsx:584-589`).** Acrescentar perto do topo do arquivo (depois dos imports), **junto de onde o chip é renderizado** (`CandidateCard` e `Chip` moram neste arquivo).

   > **Correção do orquestrador (2026-09-20):** a primeira versão desta task punha `AGENDAMENTO_IA` em `Kanban.tsx` e fazia `CandidatosLista.tsx` importar de `./Kanban`. Isso é **ciclo de import**: `Kanban.tsx:6` já faz `import { CandidateCard } from './CandidatosLista'`. Cycle de ESM entre dois módulos com estado de topo é frágil no Vite/Vitest (ordem de inicialização) e é regressão gratuita. O mapa fica no arquivo que o usa (`CandidatosLista.tsx`, onde vivem `CandidateCard` e `Chip`); `Kanban.tsx` **não** precisa do mapa — só repassa a string de status. Nenhum import novo entre os dois arquivos.

   ```ts
   // Rótulos e cores do estado da conversa de agendamento pela IA. Cópia de SESS_LABEL
   // (CandidatoDrawer.tsx:584-589) e das classes de status de AgendamentosPainel.tsx:116-123
   // (violeta = agendado, âmbar = aguardando_gestor, céu = negociando/"Respondeu",
   // azul = convidado/"Enviada") — se um dos dois mudar o texto/cor, o outro tem que acompanhar.
   const AGENDAMENTO_IA: Record<string, { label: string; cls: string }> = {
     convidado: { label: 'Convite enviado — aguardando resposta', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
     negociando: { label: 'Conversando sobre o horário', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
     aguardando_gestor: { label: 'Esperando o entrevistador aceitar um horário pedido', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
     agendado: { label: 'Entrevista marcada pela IA', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
   };
   ```

7. **`Kanban.tsx` — Props (`Kanban.tsx:8-18`).** Acrescentar `agendamentoIADe: (c: Candidate) => string | null;` (junto das props de T02, `aderenciaDe`/`faltasDe`).

8. **`Kanban.tsx` — chamada do `CandidateCard` (origem verbatim `Kanban.tsx:52-53`, já modificada por T02 no Step 8 daquela task).** Acrescentar mais um atributo:
   ```tsx
   <CandidateCard compact c={c} companies={companies} stage={s} empresa={mostrarEmpresa ? companyName(companies, c.company_id) : null}
     entrevista={proximaEntrevista.get(c.id) ?? null} onOpen={() => onOpen(c.id)}
     aderencia={aderenciaDe(c)} faltas={faltasDe(c)} agendamentoIA={agendamentoIADe(c)} />
   ```
   Invariante: mesmas classes, mesmos ícones `ri-*`, mesmos textos — só mais um atributo.

9. **`CandidatosLista.tsx` — `CandidateCard` (assinatura, `CandidatosLista.tsx:167-170`, já modificada por T02).** Acrescentar o parâmetro `agendamentoIA = null` na desestruturação e `agendamentoIA?: string | null;` no tipo. O chip é renderizado **dentro do `CandidateCard`** (é lá que o card existe), mas só aparece para quem **passa** a prop — e só o `Kanban.tsx` passa (Step 8). A visão Cards de `CandidatosLista` (`CandidatosLista.tsx:34-43`) **não** passa `agendamentoIA`, então o chip não aparece na Lista; a Tabela não usa `CandidateCard`. É o mesmo mecanismo que o `dist`, que hoje o Kanban não passa (`Kanban.tsx:52-53`) e a Lista passa (`CandidatosLista.tsx:39`). Dentro do corpo de `CandidateCard`, no bloco de chips (mesmo lugar do Step 6 de T02), acrescentar:
   ```tsx
   {agendamentoIA && AGENDAMENTO_IA[agendamentoIA] && (
     <Chip cls={AGENDAMENTO_IA[agendamentoIA].cls}>
       <i className="ri-robot-2-line" /> {AGENDAMENTO_IA[agendamentoIA].label}
     </Chip>
   )}
   ```
   `AGENDAMENTO_IA` está declarado **neste mesmo arquivo** (Step 6) — **nenhum import novo**, e em particular **nada de `import … from './Kanban'`**, que fecharia ciclo com `Kanban.tsx:6`. Invariante: mover/inserir sem reescrever — mesmo padrão de chip condicional das outras (`aderencia`/`faltas`, Step 6 de T02), mesmo componente `Chip` (`CandidatosLista.tsx:215-217`), ícone `ri-*` do mesmo conjunto Remix já em uso.

10. Rodar o gate completo (Constraint 9):
    - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
    - `npx vitest run` — esperado **507 ou mais** (os 500 de hoje + os 7 de T01), 0 failed; esta task não cria teste.
    - `npx vite build` — exit 0, sem erro.
    - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] Card do Kanban mostra o chip de estado do agendamento IA quando `agendamentoIADe(c)` é uma das 4 chaves de `AGENDAMENTO_IA`; sem chip para `erro`/`recusou`/`sem_resposta`/`cancelado`/`null`.
- [ ] Lista/Tabela não mostram o chip — a visão Cards de `CandidatosLista` não passa `agendamentoIA` (mesmo mecanismo do `dist`, que o Kanban não passa hoje).
- [ ] **Nenhum import novo entre `CandidatosLista.tsx` e `Kanban.tsx`.** `AGENDAMENTO_IA` mora em `CandidatosLista.tsx`; `Kanban.tsx` continua só importando `CandidateCard` (`Kanban.tsx:6`). Conferir com `grep -n "from './Kanban'" src/pages/contratacao/components/CandidatosLista.tsx` — esperado **nenhuma linha**.
- [ ] `hiring_scheduling_sessions` é lida com `select('candidate_id, job_id, status, updated_at')` (não `select('*')`) e `limit(500)`, dentro do `Promise.all` de `carregar()`.
- [ ] Canal `contratacao-tempo-real` (`page.tsx:196-201`) **não** ganhou `hiring_scheduling_sessions` — confirmado por leitura do arquivo após a task, não só por não ter editado a linha.
- [ ] A aba Agendamentos/Conversas da IA continua funcionando igual: o canal `contratacao-agendamentos` e o `select('*')` do `AgendamentosPainel.tsx` não foram alterados.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher; `npx vite build` limpo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes (`Chip`, classes de cor citadas de `AgendamentosPainel.tsx`, texto citado de `CandidatoDrawer.tsx`), não criou novos.
- [ ] Nada desapareceu (Constraint 11): nenhuma leitura, chip ou canal existente foi removido; só foi acrescentado.
- [ ] Rastreio: RF-02 (linha "estado agendamento IA"), US-03, briefing §3.3 cobertos.

---

## T19: Atalho "Ir para a próxima" no dia vazio de Entrevistas › Do dia

> Acrescentada por decisão do orquestrador (2026-09-20), fechando o BLOQUEIO de escopo levantado no Plan da Fase 5 (T13, Decisão 7): sem este atalho o RF-05 (última linha) ficaria descoberto e o `/sdd-07-spec-review` reprovaria a spec. **Ajuste de mapa já aplicado** pelo orquestrador na seção `## Mapa de arquivos`: `EntrevistasDoDia.tsx` deixou de ser "nenhuma" e passou a "modificar (só em T19)" — não altere o Mapa de novo, ele já reflete esta task.

| Campo | Valor |
|---|---|
| **Entregável** | Atalho "Ir para a próxima: seg 21/09 · 7 entrevistas" no estado de dia vazio de `EntrevistasDoDia.tsx` (sub-aba "Do dia") |
| **Onde** | `src/pages/contratacao/components/EntrevistasDoDia.tsx` (modificar) |
| **Depende de** | T13 (`proximoDiaComEntrevistas`/`formatarDiaCurto`, já especificadas e testadas em `hoje.ts`), T09 (o componente já vive dentro da sub-aba "Do dia" de `AreaEntrevistas`) |
| **Bloqueia** | — |
| **Paralelo com** | — |
| **Profundidade** | `contracts` |
| **Requisitos** | RF-05 (última linha) |

### Context pack

- Spec: RF-05 última linha verbatim (`#c-spec-filtrada`) — "Em dia vazio: atalho 'Ir para a próxima: seg 21/09 · 7 entrevistas'." Critérios de sucesso: nenhuma regressão em `focoEntrevista` (protegido por `entrevistasDoDia.test.tsx`).
- Global Constraints: `#global-constraints` #1 (nenhuma classe/cor/ícone novo — o botão reaproveita a mesma família do botão "Hoje" já existente no cabeçalho de dia, `EntrevistasDoDia.tsx:136`), #5/#10 (`entrevistasDoDia.test.tsx` é o gate de regressão do `focoEntrevista` — não pode ser editado, tem que continuar verde), #9 (gate), #11 (acréscimo puro: nenhuma prop sai, nenhum bloco desaparece).
- **Leitura obrigatória antes de escrever o Step** (mandado pelo pedido): o comentário de cabeçalho de `src/test/components/entrevistasDoDia.test.tsx:1-4` — "Bug de 2026-09-16: o botão caía só na aba — a regra 'trocou o dia → abre a 1ª do dia' rodava na mesma passada do link e sobrescrevia a escolha" — e o efeito que causou o bug, hoje em `EntrevistasDoDia.tsx:98-124` (`focoAplicado` + o efeito de deep link, linhas 98-107; o efeito "trocou o dia", linhas 110-124, verbatim):
  ```tsx
  const focoAplicado = useRef<string | null>(null);
  useEffect(() => {
    if (!focoId) return;
    const iv = interviews.find((x) => x.id === focoId);
    if (!iv) return;
    focoAplicado.current = iv.id;
    setDia(dayKey(new Date(iv.scheduled_at)));
    setSelId(iv.id);
    onFocoUsado?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focoId, interviews]);

  // Trocou o dia: abre a 1ª entrevista ainda não registrada (ou a 1ª do dia) — no computador.
  useEffect(() => {
    if (focoAplicado.current) {
      if (doDia.some((iv) => iv.id === focoAplicado.current)) focoAplicado.current = null;
      return;
    }
    if (!doDia.length) return;
    if (doDia.some((iv) => iv.id === selId)) return;
    const prox = doDia.find((iv) => iv.status === 'agendada') ?? doDia[0];
    setSelId(window.matchMedia('(min-width: 1024px)').matches ? prox?.id ?? null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, doDia.length]);
  ```
  O bug de 2026-09-16 era a corrida entre os dois efeitos quando `focoId` chegava **antes** das entrevistas carregarem: o 2º efeito rodava com `focoAplicado.current` ainda vazio e roubava a seleção. **O atalho desta task não usa `focoId`/`focoAplicado` em nenhum momento** — ele só chama `setDia(novoDia)`, exatamente como os botões de navegação de dia que já existem hoje e nunca dispararam esse bug (`EntrevistasDoDia.tsx:133,135`, "Dia anterior"/"Próximo dia", e `:136`, o botão "Hoje" — todos `onClick={() => setDia(...)}`, sem tocar `selId`/`focoAplicado`). Ao trocar de dia por esse caminho, o 2º efeito acima roda normalmente (`focoAplicado.current` é `null` porque nunca foi setado) e abre a 1ª entrevista do novo dia — **esse já é o comportamento desejado do atalho**, não um efeito colateral a evitar.
- Estado de dia vazio (verbatim, `EntrevistasDoDia.tsx:162-163`, conferido no arquivo real — nenhuma fase anterior toca este trecho, "nenhuma" valia até esta task):
  ```tsx
  {doDia.length === 0 ? (
    <p className="p-6 text-center text-sm text-zinc-400">Ninguém agendado neste dia.</p>
  ) : (
  ```
- Padrão do repo a reaproveitar: botão "Hoje" do cabeçalho de dia (`EntrevistasDoDia.tsx:136`, verbatim): `<button onClick={() => setDia(hoje)} className="px-3 h-9 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">Hoje</button>` — mesma família de classes usada no atalho novo.
- Arquivos vizinhos: `hoje.ts` (T13 — `proximoDiaComEntrevistas`, `formatarDiaCurto`); o componente já recebe `interviews: Interview[]` como prop (`EntrevistasDoDia.tsx:15`) — é a mesma lista usada para montar `porDia`/`doDia`, não precisa de prop nova.
- **Não fazer:** não mudar a assinatura de `Props` (nenhuma prop novo, nenhuma removida); não tocar `focoId`/`focoAplicado`/o efeito de deep link (`:98-107`); não editar `src/test/components/entrevistasDoDia.test.tsx`; não recalcular "próxima com N entrevistas" dentro do componente (a função já existe e está testada em `hoje.ts`, T13) — só chamar; não adicionar o atalho fora do estado de dia vazio (RF-05 é explícito: "em dia vazio").

### Decisões tomadas

- **Fonte do cálculo:** `proximoDiaComEntrevistas(interviews, new Date())` (T13), chamada dentro de um `useMemo` com dependência em `interviews` (a lista já muda de referência quando o shell recarrega, mesmo padrão de `porDia`, `EntrevistasDoDia.tsx:56-63`) — recalculada a cada render do dia vazio, sem `setInterval` próprio (o componente já recarrega via prop quando o shell atualiza; não é um dado "ao vivo" que precise de polling dedicado, ao contrário do selo de presença).
- **Clique:** `onClick={() => setDia(atalho.diaKey)}` — mesma forma dos botões de navegação de dia já existentes (`setDia(addDias(...))`, `setDia(hoje)`), nunca toca `selId`/`focoAplicado`. Isso é o que evita reabrir o bug de 2026-09-16 (ver Context pack): o bug nascia da interação entre o efeito de **deep link** (`focoId`) e o efeito de "trocou o dia"; o atalho não participa do deep link, só troca `dia` como qualquer navegação manual — o efeito de "trocou o dia" then abre a 1ª entrevista do novo dia normalmente, que é exatamente o comportamento pedido pela spec ("Ir para a próxima" deveria mesmo abrir a próxima).
- **Texto:** `Ir para a próxima: ${formatarDiaCurto(atalho.diaKey)} · ${atalho.quantidade} entrevista${atalho.quantidade === 1 ? '' : 's'}` — mesmo formato do exemplo da spec ("seg 21/09 · 7 entrevistas"; a spec escreve só "7", sem a palavra "entrevistas" depois do número no exemplo, mas o RF-08 já usa "entrevistas" por extenso no hint do Kpi de T14 — manter consistência entre as duas telas que citam a mesma frase).

### Interfaces

**Consumes** (de T13):
```ts
import { formatarDiaCurto, proximoDiaComEntrevistas } from '../hoje';
```
(`../hoje` porque `EntrevistasDoDia.tsx` está em `components/`, um nível abaixo de `contratacao/`, mesmo padrão de `import ... from '../shared'` já usado no arquivo.)

**Produces:** nenhuma — `Props` de `EntrevistasDoDia` não muda (Constraint desta task).

### Steps

1. **Rodar `npx vitest run src/test/components/entrevistasDoDia.test.tsx` ANTES de editar** — linha de base, esperado `Test Files 1 passed (1)` / `Tests 3 passed (3)` (os 3 `it()` do arquivo hoje), 0 failed.

2. **`EntrevistasDoDia.tsx` — importar `hoje.ts` e calcular o atalho.** Acrescentar ao bloco de imports (junto de `import { avisar, confirmar } from '../dialog';`, topo do arquivo):
   ```ts
   import { formatarDiaCurto, proximoDiaComEntrevistas } from '../hoje';
   ```
   E, logo após a definição de `doDia` (`const doDia = porDia.get(dia) ?? [];`, `EntrevistasDoDia.tsx:66` do arquivo real — conferir a linha exata, nenhuma fase anterior move este trecho), acrescentar:
   ```ts
   // RF-05 (última linha): em dia vazio, atalho para o próximo dia com entrevista. Mesma função de
   // hoje.ts (T13) usada no hint dos 3 números da tela Hoje — cálculo só num lugar, chamado nos dois.
   const atalhoProxima = useMemo(() => (doDia.length === 0 ? proximoDiaComEntrevistas(interviews, new Date()) : null), [doDia.length, interviews]);
   ```
   Invariante: mesmo padrão de `useMemo` já usado no arquivo (`porDia`, `:57-64`) — só mais um, derivado de dados que o componente já tem.

3. **`EntrevistasDoDia.tsx` — o botão, no estado de dia vazio (origem verbatim `EntrevistasDoDia.tsx:162-163`, conferida no arquivo real).** Trocar:
   ```tsx
   {doDia.length === 0 ? (
     <p className="p-6 text-center text-sm text-zinc-400">Ninguém agendado neste dia.</p>
   ) : (
   ```
   por:
   ```tsx
   {doDia.length === 0 ? (
     <div className="p-6 text-center">
       <p className="text-sm text-zinc-400">Ninguém agendado neste dia.</p>
       {atalhoProxima && (
         <button onClick={() => setDia(atalhoProxima.diaKey)}
           className="mt-3 px-3 h-9 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">
           Ir para a próxima: {formatarDiaCurto(atalhoProxima.diaKey)} · {atalhoProxima.quantidade} entrevista{atalhoProxima.quantidade === 1 ? '' : 's'}
         </button>
       )}
     </div>
   ) : (
   ```
   Invariante: mover o JSX sem reescrever — mesmas classes, mesmos ícones `ri-*` (nenhum novo, este botão não usa ícone, igual ao botão "Hoje" que também não usa), mesmos textos (o texto "Ninguém agendado neste dia." não muda; só ganha um botão condicional abaixo, com a classe do botão "Hoje" já citada no Context pack). Sem `atalhoProxima` (nenhum dia futuro com entrevista), o `<div>` mostra só o texto de sempre — comportamento idêntico ao de hoje.

4. **Rodar `npx vitest run src/test/components/entrevistasDoDia.test.tsx` DEPOIS de editar** — esperado o mesmo `Test Files 1 passed (1)` / `Tests 3 passed (3)`, 0 failed, **sem editar o arquivo de teste**. Se algum dos 3 `it()` falhar, a causa mais provável é o `useMemo`/import novo ter mudado a ordem de hooks ou disparado uma renderização extra — revisar o Step 2 antes de mexer no teste (proibido).

5. Conferência manual (Constraint 3 — sem TDD em UI, verificação visual manual):
   - Abrir um dia sem nenhuma entrevista (ex.: um fim de semana distante) → o atalho aparece com o texto "Ir para a próxima: [dia] · N entrevista(s)".
   - Clicar no atalho → a tela vai para o dia certo, e a 1ª entrevista daquele dia já aparece aberta no painel da direita (computador) — mesmo comportamento de clicar em "Próximo dia" várias vezes até achar um dia com gente.
   - Abrir um dia **com** entrevista → o atalho **não** aparece (só o texto "Ninguém agendado" nunca aparece nesse caso, e o `<div>` do atalho não é renderizado).
   - Testar `focoEntrevista` normalmente (abrir a tela via link "Abrir entrevista de Fulana") → continua abrindo a entrevista certa, sem interferência do atalho (ele só existe no ramo `doDia.length === 0`, que não é o ramo ativo quando há uma entrevista focada).

6. Rodar o gate completo (Constraint 9):
   - `npx tsc --noEmit --project tsconfig.app.json | grep -c "error TS"` — esperado **287 ou menos**.
   - `npx vitest run` — esperado o total acumulado desde T15 + 0 novos (esta task não cria teste — o atalho é acréscimo de UI sobre lógica já testada em T13), 0 failed.
   - `npx vitest run src/test/components/entrevistasDoDia.test.tsx` — verde, arquivo não editado (Steps 1 e 4).
   - `npx vite build` — exit 0, sem erro.
   - `node scripts/check.mjs --force` — exit 0 (verde).

### DoD

- [ ] `npx vitest run src/test/components/entrevistasDoDia.test.tsx` rodado **antes** da edição (linha de base) e **depois** (Steps 1 e 4) — os dois com `Tests 3 passed (3)`, 0 failed, arquivo de teste **não editado**.
- [ ] Conferência manual: dia vazio mostra o atalho; clicar leva ao dia certo com a 1ª entrevista aberta; dia com entrevista **não** mostra o atalho.
- [ ] `focoEntrevista` (deep link "Abrir entrevista de Fulana") continua funcionando sem regressão — é exatamente o que `entrevistasDoDia.test.tsx` protege, e ele passou nos dois Steps 1/4.
- [ ] Nenhuma prop de `EntrevistasDoDia` mudou (Constraint desta task) — conferir a interface `Props` (`EntrevistasDoDia.tsx:15-28`) idêntica à de antes.
- [ ] Gate da Constraint 9 verde: `node scripts/check.mjs --force` exit 0; `tsc` ≤ 287; `npx vitest run` sem falha e sem encolher (referência 50 arquivos/500 testes + os acumulados de T13-T15, sem teste novo nesta task); `npx vite build` limpo.
- [ ] Visual inalterado — reaproveitou classes/componentes existentes, não criou novos.
- [ ] Nada desapareceu (Constraint 11): acréscimo puro — o texto "Ninguém agendado neste dia." continua existindo tal e qual; o atalho é só um elemento a mais, condicional.
- [ ] Rastreio: RF-05 (última linha) coberto — fecha o BLOQUEIO registrado em T13.

---

## Pontos para o `/sdd-05-review` — decisões tomadas sem o dono

> O dono estava **ausente** em 2026-09-20 e o pedido foi explícito para não perguntar nada e decidir pela árvore de decisão da skill. Estas são as escolhas que mudam o que ele vai **ver na tela** ou que ampliam o escopo — cada uma é derrubável sem refazer o plano. Nenhuma delas é "aprovada"; todas são do orquestrador.

| # | Decisão | O que acontece se o dono discordar |
|---|---------|-------------------------------------|
| 1 | **O default da navegação passa de Entrevistas para Hoje** (RF-01, última linha da tabela de compatibilidade). Quem abre o módulo cai em Hoje, não na lista de entrevistas do dia. | Trocar 1 valor em `navegacao.ts` (T07) e o Step de default em T15. Custo: minutos. |
| 2 | **Entre T09 e T14 a barra mostra 4 áreas + engrenagem, não 5.** A área Hoje só entra na barra quando a tela existe (T14), para não haver aba que abre vazia. Ou seja, o critério de aceite "5 abas" (US-01) só fica completo no fim da Fase 5. | Aceitar o estado intermediário (é o plano) ou exigir que Hoje e a barra entrem juntas, o que obrigaria a mover a Fase 5 para antes da Fase 3 — contra a ordem de ondas do briefing §4. |
| 3 | **Intervalo sem a tela de Links WhatsApp: T09 tira a aba, T12 devolve a função em Configurações › WhatsApp.** Entre as duas, os canais do WhatsApp ficam inacessíveis pela interface (o arquivo continua no código, sem ser chamado). Como as 6 fases sobem juntas no fechamento da spec, o dono nunca vê esse intervalo em produção — **mas se alguma fase for para `main` sozinha, ele veria**. | Se o dono quiser poder subir fase por fase: acrescentar a T09 um Step que mantenha `LinksWhatsApp` acessível como 5ª seção provisória de Configurações (reusando o componente inteiro, sem UI nova), que T12 depois substitui pelo `ConfigWhatsApp` com escopo. Custo: 1 Step. |
| 4 | **T18 acrescentada à Fase 1** (chip de estado do agendamento da IA no Kanban) **com uma leitura extra de `hiring_scheduling_sessions` no shell.** É tabela que o módulo já lê, mas é uma 6ª query no carregamento da tela. | Cortar T18. O briefing §3.3 pede o chip, mas nada mais depende dele. |
| 5 | **T19 acrescentada à Fase 5** e `EntrevistasDoDia.tsx` deixou de ser intocável, para o atalho "Ir para a próxima" do RF-05 existir. O arquivo é protegido pelo único teste automatizado do módulo. | Cortar T19 e aceitar que a última linha do RF-05 fica para depois (aí o `/sdd-07-spec-review` tem que registrar a lacuna em vez de reprovar). |
| 6 | **`AgendamentosPainel.tsx` exporta `DecidirPedido` e o tipo `Sess`** para a tela Hoje ter Aceitar/Recusar sem reimplementar a chamada a `hiring-scheduler › decide`. | Alternativa: o item de "Precisa de você" só **leva** o usuário ao painel de Conversas da IA, em vez de decidir na hora. Contraria o RF-08 item 1 como está escrito, mas é menos invasivo. |
| 7 | **A Fase 6 (filtros e ações em lote) foi planejada, não cortada.** A `spec.md` §2 diz que ela é "adicional, se der tempo". Nenhuma task anterior depende dela, então pode ser descartada inteira sem tocar no resto. | Descartar T16/T17. Zero impacto nas outras fases (conferido: nenhuma `Depende de` aponta para elas). |
| 8 | **O texto da confirmação de "excluir vaga" muda** (briefing §3.4 pede avisar que apaga o agendamento em cascata e solta o link do WhatsApp). É a única mudança de texto visível ao usuário em toda a spec que não é reorganização. | Manter o texto atual e não avisar. |
| 9 | **Blocos "Vagas" e "Minhas anotações" ficam na aba Resumo da ficha** (decisão da fase 03, reafirmada aqui). | Mover para outra aba: muda 1 Step de T05. |
| 10 | **Um canal de WhatsApp que tem vaga E está marcado como padrão aparece nos dois lugares** (dentro da vaga e em Configurações). Tratado como correto, não bug: `is_default` é configuração global. | Escolher um dos dois lugares: muda o filtro de escopo em T11 Decisão 2. |
| 13 | **O briefing §3.8(b) fica FORA do escopo desta spec, por decisão do orquestrador.** O pedido é: *"Agendamentos/Conversas da IA: esqueleto de carga em vez de contadores zerados"* (o problema do briefing §2 item 10 — a aba mostra contadores em zero e "Carregando…" durante a busca). **Por que fica fora:** (a) o `spec.md` RF-05 congelou o componente — "Conversas IA: `AgendamentosPainel` (sem mudança)"; (b) um esqueleto de carga é **elemento visual novo** (blocos cinza pulsando, que não existem em nenhum lugar do módulo hoje), e a Regra nº 1 proíbe criar visual novo; (c) não é problema de **organização**, que é o escopo desta spec — é polimento de carregamento. Nenhuma outra parte do plano depende disso. Gap entre briefing e spec que só apareceu no gate `cross`: é escolha, não esquecimento. | Se o dono quiser dentro desta spec: é uma task pequena e isolada em `AgendamentosPainel.tsx`, mas exige exceção explícita dele à Regra nº 1, porque é visual novo. Caminho melhor: spec própria de polimento, junto dos outros lugares do sistema com o mesmo problema. |
| 12 | **O edge case "Celular sem JavaScript (fallback) → abas desktop visíveis" (`spec.md` §2) não tem task em nenhuma fase.** Motivo: o ERPOS é uma SPA React + Vite sem SSR — sem JavaScript não aparece **nada**, nem hoje nem depois, então não há o que preservar nem o que implementar. O edge case está descrito na spec com uma premissa que o projeto não tem. | Se o dono quiser fallback sem JS de verdade, isso é uma spec própria (SSR/pré-render), não caberia aqui. |
| 11 | **`scripts/baseline.json` está obsoleto e o plano não o conserta.** Ele diz 211 testes; a suíte tem 500. Por isso o gate de cada task manda **medir** `npx vitest run` antes e depois, em vez de confiar no baseline. Atualizar o baseline é decisão do dono (`--update-baseline` é proibido ao agente) e ficou registrado como tarefa separada, fora desta spec. | Nada a mudar nesta spec; é só ciência do dono. |

---

## Rastreabilidade RF/US → task

| RF / US | Task(s) |
|---------|---------|
| RF-01 (5 áreas + engrenagem, compatibilidade) · US-01, US-07 | T07, T08, T09 |
| RF-02 (cards com nota e vaga) · US-03 | T01, T02, T18 (estado do agendamento da IA no Kanban) |
| RF-03 ("Adicionar currículos" centralizado) · US-05 | T03, T11 |
| RF-04 (ficha em 5 abas) · US-04 | T04, T05, T06 |
| RF-05 (Entrevistas com sub-abas) · US-06 | T09; última linha do RF (atalho "Ir para a próxima" no dia vazio) = T13 (a função, com teste) + T19 (o atalho na tela) |
| RF-06 (vaga por dentro, fim da aba Links) | T11, T12 |
| RF-07 (Configurações na engrenagem) | T10, T12 |
| RF-08 (tela Hoje) | T13, T14 |
| US-02 (celular, barra inferior) | T15 |
| Briefing §3.3 / §4 onda 6 (filtros em etiquetas, ações em lote) | T16, T17 |
| Briefing §3.8(a) — filtro de empresa só com mais de uma empresa | T09 (Decisão 8 + Step 4 + DoD) |
| Briefing §3.8(b) — esqueleto de carga em Conversas da IA | **fora do escopo desta spec**, item 13 de "Pontos para o `/sdd-05-review`" (RF-05 congela `AgendamentosPainel` e esqueleto é visual novo) |
| Briefing §3.8(c) — Relatórios sem mudança | `RelatoriosContratacao.tsx` = `nenhuma` no Mapa de arquivos |
| `spec.md` §2 edge case "celular sem JavaScript" | **não aplicável** (SPA sem SSR), item 12 de "Pontos para o `/sdd-05-review`" |
