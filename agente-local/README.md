# ERPOS — Agente Local de Impressao v3

Este agente resolve o problema de impressao automatica quando a impressora esta em um **IP privado da rede local** (ex: `10.0.0.x`, `192.168.x.x`) e o sistema ERPOS esta hospedado na nuvem.

## O problema

A Supabase (nuvem) nao consegue acessar IPs privados da sua rede local. Entao a Edge Function `printer-raw` falha silenciosamente e o sistema abre a janela de impressao do navegador.

## A solucao

Este agente roda **no proprio computador do restaurante** e:
1. Recebe os pedidos de impressao diretamente do navegador via `localhost:9876` (quando o PDV esta no mesmo PC)
2. Faz **polling na fila centralizada do Supabase** para imprimir pedidos vindos de qualquer dispositivo (tablet, celular, caixa, etc.)

## Requisitos

- Windows 10/11
- Node.js 16+ (https://nodejs.org/)
- A impressora deve estar na mesma rede local do computador
- (Opcional, mas recomendado) Conexao com internet para a fila centralizada

## Instalacao rapida

1. **Instale o Node.js** se ainda nao tiver: https://nodejs.org/ (baixe a versao LTS)
2. **Copie esta pasta** `agente-local/` para o computador do restaurante (ex: `C:\ERPOS\agente-local\`)
3. **Edite o `config.json`** — coloque os IPs e IDs das impressoras do restaurante
4. **Clique com botao direito** no arquivo `instalar.bat` e escolha **"Executar como administrador"**
5. Pronto! O agente esta rodando.

Para testar, abra o navegador e acesse: `http://localhost:9876/health`

## Configuracao (config.json)

Edite o arquivo `config.json` na mesma pasta do agente. Ele aceita **quantas impressoras voce quiser**:

```json
{
  "agent_port": 9876,
  "default_timeout_ms": 10000,
  "impressoras": [
    {
      "id": "cozinha",
      "nome": "Cozinha",
      "ip": "10.0.0.186",
      "porta": 9100,
      "papel": "80mm"
    },
    {
      "id": "bar",
      "nome": "Bar",
      "ip": "10.0.0.187",
      "porta": 9100,
      "papel": "80mm"
    },
    {
      "id": "caixa",
      "nome": "Caixa",
      "ip": "10.0.0.188",
      "porta": 9100,
      "papel": "58mm"
    }
  ],
  "print_queue_enabled": true,
  "supabase_url": "https://mdghhjemzdmeuqpzuyzx.supabase.co",
  "tenant_id": "SEU-TENANT-ID-AQUI",
  "poll_interval_ms": 3000
}
```

| Campo | Descricao |
|-------|-----------|
| `agent_port` | Porta que o agente escuta (padrao: 9876) |
| `default_timeout_ms` | Timeout padrao para conexao TCP (padrao: 10000ms) |
| `impressoras` | Array com todas as impressoras do restaurante |
| `impressoras[].id` | ID unico da impressora (deve bater com o cadastrado no ERPOS) |
| `impressoras[].nome` | Nome amigavel (apenas para legibilidade) |
| `impressoras[].ip` | IP da impressora na rede local |
| `impressoras[].porta` | Porta TCP (geralmente 9100 para impressoras termicas) |
| `impressoras[].papel` | Largura do papel: "80mm" ou "58mm" |
| `print_queue_enabled` | **NOVO v3** — habilita polling da fila centralizada do Supabase |
| `supabase_url` | **NOVO v3** — URL do projeto Supabase (copie do .env) |
| `tenant_id` | **NOVO v3** — UUID do tenant/restaurante (veja em Configuracoes > Loja) |
| `poll_interval_ms` | **NOVO v3** — Intervalo de polling em ms (padrao: 3000) |

> **Dica:** O config.json e recarregado automaticamente! Voce pode editar enquanto o agente esta rodando — nao precisa reiniciar o servico.

> **Impressao separada (Cozinha vs Bar):** O ERPOS separa automaticamente os tickets:
> - Itens que passam pela cozinha (hamburguer, batata, etc.) → impressora `"cozinha"`
> - Bebidas, sobremesas e itens que **nao** passam pela cozinha (`skip_kds`) → impressora `"bar"`
> - Se nao houver impressora `"bar"` configurada, o agente usa a `"cozinha"` como fallback

## Como funciona o fluxo (modo fila centralizada — recomendado)

```
Usuario confirma pedido no ERPOS (de qualquer dispositivo)
        |
        v
ERPOS salva o ticket na tabela print_queue no Supabase
        |
        v
Agente local (PC da cozinha) faz polling a cada 3s
        |
        v
Agente busca tickets pendentes do Supabase
        |
        v
Agente formata ESC/POS e imprime na impressora local
        |
        v
Agente confirma no Supabase que imprimiu
```

## Como funciona o fluxo (modo localhost — legacy)

```
Usuario confirma pedido no ERPOS (mesmo PC do agente)
        |
        v
Frontend do ERPOS detecta IP privado
        |
        v
Chama http://localhost:9876/print com impressora_id
        |
        v
Agente (rodando no PC do restaurante) recebe
        |
        v
Agente busca o IP no config.json pelo impressora_id
        |
        v
Agente abre conexao TCP com a impressora
        |
        v
Impressora termica imprime — silencioso, sem janela!
```

## Endpoints

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| GET | `/health` | Verifica se o agente esta online |
| GET | `/queue-status` | Status da fila centralizada |
| GET | `/impressoras` | Lista todas as impressoras do config.json |
| POST | `/print` | Envia dados para a impressora |

### POST /print

Body (JSON) — usando **impressora_id** (recomendado):
```json
{
  "impressora_id": "cozinha",
  "data": "<html>...</html>",
  "data_encoding": "utf8"
}
```

Body (JSON) — usando **IP direto** (fallback):
```json
{
  "ip": "10.0.0.186",
  "port": 9100,
  "data": "<html>...</html>",
  "data_encoding": "utf8"
}
```

Resposta de sucesso:
```json
{ "success": true, "bytes_sent": 2048 }
```

Resposta de erro:
```json
{ "success": false, "error": "Impressora 'cozinha' nao encontrada no config.json" }
```

## Multiplos restaurantes / multiplas impressoras

Cada restaurante tem seu proprio `config.json`. Basta:
1. Instalar o agente no PC do restaurante
2. Editar o `config.json` com os IPs das impressoras daquele local
3. No ERPOS, cadastre as impressoras com o mesmo `id` usado no config.json

Exemplo — Restaurante A:
```json
{
  "impressoras": [
    { "id": "cozinha", "nome": "Cozinha A", "ip": "192.168.1.50", "porta": 9100 },
    { "id": "caixa",   "nome": "Caixa A",   "ip": "192.168.1.51", "porta": 9100 }
  ]
}
```

Exemplo — Restaurante B:
```json
{
  "impressoras": [
    { "id": "cozinha", "nome": "Cozinha B", "ip": "10.0.0.186", "porta": 9100 },
    { "id": "bar",     "nome": "Bar B",     "ip": "10.0.0.187", "porta": 9100 }
  ]
}
```

O ERPOS envia `impressora_id: "cozinha"` — e o agente do restaurante resolve pro IP correto dele!

## Desinstalar

Para remover o servico do Windows, execute como administrador:
```
node service-uninstall.js
```

Ou simplesmente delete a pasta — o servico sera removido automaticamente.

## Solucao de problemas

### "Nao consigo acessar localhost:9876"
- Verifique se o servico "ERPOS Print Agent" esta rodando no Gerenciador de Servicos do Windows
- Tente reiniciar o servico
- Verifique se a porta 9876 nao esta sendo usada por outro programa

### "A impressora nao imprime"
- Verifique se o IP da impressora esta correto (`ping 10.0.0.186`)
- Verifique se a porta 9100 esta aberta na impressora
- Confira o firewall do Windows — pode estar bloqueando conexoes de saida para a porta 9100
- Verifique se o `config.json` esta correto e o `impressora_id` bate com o cadastrado no ERPOS

### "O Node.js nao esta instalado"
- Baixe em https://nodejs.org/ e instale com as opcoes padrao
- Feche e reabra o prompt de comando

### "impressora_id nao encontrada"
- Confira se o `id` no `config.json` é EXATAMENTE igual ao cadastrado no ERPOS
- Use o endpoint `GET /impressoras` pra ver quais IDs o agente conhece

### Fila centralizada nao imprime
- Verifique se `print_queue_enabled` esta `true` no config.json
- Verifique se `supabase_url` e `tenant_id` estao configurados corretamente
- Use `GET /queue-status` para verificar o status da fila
- Verifique o console/log do agente — ele mostra mensagens de `[Queue]`
- Certifique-se de que o computador tem acesso a internet (o agente consulta o Supabase)
- O `tenant_id` deve ser o UUID do restaurante (encontre em Configuracoes > Loja no ERPOS)

### Onde encontro o tenant_id?
No ERPOS, vá em **Configuracoes > Loja** — o campo **ID do Tenant** é exibido na tela. Copie esse UUID e cole no config.json.