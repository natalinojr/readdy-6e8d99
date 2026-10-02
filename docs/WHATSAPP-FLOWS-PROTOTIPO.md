# WhatsApp Flows — protótipo do agendamento de entrevista (passagem de sessão)

Começado em 2026-10-01 à noite na nuvem (branch `ccr-6d892c41-zppt7x`) e com o código terminado no mesmo dia numa
sessão local (branch `claude/whatsapp-flows`). **Ainda não foi publicado:** não houve deploy de Edge Function nem
configuração na Meta, e o segredo da chave não existe. Ver "Falta" abaixo.

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

## Código (feito)

Começado na nuvem e terminado numa sessão local em 2026-10-01, no branch `claude/whatsapp-flows` (com o
`main` já mesclado). Conferido com `node scripts/check.mjs`: tsc 287/287, igual à base, e vitest todo verde.
O bundle das três Edge Functions foi conferido com esbuild.

1. **Chaves:** `scripts/whatsapp-flow/gerar-chaves.mjs <pasta fora do repo>` gera `privada.pem` e `publica.pem`.
   A privada é PKCS#8 sem senha. O script recusa pasta dentro do repositório.
2. **`_shared/wa-flow.ts`:**
   - token `"<session_id>.<hmac16>"` (HMAC com `ASSISTENTE_INTERNAL_KEY`): `tokenDoFlow` e `sessaoDoToken`;
   - leitura de `asst_settings.wa_flow_agendamento` = `{ flow_id, ativo, numeros[], modo }`: `lerFlowCfg` e
     `numeroLiberado` (lista vazia = todos; compara com e sem o 55 e o 9).
3. **`whatsapp-flow/telas.ts`:**
   - `FLOW_JSON` (7.3 / data_api 3.0): DIA → HORARIO;
   - `diasDisponiveis` (máximo de 7 dias, 30 min de antecedência, data de São Paulo);
   - `horariosDoDia` (com o item final "Nenhum horário serve"; o texto antigo passava de 30 caracteres);
   - `telaHorario`.
4. **`whatsapp-flow/index.ts`:**
   - endpoint: 432 / 421 / 427, `ping`, `error`, `INIT`/`BACK` → DIA, DIA → HORARIO, HORARIO → reserva ou
     "nenhum";
   - horário preenchido no meio do caminho → volta à HORARIO com o aviso e a lista nova;
   - dia que lotou → aviso "Volte e escolha outro dia";
   - ações admin (`x-internal-key`): `chave_publica`, `criar`, `atualizar`, `publicar`, `status`, `testar` e `ligar`.
5. **`hiring-scheduler`:**
   - `posReserva` foi separada do `book()`, sem mudar o comportamento;
   - ações novas: `flow_info`, `flow_book` (a reserva é feita na hora; confirmação e avisos vão em segundo plano)
     e `flow_nenhum`;
   - `offerAgain` chama `ofereceFlow` depois da lista. Ele só envia com o Flow ligado, o número liberado, a API
     oficial e dentro da janela de 24 h;
   - o formulário **não** entra no `history` da sessão, porque as regras olham a última fala nossa, que tem que
     continuar sendo a lista. Ele fica registrado no `wa_log` (`kind: 'flow'`).
6. **`whatsapp-cloud`:** o `nfm_reply` vira "[formulário enviado]" no `wa_log` e para ali.
7. **Teste:** `src/test/edge/whatsappFlow.test.ts` (14 casos). Cobre:
   - a criptografia, cifrando como a Meta cifra com `node:crypto`;
   - a pública derivada da privada e a assinatura;
   - o token e a lista de números;
   - os dias e horários, inclusive 22h de SP, que em UTC já é o dia seguinte;
   - os limites do Flow JSON.

8. **Ajustes da revisão (revisor):**
   - o endpoint recusa com 432 quando falta o `WHATSAPP_APP_SECRET`;
   - `flow_book` não reserva se o candidato mandou um texto há menos de 20 s: a conversa decide, para não sair
     reserva e confirmação em dobro;
   - erro do RPC que não for `horario_indisponivel` fecha o formulário;
   - `posReserva` avisa a equipe mesmo se a confirmação ao candidato falhar (o dono recebe o alerta);
   - "Nenhum serve" limpa o `pending_request`;
   - o título da vaga é cortado em 80 caracteres;
   - a chave privada com erro não fica guardada em cache.

**Enquanto `wa_flow_agendamento.ativo` não for ligado, nada muda para o candidato.** Sem a configuração,
`ofereceFlow` sai sem fazer nada.

## Falta (precisa do dono: segredo, Meta e teste com número real)

Nada disso foi feito ainda: o segredo não foi criado, nenhuma função foi publicada e nada foi configurado na
Meta.

1. Gerar as chaves fora do repo e criar o segredo:
   - `node scripts/whatsapp-flow/gerar-chaves.mjs C:/temp/flow-chaves`
   - `npx supabase secrets set --project-ref mdghhjemzdmeuqpzuyzx WHATSAPP_FLOW_PRIVATE_KEY="$(cat C:/temp/flow-chaves/privada.pem)"`
   - apagar a pasta;
   - conferir que `WHATSAPP_APP_SECRET` existe (`npx supabase secrets list`). Sem ele o endpoint responde 432 a tudo.
2. Publicar, um comando por grupo (todas são `verify_jwt: false`; conferir antes com `list_edge_functions`):
   - `npx supabase functions deploy whatsapp-flow hiring-scheduler whatsapp-cloud --no-verify-jwt --project-ref mdghhjemzdmeuqpzuyzx`;
   - depois, `curl` em cada uma para confirmar que não volta BOOT_ERROR.
3. Ações admin, nesta ordem (POST em `/functions/v1/whatsapp-flow` com `x-internal-key`):
   - `chave_publica`;
   - `criar`;
   - `status` (abrir o `preview_url`);
   - `testar { session_id, to }` em modo draft, com uma sessão da vaga de teste e o celular do dono.
4. Se a Meta reclamar de "app não conectado", ligar o app ao Flow no Flow Builder do WhatsApp Manager.
5. Testar o caminho inteiro:
   - escolher um horário → reserva + confirmação + aviso à equipe;
   - escolher um horário que outra pessoa pegou → aviso + lista nova;
   - "Nenhum serve" → mensagem na conversa;
   - abrir de novo depois de marcado → fecha com "já está marcada".
6. Ligar só para o número de teste: `ligar { ativo: true, numeros: ['55…'], modo: 'draft' }`. Depois,
   `publicar` e `ligar { ativo: true, numeros: [], modo: 'published' }`.
7. Registrar o aprendizado em `AI_SYSTEM_MAP.md` › Histórico.


## Fontes

- Exemplo oficial da Meta (criptografia, servidor, agendamento): https://github.com/WhatsApp/WhatsApp-Flows-Tools/tree/main/examples/endpoint/nodejs
- Referência técnica do Flow JSON (componentes, limites, pegadinhas): https://github.com/gokapso/agent-skills/blob/master/skills/integrate-whatsapp/references/whatsapp-flows-spec.md
- Guia do endpoint (Meta): https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint
- Flows API (Meta): https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi
- Visão geral de 2026 (versões 7.3 e Data API 4.0): https://www.infiq.in/blog/whatsapp-flows-guide
