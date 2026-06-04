/**
 * Retorna a URL base pública do app.
 *
 * Prioridade:
 * 1. __READDY_AI_DOMAIN__ injetado pelo Vite (URL pública real do Readdy — sem prefixo de preview)
 * 2. VITE_PUBLIC_APP_URL do .env
 * 3. window.location.origin (fallback — pode ser URL de preview)
 */
export function getAppBaseUrl(): string {
  try {
    const readdyDomain = typeof __READDY_AI_DOMAIN__ !== 'undefined' ? __READDY_AI_DOMAIN__ : '';
    if (readdyDomain && readdyDomain.startsWith('http')) {
      return readdyDomain.replace(/\/$/, '');
    }
  } catch {
    // ignore
  }

  const envUrl = (import.meta.env.VITE_APP_URL as string | undefined)
    || (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined);
  if (envUrl && envUrl.startsWith('http')) {
    return envUrl.replace(/\/$/, '');
  }

  return window.location.origin;
}

/**
 * Retorna se o __READDY_AI_DOMAIN__ está disponível e válido.
 * Quando disponível, é a URL pública real do app (sem /preview/xxx).
 */
function hasPublicDomain(): boolean {
  try {
    const d = typeof __READDY_AI_DOMAIN__ !== 'undefined' ? __READDY_AI_DOMAIN__ : '';
    return !!(d && d.startsWith('http'));
  } catch {
    return false;
  }
}

/**
 * Retorna a URL completa de uma rota do app (para navegação interna).
 * Inclui o __BASE_PATH__ (ex: /preview/xxx) quando necessário.
 */
export function getAppUrl(path: string): string {
  const base = getAppBaseUrl();
  const basePath = typeof __BASE_PATH__ !== 'undefined' ? __BASE_PATH__ : '';
  const cleanBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanBase}${cleanPath}`;
}

/**
 * Retorna a URL pública de uma rota para compartilhar com usuários externos.
 *
 * Quando __READDY_AI_DOMAIN__ está disponível, usa ele DIRETO sem o __BASE_PATH__
 * (que pode conter /preview/xxx que exige autenticação).
 *
 * Quando não está disponível, usa o mesmo comportamento de getAppUrl.
 */
export function getPublicUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (hasPublicDomain()) {
    // Usa o domínio público diretamente, sem o prefixo /preview/
    const base = getAppBaseUrl();
    return `${base}${cleanPath}`;
  }

  // Fallback: mesma URL que a interna (pode não funcionar fora do preview)
  return getAppUrl(path);
}

/**
 * Retorna a URL de convite de onboarding para um código específico.
 * Usa getPublicUrl para garantir que funcione para usuários externos.
 */
export function getInviteUrl(code: string): string {
  return getPublicUrl(`/onboarding?invite=${code}`);
}

/**
 * Retorna a URL pública do onboarding (sem código de convite).
 */
export function getOnboardingUrl(): string {
  return getPublicUrl('/onboarding');
}