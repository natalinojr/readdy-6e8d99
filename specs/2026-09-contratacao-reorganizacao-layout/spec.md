---
issue: N/A
tipo: refactor
titulo: Contratação: reorganização de layout (5 áreas + engrenagem)
branch: claude/contratacao-reorganizacao-layout (base origin/main; criada depois que o working tree compartilhado ficou limpo)
tdd: false
tdd_integracao: fora
feature_flag: nao
status: done
criado: 2026-09-20
autor: @orquestrador-sdd
---

# Spec: Contratação: reorganização de layout (5 áreas + engrenagem)

## Metadados

| Campo | Valor |
|-------|-------|
| Issue | N/A — sem issue tracker (pedido do dono em 2026-09-20) |
| Tipo | refactor |
| Branch | N/A — working tree compartilhado; sem branch própria (decisão do orquestrador) |
| TDD | `false` (teste só em lógica pura nova) |
| Feature flag | `nao` (reorganização de layout; flag duplicaria telas) |
| Pasta | `specs/2026-09-contratacao-reorganizacao-layout/` |
| Status | planned → `/sdd-05-review` |

---

## Por quê?

**Problema:** Módulo Contratação tem 9 abas que não cabem no desktop (barra horizontal de rolagem, engrenagem cortada) nem no celular (4–5 abas visivelmente). Abas redundantes (Entrevistas, Agenda, Agendamentos = mesmos dados em 3 modos). Informações esparsas na tela (nota de aderência só na ficha; "Adicionar currículos" em toda parte). Ficha do candidato com 17 blocos numa única rolagem dificulta acesso rápido a contato/distância.

**Objetivo:** Reorganizar o módulo em **5 áreas principais + configurações** (engrenagem), reaproveitar componentes/visual existente, ganhar clareza sem alterar design system.

**Impacto:** Melhor usabilidade no desktop e celular; acesso mais rápido a informações críticas (contato, nota, vaga); operação reduzida para o dono e equipe.

---

## 1. As Is (Research)

### Contexto

- **Módulo:** Contratação (hiring) — filtro, seleção, agendamento de entrevistas e gestão de candidatos.
- **Usuários:** Dono, gestores de contratação (vagas/candidatos).
- **Estado atual:** Tela monolítica com 9 abas em `src/pages/contratacao/page.tsx` (~800 linhas) + 10+ componentes em `components/`.
- **Referência:** `src/pages/contratacao/page.tsx`, componentes em `src/pages/contratacao/components/` (ver briefing).

### Comportamento atual (conferido em 2026-09-20, com evidência caminho:linha)

**1. Estado de aba (`page.tsx`)**
- `type Aba = 'entrevistas' | 'candidatos' | 'vagas' | 'kanban' | 'agenda' | 'agendamentos' | 'relatorios' | 'links' | 'config'` — `page.tsx:37`. `ABAS` (label + ícone Remix) em `page.tsx:43-53`.
- Estado inicial lido de `localStorage contratacao_aba` (`lsGet`, `page.tsx:40-41,78`); default `'entrevistas'` se valor inválido/ausente.
- `view` (cards/tabela da lista) também persiste em `localStorage contratacao_view` (`page.tsx:79`) e `contratacao_empresa` para o filtro de empresa (`page.tsx:83`).
- `?aba=`, `?entrevista=`, `?candidato=` lidos uma vez em `useEffect` (`page.tsx:95-109`): seta `aba` se valor bate com `ABAS`, seta `focoEntrevista` (limpando filtro de empresa) e `selId` (exceto quando `aba === 'agendamentos'`, onde abrir a ficha esconderia o pedido). O parâmetro é consumido (`setSearchParams({}, {replace:true})`, linha 108) — recarregar a página não reabre o mesmo lugar.
- `focoEntrevista` é passado para `EntrevistasDoDia` como `focoId`/`onFocoUsado` (`page.tsx:617`) e consumido em `EntrevistasDoDia.tsx:95+` para ir ao dia certo e abrir o registro.
- Botão **"Adicionar currículos"**: condição é `aba !== 'config'` (`page.tsx:548`), **não** exclui `links`/`kanban`/`agenda`/etc. — aparece em Entrevistas, Candidatos, Vagas, Kanban, Agenda, Agendamentos, Relatórios e Links WhatsApp. Filtro de empresa some em `config` e `links` (`page.tsx:540`, condição `aba !== 'config' && aba !== 'links'`).
- Faixa tracejada "Arraste PDFs…" (`queue`/dropzone) fica no bloco `else` do grande `if/else if` de abas (`page.tsx:626-664`), ou seja, aparece sempre que a aba não é `config|vagas|links|entrevistas|agenda|agendamentos|relatorios` — na prática só quando `aba === 'candidatos'` ou `aba === 'kanban'` (as duas únicas que caem no `else`). Isso confirma o briefing: dropzone fixa em **Candidatos e Kanban**.

**2. `CandidatosLista.tsx` — modos de visualização**
- Dois modos: `Tabela` (linhas de tabela, `CandidatosLista.tsx:47+`) e `CandidateCard` (cards, mesmo arquivo `:167-213`), alternados pelo botão em `page.tsx:701-710` (`view === 'cards' | 'tabela'`), só visível na aba `candidatos` (`aba === 'candidatos'`, `page.tsx:701`).
- **Tabela já mostra nota e vaga:** coluna `Th k="vaga"` (`:87`) via `vagasDe(c)` e coluna `Th k="nota"` (`:94`) via `avgScore(ultimaAvaliacao.get(c.id)?.scores)` — **isso é a média das notas dadas na(s) entrevista(s)**, não `hiring_applications.score` (ver achado da pergunta 4 abaixo).
- **`CandidateCard` (cards, usado em Candidatos e — em modo `compact` — no Kanban) NÃO mostra nota nem vaga**: campos renderizados são nome, `DecisionBadge`, estrelas (`c.rating`), cargo/idade/bairro-cidade, empresa (chip), distância (chip), próxima entrevista (chip), experiência/pontos de atenção (só quando `!compact`) — `CandidatosLista.tsx:174-210`. Nenhuma referência a `score`/`avgScore`/`vagasDe` dentro de `CandidateCard`.
- Filtros existentes: busca por texto (`busca`, `page.tsx:691-693`), fase (`faseFiltro`, chips em `page.tsx:719-727`), decisão (`decisaoFiltro`, select em `page.tsx:695-700`), empresa (`empresaFiltro`, select no cabeçalho). Não há filtro por vaga nem por "ficha incompleta" hoje.
- **Seleção múltipla: não existe.** Não há checkbox, `Set<string>` de selecionados nem ações em lote em `CandidatosLista.tsx` ou `Kanban.tsx` — confirma que é trabalho novo da onda 6.

**3. `Kanban.tsx`**
- Cada coluna é uma fase (`stages`), card é `CandidateCard` em modo `compact` (`Kanban.tsx:52`) — logo mostra só o que o card compacto mostra: nome, estrelas, decisão, cargo/idade/bairro-cidade, empresa, distância, próxima entrevista. **Sem nota, vaga, nem estado do agendamento da IA** (briefing pede isso na onda 1).
- Fase vem de `stages` (prop) comparando `c.stage_id` contra `stageIds`; sem fase válida cai na fase `native_kind === 'novo'` (`Kanban.tsx:20-23`).
- A faixa de upload **não está dentro de `Kanban.tsx`** — está no shell (`page.tsx:626-664`), que é renderizado sempre que a aba cai no `else` (candidatos/kanban), acima do próprio `<Kanban>` (`page.tsx:713-716`). Ou seja, "tirar a faixa do Kanban" é mudar a condição em `page.tsx`, não em `Kanban.tsx`.

**4. Nota de aderência e vaga do candidato — fonte de dados**
- **Dois números diferentes chamados de "nota" existem hoje** — achado importante, diverge da leitura do briefing:
  - `Application.score` (`shared.ts:138`, comentário "aderência calculada pela IA") é o **match currículo×vaga**, gravado em `hiring_applications` (Edge `hiring-cv-scan`, ação `match` — `shared.ts:498`). Só é exibido hoje **dentro da ficha**, em `CandidatoDrawer.tsx:198` (`a.score`) e `fitOf(a.score)` (chip Alta/Média/Baixa, `shared.ts:150`).
  - `avgScore(scores)` (`shared.ts:282-283`) é a **média das notas de 1-5 dadas na entrevista** (`Interview.scores`, questionário de avaliação), usada na coluna "Nota" da Tabela (`CandidatosLista.tsx:62,94,104`) e dentro da ficha em `RegistroEntrevista`/`CandidatoDrawer.tsx:227,239`.
  - **Não existe hoje nenhum lugar que já carregue `hiring_applications.score` junto da lista de candidatos** — a tabela usa `avgScore` (entrevista), não `score` (aderência à vaga). Para os cards/Kanban mostrarem "nota de aderência + vaga" como pedido no briefing (§3.3), é preciso decidir **qual das duas notas** exibir; se for a aderência (`hiring_applications.score`), a leitura já existe no fetch de `applications` que o `page.tsx` já faz (`page.tsx:151`, `supabase.from('hiring_applications')...`) e é passada para `CandidatosLista`/`Kanban` bastaria repassar `applications` (hoje só `CandidatoDrawer` recebe). **Não é preciso Edge Function nem migration nova** — é leitura que já acontece em `page.tsx`, só falta propagar como prop.
  - `vagasDe(c)` (prop de `CandidatosLista`, `CandidatosLista.tsx:28`) já resolve o título das vagas a partir de `applications`/`jobs` — reaproveitável para os cards.

**5. `CandidatoDrawer.tsx` — blocos na ordem atual (linhas de abertura de cada bloco)**
1. Fase / estrelas / empresa — `:114-132`
2. Dados mínimos (aviso + formulário `DadosMinimosForm`, ou link "editar") — `:134-151`
3. Tomada de decisão (GPC/PC/R/NA) — `:153-166`
4. Banner "Leitura simples / Organizar com IA" (condicional a `!c.ai_processed`) — `:168-181`
5. `<Section title="Vagas">` (aplicações + score/fit + inscrever em vaga) — `:184-215`
6. `<AgendamentoIA>` (agendamento pela IA, condicional) — `:218-219` (componente definido em `:590+`)
7. `<Section title="Entrevistas">` (lista + `RegistroEntrevista` + botão Agendar) — `:222-254`
8. `<HistoricoCandidato>` (linha do tempo `hiring_candidate_events` + anotação) — `:257-259` (componente em `:509+`)
9. `<Section title="Contato">` — `:262-288`
10. `<Section title="Distância até a loja">` — `:290-321`
11. `<Section title="Resumo">` (condicional a `c.summary`) — `:323`
12. Grid "Pontos fortes" / "Pontos de atenção" (condicional) — `:325-340`
13. `<Section title="Experiência">` (condicional a `c.ai_processed`) — `:342-359`
14. `<Section title="Formação">` (condicional) — `:361-372`
15. `<Section title="Outros cursos">` (condicional) — `:374-378`
16. `<Section title="Habilidades e idiomas">` (condicional) — `:380-388`
17. `<Section title="Outras informações">` (condicional) — `:390-402`
18. `<Section title="Texto do currículo">` (condicional a `c.raw_text`, toggle mostrar/esconder) — `:404-413`
19. `<Section title="Minhas anotações">` (textarea) — `:415-420`
20. Rodapé fixo: "Ver currículo original" (condicional) + **"Excluir" sempre visível** — `:423-432`

Isso bate com o "~17 blocos" do briefing (os itens 4, 12 e 20 são condicionais/compostos, não `<Section>` isoladas, então a contagem varia um pouco conforme o critério, mas a ordem e o conteúdo batem). **Confirma:** Contato (`:262`) e Distância (`:290`) só aparecem depois de rolar 9 blocos anteriores; Excluir é sempre visível no rodapé (`:429-431`), sem menu "⋯".

**6. `wa_log` e `AgendamentosPainel.tsx`**
- `wa_log` é buscado sob demanda ao abrir uma sessão (`aberto`): `supabase.from('wa_log').select('id, direction, origin, kind, text, at').eq('phone_key', phoneKey(s.phone)).order('at').order('id').limit(500)` — `AgendamentosPainel.tsx:156`. Comentário na linha 149-150: é a conversa **completa** do número (link de candidatura + agendamento + o que a IA ignora — reação, figurinha), reaproveitável tal como está para a aba "Conversa" da ficha (só falta o `phone`/`phone_key` do candidato selecionado, que hoje vem de `s.phone` da sessão de agendamento, não diretamente do `Candidate`).
- Renderização das bolhas de mensagem não estava nas linhas lidas (150-240); está mais abaixo no arquivo (renderização de `logs[s.id]` dentro do item expandido) — group render fica dentro do component tree após linha 240, aproveitar o componente/JSX de bolha diretamente citando o arquivo é seguro mas o corte exato de linha da bolha deve ser conferido de novo na fase Plan/Execute antes de extrair.
- Dados carregados: `hiring_scheduling_sessions` (+ join `hiring_interviews`), `hiring_job_scheduling`, `hiring_applications` (`:162-166`); realtime no canal `contratacao-agendamentos` para `hiring_scheduling_sessions`/`hiring_interviews` (`:179-182`) + polling de reserva a cada 30s (`:175`).

**7. `Vagas.tsx`, `VagaModal.tsx`, `AgendamentoVaga.tsx`, `LinksWhatsApp.tsx`**
- `VagaModal.tsx` importa e renderiza `AgendamentoVaga` dentro do próprio modal de edição de vaga (`VagaModal.tsx:4,103`) — confirma briefing: agendamento pela IA está "dentro do Editar vaga" hoje.
- `LinksWhatsApp.tsx` é uma aba própria, independente de `Vagas`/`VagaModal`: lê/escreve direto em `bot_channels` (`LinksWhatsApp.tsx:84,122-142`), gera link `wa.me` com texto pronto (`waLink`, `:55`).
- **`bot_channels` sem vaga:** campo `job_id: null` é valor válido no formulário (`LinksWhatsApp.tsx:257`, estado inicial do formulário com `job_id: null`) — ou seja, a tela já lida com canal "banco de currículos" sem vaga associada.
- **`is_default`:** campo boolean (`LinksWhatsApp.tsx:24`), com toggle "Link padrão: atender também quem escrever no número SEM código" (`:359`) e badge "Padrão" na listagem (`:195`). Ao marcar `is_default`, desmarca qualquer outro canal default antes de salvar (`:122`, update em lote). Hoje só aparece dentro da própria aba Links WhatsApp — não há hoje nenhuma tela "Configurações › WhatsApp" (é criação nova da onda 4, não mover algo existente).
- Apagar vaga (`deleteJob`, `page.tsx:415-426`): deleta `hiring_jobs` e depois filtra `applications` localmente (`:426`); não há código no front que solte o `job_id` de `bot_channels` — isso é comportamento de **banco** (FK com `ON DELETE SET NULL`, citado no briefing como já existente); o research não encontrou a constraint no front (é responsabilidade de migration já aplicada, fora do escopo de leitura desta spec verificar SQL, mas o comportamento observado no dado é consistente com o briefing).

**8. `EntrevistasDoDia.tsx`, `AgendaEntrevistas.tsx`**
- Rascunho local: chaves `contratacao_entrevistas_pos` (`LS_POS`, `EntrevistasDoDia.tsx:37`) guarda `{dia, sel, at}` e volta à mesma posição se saiu há menos de 12h (`:50-55`); `contratacao_rascunho_entrevista_${id}` (`lsDraftKey`, `:38`) guarda rascunho do registro por entrevista (helpers `lsLer`/`lsGravar`/`lsApagar`, `:39-41`).
- Presença confirmada: estado `presenca` carregado de `hiring_scheduling_sessions` (`confirmed_at`, `confirm_requested_at`) para as entrevistas do dia aberto, atualizado a cada 60s enquanto a aba está visível (`setInterval` + `document.hidden`, `:74-92`). Selo "Confirmou" (verde, `ri-checkbox-circle-fill`) vs "Aguardando" (`ri-time-line`) — `:181-187`.
- Canal de tempo real **não está em `EntrevistasDoDia.tsx`** nem em `AgendaEntrevistas.tsx` — o canal `contratacao-tempo-real` vive no shell (`page.tsx:196-202`), assina `hiring_candidates`, `hiring_applications`, `hiring_interviews` e atualiza os estados globais (`items`/`applications`/`interviews`) que descem como props para todas as abas. Comentário de proteção contra linha incompleta do Realtime em `page.tsx:185-191` (evento "vazio" do RLS não substitui a linha, recarrega em silêncio).
- Atualização por minuto (dados do assistente que mexem por fora da tela) também é do shell: `setInterval(tick, 60_000)` + `visibilitychange`/`focus` (`page.tsx:162-169`), não de `EntrevistasDoDia`. Ou seja: mover essas abas para sub-abas de "Entrevistas" não exige duplicar polling/realtime — eles já são globais e continuam funcionando desde que os componentes continuem recebendo as mesmas props.

**9. `ConfiguracoesContratacao.tsx` — 4 cards confirmados**
- `Empresas` (`:43-158`, `<Card titulo="Empresas / lojas">` em `:103`)
- `Fases` (`:163-229`, `<Card titulo="Fases do kanban">` em `:204`)
- `DadosMinimos` (`:257-346`, `<Card titulo="Dados mínimos da ficha">` em `:304`)
- `FichaEConvite` (`:351-481`, `<Card titulo="Entrevistas">` em `:403` — perguntas do questionário, critérios de avaliação e padrões de agendamento)
- Todos usam o mesmo componente `Card` (`:625-633`) empilhados na mesma página — bate com "4 cards, um por vez" do To Be (§3.7), só precisa de navegação lateral por cima, sem recriar os cards.

**10. Trava de dados mínimos (`required_waived_at`) e `faltasFicha`**
- `faltasFicha(c, ficha)` mora em `shared.ts:318` (lógica pura, calcula quais campos obrigatórios estão faltando).
- Usada em `CandidatoDrawer.tsx:89` (aviso + formulário), `ConfiguracoesContratacao.tsx:271` (contagem de incompletos na fase Novo), `page.tsx:324` (antes de mover de fase).
- `required_waived_at` é setado em três lugares ao confirmar "mover mesmo assim": `page.tsx:332` (mudança de fase pelo shell), `EntrevistaModal.tsx:128` e `EntrevistasDoDia.tsx:301` (ao salvar registro de entrevista com decisão que move de fase). Campo documentado em `shared.ts:210` como "mover mesmo assim com ficha incompleta".

**11. `BotaoAvisos` ("Bloqueadas")**
- Importado de `@/components/feature/BotaoAvisos` (fora da pasta `contratacao/`, componente compartilhado — `page.tsx:12`), renderizado no cabeçalho sempre, com `tenantId={user?.tenantId}` e título "Receber no celular os avisos de entrevista (agendada, confirmada, cancelada…)" (`page.tsx:539`). Não há lógica própria de "Bloqueadas" dentro de `contratacao/`; o texto/estado do botão vêm inteiramente do componente compartilhado `BotaoAvisos` — para entender o rótulo "Bloqueadas" citado no briefing é preciso olhar dentro de `src/components/feature/BotaoAvisos.tsx` (fora do escopo desta spec, mas é o arquivo certo a checar na fase Plan se o item 8 do problema for endereçado via mudança de texto/posição, já que aqui ele só decide **onde** o botão aparece, não o que ele mostra).

**12. Testes existentes**
- **Busca em `src/test/**` por `contrat`/`hiring` (case-insensitive) não encontrou nenhum arquivo de teste.** Não há suíte hoje cobrindo este módulo — logo não há regressão de teste a proteger na reorganização, apenas os testes novos de lógica pura previstos no briefing (mapa de compatibilidade de `aba`, melhor nota, "Precisa de você").

**13. Padrões visuais a preservar (para reaproveitar, não recriar)**
- Cards de lista: `rounded-2xl border border-zinc-200 bg-white hover:border-rose-300 hover:shadow-sm` — `CandidatosLista.tsx:174`.
- Etiquetas de fase/cor: `colorOf(stage.color)` (`shared.ts`, usado em `CandidatosLista.tsx:196`, `Kanban.tsx:29,41,44`) — função central de mapeamento cor→classes Tailwind, não recriar variantes novas.
- Chips secundários: componente `Chip` local (`CandidatosLista.tsx:215-217`), classes `text-[10px] font-semibold px-2 py-0.5 rounded-full border`.
- Abas do cabeçalho: `border-b-2` com `border-rose-600 text-rose-700` ativo vs `border-transparent text-zinc-500` inativo — `page.tsx:564-571`. Reaproveitar este exato padrão para as 5 áreas novas (e para sub-abas dentro de Vagas/Entrevistas).
- Modal/drawer: `dialog.tsx` (`DialogHost`, `confirmar`, `avisar`) é o padrão para confirmações e alertas (`page.tsx:21`, usado em `EntrevistaModal.tsx`, `LinksWhatsApp.tsx`, etc.); o drawer lateral do candidato é `fixed inset-y-0 right-0 ... w-full max-w-xl bg-white shadow-2xl` (`CandidatoDrawer.tsx:97`) — manter esse mesmo shell ao adicionar abas internas.
- Botões primários: `bg-rose-600 hover:bg-rose-500 text-white ... rounded-xl` (upload, `page.tsx:550`); botões secundários por contexto usam violet (`Agendar entrevista`, `CandidatoDrawer.tsx:251`), emerald (dados mínimos completos, `:148`), amber (avisos, `page.tsx:578`), sky (organizar com IA, `:174`) — cores por função, não por tela; preservar a mesma associação cor↔ação ao mover blocos.
- Ícones: só Remix (`ri-*`), nenhuma outra biblioteca em uso no módulo.

### Divergências entre o briefing e o código (achados desta fase)

1. **Nota exibida na Tabela hoje já existe** (`avgScore` de entrevista, não `hiring_applications.score`) — o briefing (§3.3) fala em "melhor `hiring_applications.score`" para os cards; são conceitos diferentes e a spec/plan (fase 03/04) precisa decidir explicitamente qual nota mostrar nos cards (aderência à vaga vs. nota de entrevista), ou mostrar as duas com rótulos distintos, para não confundir o dono.
2. **Onda 1 não precisa de leitura nova no banco.** `hiring_applications` já é carregado no `page.tsx` (`:151`) para uso em `CandidatoDrawer`/`Vagas`; basta repassar `applications` (e `vagasDe`) como prop para `CandidatosLista`/`Kanban`. Nenhuma Edge Function ou migration nova é necessária para "nota + vaga no card" — contrariando uma leitura possível do briefing de que seria preciso "leitura nova estritamente necessária" (§5).
3. **Nenhum teste existente cobre o módulo** — o item 12 do research (checar `src/test/**`) não achou nada; não há risco de quebrar suíte existente, só a obrigação de criar os testes de lógica pura já previstos.
4. **A faixa de upload não é código duplicado dentro de `Kanban.tsx`/`CandidatosLista.tsx`** — é uma única renderização no shell (`page.tsx:626-664`) condicionada a cair no `else` do roteamento de abas; "tirar do Kanban" é mudar essa condição no `page.tsx`, não editar `Kanban.tsx`.
5. **`BotaoAvisos` é componente compartilhado fora da pasta `contratacao/`** (`src/components/feature/BotaoAvisos.tsx`) — qualquer mudança de rótulo/contexto do botão "Bloqueadas" citado no briefing (item 8) pode exigir tocar um arquivo fora do escopo direto de `src/pages/contratacao/`; a fase Plan deve decidir se o wrap muda só a posição/contexto (dentro do escopo) ou também o componente compartilhado (fora).

### Lacunas do research

- [ ] Confirmar no `src/components/feature/BotaoAvisos.tsx` de onde vem exatamente o rótulo "Bloqueadas" citado no briefing (não lido nesta fase — fora de `src/pages/contratacao/`).
- [ ] Ler o JSX exato das bolhas de mensagem em `AgendamentosPainel.tsx` (após a linha 240) antes de extrair para a aba "Conversa" da ficha.
- [ ] Confirmar a constraint `ON DELETE SET NULL` de `bot_channels.job_id` na migration correspondente (não lida nesta fase, apenas inferida do comportamento de front).
- [ ] Mapear ordem exata de blocos na ficha para determinar abas finais (Resumo, Currículo, Entrevistas, Conversa, Histórico) — insumo já levantado na pergunta 5 acima; falta só a decisão de agrupamento, que é trabalho de `/sdd-03-specify`.
- [ ] Verificar se `bot_channels` sem vaga impacta layout de Configurações › WhatsApp.
- [ ] Testar responsividade de nova barra inferior (celular < sm).

---

## 2. To Be (Specify)

### Resumo

Reorganizar as 9 abas em **5 áreas principais** (Hoje, Candidatos, Vagas, Entrevistas, Relatórios) + **Configurações na engrenagem**, refatorando componentes sem alterar visual (cores, tipografia, cards `rounded-2xl`, etiquetas, drawer, dialog, ícones Remix).

### Goals

- [ ] Desktop (1366px): barra de 5 abas sem rolagem horizontal; engrenagem visível.
- [ ] Celular (375px): barra inferior com 5 áreas (bottom navigation).
- [ ] Cards da lista e Kanban exibem nota de aderência + vaga.
- [ ] Ficha do candidato reorganizada em 5 abas (Resumo, Currículo, Entrevistas, Conversa, Histórico).
- [ ] "Adicionar currículos" aparece só em Candidatos e dentro da vaga (janela única).
- [ ] Entrevistas com sub-abas (Dia, Calendário, Conversas IA).
- [ ] Links antigos (`aba=`, localStorage) continuam funcionando (compatibilidade).
- [ ] Visual (cores, fonte, cards, ícones) idêntico ao atual.

### Critérios de sucesso

- Nenhuma barra de rolagem horizontal nas abas em desktop (viewport ≥ 1366px).
- Barra inferior funcional em celular (375px), com 5 áreas + menu.
- Ficha exibe todos os 17 blocos de hoje em 5 abas sem perda de funcionalidade.
- Testes unitários para lógica pura nova (mapa compatibilidade abas, melhor nota, composição "Precisa de você").
- Gate iterativo verde (`tsc`, `vitest`, `vite build`).
- Sem regressão em funcionalidades existentes: rascunho local (`contratacao_rascunho_entrevista_*`, `contratacao_entrevistas_pos`), tempo real (`contratacao-tempo-real`, com a proteção contra linha incompleta), atualização automática a cada minuto, trava de dados mínimos + "Mover mesmo assim" (`required_waived_at`), histórico por gatilhos (`hiring_candidate_events`), campo WhatsApp ≠ telefone, `focoEntrevista`, selo de presença confirmada (Confirmou/Aguardando).
- Nota de aderência (card/Kanban) e nota de entrevista (Tabela) aparecem com rótulos distintos, sem uma substituir a outra.
- Ficha exibe 100% dos blocos de hoje distribuídos nas 5 abas (ver mapa bloco→aba em RF-04), incluindo `wa_log` completo na aba Conversa.
- `BotaoAvisos` continua funcional (ativar/negado/erro) dentro de "Precisa de você", sem duplicar no cabeçalho.

### Non-goals

- Não mudar o design system (cores rose/violet/emerald/amber/zinc, fonte, cards `rounded-2xl`, etiquetas `colorOf`, drawer, dialog, ícones Remix).
- Não adicionar abas nem remover blocos da ficha — só reorganizar.
- Não mexer em banco de dados, Edge Functions ou lógica de negócio.
- Não implementar comercialização do módulo (fica em spec futura, ver briefing §7): organização/cliente nas tabelas `hiring_*`/`bot_*`/`wa_*` + RLS por organização; e-mail do dono fixo em `hiring-cv-scan`/`canal-publico`/`shared.ts`/`is_hiring_admin`/`fn_hiring_team`; `hiring_settings id=1`; checagem de currículo repetido lendo todos os candidatos.
- Não implementar WhatsApp por cliente (número compartilhado único, `asst_settings.wa_public`, `WHISPER_PROMPT` fixo).
- Não implementar LGPD (aviso de privacidade, prazo de guarda, exclusão a pedido, perguntas sensíveis).
- Não implementar medição de uso/cobrança do módulo.
- **Nenhuma migration nem Edge Function nova nesta spec** — qualquer leitura adicional necessária (ex.: contagens da tela Hoje) usa tabelas/RPCs já existentes; se algo exigir função/coluna nova, isso é sinalizado em `/sdd-04-plan` como bloqueio, não implementado aqui.

### Restrições

1. **Regra nº 1 desta spec (inegociável):** NÃO mudar o visual. Mesmas cores (rose/violet/emerald/amber/zinc), mesma fonte, mesmos cards `rounded-2xl border-zinc-200`, mesmas etiquetas de fase (`colorOf`), mesmo drawer lateral da ficha, mesmos botões e janelas (`dialog.tsx`, padrão do `EntrevistaModal`). A mudança é só de **organização**: onde cada coisa fica, o que aparece em cada card, quantas abas existem. Reaproveitar os componentes e classes que já existem; não criar "design system" novo nem trocar ícones (Remix `ri-*`).

2. **Working tree compartilhado:** Não reverter alterações de outra sessão/Codex; não usar `git stash`; `git add` só dos próprios arquivos; nenhum `git commit`/`push`/`checkout` — trabalho em local, append-only no log.

3. **Sem TDD em UI:** Teste só em lógica pura (mapa de compatibilidade de abas, cálculo de melhor nota, montagem de itens "Precisa de você"). Verificação visual é manual (prints, login com acesso ao módulo).

4. **Compatibilidade de links:** `?aba=kanban` → Candidatos/Kanban; `?aba=agenda` → Entrevistas/Calendário; `?aba=agendamentos` → Entrevistas/Conversas; localStorage `contratacao_aba` igual; `focoEntrevista` continua abrindo a entrevista certa.

5. **Não quebrar o que entrou esta semana:** Rascunho local (`contratacao_rascunho_entrevista_*`, `contratacao_entrevistas_pos`), tempo real (`contratacao-tempo-real`), trava de dados mínimos + "Mover mesmo assim", histórico por gatilhos, campo WhatsApp ≠ telefone, selo de presença confirmada.

6. **Dados candidatos reais:** Processo seletivo TBA Ipanema em andamento. Testar leitura/navegação apenas; escrita só em candidatos de teste (`source = 'whatsapp_link_teste'`) ou criados para isso.

7. **Verificação visual requer login:** RLS `is_hiring_admin()` (dono ou `user_module_access`). Usuários `qa.*` podem não ter acesso — conferir; se não tiverem, pedir ao dono para logar no painel Navegador.

### Abordagens consideradas

| Opção | Prós | Contras | Escolha |
|-------|------|---------|---------|
| **A. Manter 9 abas, diminuir largura** | Sem refatoração; compatibilidade total | Não resolve o problema (abas continuam rolando; celular pior) | ❌ |
| **B. Dividir em 2 telas (Candidatos / Gestão)** | Menos abas por tela | Fragmentação; usuário perde visão geral; links quebram | ❌ |
| **C. Consolidar em 5 áreas principais** | Agrupa temas (Entrevistas = sub-abas); Desktop/celular OK; visual idêntico | Refatoração de componentes; manutenção de compatibilidade de links | ✅ **Escolhida** |

**Recomendação do agente:** Opção C resolve tanto desktop quanto celular, reaproveita todos os componentes existentes (apenas reorganiza), e preserva o visual. Risco de regressão mitigado por teste manual + gate iterativo.

### Escopo da entrega

**Decisão:** Uma spec em **6 fases** (ondas do §4 do briefing).

**Justificativa:** 
- Cada fase é entregável incremental (cards com nota → ficha em abas → consolidação → vaga por dentro → tela Hoje → filtros).
- Fases 1 e 2 são independentes (arquivos diferentes) e podem ser paralelas.
- Fases 3, 4, 5 mexem em `page.tsx` — precisam ser sequenciais.
- Fase 6 (filtros + ações em lote) é adicional se der tempo, senão fica para spec futura.
- Permite feedback incremental do dono a cada fase.

### Requisitos funcionais

**RF-01: Navegação de 5 áreas + engrenagem**
- Tela exibe 5 abas (Hoje, Candidatos, Vagas, Entrevistas, Relatórios) + ícone de engrenagem (Configurações).
- Desktop: mesma barra de abas de hoje, sem rolagem horizontal (viewport ≥ 1366px).
- Celular (< sm = 640px): barra fixa embaixo com 5 ícones + menu engrenagem.
- Compatibilidade: valores antigos de `?aba=` (`kanban`, `agenda`, `agendamentos`, `links`, `config`) redirecionam para a área equivalente.

**Mapa de compatibilidade (lógica pura, alvo de teste unitário):**

| Valor antigo (`?aba=` / `localStorage contratacao_aba`) | Destino novo |
|---|---|
| `entrevistas` | Entrevistas › Dia (default, igual hoje) |
| `candidatos` | Candidatos › Lista (`view` de `localStorage contratacao_view` decide cards/tabela, sem mudança) |
| `vagas` | Vagas |
| `kanban` | Candidatos, com modo `view = 'kanban'` (3º modo da mesma aba, não rota própria) |
| `agenda` | Entrevistas › Calendário |
| `agendamentos` | Entrevistas › Conversas IA |
| `links` | Configurações › WhatsApp (canais sem vaga ficam lá; canal de uma vaga específica é acessado por dentro da vaga, mas o link solto `?aba=links` não carrega contexto de vaga nenhum, então cai no destino genérico) |
| `config` | Configurações (engrenagem) |
| valor inválido/ausente | Hoje (nova tela inicial — muda o default de `entrevistas` para `hoje`, decisão desta fase, já que "Hoje" passa a ser a porta de entrada do módulo) |

`focoEntrevista` (deep link "Abrir entrevista de Fulana") continua funcionando: passa a abrir Entrevistas › Dia (ou a sub-aba correta) com o mesmo `focoId`/`onFocoUsado` de hoje — a função que resolve o mapa acima não interfere no fluxo de `focoEntrevista`, que já limpa o filtro de empresa e seta `selId` independentemente da aba.

**RF-02: Cards com nota e vaga**
- **Decisão do orquestrador (não reabrir, ver `spec.md` §1 "Divergências" #1):** existem hoje **duas notas distintas** no módulo — `hiring_applications.score` (aderência currículo×vaga, calculada pela IA em `hiring-cv-scan`) e `avgScore(scores)` (média das notas 1-5 dadas na entrevista, hoje exibida na coluna "Nota" da Tabela). O card (Lista e Kanban) exibe a **nota de aderência** — a melhor `hiring_applications.score` entre as candidaturas do candidato — junto do nome da vaga correspondente. A coluna "Nota" da Tabela (`avgScore`, nota de entrevista) **permanece como está, sem virar a nota do card**. Como as duas aparecem na mesma tela (Tabela ainda mostra "Nota" de entrevista; card/Kanban passam a mostrar nota de aderência), **cada uma precisa de rótulo que a distinga** (ex.: chip do card = "Aderência: 8,5 · Atendente (vaga)"; coluna da Tabela mantém o cabeçalho atual ou ganha um `title`/tooltip "Nota da entrevista" para não confundir com a aderência do card).
- **Sem query nova (onda 1):** `hiring_applications` já é carregado em `page.tsx:151` para uso em `CandidatoDrawer`/`Vagas`. Onda 1 é só propagação de prop (`applications`, e a função `vagasDe` já existente em `CandidatosLista.tsx:28`) para `CandidatosLista`/`Kanban` — nenhuma Edge Function, RPC ou tabela nova.
- Candidatos › Lista: card exibe nome, idade, bairro, **nota de aderência** (melhor `hiring_applications.score` do candidato, rotulada "Aderência"), **vaga** (nome da vaga da candidatura correspondente à melhor nota), alerta "falta X" se `faltasFicha > 0`.
- Candidatos › Kanban: mesmo + fase + decisão + estado agendamento IA.

**RF-03: "Adicionar currículos" centralizado**
- Botão aparece só em Candidatos (lado direito header ou rodapé) e dentro da Vaga.
- Abre janela modal com empresa, vaga, área de arrastar PDFs, fila de leitura.
- Faixa tracejada fixa (`drag & drop`) sai da lista e do Kanban.

**RF-04: Ficha em 5 abas**
- **Cabeçalho fixo:** nome, idade, bairro, distância, melhor nota/vaga, decisão.
- **Barra de ações:** fase, WhatsApp, agendar pela IA, currículo original, editar dados. Excluir em menu "⋯".
- **Abas:**
  - Resumo: falta + formulário mínimos, decisão, estrelas, empresa, vagas com nota, próxima entrevista, resumo, fortes/atenção, anotações.
  - Currículo: contato, distância, experiência, formação, cursos, habilidades, outras, texto original.
  - Entrevistas: lista + "Registro da entrevista".
  - Conversa: WhatsApp completo (`wa_log`).
  - Histórico: `hiring_candidate_events` + anotação.

**Mapa bloco → aba (prova de que nenhum dos ~20 blocos do `CandidatoDrawer.tsx` atual some — numeração igual à de `spec.md` §1 "Comportamento atual" item 5):**

| # | Bloco atual (`CandidatoDrawer.tsx`) | Destino |
|---|---|---|
| 1 | Fase / estrelas / empresa | Cabeçalho fixo (fase/decisão) + aba **Resumo** (estrelas, empresa) |
| 2 | Dados mínimos (aviso + formulário) | Aba **Resumo** |
| 3 | Tomada de decisão (GPC/PC/R/NA) | Cabeçalho fixo (decisão) + aba **Resumo** (ação de mudar) |
| 4 | Banner "Leitura simples / Organizar com IA" | Aba **Resumo** (topo, mesma condição `!c.ai_processed`) |
| 5 | Seção "Vagas" (aplicações + score/fit) | Aba **Resumo** (vagas com nota) |
| 6 | `AgendamentoIA` | Barra de ações (atalho "agendar pela IA") + aba **Resumo** (estado do agendamento) |
| 7 | Seção "Entrevistas" (lista + registro) | Aba **Entrevistas** |
| 8 | `HistoricoCandidato` (timeline + anotação) | Aba **Histórico** |
| 9 | Seção "Contato" | Aba **Currículo** |
| 10 | Seção "Distância até a loja" | Cabeçalho fixo (distância resumida) + aba **Currículo** (detalhe) |
| 11 | Seção "Resumo" (`c.summary`) | Aba **Resumo** |
| 12 | Pontos fortes / atenção | Aba **Resumo** |
| 13 | Seção "Experiência" | Aba **Currículo** |
| 14 | Seção "Formação" | Aba **Currículo** |
| 15 | Seção "Outros cursos" | Aba **Currículo** |
| 16 | Seção "Habilidades e idiomas" | Aba **Currículo** |
| 17 | Seção "Outras informações" | Aba **Currículo** |
| 18 | Seção "Texto do currículo" | Aba **Currículo** |
| 19 | Seção "Minhas anotações" | Aba **Resumo** (perto da decisão/anotação rápida) |
| 20 | Rodapé "Ver currículo original" + "Excluir" | Barra de ações (currículo original) + menu "⋯" (Excluir, deixa de ficar sempre visível) |
| — | `wa_log` (hoje só em `AgendamentosPainel`, fora da ficha) | Aba **Conversa** (novo acesso pela ficha; reaproveita a mesma renderização de bolhas do `AgendamentosPainel.tsx`, buscando por `phone_key` do candidato) |

Nenhum bloco é removido; "Vagas" (5) e "Anotações" (19) ficam em Resumo por serem parte da decisão rápida do gestor, não do currículo em si — decisão desta fase, revisável em `/sdd-04-plan` se o dev achar melhor separar.

**RF-05: Entrevistas com sub-abas**
- Dia: `EntrevistasDoDia` (sem mudança no registro).
- Calendário: `AgendaEntrevistas` (sem mudança).
- Conversas IA: `AgendamentosPainel` (sem mudança).
- Em dia vazio: atalho "Ir para a próxima: seg 21/09 · 7 entrevistas".

**RF-06: Vaga por dentro**
- Clicar na vaga abre tela com sub-abas: Candidatos (ranking), Divulgação (link wa.me + QR + primeira resposta), Agendamento IA, Dados da vaga.
- Aba "Links WhatsApp" deixa de existir (conteúdo move para Divulgação).
- `bot_channels` sem vaga (`job_id = null`) e/ou `is_default = true` → **Configurações › WhatsApp**, tela nova (o research confirmou que hoje não existe nenhuma tela "Configurações › WhatsApp" — não é mover algo pronto, é criar a tela). **Escopo mínimo desta spec:** reaproveitar a mesma renderização/cards e o mesmo comportamento de `LinksWhatsApp.tsx` (listagem, badge "Padrão", toggle `is_default` com exclusividade, formulário de canal) só realocados para dentro de Configurações; nenhum recurso novo (sem novo campo, sem nova regra de negócio).
- Canal de uma vaga específica é acessado por dentro da vaga (aba Divulgação); canal sem vaga ou marcado padrão fica só em Configurações › WhatsApp — sem duplicar a listagem nos dois lugares (a vaga mostra só o(s) canal(is) daquela vaga).

**RF-07: Configurações na engrenagem**
- Menu lateral (celular = lista): Empresas, Fases, Dados mínimos, Entrevista, WhatsApp.
- Mesmos cards de hoje, um por vez; o card "WhatsApp" é a tela nova descrita em RF-06 (escopo mínimo, reaproveitando `LinksWhatsApp.tsx`).

**RF-08: Tela "Hoje"**
- 3 números: entrevistas hoje (+ "próxima: seg 21/09 · 7"), currículos novos (+ quantos com ficha incompleta), entrevistas passadas sem registro.
- **"Precisa de você" — montagem é lógica pura (alvo de teste), fontes explícitas:**
  1. **`aguardando_gestor`** — sessões de agendamento (`hiring_scheduling_sessions`) com pedido de horário fora da agenda; item com ações **Aceitar/Recusar** chamando `hiring-scheduler › decide` (mesma Edge já usada hoje, sem mudança de contrato).
  2. **`needs_human`** — conversas onde a IA não consegue seguir sozinha (candidato pedindo para remarcar, dúvida fora do roteiro); item abre a conversa (aba Conversa da ficha ou o painel de Conversas IA).
  3. **Sessão `erro`** — convites/agendamentos que falharam ao enviar; item aponta o candidato/vaga afetado.
  4. **Aviso de notificações (`BotaoAvisos`)** — substitui o botão solto no cabeçalho (hoje em `src/components/feature/BotaoAvisos.tsx`, importado em `page.tsx:12,539`, fora da pasta `contratacao/`). O componente já esconde a si mesmo quando não há nada a fazer (retorna `null` nos estados `ativo`/`nao-suportado`/carregando) e só aparece nos estados `inativo` ("Ativar avisos"), `negado` ("Bloqueadas", é isso que o dono via "sem contexto") ou erro de registro ("Tentar de novo") — **reaproveitar o mesmo componente**, sem reescrever a lógica de push/Firebase, só trocar onde ele é renderizado: de um botão solto no header para um item de "Precisa de você" com o rótulo/título que já existe (`titulo` prop), preservando a função (clique continua chamando o mesmo `ativar()`/fluxo de permissão).
- Próximas entrevistas (com selo Confirmou/Aguardando).
- Vagas abertas com números.

### Edge cases

| Cenário | Comportamento esperado |
|---------|------------------------|
| Usuário abre link antigo `?aba=kanban` | Redireciona para Candidatos com vista Kanban ativa |
| Usuário tem localStorage `contratacao_aba='agenda'` | Abre Entrevistas › Calendário |
| `focoEntrevista` (deep link para entrevista) | Abre ficha do candidato + aba Entrevistas, com entrevista destaque |
| Desktop com viewport 1365px (justo abaixo do limite) | Barra de abas sem rolagem horizontal; pode haver scroll do conteúdo |
| Celular sem JavaScript (fallback) | Abas desktop visíveis (graceful degradation) |
| Ficha com candidato sem wa_log | Aba Conversa vazia com mensagem "Sem histórico" |

### Revisão da spec (Specify)

- [x] Sem TBD / placeholders vagos em §2 e §4 — pendências do research (nota, `BotaoAvisos`, `bot_channels`, mapa de blocos) resolvidas nesta fase.
- [x] Goals ↔ critérios de sucesso ↔ RF ↔ US alinhados
- [x] Restrições e non-goals sem contradição (não-goals ampliados 1:1 com briefing §7)
- [x] Abordagem escolhida refletida no To Be (Opção C, §2 "Abordagens consideradas")
- [x] Escopo da entrega adequado — 6 fases, paralelismo 1/2 e serialização 3/4/5 mantidos do briefing §4

### Confirmação de entendimento

**Agente entendeu como:** Reorganizar 9 abas em 5 áreas (Hoje, Candidatos, Vagas, Entrevistas, Relatórios) + engrenagem (Configurações), refatorando componentes React sem alterar visual (cores, fonte, cards, ícones), preservar compatibilidade de links antigos, ficha em 5 abas. Trabalho em working tree compartilhado, sem branch própria, teste só em lógica pura.

**Dev confirmou:** decisão do orquestrador SDD em nome do dono (dono ausente, 2026-09-20) — specify segue sem pausa para confirmação humana, ver `executions.md` para o registro das decisões tomadas nesta fase.

---

## 3. Design

### Decisões

| Decisão | Alternativas | Motivo |
|---------|--------------|--------|
| 5 áreas principais + engrenagem | Submenu em 1 aba (Gestão) | Abas iguais em desktop/celular; engrenagem é ícone reconhecível (padrão) |
| Ficha em 5 abas | Drawer inteiro em 1 aba (Resumo) | Separação de dados (Currículo = contato/formação; Entrevistas = registros; Conversa = wa_log) — acesso rápido |
| Cards mostram nota + vaga | Só na ficha | Ganho informativo sem sobrecarregar visual; cards hoje mostram nome+idade+bairro (espaço ≈) |
| Janela única "Adicionar currículos" | Botão flutuante em cada aba | Contexto (empresa, vaga) selecionado uma vez; fila de leitura centralizada |
| Barra inferior no celular | Drawer menu | Navegação sempre visível; padrão mobile (bottom tab) |

---

## 4. User stories

### US-01: Navegação em 5 áreas (desktop)

**Como** gestor de contratação **quero** ver as abas Hoje, Candidatos, Vagas, Entrevistas, Relatórios + Configurações em uma linha sem barra de rolagem horizontal **para** acessar tudo rapidamente no desktop (1366px).

**Critérios de aceite:**

- [ ] Barra de abas exibe 5 abas + ícone engrenagem.
- [ ] Nenhuma rolagem horizontal em viewport ≥ 1366px.
- [ ] Engrenagem abre Configurações (mesmos cards de hoje).

### US-02: Navegação no celular (< 640px)

**Como** gestor de contratação no celular **quero** uma barra inferior com as 5 áreas em ícones + menu **para** navegar sem rolar horizontalmente.

**Critérios de aceite:**

- [ ] Barra fixa embaixo com 5 ícones (Hoje, Candidatos, Vagas, Entrevistas, Relatórios).
- [ ] Menu engrenagem abre Configurações.
- [ ] Sem barra de rolagem horizontal nas abas.

### US-03: Cards com nota e vaga

**Como** gestor **quero** ver a nota de aderência e a vaga de cada candidato nos cards (Candidatos › Lista) **para** tomar decisão rápida sem abrir a ficha.

**Critérios de aceite:**

- [ ] Card exibe nome, idade, bairro, **nota** (melhor `score`), **vaga** (nome da vaga), alerta "falta X" se incompleto.
- [ ] Kanban: mesma coisa + fase + decisão + agendamento IA.

### US-04: Ficha em 5 abas

**Como** gestor **quero** acessar dados do candidato em abas temáticas (Resumo, Currículo, Entrevistas, Conversa, Histórico) **para** encontrar informações rapidamente sem rolar 17 blocos em 1 única.

**Critérios de aceite:**

- [ ] Ficha exibe 5 abas.
- [ ] Resumo: dados mínimos, decisão, empresa, vagas, próxima entrevista, anotações.
- [ ] Currículo: contato, distância, experiência, formação, habilidades.
- [ ] Entrevistas: lista + registro.
- [ ] Conversa: WhatsApp completo (wa_log).
- [ ] Histórico: eventos + anotação.
- [ ] Cabeçalho fixo (nome, idade, distância, nota, decisão) em todas as abas.

### US-05: "Adicionar currículos" centralizado

**Como** gestor **quero** carregar PDFs/entrevistadores só em um lugar (Candidatos ou dentro da Vaga) **para** não duplicar o botão em 9 abas.

**Critérios de aceite:**

- [ ] Botão aparece em Candidatos (header ou rodapé) e dentro da Vaga.
- [ ] Abre modal com empresa, vaga, drag & drop, fila.
- [ ] Faixa tracejada sai da lista e do Kanban.

### US-06: Entrevistas com sub-abas

**Como** gestor **quero** ver registro do dia, calendário e conversas IA em uma aba (Entrevistas) com sub-abas **para** não preencher 3 abas.

**Critérios de aceite:**

- [ ] Aba Entrevistas exibe 3 sub-abas (Dia, Calendário, Conversas).
- [ ] Sub-aba Dia: `EntrevistasDoDia` intacta.
- [ ] Sub-aba Calendário: `AgendaEntrevistas` intacta.
- [ ] Sub-aba Conversas: `AgendamentosPainel` intacta.

### US-07: Compatibilidade de links antigos

**Como** desenvolvedor ou bot **quero** que links antigos (`?aba=kanban`, `?aba=agenda`, etc.) continuem abrindo o lugar certo **para** não quebrar automação/deep links.

**Critérios de aceite:**

- [ ] `?aba=kanban` → Candidatos › Kanban.
- [ ] `?aba=agenda` → Entrevistas › Calendário.
- [ ] `?aba=agendamentos` → Entrevistas › Conversas.
- [ ] `?aba=links` / `?aba=config` → Configurações.
- [ ] localStorage `contratacao_aba` respeita valores antigos.
- [ ] `focoEntrevista` abre ficha + aba Entrevistas.

---

## 5. Tasks

> Conforme `tasks.md` (estrutura completa com Global Constraints, Mapa de arquivos, Profundidade, Fases, Tasks com Context pack e Steps).

- **Arquivo:** `specs/2026-09-contratacao-reorganizacao-layout/tasks.md` (~4.850 linhas)
- **6 Fases, 19 tasks:** Fase 1 = T01, T02, T18, T03 (cards + janela de upload) · Fase 2 = T04, T05, T06 (ficha em 5 abas) · Fase 3 = T07, T08, T09, T10 (extração de `page.tsx` + navegação de 5 áreas) · Fase 4 = T11, T12 (vaga por dentro + Configurações › WhatsApp) · Fase 5 = T13, T14, T15, T19 (tela Hoje + celular) · Fase 6 = T16, T17 (filtros + ações em lote, **adicional**)
- **`plan_depth`:** `contracts` (25 de 45 paths do mapa são `criar`), com override `snippets` nas 4 tasks de lógica pura: T01 (`aderencia.ts`), T07 (`navegacao.ts`), T13 (`hoje.ts`) e os Steps puros de T16/T17 — as únicas com teste automatizado.
- **Paralelismo:** só Fases 1 e 2 são paralelas (arquivos disjuntos, conferido no gate `cross`). Fases 3 a 6 são sequenciais porque se concentram em `page.tsx`/`areas/*`.
- **Tasks acrescentadas no Plan:** T18 (estado do agendamento da IA no card do Kanban — briefing §3.3 pedia, mas não havia dado carregado) e T19 (atalho "Ir para a próxima" no dia vazio — RF-05, última linha, que ficaria descoberta).
- **Status:** `planned` — gate de plan-compliance ✅ em todos os 8 escopos (`skeleton`, `fase-1` a `fase-6`, `cross`). Próximo: `/sdd-05-review`.
- **Antes de executar, ler:** a seção **"Pontos para o `/sdd-05-review` — decisões tomadas sem o dono"** no fim do `tasks.md` (13 itens, cada um com o custo de ser derrubado).

---

## 6. Referências

- **Briefing:** `specs/briefing-contratacao-reorganizacao-layout.md` (entrada desta spec)
- **Código atual:** `src/pages/contratacao/page.tsx`, `components/*`
- **Padrão de abas:** Radix Tabs (componente `tabs.tsx`)
- **Padrão de drawer:** `CandidatoDrawer.tsx` (já usa sheet/drawer)
- **Padrão de dialog:** `dialog.tsx` (Radix Dialog)
- **Design tokens:** Tailwind (cores rose/violet/emerald/amber/zinc; `rounded-2xl`; `border-zinc-200`)
- **Ícones:** Remix (ri-* — `remix-icon` npm package)
- **Mapa de sistema:** `AI_SYSTEM_MAP.md` (ver "Histórico de soluções")
- **Regras do projeto:** `AGENTS.md` (gates de qualidade, TDD, branches, commit/push)

---

**Próxima fase:** `/sdd-04-plan` — Detalhar `tasks.md` (backlog executável por fase, ondas 1–6, contexto/steps por task), com atenção ao paralelismo de Fases 1 e 2 e à serialização de 3/4/5 em `page.tsx`.
