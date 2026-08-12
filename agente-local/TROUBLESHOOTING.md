# Solução de Problemas - Agente de Impressão

## Problema: "Todo dia a impressora para e eu preciso reiniciar o agente"

### Sintomas
- De manhã (ou depois de um tempo) os pedidos param de sair na impressora.
- Os tickets ficam em `print_queue.status = 'pending'` acumulando, sem virar `printing`.
- **Reiniciar o agente resolve na hora** — e o problema volta no dia seguinte.

### Causa
O agente roda em **modo só-Realtime** (`polling_enabled: false`). O Realtime usa um
**websocket**. Quando o PC **dorme/hiberna à noite** ou a **rede oscila**, o socket fica
"zumbi" (parece vivo mas não recebe mais nada). Nas versões antigas (≤ v3.2) não havia
fallback nem reconexão automática → o agente ficava "rodando" sem imprimir até o restart manual.

### Solução definitiva (v3.3.0+)
A partir da **v3.3.0** o agente se auto-recupera e **não precisa mais de restart manual**:
1. **Safety-net poll sempre ligado** — mesmo em modo Realtime, um poll lento (padrão 60s,
   `safety_poll_interval_ms`) garante a impressão mesmo se o Realtime morrer.
2. **Watchdog do Realtime** (`realtime_watchdog_ms`, padrão 60s) — detecta socket zumbi e
   força a reconexão sozinho, restaurando a impressão instantânea.
3. **Crash guards** — um erro solto não derruba mais o processo.

**Como aplicar em cada PC:**
1. Copiar o `index.js` novo (v3.3.0) para a pasta do agente no PC (ex.: `C:\ERPOS\agente-local\`).
2. Conferir que o agente está como **Serviço do Windows** (rode `instalar.bat` como admin se ainda não estiver — isso garante auto-start no boot e auto-restart em caso de crash).
3. Reiniciar o serviço **"ERPOS Print Agent"** (services.msc) — ou rodar `node index.js`.
4. Validar em `http://localhost:9876/health`: deve mostrar `"version":"3.3.0"`,
   `"realtime_healthy":true` e `"realtime_watchdog":true`.

> Dica: deixe o **plano de energia do Windows** como "Alto desempenho" / nunca suspender,
> para o PC da loja não dormir durante o expediente.

---

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