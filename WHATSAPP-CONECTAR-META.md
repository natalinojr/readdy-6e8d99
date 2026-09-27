# Conectar WhatsApp pela Meta (Tech Provider) — o que falta fazer

Criado em 2026-09-27. O código do botão **"Conectar pela Meta"** (Delivery › Atendimento WhatsApp › Número
próprio) já está pronto e publicado, **escondido**: ele aparece sozinho quando os três segredos `META_ES_*`
existirem no Supabase. Até lá, as lojas usam o **chip novo** (número na conta do ERPOS), que já funciona.

Com o botão, cada cliente do ERPOS conecta o WhatsApp da própria empresa numa janela da Meta: a conta, a
cobrança e o nome ficam com ele, e dá até para manter o número no app WhatsApp Business do celular
(coexistência). Para a Meta liberar isso para o ERPOS, o ERPOS precisa ser **Tech Provider**.

## O que o dono faz na Meta (uma vez)

Use o **mesmo app da Meta que já recebe o webhook do WhatsApp** (o do segredo `WHATSAPP_APP_SECRET`): os
eventos das contas dos clientes chegam no webhook desse app, assinados com o segredo dele.

1. **Verificar a empresa** no Gerenciador de Negócios (Configurações do negócio › Central de segurança ›
   Verificação): CNPJ, endereço, site. O site tem que estar no ar, com HTTPS, dizendo o que o ERPOS faz.
2. **Política de privacidade e termos**: URLs públicas no app (Configurações › Básico).
3. **Virar Tech Provider**: no painel do app, WhatsApp › "Tornar-se um provedor de tecnologia" (ou
   developers.facebook.com › seu app › WhatsApp › Configuração) e seguir a verificação de acesso.
4. **Revisão do app** pedindo acesso avançado a `whatsapp_business_management` e
   `whatsapp_business_messaging` (e `business_management` se a Meta pedir). A Meta pede um vídeo mostrando o
   fluxo — gravar a tela da aba Atendimento WhatsApp conectando uma loja de teste.
5. **Facebook Login para Empresas › Configurações › Criar configuração** do tipo *WhatsApp Embedded Signup*
   (ativos: conta do WhatsApp; permissões: as duas acima). Ela gera o **ID da configuração**.
6. **Domínios**: em Facebook Login / SDK do JavaScript, liberar `erpos.vercel.app` (domínios permitidos e
   URI de redirecionamento).
7. **Webhook do app** (WhatsApp › Configuração): além de `messages`, assinar os campos
   `smb_message_echoes`, `history` e `smb_app_state_sync` (obrigatórios para a coexistência).

## O que o Claude faz quando a Meta aprovar

```bash
npx supabase secrets set --project-ref mdghhjemzdmeuqpzuyzx META_ES_APP_ID=<id do app> META_ES_APP_SECRET=<chave secreta do app> META_ES_CONFIG_ID=<id da configuração>
```

O botão aparece na hora (a edge `atendimento-loja › info` devolve `conectar`). Depois: conectar a loja
"Testes PDV" com um número de teste e conferir mensagem chegando e saindo.

## Como funciona por dentro

- Front: `src/pages/config-delivery/NumeroProprio.tsx` abre a janela (SDK do Facebook, `FB.login` com o
  `config_id`, `response_type: 'code'`); os ids do número e da conta chegam por `postMessage`
  (`WA_EMBEDDED_SIGNUP`, evento `FINISH` ou `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` na coexistência).
- Edge `atendimento-loja › conectar_meta`: troca o código (vale **30 s**) pelo token da empresa do cliente,
  confere que o número pertence à conta com esse token, assina o webhook na conta dele, registra o número
  (menos na coexistência, que já vem registrado) e guarda o token em `wa_loja_credenciais` (só o servidor lê).
- Envio e mídia daquele número usam o token do cliente (`WaConfig.token` em `_shared/wa.ts`).
- Coexistência: a equipe respondendo pelo app do celular chega como `smb_message_echoes` → o assistente pausa
  2 h naquela conversa (`whatsapp-cloud › ecoDoApp`).

Fontes: [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/),
[Coexistência](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/),
[Registro de números](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration/).
