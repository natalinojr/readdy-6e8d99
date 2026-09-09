import { CSOSN_OPTIONS, CFOP_OPTIONS, ORIGEM_OPTIONS, NCM_SUGESTOES } from '@/lib/fiscal';

/**
 * Campos de classificação fiscal (NFC-e) reutilizados no item e na categoria do cardápio.
 * Tudo opcional: vazio = herda do nível acima (item → categoria → padrão da loja).
 */
export interface FiscalFieldsValue {
  ncm?: string | null;
  cest?: string | null;
  cfop?: number | null;
  csosn?: string | null;
  origem?: number | null;
  codTributacao?: string | null;
  gtin?: string | null;
}

interface Props {
  value: FiscalFieldsValue;
  onChange: (v: FiscalFieldsValue) => void;
  /** 'item' mostra origem e GTIN; 'categoria' esconde. */
  scope: 'item' | 'categoria';
  heranca?: string; // texto explicando de onde herda quando vazio
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors';

export default function FiscalFields({ value, onChange, scope, heranca }: Props) {
  const set = (k: keyof FiscalFieldsValue, v: string | number | null) => onChange({ ...value, [k]: v === '' ? null : v });
  const ncmDigits = (value.ncm ?? '').replace(/\D/g, '');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg p-3">
        <i className="ri-information-line text-amber-500 text-sm mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-800">
          Deixe em branco para herdar {heranca ?? (scope === 'item' ? 'da categoria e, depois, do padrão da loja' : 'do padrão da loja (Configurações › Fiscal)')}.
          Peça ao contador a lista de NCM por tipo de produto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">NCM (8 dígitos)</label>
          <input
            className={inputCls}
            list="ncm-sugestoes"
            placeholder="Ex: 21069090"
            value={value.ncm ?? ''}
            onChange={e => set('ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
          <datalist id="ncm-sugestoes">
            {NCM_SUGESTOES.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
          </datalist>
          {ncmDigits && ncmDigits.length !== 8 && (
            <p className="text-[10px] text-red-500 mt-1">NCM precisa ter 8 dígitos</p>
          )}
          {ncmDigits.length === 8 && (
            <p className="text-[10px] text-gray-400 mt-1">
              {NCM_SUGESTOES.find(n => n.value === ncmDigits)?.label ?? 'NCM informado'}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">CFOP</label>
          <select className={`${inputCls} cursor-pointer`} value={value.cfop ?? ''} onChange={e => set('cfop', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Herdar</option>
            {CFOP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">CSOSN / CST ICMS</label>
          <select className={`${inputCls} cursor-pointer`} value={value.csosn ?? ''} onChange={e => set('csosn', e.target.value || null)}>
            <option value="">Herdar</option>
            {CSOSN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">CEST <span className="text-gray-400 font-normal">(só com ST: bebidas, cigarros)</span></label>
          <input className={inputCls} placeholder="Ex: 0300700" value={value.cest ?? ''} onChange={e => set('cest', e.target.value.replace(/\D/g, '').slice(0, 7))} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Grupo tributário (Brasil NFe)</label>
          <input className={inputCls} placeholder="Código do painel, se usar" value={value.codTributacao ?? ''} onChange={e => set('codTributacao', e.target.value.trim() || null)} />
          <p className="text-[10px] text-gray-400 mt-1">Se preenchido, o provedor aplica CFOP/CST/impostos sozinho.</p>
        </div>

        {scope === 'item' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Origem da mercadoria</label>
              <select className={`${inputCls} cursor-pointer`} value={value.origem ?? ''} onChange={e => set('origem', e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">Herdar (nacional)</option>
                {ORIGEM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">GTIN / código de barras <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input className={inputCls} placeholder="Ex: 7891234567890" value={value.gtin ?? ''} onChange={e => set('gtin', e.target.value.replace(/\D/g, '').slice(0, 14) || null)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
