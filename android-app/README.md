# App Android do ERPOS (Capacitor)

Pasta separada do site: tem `package.json` próprio e **não entra no build da Vercel**.

- O app abre **https://erpos.vercel.app** (`capacitor.config.json › server.url`). Cada push no `main`
  já aparece no app, sem gerar APK novo. APK novo só quando mudar a parte nativa (plugins, ícone,
  permissões).
- `www/index.html` é só a página de "sem conexão".
- Plugins: `send-intent` (o ERPOS aparece no **Compartilhar** do Android) e
  `@capgo/capacitor-native-biometric` (digital/rosto). O site chama os plugins por
  `window.Capacitor.Plugins.*`, sem importar nada no bundle da web.

## Gerar o APK de teste (neste PC)

Requisitos já instalados em 2026-09-15: Android Studio (JDK 21 em `...\Android Studio\jbr`), SDK 36.

```bash
cd android-app
npm install
npx cap add android   # só na primeira vez
npm run apk           # → android/app/build/outputs/apk/debug/app-debug.apk
```

Instalar no celular: copiar o `app-debug.apk` e abrir (permitir "instalar apps desconhecidos"),
ou `adb install -r` com o celular no cabo e depuração USB ligada.

## Digital no lugar do PIN (pronto)

No chat do assistente, ao tocar em **Pagar**: se o PIN já estiver guardado, a digital destrava e paga.
Na 1ª vez o PIN é digitado e (com "Usar a digital nas próximas vezes" marcado) fica no Keystore do
celular protegido pela biometria (`NativeBiometric.setCredentials`, `accessControl: BIOMETRY_ANY`).
O servidor continua conferindo o PIN. PIN trocado pelo `/pin` → o guardado é apagado e pede de novo.

## Notificação nativa (código pronto — falta o Firebase)

Dentro do app o Web Push do PWA não existe. Já está feito: plugin `@capacitor/push-notifications`,
botão "Ativar avisos" usando o token do Firebase (inscrito em `push_subscriptions` com
`endpoint = 'fcm:<token>'`), `send-push` enviando pela API HTTP v1 do FCM (`send-push/fcm.ts`),
canal Android "erpos" e toque na notificação abrindo a tela do aviso. O botão só aparece quando o
servidor tem o Firebase configurado (`send-push › fcm_status`).

**FEITO em 2026-09-15** (projeto criado pelo Chrome, com o dono logado):
- Projeto Firebase **ERPOS**, id **`erpos-7ef91`**, plano Spark (grátis), Google Analytics **desligado**
  e "Programa para desenvolvedores do Google" **desligado**.
- App Android **ERPOS Android**, pacote `app.erpos.gestao`, sem SHA-1 (FCM não precisa).
- `google-services.json` em `android-app/android/app/` — **vai para o repositório** (não está no
  `.gitignore`) e tudo bem: ele já viaja dentro do APK e só identifica o app. Segredo mesmo é a
  chave da conta de serviço, que fica só no secret do Supabase.
- Chave da conta de serviço `firebase-adminsdk-fbsvc@erpos-7ef91.iam.gserviceaccount.com` gravada no
  secret **`FIREBASE_SERVICE_ACCOUNT`** do Supabase. O JSON baixado continua em `~/Downloads` —
  **apague depois** (é a chave do servidor; quem tiver o arquivo manda notificação pelo seu projeto).

Se algum dia precisar refazer:
1. https://console.firebase.google.com › Adicionar projeto (pode desligar o Analytics).
2. Adicionar app **Android** com o pacote **`app.erpos.gestao`** › baixar o `google-services.json`
   e colocar em `android-app/android/app/`.
3. Configurações do projeto › **Contas de serviço** › Gerar nova chave privada (JSON) e salvar o
   conteúdo no secret `FIREBASE_SERVICE_ACCOUNT` do Supabase
   (`npx supabase secrets set --env-file <arquivo com FIREBASE_SERVICE_ACCOUNT={json numa linha}> --project-ref mdghhjemzdmeuqpzuyzx`).
4. Gerar o APK de novo (`npm run apk`) e instalar por cima.

## Pegadinhas já resolvidas (2026-09-15, 1º teste no celular do dono)

- **Conteúdo embaixo da barra de status / dos botões**: com `targetSdk 36` (Android 16) a tela cheia
  "edge-to-edge" é obrigatória e o site (que usa `viewport-fit=cover`) ficava por baixo das barras.
  Solução: `targetSdkVersion = 35` (`variables.gradle`) + `android:windowOptOutEdgeToEdgeEnforcement`
  no `AppTheme.NoActionBar` (`styles.xml`). `compileSdk` continua 36. Ao subir para o targetSdk 36 no
  futuro, o jeito passa a ser tratar `env(safe-area-inset-*)` no CSS do ERPOS.
- **Microfone não gravava**: `RECORD_AUDIO` é permissão "perigosa" — no manifesto não basta. A
  `MainActivity` agora pede a permissão no `onCreate` e libera o pedido do WebView
  (`onPermissionRequest`) quando o app já tem a permissão.
- **Compartilhar não chegava na conversa** (2 rodadas): o app abre na ÚLTIMA rota usada — muitas
  vezes `/modulos`, onde o `AssistenteChat` nem é montado —, então tratar o `send-intent` dentro do
  chat nunca ia funcionar. Agora quem recebe é **`src/lib/shareIntake.ts`**, chamado no `main.tsx`
  antes de qualquer tela: guarda o conteúdo em `sessionStorage` (`erpos_share_intent`) e manda o app
  para `/assistente`; o chat consome ao montar (ou pelo evento `erpos-share`, se já estiver aberto).
  Testes: `src/test/lib/shareIntake.test.ts` e `src/test/components/assistenteChat.test.tsx`.
- **Teclado "cru"**: a caixa de mensagem agora declara `lang=pt-BR`, `autoCapitalize`, `autoCorrect`,
  `spellCheck` e `inputMode=text` (o WebView sem isso abre o teclado sem sugestões nem maiúscula), e
  o app usa o plugin **`@capacitor/keyboard`** (`resize: native`) para a tela subir junto com o teclado.
- **Teclado abrindo o "editor em tela cheia"** (caixa "Mensagem — Fechar — OK" cobrindo o app, teclado
  Samsung): é o *extract UI* do Android, ligado quando o campo não declara o contrário. App nativo
  declara no próprio campo; no WebView foi preciso criar **`ErposWebView`** (subclasse de
  `CapacitorWebView`) que acrescenta `IME_FLAG_NO_EXTRACT_UI | IME_FLAG_NO_FULLSCREEN` em
  `onCreateInputConnection`, e sobrepor o layout da biblioteca com
  `res/layout/capacitor_bridge_layout_main.xml` (mesmo nome = o do app vence). `captureInput` do
  Capacitor **não** resolve isso (troca a conexão por uma de teclado físico).
  Ao atualizar o Capacitor: conferir se o layout original mudou.
  **Só as marcas não bastaram** (16/09, Galaxy S24): a Activity não declarava nada sobre o teclado,
  então o Android concluía que não havia espaço e abria o editor em tela cheia assim mesmo. Foi
  somado `android:windowSoftInputMode="adjustResize"` no manifesto **e** o mesmo em código
  (`MainActivity.onCreate`), porque alguns aparelhos ignoram só o manifesto.
  Conferir a versão instalada: Configurações › Apps › ERPOS › versão (`versionName` em
  `app/build.gradle`, subir a cada APK).
- **Áudio sem resposta**: o microfone e o Whisper funcionaram, mas o modelo respondeu `NO_REPLY` (o
  modo silencioso da triagem de grupo) e o chat mostrou nada. A `assistente-app` agora troca
  `NO_REPLY` por "Ok 👍" — no chat, conversa sempre responde.

## Pendente

- Firebase (acima) — só o dono consegue criar.
- Publicar na Play Store: conta de desenvolvedor (US$ 25, uma vez) + chave de assinatura (release).
