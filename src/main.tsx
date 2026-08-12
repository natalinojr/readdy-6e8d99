import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'
import { registerServiceWorker } from './lib/pwa'

// ── Rede de segurança: captura erros de refresh token do Supabase que
//    escapem do try-catch interno. Ao invés de redirecionar bruscamente,
//    apenas limpa a sessão local e deixa o AuthContext redirecionar.
//    safeRefreshSession() e safeSignOut() já fazem a limpeza principal;
//    este handler é a última linha de defesa. ──
function handleInvalidRefreshToken(reason: unknown) {
  const msg = (reason as Error | undefined)?.message ?? ''
  if (
    msg.includes('Invalid Refresh Token') ||
    msg.includes('Refresh Token Not Found') ||
    msg.includes('Refresh Token Already Used') ||
    msg.includes('JWT expired')
  ) {
    console.warn('[Auth] Refresh token inválido detectado (unhandled) — limpando sessão local')
    // Somente limpa o localStorage, sem redirecionar — o AuthContext
    // vai detectar a ausência de sessão e exibir a tela de login.
    const keys = Object.keys(window.localStorage)
    for (const key of keys) {
      if (key.startsWith('sb-') || key.includes('supabase')) {
        window.localStorage.removeItem(key)
      }
    }
    return true
  }
  return false
}

window.addEventListener('unhandledrejection', (event) => {
  if (handleInvalidRefreshToken(event.reason)) {
    event.preventDefault()
  }
})

window.addEventListener('error', (event) => {
  if (handleInvalidRefreshToken(event.error)) {
    event.preventDefault()
  }
})

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

// ── Rede de segurança: "Failed to fetch dynamically imported module" ──
//    Cada push no main dispara um deploy (ver CLAUDE.md), trocando os
//    arquivos de cada tela (code-split por rota). Um PDV/tablet ligado o
//    turno inteiro (useWakeLock existe por isso) pode ter uma aba aberta
//    desde ANTES do deploy — ao navegar pra uma tela ainda não carregada
//    nela, o navegador busca o arquivo antigo, que já não existe (404), e
//    o Vite dispara `vite:preloadError` no window. Sem isso, a única saída
//    era o operador clicar manualmente em "Recarregar página" na tela de
//    erro — inaceitável num caixa em operação.
//    Guarda via sessionStorage: recarrega no máximo 1x por staleness. Se o
//    reload não resolver (erro persiste == problema real, não só staleness),
//    a 2ª falha NÃO recarrega de novo — sobe pro ErrorBoundary normal, sinal
//    de que precisa de atenção humana em vez de reload silencioso em loop.
const CHUNK_RELOAD_GUARD_KEY = 'erpos_chunk_reload_attempted'

window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)) return
  sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1')
  event.preventDefault()
  window.location.reload()
})

// Ficou de pé por alguns segundos sem novo preloadError — o reload (se
// houve) funcionou. Libera a guarda pra um deploy futuro poder recarregar
// de novo (senão essa aba só se recuperaria automaticamente 1x na vida).
setTimeout(() => {
  sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY)
}, 5000)

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

// ── Callback do login da Meta (popup) ──
// Se esta janela é um popup aberto pelo fluxo OAuth e voltou com ?code=,
// devolve o código pra janela principal e se fecha — sem renderizar o app
// (assim não passa pelo roteador, que redirecionaria pro /modulos).
const isMetaOAuthPopup = (() => {
  try {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const oauthError = params.get('error_description') || params.get('error')
    if (window.opener && window.opener !== window && (code || oauthError)) {
      window.opener.postMessage(
        { type: 'meta_oauth', code, state: params.get('state'), error: oauthError },
        window.location.origin,
      )
      window.close()
      return true
    }
  } catch {
    /* ignora — segue renderizando o app normalmente */
  }
  return false
})()

if (!isMetaOAuthPopup) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  // PWA: instalável na tela inicial do celular. Só registra em produção.
  registerServiceWorker()
}