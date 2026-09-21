# MR: Contratação — reorganização de layout (5 áreas + engrenagem)

## O que muda para quem usa

**Navegação:** As 9 abas do módulo Contratação (Entrevistas, Candidatos, Vagas, Kanban, Agenda, Agendamentos, Relatórios, Links, Configurações) se reorganizam em **5 áreas principais + engrenagem** (ícone de configuração):

1. **Hoje** — resumo do dia (contagem de entrevistas, "Precisa de você", atalhos)
2. **Entrevistas** — calendário, conversas e lista de entrevistas agendadas
3. **Candidatos** — busca, filtros por vaga/fase/ficha incompleta, visualização em cards/tabela/Kanban
4. **Vagas** — gestão de vagas com 4 sub-abas (Dados da vaga, Candidatos, Links WhatsApp, Anotações)
5. **Conversa** — histórico de mensagens de WhatsApp com candidatos

**Engrenagem** (configurações):
- WhatsApp — gerenciar canais de divulgação por vaga ou padrão
- Futuro: outras opções de configuração do módulo

**Ficha do candidato** — reorganizada em 5 abas em vez de rolo único de 17+ blocos:
1. **Resumo** — dados mínimos, vagas inscritas, agendamento pela IA, entrevistas
2. **Currículo** — texto bruto, experiência, formação, habilidades, resumo
3. **Contato** — telefone, e-mail, localização, distância até a loja
4. **Conversa** — histórico de mensagens de WhatsApp
5. **Anotações** — notas internas do gestor

**Cards de candidatos e Kanban** — exibem agora:
- Nota de aderência (score do currículo matching com a vaga)
- Título da vaga
- "Falta X dado" (indicador de ficha incompleta)
- Chip de estado do agendamento pela IA (quando aplicável)

**Barra inferior no celular** — as 5 áreas ficam em abas fixas na base da tela, com ícones Remix; engrenagem sempre acessível.

**Filtros em etiquetas** — acima da lista de candidatos:
- Fase (já existia)
- Vaga (novo)
- Decisão (já existia)
- "Ficha incompleta" (novo)
- "Ordenar por aderência" (novo)

**Seleção múltipla e ações em lote** — caixa de seleção em cada card, linha da tabela e card do Kanban; barra com "Selecionar todos"/"Limpar", "Mover para…" (fase), "Enviar p/ IA agendar" e "Descartar". Descartar em lote pede confirmação própria, dizendo quantos candidatos vão para "Descartado". Se parte da seleção estiver travada por dados mínimos, aparece **uma** confirmação nomeando os incompletos: cancelar não move ninguém; aceitar move todos e grava `required_waived_at` só nos travados. A seleção é podada para o que está visível a cada troca de modo, fase, busca ou filtro — não é possível agir em lote sobre quem está fora da vista.

## O que NÃO muda (regra nº 1)

- **Visual:** Cores (rose/violet/emerald/amber/zinc), tipografia, espaçamento, ícones Remix — **tudo idêntico**
- **Componentes:** Reaproveitados conforme já existem (sem redesenho)
- **Comportamento funcional:** Dados reais, trava de dados mínimos, rascunho local, histórico de eventos, time real — tudo preservado
- **Compatibilidade de links:** `?aba=kanban`, `?aba=agenda`, `?focoEntrevista=X`, `localStorage contratacao_aba` — funcionam como antes

## Como validar

1. **Desktop (1366px+)** — abrir o módulo Contratação e conferir:
   - 5 áreas + engrenagem visíveis (sem rolagem horizontal)
   - Cards/tabela/Kanban em Candidatos mostram aderência + vaga
   - Ficha do candidato abre com 5 abas no topo
   - Vaga abre com 4 sub-abas
   - Engrenagem › WhatsApp mostra canais por vaga/padrão

2. **Celular** — barra com 5 áreas fixas na base, engrenagem acessível; toque em "Hoje" mostra resumo do dia

3. **Compatibilidade de links:**
   - `?aba=kanban` → Candidatos/Kanban
   - `?aba=agenda` → Entrevistas/Calendário
   - `?aba=agendamentos` → Entrevistas/Conversas
   - `localStorage contratacao_aba` atualizado na troca de área

4. **Filtros** — em Candidatos › Tabela/Cards:
   - Clicar em "Vaga" mostra etiquetas com títulos de vagas (ID exato, evita duplicação)
   - "Ficha incompleta" filtra candidatos com dados faltando
   - "Ordenar por aderência" reordena por nota do matching currículo×vaga

5. **Dados reais** — TBA Ipanema (candidatos em processo seletivo):
   - Navegar e consultar dados (read-only, sem escrita)
   - Verificar 0 quebra de layout, 0 carregamento lento

## Critérios de aceite (do briefing)

- [x] 5 áreas + engrenagem — navegação sem rolagem horizontal no desktop
- [x] "Adicionar currículos" — modal único compartilhado (não em todas as abas)
- [x] Faixa de upload (drop zone) — só em Candidatos/Kanban
- [x] Card e Kanban com aderência + vaga
- [x] Ficha em 5 abas (Resumo, Currículo, Contato, Conversa, Anotações)
- [x] Compatibilidade de links antigos (`?aba=`, `localStorage`)
- [x] Gate de qualidade (tsc, vitest, build)
- [ ] ⚠️ **Verificação visual ao vivo** — não realizada (requer login `is_hiring_admin()`)

## Dívidas conhecidas

1. **Filtro de vaga não muda em tempo real** — `hiring_scheduling_sessions` está fora do canal Realtime; a aba "Estado do agendamento" do chip do Kanban não atualiza sozinha. Requer mudança de banco (fora do escopo desta spec).

2. **`moveLote` duplica lógica de trava** — a função `updateCandidate` já valida dados mínimos; `moveLote` reimplementa essa trava. Refatoração rejeitada por escopo (exigiria abrir múltiplas tasks).

3. **`fmtTime` / `fmtDateTime` no fuso da máquina** — dívida pré-existente, separada em tarefa própria (não é regressão desta spec). Afeta horas de entrevista em telas que usam Brasília (tipo `EntrevistasDoDia.tsx`).

4. **Tabela de candidatos não ordena por aderência** — a etiqueta "Ordenar por aderência" afeta cards e Kanban, mas a Tabela mantém seu próprio controle (`SortKey`). Adicionar `aderencia` como coluna de sort exigiria expandir `CandidatosLista.tsx`, fora do escopo.

## Gate de qualidade

- **TypeScript:** `tsc 287/292 erros` (baseline 292; sem regressão)
- **Testes:** `vitest 560/560 passando, 0 falhando`
- **Build:** `npx vite build` — OK

---

**Gerado por:** `/sdd-08-docs` (fase 08 do fluxo SDD)  
**Data:** 2026-09-20  
**Status:** Pronto para merge em `main` + deploy Vercel
