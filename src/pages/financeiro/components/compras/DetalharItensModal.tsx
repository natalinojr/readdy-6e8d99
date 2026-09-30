// Detalhar itens de uma compra já lançada (2026-09-29) — Financeiro › Compras › detalhe.
// Compra lançada pelo extrato (1 item "Compra") ou paga/recebida, que o "Editar" recusa: aqui só os
// ITENS mudam — à mão ou pela nota (QR, foto, arquivo). A soma tem que fechar com o valor da compra,
// então contas, pagamento e caixa não mudam. Edge purchase-write › replace_items (acerta o estoque
// se a compra já tinha entrado).
import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { avisar } from '@/components/base/Dialogos';
import type { Purchase, PurchaseItem } from '@/types/financeiro';
import LerNotaBotoes from './LerNotaBotoes';
import { useInsumos, numBR, numBRqtd, fatorDaLinha, InsumoDoItem, freteDasLinhas } from '../conciliacao/LancarDoExtrato';
import { linhasParaValor, aprenderVinculos, type ScanResult } from '@/lib/leituraNotinha';

// fator = quanto 1 unidade comprada vale na unidade do insumo, quando digitado (null = sugerido / o da linha original)
type Linha = { key: number; descricao: string; qtd: string; unidade: string; total: string; insumoId: string; raw?: string; orig?: PurchaseItem; fator?: string | null };
const fmtQtd = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const fmtBRL = (n: number) => n.toFixed(2).replace('.', ',');

interface Props {
  purchase: Purchase & { stock_applied_at?: string | null };
  onClose: () => void;
  onSaved: () => void;
}

export default function DetalharItensModal({ purchase, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { insumos, insumoOptions, adicionarInsumo } = useInsumos(true);
  const frete = Math.round(Number(purchase.freight_amount ?? 0) * 100) / 100;
  const alvo = Math.round((Number(purchase.total_amount) - frete) * 100) / 100;
  const [linhas, setLinhas] = useState<Linha[]>(() => (purchase.items ?? []).map((it, i) => ({
    key: i + 1, descricao: it.description ?? '', qtd: fmtQtd(Number(it.quantity) || 1), unidade: it.unit_label ?? 'un',
    total: fmtBRL(Number(it.total_price) || 0), insumoId: it.ingredient_id ?? '', orig: it,
    fator: it.ingredient_id && Number(it.units_per_package) > 0 ? String(Math.round(Number(it.units_per_package) * 1e6) / 1e6).replace('.', ',') : null,
  })));
  const [lida, setLida] = useState<ScanResult | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const soma = useMemo(() => Math.round(linhas.reduce((s, l) => s + (numBR(l.total) || 0), 0) * 100) / 100, [linhas]);
  const falta = Math.round((alvo - soma) * 100) / 100;
  // Frete da compra + linha de frete nova: diluídos nos produtos (purchase-write › replace_items)
  const freteLinhas = freteDasLinhas(linhas, frete);
  const invalida = linhas.find((l) => !l.descricao.trim() || !(numBRqtd(l.qtd) > 0) || !(numBR(l.total) > 0));
  const semConversao = linhas.find((l) => l.insumoId && !(fatorDaLinha(l, insumos) > 0));
  const fecha = Math.abs(falta) < 0.005;
  const muda = (key: number, p: Partial<Linha>) => setLinhas((v) => v.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const aplicarNota = (r: ScanResult) => {
    const novas = linhasParaValor(r, alvo).map((l, i): Linha => ({
      key: Date.now() + i, descricao: l.descricao, qtd: fmtQtd(l.qtd), unidade: l.unidade,
      total: fmtBRL(l.total), insumoId: l.insumoId ?? '', raw: l.raw,
      fator: l.insumoId && l.fator ? String(Math.round(l.fator * 1e6) / 1e6).replace('.', ',') : null,
    }));
    // A nota substitui os itens: o item genérico ("Compra", "Pagamento…") sai
    setLinhas(novas);
    setLida(r);
  };

  const salvar = async () => {
    if (!user?.tenantId) return;
    if (invalida) { setErro('Todo item precisa de descrição, quantidade e valor.'); return; }
    if (semConversao) { setErro(`Diga quanto 1 ${semConversao.unidade.trim() || 'un'} de "${semConversao.descricao.trim() || 'item'}" vale na unidade do insumo.`); return; }
    if (!fecha) { setErro(`Os itens somam ${formatCurrency(soma)} e precisam fechar ${formatCurrency(alvo)}.`); return; }
    setSalvando(true);
    setErro(null);
    const items = linhas.map((l) => {
      const qtd = numBRqtd(l.qtd);
      const total = Math.round(numBR(l.total) * 100) / 100;
      const o = l.orig as (PurchaseItem & { dre_category_id?: string | null }) | undefined;
      // Linha que já existia mantém embalagem, categoria e códigos; mudou insumo, unidade ou conversão →
      // vale o fator da tela (units_per_package; pack_count sairia na frente dele no purchase-write)
      const fator = l.insumoId ? fatorDaLinha(l, insumos) : NaN;
      const mesmaConversao = !!o && (o.ingredient_id ?? '') === l.insumoId && (o.unit_label ?? 'un') === (l.unidade.trim() || 'un')
        && Math.abs(fator - Number(o.units_per_package)) < 1e-9;
      return {
        description: l.descricao.trim(), quantity: qtd, unit_price: total / qtd, unit_label: l.unidade.trim() || 'un',
        ingredient_id: l.insumoId || null,
        ...(o ? {
          merchandise_category_id: o.merchandise_category_id ?? null, dre_category_id: o.dre_category_id ?? null,
          supplier_code: o.supplier_code ?? null, ean: o.ean ?? null, cost_center_id: o.cost_center_id ?? null, notes: o.notes ?? null,
        } : {}),
        ...(mesmaConversao
          ? { units_per_package: o!.units_per_package, pack_count: o!.pack_count, pack_size: o!.pack_size }
          : fator > 0 ? { units_per_package: fator } : {}),
      };
    });
    const r = await invokeWithAuth<{ data?: unknown; error?: string; avisos_conversao?: string[] }>('purchase-write', {
      body: { action: 'replace_items', tenant_id: user.tenantId, payload: { purchase_id: purchase.id, items, invoice_number: lida?.invoice_number ?? null } },
    });
    setSalvando(false);
    const msg = r.data?.error ?? r.error?.message;
    if (msg) { setErro(msg); return; }
    if (lida) {
      aprenderVinculos(user.tenantId, lida.supplier_key, linhas.filter((l) => l.raw).map((l) => ({
        raw_description: l.raw!, ingredient_id: l.insumoId || null, unit_label: l.unidade.trim() || null,
        ...(l.insumoId && fatorDaLinha(l, insumos) > 0 ? { pack_count: 1, pack_size: fatorDaLinha(l, insumos) } : {}),
      })));
    }
    // Item ligado pela pessoa vira vínculo confirmado: a próxima nota do mesmo fornecedor já vem ligada
    if (linhas.some((l) => l.insumoId)) {
      await supabase.rpc('fn_item_confirm_links_from_purchase', { p_tenant: user.tenantId, p_purchase: purchase.id });
    }
    if (r.data?.avisos_conversao?.length) await avisar(r.data.avisos_conversao.join(' '), { titulo: 'Itens salvos' });
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-2" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-zinc-800">Detalhar itens</h3>
            <p className="text-xs text-zinc-500 truncate">{purchase.supplier} · {formatCurrency(Number(purchase.total_amount))}{frete ? ` (frete ${formatCurrency(frete)})` : ''}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer" aria-label="Fechar"><i className="ri-close-line" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <p className="text-xs text-zinc-500">
            Diga o que veio nesta compra, à mão ou pela nota. O valor da compra não muda (contas e pagamento ficam como estão);
            {purchase.stock_applied_at ? ' como ela já entrou no estoque, o estoque é acertado com os itens novos.' : ' os itens ligados a insumo entram no estoque quando o recebimento for confirmado.'}
          </p>
          <LerNotaBotoes onLido={aplicarNota} disabled={salvando} />
          {lida && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 px-2.5 py-2 text-xs text-violet-900 space-y-0.5">
              <p>{lida.source === 'qrcode' ? 'SEFAZ · QR Code' : 'Leitura por IA'} · {lida.supplier_name ?? 'Nota'}{lida.invoice_number ? ' · nº ' + lida.invoice_number : ''}{lida.document_total != null ? ' · total ' + formatCurrency(lida.document_total) : ''}</p>
              {lida.document_total != null && Math.abs(lida.document_total - Number(purchase.total_amount)) >= 0.01 && (
                <p className="text-amber-700">O total da nota é diferente do valor da compra: ajuste os itens até fechar.</p>
              )}
              {lida.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
            </div>
          )}

          {linhas.map((l) => {
            const ins = insumos.find((x) => x.id === l.insumoId);
            const FR = freteLinhas;
            return (
              <div key={l.key} className="border border-zinc-200 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input value={l.descricao} onChange={(e) => muda(l.key, { descricao: e.target.value })} placeholder="Item (ex.: Gelo 5 kg)"
                    className="flex-1 min-w-0 px-2 py-1.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                  <button type="button" onClick={() => setLinhas((v) => v.filter((x) => x.key !== l.key))} aria-label="Tirar item"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                    <i className="ri-delete-bin-line" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="text-[11px] text-zinc-500">Qtd
                    <input value={l.qtd} onChange={(e) => muda(l.key, { qtd: e.target.value })} inputMode="decimal" className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-zinc-800" />
                  </label>
                  <label className="text-[11px] text-zinc-500">Unidade
                    <input value={l.unidade} onChange={(e) => muda(l.key, { unidade: e.target.value, fator: null })} maxLength={20} className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-zinc-800" />
                  </label>
                  <label className="text-[11px] text-zinc-500">Valor total (R$)
                    <input value={l.total} onChange={(e) => muda(l.key, { total: e.target.value })} inputMode="decimal" placeholder="0,00" className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-zinc-800" />
                  </label>
                </div>
                {FR.ehFrete(l) ? <p className="text-[11px] rounded-lg bg-sky-50 text-sky-800 px-2 py-1.5"><i className="ri-truck-line mr-1" />Frete de {formatCurrency(FR.frete)}: diluído nos outros itens pelo valor de cada um — entra no custo de cada insumo, não fica como item.</p> : (
                  <InsumoDoItem linha={l} insumos={insumos} insumoOptions={insumoOptions} onAdicionado={adicionarInsumo}
                    onChange={(patch) => muda(l.key, patch)} frete={FR.parte(l)} />
                )}
                {!l.insumoId && FR.parte(l) > 0 && <p className="text-[11px] text-sky-700">+ {formatCurrency(FR.parte(l))} de frete no custo deste item</p>}
              </div>
            );
          })}
          <button type="button" onClick={() => setLinhas((v) => [...v, { key: Date.now(), descricao: '', qtd: '1', unidade: 'un', total: falta > 0 ? fmtBRL(falta) : '', insumoId: '' }])}
            className="w-full py-2 rounded-lg border border-dashed border-violet-300 text-violet-700 text-sm font-semibold cursor-pointer hover:bg-violet-50">
            <i className="ri-add-line" /> Adicionar item
          </button>
        </div>

        <div className="px-4 py-3 border-t border-zinc-100 space-y-2">
          <p className={`text-xs font-semibold ${fecha ? 'text-emerald-700' : 'text-red-600'}`}>
            Itens: {formatCurrency(soma)} de {formatCurrency(alvo)}{frete ? ' (sem o frete)' : ''}
            {fecha ? ' ✓ fechou' : falta > 0 ? ` · faltam ${formatCurrency(falta)}` : ` · passou ${formatCurrency(-falta)}`}
          </p>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 rounded-lg cursor-pointer">Cancelar</button>
            <button onClick={salvar} disabled={salvando || !fecha || !!invalida || linhas.length === 0}
              className="px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              {salvando ? 'Salvando…' : 'Salvar itens'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
