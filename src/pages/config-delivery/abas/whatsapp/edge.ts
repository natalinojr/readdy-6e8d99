import { supabase } from '@/lib/supabase';
import { fetchPtBr } from '../../config';

// Chamada à Edge `atendimento-loja` com a sessão de quem está logado (a Edge confere se é o dono da loja).
// Função solta no módulo (identidade estável): o NumeroProprio a recebe por prop e a usa em efeitos.
// Falha de rede vira "Sem conexão com o servidor. Tente de novo." (nada de "Failed to fetch" cru na tela).

function urlDaEdge(): string {
  const base = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string) || '').replace(/\/$/, '');
  return base + '/functions/v1/atendimento-loja';
}

export async function chamarEdge(body: Record<string, unknown>): Promise<any> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const r = await fetchPtBr(urlDaEdge(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token ?? '') },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out?.success === false) throw new Error(out?.error || ('Erro ' + r.status));
  return out;
}
