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
- **Compartilhar não chegava na conversa**: o app abre na última tela; em `/assistente` o chat é o
  embutido e o `send-intent` só era tratado no chat flutuante. Agora vale nos dois (teste em
  `src/test/components/assistenteChat.test.tsx`).

## Pendente

- Firebase (acima) — só o dono consegue criar.
- Publicar na Play Store: conta de desenvolvedor (US$ 25, uma vez) + chave de assinatura (release).
