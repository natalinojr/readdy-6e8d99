# Solução de Problemas - Agente de Impressão

## Problema: Agente inicia mas não imprime nada

### Sintomas
- O agente mostra "Fila centralizada ATIVA" ao iniciar
- Nenhum log de polling aparece (sem `[Queue] Polling tenant:`)
- Os tickets na tabela `print_queue` ficam com `status = 'pending'` e `retry_count = 0`
- Nenhum ticket é processado

### Causa
A edge function `print-queue-agent` no Supabase foi deployada com `verify_jwt: true`.
O agente local usa a chave `sb_publishable_...` (configurada no `config.json`) que **não é um JWT válido**.
O gateway do Supabase rejeita a chamada antes mesmo de chegar na função, e o agente não mostra o erro.

### Solução
Redeployar a edge function `print-queue-agent` com `verify_jwt: false`.

**Passos no Readdy.ai:**
1. Pedir para o assistente: "Redeploya a edge function `print-queue-agent` com `verify_jwt: false`"
2. Aguardar o deploy concluir
3. No PC da loja, matar todos os processos `node` e rodar `node index.js` novamente
4. Verificar se os logs de polling aparecem a cada 3 segundos

### Verificação
Depois de corrigir, o terminal deve mostrar:
```
[Queue] Polling tenant: ac66279a-...
[Queue] Encontrados X ticket(s) pendentes
```

E as impressões devem sair normalmente.

---

## Problema: Erro `EADDRINUSE` ao iniciar

### Sintoma
```
Error: listen EADDRINUSE: address already in use 127.0.0.1:9876
```

### Causa
Já existe uma instância do agente rodando na porta 9876.

### Solução
- Se o agente está funcionando: **não fazer nada**, ele já está rodando
- Se precisa reiniciar: abrir o Gerenciador de Tarefas, matar todos os processos `node.exe` e rodar `node index.js` novamente

---

## Problema: Tickets com `impressora_id = null`

### Sintoma
Tickets aparecem no banco com `impressora_id = null` mesmo quando deveriam ter uma impressora específica.

### Causa
Código antigo do PDV não enviava o `impressora_id` correto ao criar o ticket.

### Solução
Verificar se o build mais recente do projeto está deployado. Os tickets criados **depois** da correção já saem com o `impressora_id` correto.
Tickets antigos com `null` continuarão pendentes — podem ser deletados manualmente ou processados com impressora padrão.