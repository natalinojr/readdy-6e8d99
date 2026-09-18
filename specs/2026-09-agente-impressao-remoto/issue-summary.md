# Issue Summary — Agente de impressão gerenciado remotamente

## Status

- **Criado em:** 2026-09-18
- **Slug:** `agente-impressao-remoto`
- **Tipo:** `feat`
- **Fase atual:** 01-new (estrutura inicial)
- **Prazo:** antes de seg 21/09/2026 (Paranaguá go-live)

## Resumo executivo

Substituir o modelo atual de agente de impressão (chave pública + config.json local) por um modelo gerenciado remotamente via token de máquina, com tela de status e atribuição de lojas por clique.

## Problemas resolvidos

1. **Segurança:** chave pública + id da loja vaza → qualquer um manipula fila.
2. **Operação:** editar config.json exige ida ao PC, é frágil (JSON inválido).
3. **Escalabilidade:** sem controle de qual PC atende qual loja → duplicação de impressão.
4. **Visibilidade:** sem forma de saber se agente está online, qual versão roda, ou se houve erro.

## Abordagem

- Token único por PC, gerado na primeira instalação.
- Tela "Agentes de impressão" mostrando status online/offline, versão, última impressão, erros.
- Feature flag `require_print_agent_token` (padrão false) para backward compatibility.
- Configuração buscada do servidor em vez de arquivo local.

## Próximos passos

1. `/sdd-02-research` — mapeamento do sistema atual.
2. `/sdd-03-specify` — detalhamento de UX e goals.
3. `/sdd-04-plan` → `/sdd-06-execute` → `/sdd-07-spec-review` → `/sdd-08-docs`.

## Referências

- Spec: `specs/2026-09-agente-impressao-remoto/spec.md`
- Executions: `specs/2026-09-agente-impressao-remoto/executions.md`
- Agente atual: `agente-local/index.js`
- Edge `print-queue-agent`: `supabase/functions/print-queue-agent/index.ts`
