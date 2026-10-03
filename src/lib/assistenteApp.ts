// Chamada à Edge `assistente-app` (só o dono: o servidor confere o e-mail e o dono do assistente).
// Morava dentro do AssistenteChat; saiu para cá (2026-10-03) para a tela Hoje usar os mesmos cartões
// que resolvem ali mesmo (classificar itens, DRE das contas) sem puxar o módulo inteiro do chat.
import { supabase } from '@/lib/supabase';

export async function chamarAssistente<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('assistente-app', { body: { action, ...extra } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: T } | null;
  if (!resp?.success) throw new Error(resp?.error || 'Falha na operação');
  return resp.data as T;
}
