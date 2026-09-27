# App Android "ERPOS Entregas" (Capacitor) — só para motoboys

Separado do app ERPOS de propósito (decisão do dono, 2026-09-27): o motoboy não vê o resto do sistema e o app só
pede **localização + notificação** (o app ERPOS não pede localização). Pasta própria, fora do build da Vercel.

- Abre **https://erpos.vercel.app/app-entregas** (`capacitor.config.json › server.url`) — tela
  `src/pages/app-entregas/page.tsx`: nome + celular (uma vez) e as **lojas ligadas por código**. Tocar numa loja abre o
  portal de sempre (`/entregas/<slug>`) com a sessão gravada; o portal mostra "Minhas lojas" para trocar.
- **Código:** a loja gera em Config. do Delivery › Entregadores › "Código para o app" (8 letras/números, uso único,
  24 h — `delivery-write › gerar_codigo_motoboy`, tabela `delivery_driver_codes`). O motoboy digita em "Adicionar
  loja" → `motoboy-signal › vincular_codigo` acha/cria o entregador pelo celular naquela loja. Um código por loja.
- **GPS com a tela apagada:** plugin `@capacitor-community/background-geolocation` (serviço em primeiro plano com o aviso
  fixo "ERPOS — entrega em andamento"). O site usa o plugin quando `window.Capacitor.isNativePlatform()`
  (`src/pages/motoboy/useMotoboyGps.ts`); mesmas regras (só com entrega ativa ou turno ligado; ≥ 15 s e ≥ 30 m).
- Pacote `app.erpos.entregas`, ícone = o do ERPOS com fundo escuro (`res/values/ic_launcher_background.xml`).
  `MainActivity`/`ErposWebView` = as do app ERPOS sem o microfone (voltar do Android, teclado).
- Cada push no `main` já aparece no app. APK novo só quando mudar a parte nativa.

## Gerar o APK (PowerShell)

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; $env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android-entregas; npm install; npx cap sync android; cd android; .\gradlew.bat assembleDebug
# → android\app\build\outputs\apk\debug\app-debug.apk
```

## Teste no celular
Instalar o APK → nome e celular → pedir um código à loja e digitar em "Adicionar loja" → ligar o turno (ou pegar uma
entrega) → aceitar localização e notificações → apagar a tela e andar: a moto continua andando no Mapa do Gestor.
Economia de bateria (Xiaomi, Samsung) pode matar o serviço: "Bateria › Sem restrição" para o ERPOS Entregas.
