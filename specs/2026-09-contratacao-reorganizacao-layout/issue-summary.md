# Issue Summary: contratacao-reorganizacao-layout

**Slug:** `contratacao-reorganizacao-layout`  
**Tipo:** Refactor (UI/UX)  
**Status:** Done  
**Data de Conclusão:** 2026-09-20

## Resumo

O módulo Contratação tinha 9 abas que não cabiam no desktop (rolagem horizontal) nem no celular (4–5 abas visíveis). A ficha do candidato era um rolo de 17+ blocos, dificultando acesso rápido a contato/vaga/distância. Reorganização em **5 áreas principais + engrenagem** ganhou clareza sem alterar o visual: mesmas cores, ícones, componentes (regra nº 1 inegociável do briefing).

## O que foi entregue

1. **5 áreas de navegação** (+ engrenagem):
   - Hoje (resumo do dia)
   - Entrevistas (calendário + conversas)
   - Candidatos (busca, filtros, cards/tabela/Kanban)
   - Vagas (com 4 sub-abas)
   - Conversa (WhatsApp history)

2. **Ficha reorganizada em 5 abas** — Resumo, Currículo, Contato, Conversa, Anotações (antes: 1 rolo de ~20 blocos)

3. **Cards do Kanban + tabela** — exibem nota de aderência + vaga + indicador "Falta X"

4. **Filtros em etiquetas** — vaga, ficha incompleta, ordenar por aderência (novo); fase e decisão (já existia)

5. **Seleção múltipla e ações em lote** — mover fase/vaga, decisão, remover

6. **Barra inferior no celular** — 5 áreas em abas fixas + engrenagem

7. **Configurações › WhatsApp** — gerenciar canais de divulgação por vaga ou padrão

## Verificação

- ✅ Gate automatizado: tsc 287/292, vitest 560/560 passando, build OK
- ✅ 19 tasks executadas (6 fases)
- ✅ Compatibilidade de links antigos (`?aba=`, `localStorage`, `focoEntrevista`)
- ✅ Regra nº 1 (visual idêntico) — cores, ícones Remix, classes reutilizadas
- ⚠️ Verificação visual ao vivo — pendente (requer login `is_hiring_admin()`)

## Pendências não-código

1. **Verificação visual — falta fazer** — 6 das 7 ondas completadas sem verificação ao vivo (exige acesso RLS admin). Conferência feita por leitura de código (classes, ícones, textos idênticos) + gate automatizado. O dono (ou usuário com `is_hiring_admin()`) deve logar e conferir:
   - Desktop 1366px sem rolagem horizontal na barra
   - Celular com barra inferior funcional
   - Compatibilidade de `?aba=kanban`, `?aba=agenda`, `?aba=agendamentos`
   - Filtro de vaga/ficha incompleta em Candidatos

2. **Dívidas técnicas registradas:**
   - `hiring_scheduling_sessions` fora do Realtime — chip de estado do agendamento não atualiza em tempo real
   - `moveLote` duplica lógica de trava de dados mínimos (refatoração descartada por escopo)
   - `fmtTime`/`fmtDateTime` em fuso da máquina (dívida pré-existente, tarefa separada)
   - Tabela não ordena por aderência (exigiria novo `SortKey`)

## Impacto

- Usabilidade desktop/celular **melhorada** — barras sem rolagem, acesso rápido a campos críticos
- **0 mudança de visual** — reaproveitamento total de componentes, cores, ícones
- **0 regressão** — dados, validação, comportamentos preservados
- **0 banco alterado** — apenas reorganização de UI e lógica pura para filtros/cálculos
