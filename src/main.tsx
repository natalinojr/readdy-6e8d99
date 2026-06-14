import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)