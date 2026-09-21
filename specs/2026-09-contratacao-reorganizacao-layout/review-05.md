# `/sdd-05-review` — Revisão adversarial do plano (Contratação: reorganização de layout)

> Revisor: subagente Sonnet 5, dono ausente. Não aprova nem reprova — devolve achados para o orquestrador decidir. Só leitura de código (conferido contra `src/pages/contratacao/*` real: `page.tsx` 797 linhas, `CandidatoDrawer.tsx` 709, `CandidatosLista.tsx` 217, `Kanban.tsx` 79, `AgendamentosPainel.tsx` 345, `EntrevistasDoDia.tsx` 472 — todos batem com o que `spec.md`/`tasks.md` afirmam).

## 1. Alinhamento briefing → spec → tasks

Todo item do briefing §3/§6 tem task ou justificativa explícita de exclusão (tabela "Rastreabilidade RF/US → task", fim de `tasks.md`). §3.8(a) (filtro de empresa `>1`) só ganhou task depois do gate `cross` pegar o furo — hoje está em T09. §3.8(b) (esqueleto de carga) e o edge case "sem JS" ficam fora do escopo, com motivo escrito (itens 13 e 12 da tabela de decisões). T18 e T19 foram acrescentadas pelo próprio Plan para fechar RF-02/RF-05 que ficariam descobertas — não é inflação, é correção de gap real. **Não achei item do briefing sem task, nem task sem lastro no briefing/spec.**

## 2. Regra nº 1 — visual inalterado

Não encontrei classe/cor/ícone novo decorativo. Dois pontos genuinamente novos, ambos **funcionais** (pedidos explícitos do briefing, não estética):
- **Checkboxes de seleção (T17)** — elemento visual que não existe hoje, mas é a UI mínima para "seleção múltipla" que o briefing §3.3 pede; reaproveita classe de `AdicionarCandidatosModal.tsx`.
- **Barra inferior no celular (T15)** — não existe hoje em Contratação; a task copia a *estrutura* de `src/pages/tarefas/components/MobileNav.tsx` mas troca paleta/ícones para rose/zinc/Remix, exatamente para não importar o design system de Tarefas. É a solução mais disciplinada possível para um requisito (RF-01/US-02) que por definição não tem precedente visual dentro do próprio módulo.
- O texto do label "Config" (abreviação de "Configurações") é a única alteração de texto de navegação; irrelevante.
- Confirma-se corretamente **rejeitado** o esqueleto de carga (§3.8b) por ser "visual novo" — mesmo padrão de rigor aplicado de forma consistente.

Nenhuma violação encontrada.

## 3. Perda de função

Mapa bloco→aba (RF-04, 20 itens) e o mapa aba→destino (RF-01) cobrem tudo que o research (`spec.md` §1) levantou. `LinksWhatsApp.tsx` tem checklist item-a-item no DoD de T12 (13 itens) provando que nada da aba antiga fica sem endereço novo. Não achei bloco/funcionalidade órfã.

## 4. Regressão do que entrou esta semana

Todos os 8 itens do briefing §5 têm dono explícito: rascunho local e `contratacao_entrevistas_pos` (não tocados, ficam dentro de `EntrevistasDoDia`/T19 sem mudar o efeito); tempo real (`contratacao-tempo-real`) e polling de 60s (T18 decide explicitamente **não** adicionar `hiring_scheduling_sessions` a esse canal, para não duplicar responsabilidade com `contratacao-agendamentos`); trava `required_waived_at` (replicada operando-a-operando em T17); histórico por gatilhos (não tocado); WhatsApp≠telefone (T06 decide explicitamente); `focoEntrevista` e selo de presença (protegidos por `entrevistasDoDia.test.tsx`, que **13 tasks diferentes** mandam rodar antes/depois sem editar). `entrevistasDoDia.test.tsx` é mantido verde sem edição em todo o plano — correto.

## 5. T08 (maior risco declarado)

Mitigação real, não só formal: Steps 1-2-3 rodam `tsc` isolado a cada área extraída (não um `tsc` só no fim), e o DoD lista as 9 abas nomeadamente para conferência visual manual — é o único jeito de pegar prop com valor trocado, já que `noUnusedLocals:false` não ajuda. Ponto fraco real: essa conferência é manual e depende de o executor realmente comparar tela a tela; o plano não propõe nenhum auxílio automatizado (ex.: prints antes/depois) além do checklist textual. Risco residual aceitável, mas é o item onde uma falha silenciosa tem mais chance de escapar do gate.

## 6. Ordem e estado intermediário

Grafo bate com as fases do briefing §4. Não achei dependência invertida ou faltando. Estados intermediários adicionais aos dois já avisados no pedido (item 3 do §13, links WhatsApp; barra com 4 áreas):
- **T09→T14 (Fase 3 a 5):** com T09 sozinha em produção, `?aba=` inválido/ausente cai em "entrevistas" (correção temporária), não em "hoje" — só reverte em T15. Documentado (Decisão 3 de T09, Decisão 8 de T15), consistente.
- **T04 muda o cache de `wa_log`** de "por id de sessão" (não requery ao reabrir) para "por montagem" (requery toda vez que a linha abre/fecha em `AgendamentosPainel`) — mais chamadas de rede que hoje. É decisão consciente e documentada, mas não é pedida pelo briefing; sinalizo como mudança de comportamento não-visual não coberta pelos critérios de aceite.

## 7. Pontos para o dono (13 itens da lista) — concordância

Concordo com 11/13 como reversíveis e bem justificados (#1 default Hoje, #4/#5 T18/T19, #6 export de `DecidirPedido`, #7 Fase 6 opcional, #9 blocos na aba Resumo, #10 canal nos dois lugares, #11 baseline obsoleto, #12 edge case sem-JS não aplicável, #13 esqueleto fora de escopo).

**Duas contrariam ou tensionam o briefing e merecem ida ao dono, não só ciência:**
- **#2 (barra com 4 áreas entre T09 e T14):** o critério de aceite "5 áreas" (spec.md, US-01) fica formalmente não-cumprido por 3 fases inteiras. É inevitável dentro da ordem de ondas do briefing, mas é uma **divergência do critério de aceite escrito**, não só um detalhe de execução — vale confirmação explícita de que o dono aceita essa leitura do próprio critério que ele mesmo formulou.
- **#3 (intervalo sem Links WhatsApp):** o próprio plano avisa "se alguma fase for para main sozinha, o dono veria [o intervalo]". Como o fechamento padrão deste projeto é commit+push por fase verificada (`AGENTS.md`), e não necessariamente as 6 fases de uma vez, esse risco é mais real do que o texto sugere — vale confirmar com o dono se as fases sobem juntas ou uma a uma antes de aceitar o plano como está.

## 8. Viabilidade zero-context (T09 onda 3, T12 onda 4)

Ambas seriam executáveis por um subagente sem contexto prévio: citam origem verbatim, avisam explicitamente que os números de linha do As Is deslizaram e mandam localizar por conteúdo, trazem Interfaces com assinatura exata e Steps com trechos de código completos (não resumidos). Únicas lacunas: (a) T09 pressupõe que o executor já sabe o que é `mostrarEmpresa`/`ivsDaEmpresa` (vem de `page.tsx`, não explicado na task, mas citado como "props já existentes" — exige abrir o arquivo real para confirmar o nome); (b) T12 depende de T11 ter criado `abrirCandidatoDoBot`/`EscopoWhatsApp`, que só existem no corpo de T11, não repetidos aqui — um executor que pule T11 sem ler não encontra a função. Nos dois casos a saída (ir ler o arquivo/task vizinha) está indicada, então não é um bloqueio, é uma dependência de leitura adicional esperada pelo próprio `plan_depth: contracts`.

---

## Veredicto recomendado

**Críticos (impedem começar):** nenhum encontrado.

**Importantes (corrigir no caminho, não bloqueiam o início):**
- Confirmar com o dono os itens #2 e #3 da lista de 13 antes de fechar a Fase 3/4, especialmente se as fases puderem subir para `main` uma a uma (ver AGENTS.md "Fechamento padrão").
- T04: deixar registrado que o cache de `wa_log` muda de padrão (mais chamadas de rede) — não é regressão funcional, mas é mudança de comportamento não pedida pelo briefing.

**Menores:**
- Tabela de "Pontos para o `/sdd-05-review`" tem os itens fora de ordem numérica no fim (11, 13, 12) — só cosmético no documento.
- T08: nenhum auxílio além de checklist textual para a conferência visual das 9 abas; aceitável, mas é o ponto de maior confiança-na-execução do plano inteiro.

**Recomendação:** plano aprovável para começar a execução (Fases 1 e 2 em paralelo). Não há Crítico bloqueante. Itens que exigem o dono antes de fechar Fases 3-4: **#2 e #3** da lista de 13 decisões do orquestrador.
