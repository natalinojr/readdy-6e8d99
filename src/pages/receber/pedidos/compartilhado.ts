// "Compartilhar → ERPOS" com link de loja online (2026-09-28): o service worker (public/sw.js ›
// receberCompartilhado) guarda o que veio no cache 'erpos-compartilhado' e abre
// /receber?pedido=compra_online&compartilhado=1. O cache fica até a compra ser pedida, para o
// "Não é compra? Criar tarefa" das Tarefas (CompartilhadoParaTarefa) ainda achar o conteúdo.
const SHARE_CACHE = 'erpos-compartilhado';

export async function lerTextoCompartilhado(): Promise<string | null> {
  try {
    if (!('caches' in window)) return null;
    const r = await (await caches.open(SHARE_CACHE)).match('/__compartilhado/meta');
    if (!r) return null;
    const m = (await r.json()) as { title?: string; text?: string; url?: string };
    const partes = [m.title, m.text, m.url].map((s) => (s ?? '').trim()).filter(Boolean);
    // O app manda às vezes o link em `url` e de novo dentro de `text`: não repete
    return partes.filter((s, i) => partes.indexOf(s) === i && !partes.some((o, j) => j !== i && o.includes(s) && o.length > s.length)).join(' ') || null;
  } catch {
    return null;
  }
}

export async function limparCompartilhado(): Promise<void> {
  try { await caches.delete(SHARE_CACHE); } catch { /* sem Cache API */ }
}
