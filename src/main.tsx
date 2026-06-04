import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'

// ── Rede de segurança: captura erros de refresh token do Supabase que
//    escapem do try-catch interno (geralmente do autoRefreshToken). ──
function handleInvalidRefreshToken(reason: unknown) {
  const msg = (reason as Error | undefined)?.message ?? ''
  if (
    msg.includes('Invalid Refresh Token') ||
    msg.includes('Refresh Token Not Found') ||
    msg.includes('Refresh Token Already Used') ||
    msg.includes('JWT expired')
  ) {
    console.warn('[Auth] Refresh token inválido detectado — limpando sessão e redirecionando para login')
    supabase.auth.signOut().catch(() => {
      // Se signOut() falhar, ainda assim limpa o localStorage manualmente
    }).finally(() => {
      window.localStorage.removeItem('supabase.auth.token')
      window.localStorage.removeItem('sb-localhost-auth-token') // dev
      window.localStorage.removeItem('sb-127.0.0.1-auth-token') // dev
      window.location.href = '/login'
    })
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