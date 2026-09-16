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

Para ligar (o dono):
1. https://console.firebase.google.com › Adicionar projeto (pode desligar o Analytics).
2. Adicionar app **Android** com o pacote **`app.erpos.gestao`** › baixar o `google-services.json`
   e colocar em `android-app/android/app/`.
3. Configurações do projeto › **Contas de serviço** › Gerar nova chave privada (JSON) e salvar o
   conteúdo no secret `FIREBASE_SERVICE_ACCOUNT` do Supabase
   (`npx supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat chave.json)" --project-ref mdghhjemzdmeuqpzuyzx`).
4. Gerar o APK de novo (`npm run apk`) e instalar por cima.

## Pendente

- Firebase (acima) — só o dono consegue criar.
- Publicar na Play Store: conta de desenvolvedor (US$ 25, uma vez) + chave de assinatura (release).
