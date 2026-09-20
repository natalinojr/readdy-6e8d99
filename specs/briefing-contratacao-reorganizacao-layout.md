# Briefing — Contratação: reorganização de layout

> Documento de passagem para uma nova sessão rodar o fluxo SDD com o orquestrador.
> Preparado em 2026-09-20, depois de uma revisão feita no sistema real (erpos.vercel.app, login do
> dono) e de esboços aprovados em conversa. **Nada disto foi executado.**
> Slug sugerido: `contratacao-reorganizacao-layout` → pasta `specs/2026-09-contratacao-reorganizacao-layout`,
> branch `claude/contratacao-reorganizacao-layout`.

## 1. Pedido do dono (com as palavras dele)

- "Acho que algumas informações poderiam estar mais organizadas, o botão adicionar currículo só em uma
  página específica."
- Depois de ver os esboços: **"o problema é que você mudou o tipo do visual… não precisa mudar, o
  visual que está, está legal."**
- "Pode organizar então."

### Regra nº 1 desta spec (inegociável)

**NÃO mudar o visual.** Mesmas cores (rose/violet/emerald/amber/zinc), mesma fonte, mesmos cards
`rounded-2xl border-zinc-200`, mesmas etiquetas de fase (`colorOf`), mesmo drawer lateral da ficha,
mesmos botões e janelas (`dialog.tsx`, padrão do `EntrevistaModal`). A mudança é só de **organização**:
onde cada coisa fica, o que aparece em cada card, quantas abas existem. Reaproveitar os componentes e
classes que já existem; não criar "design system" novo nem trocar ícones (Remix `ri-*`).

## 2. Como está hoje (As Is, conferido na tela em 2026-09-20)

Código: `src/pages/contratacao/page.tsx` (≈800 linhas, shell + estado) e `components/`
(CandidatosLista, Kanban, Vagas, VagaModal, AgendamentoVaga, AdicionarCandidatosModal, CandidatoDrawer,
EditarCandidatoModal, EntrevistaModal, EntrevistasDoDia, AgendaEntrevistas, AgendamentosPainel,
RelatoriosContratacao, LinksWhatsApp, ConfiguracoesContratacao), `shared.ts`, `dialog.tsx`.

Problemas vistos:

1. **9 abas** (Entrevistas, Candidatos, Vagas, Kanban, Agenda, Agendamentos, Relatórios, Links WhatsApp,
   Configurações). Não cabem: no desktop aparece barra de rolagem horizontal sob as abas e a
   engrenagem fica cortada; no celular cabem 4–5.
2. Três abas do mesmo assunto: **Entrevistas** (registro do dia), **Agenda** (calendário) e
   **Agendamentos** (conversas da IA). **Kanban** e **Candidatos** são a mesma lista em dois modos.
3. Botão **"Adicionar currículos"** no cabeçalho em quase todas as abas (`aba !== 'config'`), **mais** a
   área tracejada "Arraste PDFs…" fixa em Candidatos **e no Kanban** (empurra as colunas para baixo).
4. **Cards da lista não mostram a nota de aderência nem a vaga** (só dentro da ficha). Cards do Kanban
   são ainda mais pobres: nome, idade, cidade.
5. **Ficha (CandidatoDrawer)**: ~17 blocos numa rolagem só, nesta ordem: fase/estrelas/empresa → dados
   mínimos → decisão → vagas → agendamento IA → entrevistas → histórico → contato → distância → resumo →
   fortes/atenção → experiência → formação → cursos → habilidades → outras → texto → anotações.
   Contato e distância só aparecem depois de rolar bastante. "Excluir" sempre visível no rodapé.
   A conversa completa do WhatsApp (`wa_log`) só existe na aba Agendamentos, não na ficha.
6. **Vagas**: com uma vaga só, a tela fica quase vazia. O link do WhatsApp da vaga mora em outra aba
   (Links WhatsApp) e o agendamento pela IA dentro do "Editar vaga".
7. **Entrevistas** abre vazia em dia sem entrevista, sem apontar a próxima ("seg 21/09 · 7").
8. Botão **"Bloqueadas"** (`BotaoAvisos`) ao lado do título, sem contexto — parece erro.
9. **Configurações**: uma página comprida com 4 cards (Empresas, Fases, Dados mínimos, Entrevistas).
10. Agendamentos mostra contadores zerados + "Carregando…" durante a carga.

## 3. Como deve ficar (To Be)

### 3.1 Navegação: 5 áreas + engrenagem

`Hoje · Candidatos · Vagas · Entrevistas · Relatórios` e **Configurações como engrenagem** no cabeçalho.
Mesmo componente/estilo de abas de hoje. No celular (< sm): barra fixa embaixo com as 5 áreas.
Manter compatibilidade dos links existentes: `?aba=` / `localStorage contratacao_aba` com valores antigos
(`kanban`, `agenda`, `agendamentos`, `links`, `config`) devem cair no lugar novo equivalente; o link
"Abrir entrevista de Fulana" (`focoEntrevista`) precisa continuar funcionando.

### 3.2 Hoje (nova, tela inicial)

Com os cards/listas que já existem:
- 3 números: entrevistas hoje (+ "próxima: seg 21/09 · 7"), currículos novos (+ quantos com ficha
  incompleta), entrevistas passadas sem registro.
- **"Precisa de você"**: pedidos de horário fora da agenda (`aguardando_gestor`, com Aceitar/Recusar via
  `hiring-scheduler › decide`), candidato pedindo para remarcar / conversa com `needs_human`, convites com
  erro (sessão `erro`), e o aviso de notificações (substitui o botão "Bloqueadas" solto).
- Próximas entrevistas (com o selo Confirmou/Aguardando que já existe em `EntrevistasDoDia`).
- Vagas abertas com os números do card atual de `Vagas.tsx`.

### 3.3 Candidatos

- **Lista · Tabela · Kanban** como alternância de visualização da mesma aba (hoje já existe cards/tabela;
  o Kanban entra como 3º modo e sai das abas).
- Filtros em etiquetas: fase (já existe), vaga, decisão, "ficha incompleta"; ordenar por nota.
- **Cards ganham nota de aderência + vaga** (melhor `hiring_applications.score` do candidato) e alerta
  "falta X" quando `faltasFicha` > 0. Kanban: mesma coisa + decisão + estado do agendamento da IA.
- Seleção múltipla com ações em lote: enviar para a IA agendar (mover para fase `agendar`), mover de
  fase, descartar. Respeitar a trava dos dados mínimos (`required_waived_at` / "Mover mesmo assim").
- **"Adicionar currículos" só aqui e dentro da vaga**, abrindo uma **janela** com empresa, vaga, área de
  arrastar e a fila de leitura (`queue`). A faixa tracejada fixa sai da lista e do Kanban.

### 3.4 Vaga por dentro

Clicar na vaga abre a tela dela com sub-abas: **Candidatos** (o ranking atual), **Divulgação** (o link
wa.me + QR + o que o atendente pode contar + primeira resposta — vem de `LinksWhatsApp.tsx`),
**Agendamento pela IA** (`AgendamentoVaga.tsx`, hoje dentro do `VagaModal`) e **Dados da vaga**.
A aba "Links WhatsApp" deixa de existir. Atenção: `bot_channels` pode existir **sem vaga** (só empresa /
banco de currículos) e pode haver canal `is_default` — prever onde esses ficam (sugestão: Configurações ›
WhatsApp). Apagar vaga hoje apaga o agendamento em cascata e solta o link (`set null`): avisar na tela.

### 3.5 Entrevistas

Sub-abas: **Do dia** (= `EntrevistasDoDia`, sem mudar o registro nem o rascunho local), **Calendário**
(= `AgendaEntrevistas`), **Conversas da IA** (= `AgendamentosPainel`, com contador do que precisa de
atenção). Em dia vazio, atalho "Ir para a próxima: seg 21/09 · 7 entrevistas".

### 3.6 Ficha do candidato (mesmo drawer)

- Cabeçalho fixo: nome, idade, bairro, distância, melhor nota/vaga, decisão.
- Barra de ações: fase, WhatsApp, agendar pela IA, currículo original, editar dados. **Excluir** dentro de
  um menu "⋯".
- Abas: **Resumo** (o que falta na ficha + formulário de dados mínimos, decisão, estrelas, empresa, vagas
  com nota, próxima entrevista, resumo, fortes/atenção, anotações) · **Currículo** (contato, distância,
  experiência, formação, cursos, habilidades, outras informações, texto original) · **Entrevistas**
  (lista + "Registro da entrevista") · **Conversa** (WhatsApp completo do número, de `wa_log`, mesma
  renderização do AgendamentosPainel) · **Histórico** (`hiring_candidate_events` + anotação).
- Nenhum bloco some; só muda de lugar.

### 3.7 Configurações

Menu lateral (no celular vira lista): Empresas · Fases do kanban · Dados mínimos · Entrevista ·
WhatsApp (canais sem vaga / padrão). Mesmos cards de hoje, um por vez.

### 3.8 Detalhes

- Filtro de empresa no topo só aparece com mais de uma empresa.
- Agendamentos/Conversas da IA: esqueleto de carga em vez de contadores zerados.
- Relatórios: **sem mudança**.

## 4. Ordem sugerida (ondas)

1. Cards com nota e vaga (lista + kanban) · janela "Adicionar currículos" só em Candidatos/Vaga ·
   tirar a faixa de envio do Kanban.
2. Ficha em abas (inclui a aba Conversa).
3. Fusão das abas: Kanban → modo de Candidatos; Entrevistas com sub-abas; Configurações na engrenagem
   com menu lateral; compatibilidade dos valores antigos de `aba`.
4. Vaga por dentro (Divulgação + Agendamento) e fim da aba Links WhatsApp.
5. Tela Hoje + barra inferior no celular.
6. Filtros em etiquetas e ações em lote.

Ondas 1 e 2 são independentes entre si (arquivos diferentes) e podem ir em paralelo. 3, 4 e 5 mexem todas
em `page.tsx` — serializar.

## 5. Restrições e cuidados

- **Não mexer em banco nem em Edge Functions** nesta spec, salvo leitura nova estritamente necessária
  (ex.: contagens para a tela Hoje). Nada de migração destrutiva.
- Não regredir o que entrou esta semana: rascunho local do registro (`contratacao_rascunho_entrevista_*`,
  `contratacao_entrevistas_pos`), tempo real (`contratacao-tempo-real`, com a proteção contra linha
  incompleta), atualização automática a cada minuto, trava de dados mínimos + "Mover mesmo assim",
  histórico por gatilhos, campo WhatsApp ≠ telefone, `focoEntrevista`, selo de presença confirmada.
- `page.tsx` já é grande: a reorganização é boa hora para extrair as áreas em componentes, sem mudar
  comportamento.
- Working tree é compartilhado com outras sessões/Codex: não reverter o que não é desta spec; **não usar
  `git stash`**; `git add` só dos arquivos tocados.
- Gate: `node scripts/check.mjs --force` (tsc não pode aumentar em relação a `scripts/baseline.json`;
  vitest sem falha nova). Build: `npx vite build`.
- **Verificação visual precisa de login com acesso ao módulo Contratação** (RLS `is_hiring_admin()`:
  dono ou `user_module_access`). Os usuários `qa.*` provavelmente não têm esse acesso — conferir; se não
  tiverem, pedir ao dono para logar no painel Navegador (foi assim nesta revisão) ou liberar o módulo
  para `qa.admin`. **Não escrever em candidatos reais** durante o teste: há processo seletivo em
  andamento (TBA Ipanema, entrevistas marcadas). Testar leitura/navegação; escrita só em candidato de
  teste (`source = 'whatsapp_link_teste'`) ou criado para isso.
- TDD: a parte é quase toda de apresentação; vale teste só para lógica pura nova (ex.: mapa dos valores
  antigos de `aba`, seleção da "melhor nota" do candidato, montagem dos itens de "Precisa de você").

## 6. Critérios de aceite

- Visual idêntico ao atual em cores, fonte, cards, etiquetas e drawer (comparar com prints antes/depois).
- 5 áreas + engrenagem; nenhuma barra de rolagem horizontal nas abas no desktop (1366 px); barra inferior
  no celular (375 px).
- "Adicionar currículos" aparece só em Candidatos e dentro da vaga; Kanban sem a faixa de envio.
- Card da lista e do Kanban mostra nota e vaga.
- Ficha em 5 abas, com todos os blocos de hoje presentes; aba Conversa mostra o WhatsApp completo.
- Links/atalhos antigos continuam abrindo o lugar certo (incluindo "Abrir entrevista de Fulana").
- Contagem de erros TS não aumenta; vitest verde; `vite build` ok.

## 7. Fora do escopo (vira outra spec depois)

**Comercialização do módulo** — levantada na mesma conversa, não faz parte desta entrega:
organização/cliente nas tabelas `hiring_*`/`bot_*`/`wa_*` + RLS por organização (hoje quem tem acesso vê
tudo; e-mail do dono fixo em `hiring-cv-scan`, `canal-publico`, `shared.ts`, `is_hiring_admin`,
`fn_hiring_team`; `hiring_settings id=1`; checagem de currículo repetido lê todos os candidatos);
WhatsApp por cliente (`asst_settings.wa_public` é um número só; modelos com "TBA Ipanema" no exemplo;
`WHISPER_PROMPT` fixo); LGPD (aviso de privacidade, prazo de guarda, exclusão a pedido) e perguntas
sensíveis no padrão ("Filhos", estado civil, nascimento obrigatório); medição de uso e cobrança; testes
do `hiring-scheduler`; alertas de saúde; cabeçalho próprio sem os selos do PDV.
Decisões pendentes do dono: vender como módulo do ERPOS × produto separado; número compartilhado ×
número próprio por cliente; forma de cobrança.
