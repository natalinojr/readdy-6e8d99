# WhatsApp Meta - delivery

Objetivo: enviar mensagem automatica para cliente do delivery quando um pedido for criado.

## Onde voce esta na Meta

Pelo print, voce esta em:

Meta for Developers > app > Conectar no WhatsApp > Configuracao da API.

Nessa tela:
- Gere um token temporario para teste.
- Copie o `Identificacao do numero de telefone` (Phone Number ID).
- Copie o `Identificacao da conta do WhatsApp Business` (WABA ID).
- Em `Ate`, selecione ou adicione seu numero pessoal como destinatario de teste.
- Envie a mensagem de teste `hello_world` pela propria tela da Meta para confirmar que a conta esta funcionando.

## Template para producao

Para pedido vindo do site, a mensagem deve usar template aprovado pela Meta.

Crie um template chamado:

`pedido_recebido_delivery`

Idioma:

`pt_BR`

Categoria sugerida:

`Utility`

Texto sugerido:

```text
Oi, {{1}}! Recebemos seu pedido {{2}} no valor de {{3}}. Vamos te avisar por aqui sobre o andamento.
```

Parametros usados pelo sistema:
- `{{1}}`: primeiro nome do cliente.
- `{{2}}`: numero do pedido.
- `{{3}}`: total do pedido.

## Secrets do Supabase

Configurar como secrets das Edge Functions:

```text
META_WHATSAPP_ACCESS_TOKEN=token_permanente_da_meta
META_WHATSAPP_PHONE_NUMBER_ID=phone_number_id_da_meta
WHATSAPP_INTERNAL_TOKEN=um_texto_grande_aleatorio_criado_por_voce
WHATSAPP_TEMPLATE_ORDER_CREATED=pedido_recebido_delivery
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
```

Para teste inicial com token temporario da tela da Meta, tambem funciona, mas ele expira. Para producao, crie token permanente com System User no Business Manager.

## Edge Functions

Criadas/alteradas:
- `supabase/functions/whatsapp-send/index.ts`: envia template pela WhatsApp Cloud API.
- `supabase/functions/delivery-write/index.ts`: chama `whatsapp-send` quando `create_delivery_order` cria um pedido.

Importante:
- A chamada e nao bloqueante do ponto de vista do negocio. Se WhatsApp falhar, o pedido continua criado.
- O envio so acontece se `WHATSAPP_INTERNAL_TOKEN` estiver configurado.

## Deploy

Depois de configurar secrets:

```bash
supabase functions deploy whatsapp-send --project-ref mdghhjemzdmeuqpzuyzx
supabase functions deploy delivery-write --project-ref mdghhjemzdmeuqpzuyzx
```

Se for usar o MCP/Supabase do Codex, deployar as duas Edge Functions pelo projeto `mdghhjemzdmeuqpzuyzx`.

## Teste manual da funcao

Depois do deploy, teste enviando para um numero permitido pela Meta:

```json
{
  "action": "send_template",
  "to": "5511999999999",
  "template_name": "hello_world",
  "language_code": "en_US",
  "body_params": []
}
```

Header obrigatorio:

```text
x-internal-token: mesmo_valor_do_WHATSAPP_INTERNAL_TOKEN
```

Depois que o template `pedido_recebido_delivery` for aprovado, o teste real e criar um pedido pelo delivery.

