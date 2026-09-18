# MR Template — Agente de impressão gerenciado remotamente

*A ser preenchido em `/sdd-08-docs` após implementação completa.*

## Summary

(Resumo das mudanças)

## Checklist de entrega

- [ ] Spec completa (`spec.md`)
- [ ] Testes passando (`npx vitest run`)
- [ ] TypeScript: sem novos erros acima do baseline
- [ ] Build: `npx vite build` passa
- [ ] Feature flag implementada (`system_settings.require_print_agent_token`)
- [ ] Documentação de restore/rollback em caso de problema

## Validação

- [ ] Teste manual da tela "Agentes de impressão"
- [ ] Teste manual de atribuição de loja a agente
- [ ] Teste de backward compatibility (agente antigo continua funcionando enquanto flag está false)
- [ ] Teste de transição (ligar flag, agente antigo para de funcionar por loja)

## Breaking changes

(Nenhum esperado nesta entrega; backward compatibility mantida)

## Deployment notes

(Instruções de deploy, se houver)
