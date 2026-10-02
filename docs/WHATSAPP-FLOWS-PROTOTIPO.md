# WhatsApp Flows — protótipo do agendamento de entrevista (passagem de sessão)

Começado em 2026-10-02, numa sessão na nuvem, no branch `ccr-6d892c41-zppt7x`. **Nada foi publicado em produção.**
Não houve deploy de Edge Function, nem mudança no banco, nem configuração na Meta. Este arquivo é o ponto de
partida para continuar numa sessão local.

## O que é e por que aqui

Flows = telas de formulário nativas dentro da conversa do WhatsApp (só na API oficial / Cloud API). O primeiro
uso escolhido foi o **agendamento de entrevista** (Contratação): em vez de digitar "quarta 16:00" e a IA
interpretar, o candidato toca em "Escolher horário", escolhe o dia e depois o horário (que vêm ao vivo da agenda
da vaga) e confirma. A reserva passa pelo mesmo `fn_hiring_book`, e os avisos são os mesmos do `book()`.

## Pesquisa (fatos que valem para o código)

- **Criptografia do endpoint** (exemplo oficial da Meta, `github.com/WhatsApp/WhatsApp-Flows-Tools` ›
  `examples/endpoint/nodejs/basic/src/encryption.js`):
  - o pedido traz `encrypted_aes_key`, `encrypted_flow_data` e `initial_vector`;
  - a chave AES-128 chega cifrada com RSA-OAEP SHA-256 usando a nossa chave pública;
  - os dados vêm em AES-128-GCM, com a tag nos 16 bytes finais;
  - a resposta usa a mesma chave AES com o vetor invertido (`~byte`), em base64 puro (não JSON).
- **Códigos HTTP do endpoint:**
  - `421` = falha ao decifrar (a Meta busca a chave pública de novo);
  - `427` = token do Flow inválido (fecha o Flow; vai `{ error_msg }` cifrado);
  - `432` = assinatura `x-hub-signature-256` errada (HMAC do corpo cru com o App Secret, o mesmo
    `WHATSAPP_APP_SECRET` do webhook).
- **Ações do pedido:**
  - `ping` → responder `{ data: { status: 'active' } }` (é a checagem de saúde da Meta; precisa funcionar para publicar);
  - `data.error` → `{ data: { acknowledged: true } }`;
  - `INIT` (abriu o Flow), `BACK` e `data_exchange` (com `screen` = tela atual).
  - Resposta: `{ version, screen, data }`, devolvendo o mesmo `version` do pedido. Sem ele, a falha é silenciosa.
  - Fechar o Flow: `{ screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token, ... } } } }`.
- **Versões (out/2026):**
  - Flow JSON `7.3` é a recomendada;
  - `data_api_version` `3.0` ainda funciona. A `4.0` acrescenta o `flow_token_signature` (um JWT assinado com o
    App Secret; é opcional e só vem com Flow JSON ≥ 7.3).
  - Versões antigas congelam ou expiram com cerca de 90 dias de aviso.
- **Limites úteis:**
  - RadioButtonsGroup: até 20 itens; título até 30 caracteres;
  - Dropdown: até 200 itens;
  - Footer: 1 por tela; rótulo até 35 caracteres;
  - endpoint: responder em menos de ~10 s;
  - campos que não estão declarados no `data` da tela são descartados.
- **API da Meta (Graph v25, mesmo `graph()` de `_shared/wa.ts`):**
  - chave pública: `POST /{phone_id}/whatsapp_business_encryption` com `business_public_key` (PEM, RSA 2048);
  - criar Flow: `POST /{waba_id}/flows` com `{ name, categories:['APPOINTMENT_BOOKING'], flow_json (string), endpoint_uri, publish:false }` → `{ id, validation_errors }`;
  - trocar o JSON: `POST /{flow_id}/assets` (multipart: `name=flow.json`, `asset_type=FLOW_JSON`, `file`);
  - publicar: `POST /{flow_id}/publish`;
  - status e prévia: `GET /{flow_id}?fields=id,name,status,validation_errors,health_status,preview.invalidate(false)`
    (o `preview_url` abre a prévia no navegador);
  - Flow publicado não se edita: é preciso clonar ou criar uma versão nova.
- **Envio:** mensagem `interactive` do tipo `flow` (feito em `waSendFlow`, `_shared/wa.ts`), com
  `flow_message_version:'3'`, `flow_token`, `flow_id`, `flow_cta` e `flow_action:'data_exchange'`.
  `mode:'draft'` testa o Flow em rascunho sem publicar. Só funciona dentro da janela de 24 h, ou como modelo com
  botão FLOW.
- **Retorno no webhook:** `messages[].type = 'interactive'`, com `interactive.type = 'nfm_reply'` e
  `interactive.nfm_reply.response_json` (string JSON com o `flow_token` e os `params` do SUCCESS).
- **Custo:** o Flow não tem tarifa própria; paga-se a mensagem ou o modelo normal.
- **Bloqueio deste ambiente:** a sessão na nuvem não acessa `developers.facebook.com`. No PC, vale conferir lá o
  guia "Implement endpoints for Flows", o "Flows API" e o changelog.

## Já feito neste branch

1. `supabase/functions/_shared/wa.ts` → nova `waSendFlow(cfg, to, { flowId, token, cta, body, header?, footer?, draft?, origin? })`.
   É só um acréscimo: ninguém chama ainda. Registra no `wa_log` com `kind: 'flow'` (a coluna não tem restrição;
   conferido no banco).
2. `supabase/functions/whatsapp-flow/cripto.ts` → `importarPrivada`, `decifrar`, `cifrarResposta`,
   `publicaDaPrivada`, `assinaturaMetaOk` e `FlowHttpError`. Usa WebCrypto puro, então roda no Deno e no Node
   (vitest). **Ainda sem teste.**

## Falta fazer (na ordem)

1. **Script de chaves:** `scripts/whatsapp-flow/gerar-chaves.mjs`, com
   `crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })`.
   A privada é sem senha, porque o WebCrypto não lê PEM com senha. Salvar a privada como segredo
   `WHATSAPP_FLOW_PRIVATE_KEY`. Nunca commitar a chave.
2. **`supabase/functions/whatsapp-flow/telas.ts`** (puro, testável):
   - `FLOW_JSON`: versão `7.3`, `data_api_version` `3.0`, `routing_model { DIA: ['HORARIO'], HORARIO: [] }`.
   - Tela `DIA`: `TextHeading ${data.vaga}`, `TextBody ${data.local}`, RadioButtonsGroup `dia` com a lista `${data.dias}`,
     e Footer "Ver horários" → `data_exchange { dia: ${form.dia} }`. Texto: "Se nenhum dia servir, feche e responda na conversa".
   - Tela `HORARIO` (`terminal: true`): `TextSubheading ${data.dia_label}`, `TextCaption ${data.aviso}` com
     `visible: ${data.tem_aviso}`, Dropdown `horario` com a lista `${data.horarios}` (o último item é
     `{ id:'nenhum', title:'Nenhum serve — combinar na conversa' }`), e Footer "Confirmar entrevista" →
     `data_exchange { dia: ${data.dia}, horario: ${form.horario} }`.
   - `diasDisponiveis(slots, agora)`: agrupa por data de São Paulo e descarta horários com menos de 30 min de
     antecedência. Títulos "Hoje · quinta 01/10", "Amanhã · sexta 02/10", "Sábado 03/10", com a descrição
     "N horários". No máximo 7 dias.
   - `horariosDoDia(slots, dia)`: `{ id: iso, title: 'HH:MM' }` mais o item "nenhum".
   - Teste em `src/test/edge/whatsappFlow.test.ts`, no padrão de `atendimentoTravas.test.ts` (import pelo
     caminho montado em tempo de execução). O teste cobre:
     - ida e volta da criptografia, gerando o par de chaves com `node:crypto` e cifrando como a Meta cifra;
     - o vetor invertido;
     - a assinatura;
     - o agrupamento de dias e horários.
3. **`supabase/functions/whatsapp-flow/index.ts`** (deploy com `--no-verify-jwt`):
   - Ler o corpo cru e conferir a assinatura (`WHATSAPP_APP_SECRET`); se falhar, responder `432`.
   - Ações admin com o header `x-internal-key` (= `ASSISTENTE_INTERNAL_KEY`): `chave_publica`, `criar`
     (grava o `flow_id` em `asst_settings.wa_flow_agendamento`), `atualizar`, `publicar`, `status`,
     `testar { session_id, to }` e `ligar { ativo, numeros, modo:'draft'|'published' }`.
   - Decifrar; se falhar, responder `421`.
   - `ping` e erro, conforme a pesquisa acima.
   - Token = `"<session_id>.<hmac16>"`, com HMAC sobre `ASSISTENTE_INTERNAL_KEY`. A mesma função também é usada
     pelo scheduler, então vai em `_shared/wa-flow.ts`. Se for inválido, responder `427`.
   - `INIT`/`BACK` → hiring-scheduler `flow_info` → tela DIA. Se a entrevista já estiver marcada ou aguardando a
     equipe, responder `427` com a mensagem "Sua entrevista já está marcada…".
   - DIA → tela HORARIO (com `flow_info` de novo, para a lista estar fresca).
   - HORARIO com `nenhum` → `flow_nenhum` → SUCCESS.
   - HORARIO com um horário → `flow_book`. Se der certo, SUCCESS. Se não, volta à HORARIO com
     `aviso: 'Esse horário acabou de ser preenchido'` e a lista nova.
4. **`hiring-scheduler/index.ts`** (só acréscimos):
   - `flow_info { session_id }`:
     - só aceita sessão com status `convidado` ou `negociando`;
     - devolve `{ vaga, local: onde(c), slots }`;
     - os `slots` vêm de `freeSlots`, ou de `pend.slots` com `semConflito` quando o pedido pendente é `janela_gestor`.
   - `flow_book { session_id, starts_at }`:
     - chama `fn_hiring_book` direto, com `force` = horário da janela da equipe e ainda sem conflito;
     - grava no histórico "[escolheu pelo formulário] …";
     - os avisos rodam em segundo plano (`EdgeRuntime.waitUntil`) para responder em menos de 10 s;
     - para isso, separar a parte de sucesso do `book()` numa `posReserva(admin, c, startsAt, force)`, reaproveitada pelos dois.
   - `flow_nenhum`: manda "Sem problema! Me diga o melhor dia e horário pra você…" e volta a sessão para `negociando`.
   - Em `offerAgain`, depois do texto (que continua igual), chamar `ofereceFlow(admin, c)`. Ele só manda o Flow
     quando:
     - `asst_settings.wa_flow_agendamento.ativo` está ligado;
     - o número está na lista `numeros` (lista vazia = todos);
     - o transporte é `cloud`.
     - Corpo: "Prefere escolher tocando? 👇"; botão: "Escolher horário".
5. **`whatsapp-cloud/index.ts`**: quando chegar `interactive.type === 'nfm_reply'`, registrar
   "[formulário enviado]" no `wa_log` e parar ali, porque a reserva já foi feita pelo endpoint. Hoje ele cairia
   com texto vazio no `canal-publico`. Fazer isso depois do `firstTime` e do `wa_last_in` (o envio do formulário
   abre a janela de 24 h).
6. **Configuração na Meta (com o dono):**
   - gerar as chaves → `npx supabase secrets set --project-ref mdghhjemzdmeuqpzuyzx WHATSAPP_FLOW_PRIVATE_KEY="$(cat privada.pem)"`;
   - deploy de `whatsapp-flow` (`--no-verify-jwt`) e `hiring-scheduler`;
   - rodar as ações admin `chave_publica` → `criar` → `status` (abrir o `preview_url`) → `testar` em modo draft com
     uma sessão da vaga de teste;
   - se o endpoint reclamar de "app não conectado", ligar o app da Meta ao Flow no Flow Builder do WhatsApp Manager;
   - só depois `publicar` e `ligar`.
7. **Checagem:** `node scripts/check.mjs` (tsc sem aumentar a base de erros + vitest), registrar o aprendizado em
   `AI_SYSTEM_MAP.md` › Histórico, e só então subir em `main`.

## Fontes

- Exemplo oficial da Meta (criptografia, servidor, agendamento): https://github.com/WhatsApp/WhatsApp-Flows-Tools/tree/main/examples/endpoint/nodejs
- Referência técnica do Flow JSON (componentes, limites, pegadinhas): https://github.com/gokapso/agent-skills/blob/master/skills/integrate-whatsapp/references/whatsapp-flows-spec.md
- Guia do endpoint (Meta): https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint
- Flows API (Meta): https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi
- Visão geral de 2026 (versões 7.3 e Data API 4.0): https://www.infiq.in/blog/whatsapp-flows-guide
