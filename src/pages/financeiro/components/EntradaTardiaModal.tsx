import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

// Recebimentos de um item que ficaram fora do estoque (item recebido sem insumo ligado).
// O usuário escolhe quais entram agora e quais não entram; nada vem marcado.
// Regras no banco: fn_item_unstocked_receipts / fn_item_stock_late_entry (2026-09-24).

interface Recebimento {
  purchase_item_id: string;
  supplier: string | null;
  invoice_number: string | null;
  received_at: string;
  purchase_date: string | null;
  unit_label: string | null;
  quantidade: number;
  valor: number;
  inventario_depois: boolean;
  inventario_em: string | null;
}

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Props {
  tenantId: string;
  item: { id: string; description: string; unit_label: string | null };
  insumo: { name: string; unit: string } | null;
  upp: number;
  onFechar: () => void;
  onFeito: () => void;
}

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const un = (u: string | null | undefined) => (!u || u === 'unit' ? 'un' : u);

export default function EntradaTardiaModal({ tenantId, item, insumo, upp, onFechar, onFeito }: Props) {
  const { success: toastOk, error: toastErr } = useToast();
  const [lista, setLista] = useState<Recebimento[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    supabase.rpc('fn_item_unstocked_receipts', { p_tenant: tenantId, p_id: item.id }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { toastErr('Não foi possível carregar os recebimentos', error.message); setLista([]); return; }
      setLista((data ?? []) as Recebimento[]);
    });
    return () => { vivo = false; };
  }, [tenantId, item.id, toastErr]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const marcados = (lista ?? []).filter((r) => sel.has(r.purchase_item_id));
  const totalEntrada = marcados.reduce((s, r) => s + Number(r.quantidade) * upp, 0);

  const aplicar = async (modo: 'entrar' | 'ignorar') => {
    if (marcados.length === 0) return;
    const ids = marcados.map((r) => r.purchase_item_id);
    setBusy(true);
    const { data, error } = await supabase.rpc('fn_item_stock_late_entry', {
      p_tenant: tenantId, p_id: item.id,
      p_entrar: modo === 'entrar' ? ids : [], p_ignorar: modo === 'ignorar' ? ids : [],
    });
    setBusy(false);
    if (error) { toastErr('Não foi possível salvar', error.message); return; }
    const d = (data ?? {}) as { entraram?: number; ignorados?: number; quantidade?: number };
    if (modo === 'entrar') {
      toastOk(`${d.entraram ?? 0} recebimento(s) entraram no estoque`, insumo ? `+${num(Number(d.quantidade ?? 0))} ${un(insumo.unit)} em ${insumo.name}.` : '');
    } else {
      toastOk(`${d.ignorados ?? 0} recebimento(s) marcados como resolvidos`, 'O estoque não mudou.');
    }
    setSel(new Set());
    const restantes = (lista ?? []).filter((r) => !ids.includes(r.purchase_item_id));
    setLista(restantes);
    onFeito();
    if (restantes.length === 0) onFechar();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onFechar}>
      <div className="bg-white w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-100 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-zinc-800">Recebimentos que não entraram no estoque</p>
            <p className="text-xs text-zinc-500 mt-0.5 break-words">{item.description}</p>
            {insumo ? (
              <p className="text-xs text-emerald-700 mt-1"><i className="ri-links-line" /> {insumo.name} · 1 {item.unit_label || 'un'} = {num(upp)} {un(insumo.unit)}</p>
            ) : (
              <p className="text-xs text-amber-700 mt-1">Ligue o item a um insumo para poder dar entrada.</p>
            )}
          </div>
          <button onClick={onFechar} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <p className="px-4 pt-3 text-xs text-zinc-500">
          Esses recebimentos foram confirmados quando o item ainda não estava ligado a um insumo, e o estoque não mudou.
          Marque os que devem entrar agora. Se a mercadoria já foi usada ou se um inventário já acertou o estoque depois, marque e escolha <b>Não entram</b>.
        </p>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {lista === null ? (
            <p className="text-sm text-zinc-400 text-center py-6">Carregando…</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-6">Nenhum recebimento pendente para este item.</p>
          ) : lista.map((r) => (
            <label key={r.purchase_item_id}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${sel.has(r.purchase_item_id) ? 'border-amber-300 bg-amber-50/60' : 'border-zinc-200 hover:border-zinc-300'}`}>
              <input type="checkbox" className="mt-1" checked={sel.has(r.purchase_item_id)} onChange={() => toggle(r.purchase_item_id)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-800">
                  {r.invoice_number ? `NF ${r.invoice_number}` : 'Compra sem NF'}
                  {r.purchase_date && ` de ${new Date(r.purchase_date + 'T00:00:00').toLocaleDateString('pt-BR')}`}
                  <span className="text-zinc-500"> · {r.supplier ?? '—'}</span>
                </p>
                <p className="text-xs text-zinc-500">Recebimento confirmado em {dataHora(r.received_at)}</p>
                <p className="text-xs text-zinc-500">
                  {num(Number(r.quantidade))} {r.unit_label || 'un'} · {brl(Number(r.valor))}
                  {insumo ? ` → +${num(Number(r.quantidade) * upp)} ${un(insumo.unit)} no estoque` : ''}
                </p>
                {r.inventario_depois && (
                  <p className="text-[11px] text-orange-700 mt-1">
                    <i className="ri-error-warning-line" /> Teve contagem deste insumo depois{r.inventario_em ? ` (${dataHora(r.inventario_em)})` : ''}: o estoque já foi acertado. Dar entrada agora conta em dobro.
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-100 flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500 mr-auto">
            {marcados.length === 0 ? 'Nenhum marcado' : `${marcados.length} marcado(s)${insumo ? ` · +${num(totalEntrada)} ${un(insumo.unit)}` : ''}`}
          </span>
          <button disabled={busy || marcados.length === 0} onClick={() => aplicar('ignorar')}
            className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 cursor-pointer">
            Não entram
          </button>
          <button disabled={busy || marcados.length === 0 || !insumo} onClick={() => aplicar('entrar')}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
            Dar entrada no estoque
          </button>
        </div>
      </div>
    </div>
  );
}
