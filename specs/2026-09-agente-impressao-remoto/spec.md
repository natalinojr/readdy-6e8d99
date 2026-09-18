---
issue: N/A
tipo: feat
slug: agente-impressao-remoto
titulo: Agente de impressão gerenciado remotamente, com token por PC
branch: claude/agente-impressao-remoto
tdd: true
tdd_integracao: fora
feature_flag: true
status: 01-new
criado: 2026-09-18
autor: "@natalinojr (fase inicial SDD 01, spec mecânica — contexto e problema abaixo)"
---

# Spec: Agente de impressão gerenciado remotamente, com token por PC

## Metadados

| Campo | Valor |
|-------|-------|
| Issue | N/A — sem issue tracker neste projeto (ver `AGENTS.md`) |
| Tipo | `feat` |
| Branch | `claude/agente-impressao-remoto` (convenção do projeto, sem prefixo de issue) |
| TDD | `true` para lógica de token, associação loja-agente, status; `tdd_integracao: fora` para chamadas reais a impressoras (mockadas em teste) |
| Feature flag | `true` — coluna booleana em `system_settings` por loja: `require_print_agent_token` (padrão: false para manter compatibilidade com agente antigo) |
| Pasta | `specs/2026-09-agente-impressao-remoto/` |
| Status | `01-new` — estrutura inicial; aguardando `/sdd-02-research` |
| Prazo | Pronto antes de seg 21/09/2026 para Paranaguá instalar versão nova |

## Por quê?

Hoje cada loja tem um PC com o agente de impressão (`agente-local/index.js`, Node, serviço do Windows) que puxa a fila `print_queue` pela Edge `print-queue-agent` usando apenas a **chave pública (anon)** + `tenant_ids` escritos no `config.json` local. Isso traz problemas de segurança, operação e escalabilidade:

1. **Segurança** — com a chave pública e o id da loja, qualquer pessoa com acesso ao PC (ou à chave pública vaza em log/screenshot) consegue ler/manipular a fila de impressão de todas as lojas configuradas.

2. **Configuração manual e frágil** — toda mudança de quais lojas o PC atende exige ir até o PC e editar manualmente o `config.json`. Já houve instância de JSON inválido por falta de vírgula, parando o agente silenciosamente.

3. **Sem controle de duplicação** — nada impede dois PCs atenderem à mesma loja. Hoje o PC de casa do dono atende a Paranaguá para testes e vai disputar tickets com o PC da loja na segunda, causando impressão duplicada ou perdida.

4. **Sem visibilidade** — não há como ver de fora (pelo ERPOS) se o agente está online, qual versão está rodando, quando foi a última impressão bem-sucedida, ou se houve erro.

**Objetivo (caminho escolhido pelo dono):** instalar o agente UMA vez por PC e daí em diante tudo remoto:

- **Token de máquina por PC** — cada PC recebe um token único, evitando que qualquer pessoa com a chave pública acesse a fila.
- **Tela "Agentes de impressão" no ERPOS** com status online/offline, versão instalada, última impressão, erros recentes.
- **Atribuição por clique** — quais lojas cada agente atende, com a regra de uma loja por agente de cada vez.
- **Configuração buscada do servidor** — agente consulta a API do ERPOS em vez de ler `config.json` local.
- **Atualização automática do agente** — pode ficar como fase final se arriscado.

**Transição sem parar ninguém:** o servidor aceita o agente antigo (anon) **E** o novo (token) até o dono ligar, por loja, a flag "Exigir token do agente"; voltar a desligar reativa o antigo.

---

## 1. As Is (Research)

*A ser preenchido em `/sdd-02-research`.*

---

## 2. To Be (Specify)

*A ser preenchido em `/sdd-03-specify` após research.*

### Goals (preliminares)

- [ ] Gerar e armazenar um token único por PC (máquina).
- [ ] Modificar a Edge `print-queue-agent` para aceitar tanto agente antigo (anon) quanto agente novo (token), respeitando a flag `require_print_agent_token` por loja.
- [ ] Criar tela "Agentes de impressão" no ERPOS mostrando status online/offline, versão, última impressão, erros.
- [ ] Permitir atribuir lojas a agentes por clique (regra: uma loja por agente de cada vez).
- [ ] Fazer o agente buscar configuração do servidor em vez de ler `config.json`.
- [ ] Implementar feature flag `require_print_agent_token` em `system_settings` (padrão: false).

### Requisitos funcionais (preliminares)

1. **Token de máquina** — cada PC que roda o agente recebe um token único, armazenado localmente (ex.: `D:\agente-impressao\.token`), apresentado via tela de onboarding do agente.
2. **API de registro do agente** — agente chama a API ao iniciar para registrar-se com token + versão + última IP.
3. **Armazenamento de agentes** — tabela `print_agents` (ou similar) em Supabase com campos: token, tenant_id (ou null se não atribuído), status (online/offline), versão, última_impressão, erro_recente.
4. **Atribuição de lojas** — tela no ERPOS permite arrastar uma loja de uma lista para um agente (ou botão "Atribuir"), com validação de que cada loja pode ter apenas um agente ativo.
5. **Lógica de disputa** — se dois agentes tentarem atender à mesma loja, apenas um vence (primeiro chegar? ou o mais recentemente online?).
6. **Feature flag por loja** — `system_settings.require_print_agent_token` (boolean, padrão false); quando true, Edge rejeita requisições do agente antigo (anon).
7. **Backward compatibility** — enquanto flag é false, agente antigo e novo coexistem; um PC com agente novo e outro com antigo podem atender lojas diferentes.

### Restrições (preliminares)

- **Uma loja por agente de cada vez** — se um agente é assinalado a Loja A, não pode atender Loja B simultaneamente.
- **Sem Docker, sem dependências novas** — agente continua sendo Node.js puro, servicível no Windows via PowerShell/Task Scheduler.
- **Nunca hardcode token** nos arquivos de config/scripts — token fica em arquivo local sensível com permissões restritas.
- **Token deve ser válido por longo prazo** — não deve vencer diariamente (ao contrário de tokens de sessão de usuário); mas deve permitir revogação/reemissão manual.
- **Testes unitários sem chamar impressora real** (`tdd_integracao: fora`).

### Escopo de entrega

- Uma spec só (sem subdividir em fases).

### Non-goals (preliminares)

- Atualização automática do agente nesta entrega (pode ser fase 2 se arriscado).
- Dashboard avançado com histórico/gráficos de impressão (tela simples apenas).
- Revogação/reemissão de tokens via UI (apenas criação inicial na primeira instalação).

---

## 3. Design

*A ser preenchido em `/sdd-04-plan` e `/sdd-03-specify` se necessário.*

---

## 4. User stories

*A ser preenchido em `/sdd-03-specify`.*

---

## 5. Tasks

*A ser planejado em `/sdd-04-plan` após specify.*

---

## 6. Contexto de negócio (resumido)

- **Loja Paranaguá:** go-live 21/09/2026; novo agente remoto deve estar pronto para instalação antes disso.
- **Lojas operando:** Vila Leste (desde jun/2026) + Paranaguá (a partir 21/09). Cada uma com seu PC de agente de impressão.
- **Caso de uso crítico:** Paranaguá terá múltiplos tipos de impressora (cupom, comanda, etc.); agente remoto reduz overhead de configuração e suporta escalabilidade para mais lojas.

---

## 7. Referências

- Agente atual: `agente-local/index.js`
- Edge atual: `supabase/functions/print-queue-agent/index.ts`
- Sistema de print: mencionado em `AI_SYSTEM_MAP.md` (seção "Histórico de soluções — Agente impressão Realtime")
- Feature flags: `AGENTS.md` § Feature flags; implementação em `src/contexts/SystemSettingsContext.tsx`
- Documentação viva de soluções: `AI_SYSTEM_MAP.md` ("Histórico de soluções e critérios")
