# Estudo — Tarefas no celular (ERPOS V2)

Criado em: 2026-08-11. Status: **M0, M1, M2 e M3 IMPLEMENTADAS** (2026-08-11/12). Backend no ar; front pendente de push.

> **M0 — PWA instalável** ✅ `public/manifest.webmanifest`, ícones PNG gerados (âmbar + check), `public/sw.js`, registro em `src/lib/pwa.ts` (só em produção), meta tags iOS no `index.html`, banner de instalação em `src/components/feature/InstallPWA.tsx` (montado no `AppLayout`).
>
> **M1 — Tarefas mobile-first** ✅ Navegação inferior (Minhas · Lista · Agenda · Listas) com selo de pendências; "Minhas" como tela inicial no celular; seletor de listas em bottom sheet; calendário em modo agenda (faixa da semana + tarefas do dia); botão **Tirar foto** nos anexos com compressão automática; botão voltar do Android fecha overlays; áreas de toque ≥44px; puxar-para-atualizar; busca e agrupamento movidos para dentro do painel de filtros.
>
> **M2 — Web Push** ✅ Tabela `push_subscriptions`; chaves VAPID geradas e guardadas nos secrets; Edge Function `send-push` com o protocolo Web Push (RFC 8291 + 8292) implementado sobre Web Crypto — **sem biblioteca Node**, cuja compatibilidade no Deno é instável; gancho no `notify()` do `task-write`; handlers `push`/`notificationclick` no service worker; inscrição em `src/lib/push.ts`; botão "Ativar avisos neste aparelho" + "Testar" na caixa de notificações; clique na notificação abre `/tarefas?task=<id>` direto na tarefa.
>
> **M3 — Polimento** ✅ Selo numérico no ícone do app instalado (Badging API), sincronizado com as pendências e marcado pelo service worker quando chega push com o app fechado.
>
> Para testar o PWA localmente (o service worker só roda em produção): `npm run build` e depois o preview na porta 4173 — já existe a configuração `preview` em `.claude/launch.json`.

Pergunta: como levar o sistema para o celular, começando só pelo módulo de tarefas, com o que é 100% prático de usar na mão?

---

## 1. Ponto de partida (fatos verificados no código)

O que **já ajuda**:

- O shell autenticado já é responsivo: `Sidebar.tsx` vira drawer off-canvas abaixo de `md` (overlay + translate-x), `TopBar` tem botão de menu, `main` tem padding adaptativo.
- `index.html` já tem viewport correto, inclusive `interactive-widget=resizes-content` (teclado virtual não quebra o layout).
- O projeto já tem DNA mobile no lado do cliente: `/delivery`, `/mesa-qr`, `/motoboy` são mobile-first, com `PullToRefresh` e `MobileKeyboardAssist` prontos para reuso.
- O backend de tarefas é 100% neutro de dispositivo (RPCs + `task-write` + realtime). **Nada do backend muda neste estudo.**
- As notificações de tarefas já são persistidas por usuário com broadcast (`task-notify:<user_id>`) — é exatamente a base que Web Push precisa.
- `compressImage()` já existe em `src/lib/supabase.ts` — serve para foto de câmera como anexo.

O que **falta**:

- Nenhum manifest PWA, nenhum service worker, nenhum ícone (a pasta `public/` está vazia; favicon é o `vite.svg`).
- O módulo de tarefas foi construído desktop-first: sidebar interna fixa de 240px, drawer lateral, Kanban com drag HTML5 (não funciona em toque), calendário mensal com células pequenas, filtros em popovers.

## 2. Estratégias possíveis

| Estratégia | O que é | Custo | Push | Loja de apps | Veredito |
|---|---|---|---|---|---|
| **PWA sobre o app atual** | Manifest + service worker + ajustes mobile-first no módulo. O funcionário "instala" pelo navegador (ícone na tela inicial, abre sem barra do navegador) | **Baixo** — mesmo repo, mesmo deploy Vercel | Android: excelente. iPhone: funciona desde o iOS 16.4, **mas só com o app adicionado à tela inicial** | Não passa | ✅ **Recomendado** |
| Capacitor | Embrulha o mesmo app web num binário nativo (Android/iOS) | Médio — toolchain nativa, contas de desenvolvedor (US$ 25 Google / US$ 99/ano Apple), processo de review | Nativo, confiável nos dois | Sim | Só se a presença em loja virar requisito. Dá para adotar DEPOIS por cima da mesma base |
| React Native / Expo | App nativo separado | **Alto** — segunda base de código para manter em paralelo com o Codex/Claude | Nativo | Sim | ❌ Descartado: duplicaria todo o trabalho das Fases 1–4 |

**Recomendação: PWA.** É o único caminho em que o módulo de tarefas inteiro (backend + telas + realtime) é reaproveitado como está, o deploy continua sendo o push no `main`, e a "instalação" no celular do funcionário leva 10 segundos. Capacitor fica como upgrade futuro sem retrabalho — ele embrulha exatamente o mesmo código.

## 3. O que é "100% prático no celular" (e o que não é)

Cenário real: funcionário no chão da loja, uma mão no celular, tela de ~5,5", rede oscilante. O celular é para **executar e ser avisado**; configurar é trabalho de gestor no desktop.

**Entra na experiência mobile (otimizado):**

1. **Minhas Tarefas como tela inicial** — atrasadas/hoje/semana. É a pergunta que o funcionário faz ao abrir: "o que eu tenho pra fazer?"
2. **Concluir com um toque** — checkbox grande na linha, sem abrir a tarefa.
3. **Checklist tocável** — itens com área de toque ≥44px; é o coração das rotinas (abertura/fechamento).
4. **Foto da câmera como anexo** — prova de execução ("limpei a chapa", foto da nota do fornecedor). `<input capture="environment">` + a compressão que já existe + upload que já existe. **Provavelmente a feature de maior valor prático do estudo.**
5. **Push de atribuição/menção** — o aviso chega com o app fechado. Sem isso, o celular perde metade do sentido.
6. **Criar tarefa rápida** — título + lista, nada mais obrigatório. Detalhes ficam para depois/desktop.
7. **Comentar com @** — já funciona em toque (o autocomplete é por clique).
8. **Agenda do dia** — o calendário mensal vira lista "agenda" no celular: toca no dia, vê as tarefas dele.

**Fica disponível mas sem otimização (uso ocasional):** view Lista completa com agrupamentos, filtros, tags.

**Explicitamente fora do celular (trabalho de gestor, desktop):** gerenciar campos personalizados, templates, status das listas, views compartilhadas; Kanban com arrasto (no toque, mover de status é pelo dropdown do detalhe — o arrasto HTML5 não existe em touch e um polyfill não vale o custo para uso ocasional).

## 4. Adaptações concretas por componente

Tudo abaixo de `md:` (768px), via Tailwind — sem detecção de user-agent, sem rota separada:

| Componente | Hoje (desktop) | No celular |
|---|---|---|
| `page.tsx` | Sidebar interna 240px + header com views | **Bottom navigation** fixa: Minhas · Lista · Agenda · 🔔. Seletor de lista vira **bottom sheet** (o padrão off-canvas do `Sidebar.tsx` do shell serve de referência). "Minhas" é a aba inicial |
| `TaskDrawer` | Painel lateral max-w-xl | **Folha em tela cheia** deslizando de baixo; botão voltar fecha (history state, para o botão físico do Android funcionar) |
| `ViewLista` | Linhas densas, badges de campos custom | Linhas mais altas (área de toque), badges reduzidas ao essencial (prazo + responsável), quick-add fixo no rodapé |
| `ViewKanban` | Colunas 288px + drag | Mantém rolagem horizontal por coluna (funciona), **sem drag**; mover status = abrir tarefa → dropdown. Sem polyfill de toque |
| `ViewCalendario` | Grade mensal 7 colunas | **Modo agenda**: semana como padrão; tocar num dia mostra a lista de tarefas do dia abaixo da faixa de dias |
| `MinhasTarefas` | Já é lista simples | Praticamente pronta — só engordar as áreas de toque e ligar `PullToRefresh` |
| `FiltrosBar` | Popovers | Bottom sheet único de filtros |
| Anexos | `<input type="file">` | Dois botões: **📷 Tirar foto** (`capture="environment"` + `compressImage`) e 📎 Arquivo |

## 5. Push notifications (a peça nova de verdade)

Único item que exige infraestrutura nova — tudo o mais é CSS/layout:

1. **Tabela `push_subscriptions`** (tenant_id, user_id, endpoint, chaves p256dh/auth) — o navegador do funcionário registra a assinatura ao ativar.
2. **Chaves VAPID** (par único, gratuito, gerado uma vez; guardado como secret das Edge Functions).
3. **Edge Function `send-push`** — recebe user_id + payload e envia via Web Push para as assinaturas dele (Deno tem lib `webpush` pronta).
4. **Gancho no `notify()` do `task-write`** — onde hoje insere em `task_notifications`, passa a também chamar o envio de push. Um ponto único de mudança.
5. **Service worker** — recebe o push e mostra a notificação do sistema; tocar nela abre `/tarefas` na tarefa certa.

Realidade por plataforma: **Android** = experiência completa (banner, som, app fechado). **iPhone** = funciona a partir do iOS 16.4, somente com o PWA instalado na tela inicial — a instalação vira passo obrigatório do onboarding dos funcionários com iPhone (instrução de 3 toques: Compartilhar → Adicionar à Tela de Início).

## 6. Fases propostas

| Fase | Entrega | Esforço estimado |
|---|---|---|
| **M0 — PWA instalável** ✅ | Manifest + ícones + service worker mínimo (network-first no HTML para não conflitar com os deploys frequentes do Vercel) + tela "instale o app" | Pequeno (1 sessão) |
| **M1 — Tarefas mobile-first** ✅ | Bottom nav, Minhas como home, folha full-screen, agenda, botão de foto, áreas de toque, pull-to-refresh | Médio (1–2 sessões) — maior valor visível |
| **M2 — Web Push** ✅ | `push_subscriptions` + VAPID + `send-push` + gancho no `notify()` + opt-in na UI | Médio (1 sessão) |
| **M3 — Polimento** ✅ | Cache leve de leitura p/ abrir instantâneo, badge de contagem no ícone, atalhos de instalação por loja | Pequeno |

Ordem sugerida: M0 → M1 → M2. M0+M1 já entregam o uso diário; M2 fecha o ciclo "fui avisado → abri → concluí".

## 7. Riscos e pegadinhas

- **Service worker × deploys frequentes**: cada push no `main` publica versão nova; o SW deve usar network-first para navegação e `skipWaiting` para o funcionário não ficar preso numa versão velha. É o risco técnico nº 1 de PWA neste projeto.
- **iOS**: push só com PWA instalada; e o Safari pode limpar storage de sites não usados por semanas (sessão cai, pede login de novo — aceitável, mas bom saber).
- **Peso da página**: o `index.html` carrega Meta Pixel + 3 CSS de CDN (fontes/ícones) em todas as telas — no celular do funcionário isso custa. Vale mover os pixels para só as rotas públicas de delivery num passo futuro (fora do escopo deste estudo).
- **Drag & drop**: decisão deliberada de NÃO portar para toque. Reavaliar só se houver demanda real.
- **Sem app de loja**: se algum franqueado exigir "app na Play Store", o caminho é Capacitor por cima desta mesma base — nada do que está aqui se perde.


---

## 8. Estado final da implementação (2026-08-12)

**No ar (backend):** tabela `push_subscriptions`; secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; Edge Functions `send-push` (nova) e `task-write` (com o gancho de push).

**Verificado:** a criptografia do push foi conferida de ponta a ponta — o corpo cifrado pela função foi decifrado por uma implementação independente em Node (texto idêntico, incluindo acentos e emoji) e a assinatura VAPID ES256 valida contra a chave pública. O service worker registra, ativa e controla a página; a chave VAPID chega ao cliente.

**Não verificado (precisa de aparelho real):** a entrega de fato pelo serviço de push (FCM/APNs) e a UI mobile do módulo, porque o navegador automatizado bloqueia a permissão de notificação e as telas exigem login. Depois do push para produção: instalar no celular, abrir o sino → "Ativar avisos neste aparelho" → "Testar".

**Chaves VAPID:** guardadas apenas nos secrets do Supabase. Trocá-las invalida todas as assinaturas existentes (os aparelhos precisariam reativar).
