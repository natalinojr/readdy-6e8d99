# Restrições no SDD — Convenção centralizada

Fonte única para a seção **Restrições** em `spec.md` (§2 To Be). **Restrições padrão deste repositório:** ver [`AGENTS.md`](../../AGENTS.md) (seção Restrições padrão do repositório).

## Restrições vs non-goals

| | **Restrições** | **Non-goals** |
|---|----------------|---------------|
| Pergunta | O que **não pode ser violado** ao implementar? | O que **não faremos** nesta entrega? |
| Exemplo | Manter o contrato de API existente | Não criar testes novos nesta entrega |
| Fase | Obrigatório em `/sdd-03-specify` | Obrigatório em `/sdd-03-specify` |

Se um item for ambíguo, registrar nos dois ou escolher o papel dominante e referenciar o outro em uma linha.

## Quando preencher

- **`/sdd-03-specify`:** seção **Restrições** obrigatória em `spec.md` §2.
- Se o As Is ou o pedido do dev não deixarem limites claros, **perguntar** antes de fechar o Specify.
- Mínimo: listar restrições **aplicáveis** à spec; se não houver nenhuma além das do projeto, registrar explicitamente: *"Nenhuma restrição adicional além das padrão do repositório (ver AGENTS.md)."*

## Categorias sugeridas (usar as que couberem)

| Categoria | O que registrar |
|-----------|-----------------|
| **Compatibilidade** | Contratos, clientes legados, idempotência |
| **Stack / arquitetura** | Versões, camadas, padrões do projeto |
| **Integrações** | Protocolos externos, mapeamento de erros, clients existentes |
| **Mensageria** | Idempotência, padrões assíncronos |
| **Segurança / privacidade** | Auth, credenciais, logs |
| **Dados / deploy** | Migrations, ordem de deploy, feature flags |
| **Performance** | Regressão, timeouts |
| **Qualidade** | Gates e convenções do projeto (`AGENTS.md`, rules) |

## Validação nas fases

| Fase | O que verificar |
|------|-----------------|
| **Plan** (`/sdd-04-plan`) | Tasks e DoD não violam restrições; impactos documentados |
| **Review plano** (`/sdd-05-review`) | Plano respeita restrições e non-goals |
| **Execute** (`/sdd-06-execute`) | Implementação + loop de revisão dentro das restrições; desvio → atualizar spec |
| **Spec review** (`/sdd-07-spec-review`) | Entrega final respeita todas as restrições |

## Legado

Specs anteriores a esta convenção podem não ter a seção **Restrições**; não é obrigatório migrar. Novas specs devem incluí-la a partir de `/sdd-03-specify`.
