// Link para o cliente do iFood acompanhar o pedido (2026-10-06). A loja copia e cola no chat do iFood.
// O código vem do banco (fn_ifood_link_cliente: aleatório, só quem é da loja gera, o mesmo a cada clique);
// a página pública é /p/<código> (src/pages/acompanhar). Dados públicos: motoboy-signal › pedido_link.
import { supabase } from '@/lib/supabase';

export const TEXTO_LINK_CLIENTE = 'Acompanhe seu pedido:';

export function urlLinkCliente(codigo: string): string {
  return `${window.location.origin}/p/${codigo}`;
}

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Navegador sem permissão de área de transferência: cópia à moda antiga.
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Gera (ou reaproveita) o link do pedido e copia "Acompanhe seu pedido: <link>". */
export async function copiarLinkCliente(ifoodOrderId: string): Promise<{ ok: true; texto: string } | { ok: false; erro: string; texto?: string }> {
  const { data, error } = await supabase.rpc('fn_ifood_link_cliente', { p_ifood_order_id: ifoodOrderId });
  if (error || !data) return { ok: false, erro: error?.message || 'Não deu para gerar o link.' };
  const texto = `${TEXTO_LINK_CLIENTE} ${urlLinkCliente(String(data))}`;
  return (await copiarTexto(texto)) ? { ok: true, texto } : { ok: false, erro: 'Não deu para copiar. Copie o texto abaixo.', texto };
}
