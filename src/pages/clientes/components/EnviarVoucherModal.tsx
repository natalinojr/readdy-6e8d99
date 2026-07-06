// Modal "Enviar Voucher" do perfil do cliente (CRM).
// Cria um voucher vinculado ao cliente com link público de ativação
// (/voucher/:token) e abre o WhatsApp com a mensagem pronta.
import { useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import type { ClienteCRM } from '@/hooks/useClientes';
import type { Voucher } from '@/types/vouchers';

interface Props {
  cliente: ClienteCRM;
  onClose: () => void;
  onSent?: () => void;
}

type TipoOferta = 'discount_percent' | 'discount_fixed' | 'gift_card';

const TIPOS: { value: TipoOferta; label: string; icon: string; desc: string }[] = [
  { value: 'discount_percent', label: 'Desconto %', icon: 'ri-discount-percent-line', desc: 'Ex: 15% no pedido' },
  { value: 'discount_fixed', label: 'Desconto R$', icon: 'ri-money-dollar-circle-line', desc: 'Ex: R$ 20 de desconto' },
  { value: 'gift_card', label: 'Vale-presente', icon: 'ri-gift-line', desc: 'Crédito em R$ para gastar' },
];

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function maisDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDataBR(isoDate: string) {
  const [y, m, day] = isoDate.split('-');
  return `${day}/${m}/${y}`;
}

export default function EnviarVoucherModal({ cliente, onClose, onSent }: Props) {
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();

  const [tipo, setTipo] = useState<TipoOferta>('discount_percent');
  const [valor, setValor] = useState<string>('');
  const [inicio, setInicio] = useState<string>(hoje());
  const [fim, setFim] = useState<string>(maisDias(7));
  const [maxUsos, setMaxUsos] = useState<string>('1');
  const [pedidoMinimo, setPedidoMinimo] = useState<string>('');
  const [obs, setObs] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [voucherCriado, setVoucherCriado] = useState<Voucher | null>(null);
  const [linkCopiado, setLinkCopiado] = useState(false);
  // Mensagem editável: null = usa o texto padrão; string = texto que o operador ajustou.
  const [mensagemEditada, setMensagemEditada] = useState<string | null>(null);

  const primeiroNome = cliente.nome.split(' ')[0];

  const descricaoOferta = (() => {
    const v = Number(valor) || 0;
    if (tipo === 'discount_percent') return `${v}% de desconto`;
    if (tipo === 'discount_fixed') return `R$ ${v.toFixed(2).replace('.', ',')} de desconto`;
    return `vale-presente de R$ ${v.toFixed(2).replace('.', ',')}`;
  })();

  const link = voucherCriado?.claim_token
    ? `${window.location.origin}/voucher/${voucherCriado.claim_token}`
    : '';

  const minimoNum = Number(pedidoMinimo) || 0;
  const trechoMinimo = minimoNum > 0
    ? ` em pedidos a partir de R$ ${minimoNum.toFixed(2).replace('.', ',')}`
    : '';

  // Emojis via escape Unicode (\u{...}) — ASCII puro, imune a corrupção de encoding no build.
  const mensagemWhats = voucherCriado
    ? `\u{1F381} Olá, ${primeiroNome}! Você ganhou ${descricaoOferta} na ${user?.loja || 'nossa loja'}${trechoMinimo}!\n\nToque no link para ativar seu voucher:\n${link}\n\nVálido até ${fmtDataBR(fim)}. Esperamos você! \u{1F60A}`
    : '';
  // Texto efetivamente enviado: o editado pelo operador, ou o padrão.
  const mensagemFinal = mensagemEditada ?? mensagemWhats;

  async function handleCriar(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(valor);
    if (!v || v <= 0) { setError('Informe o valor da oferta'); return; }
    if (tipo === 'discount_percent' && v > 100) { setError('Percentual deve ser entre 1 e 100'); return; }
    if (!fim) { setError('Informe a data final de validade'); return; }
    if (inicio && fim < inicio) { setError('A validade final deve ser depois do início'); return; }

    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        action: 'issue_voucher',
        active_tenant_id: user?.tenantId,
        voucher_type: tipo === 'gift_card' ? 'gift_card' : 'discount',
        original_amount: v,
        // Início: se for hoje, vale imediatamente; se futuro, começa 00:00 local
        valid_from: inicio && inicio !== hoje() ? new Date(`${inicio}T00:00:00`).toISOString() : null,
        // Fim: até 23:59:59 local do dia escolhido
        expires_at: new Date(`${fim}T23:59:59`).toISOString(),
        max_uses: Math.max(1, Number(maxUsos) || 1),
        min_order_amount: minimoNum > 0 ? minimoNum : null,
        generate_claim_link: true,
        customer_id: cliente.id,
        customer_name: cliente.nome,
        notes: obs.trim() || null,
      };
      if (tipo !== 'gift_card') {
        payload.discount_type = tipo === 'discount_percent' ? 'percent' : 'fixed';
        payload.discount_value = v;
      }

      const { data, error: fnErr } = await invokeWithAuth('voucher-write', { body: payload });
      if (fnErr) throw fnErr;
      const created = (data as { data?: Voucher; error?: string })?.data;
      if (!created) throw new Error((data as { error?: string })?.error ?? 'Falha ao criar voucher');

      setVoucherCriado(created);
      registrarEvento({
        tipo: 'voucher_emitido',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? '—',
        descricao: `Voucher ${created.code} (${descricaoOferta}) enviado para ${cliente.nome} via link de ativação`,
        entidade: 'Voucher',
        entidadeId: created.code,
        detalhes: obs || undefined,
      });
      onSent?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message
        : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as { message: unknown }).message)
        : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const abrirWhatsApp = () => {
    if (!cliente.celular) return;
    const numero = cliente.celular.replace(/\D/g, '');
    window.open(`https://wa.me/55${numero}?text=${encodeURIComponent(mensagemFinal)}`, '_blank');
  };

  const copiarLink = () => {
    navigator.clipboard.writeText(mensagemFinal).then(() => {
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-50 rounded-lg">
              <i className="ri-coupon-3-line text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Enviar Voucher</h2>
              <p className="text-xs text-zinc-400">para {cliente.nome}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {!voucherCriado ? (
          /* ── Passo 1: configurar oferta ─────────────────────────────────── */
          <form onSubmit={handleCriar} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <i className="ri-error-warning-line" />{error}
              </div>
            )}

            {/* Tipo de oferta */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-2">O que você quer oferecer? *</label>
              <div className="grid grid-cols-3 gap-2">
                {TIPOS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-center cursor-pointer transition-all ${tipo === t.value ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}
                  >
                    <i className={`${t.icon} text-lg ${tipo === t.value ? 'text-amber-600' : 'text-zinc-400'}`} />
                    <p className={`text-[11px] font-bold leading-tight ${tipo === t.value ? 'text-amber-700' : 'text-zinc-600'}`}>{t.label}</p>
                    <p className="text-[9px] text-zinc-400 leading-tight">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Valor */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">
                {tipo === 'discount_percent' ? 'Percentual de desconto (%) *' : 'Valor (R$) *'}
              </label>
              <input
                type="number"
                min={tipo === 'discount_percent' ? 1 : 0.01}
                max={tipo === 'discount_percent' ? 100 : undefined}
                step={tipo === 'discount_percent' ? 1 : 0.01}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={tipo === 'discount_percent' ? '15' : '20.00'}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>

            {/* Período de validade */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Válido a partir de</label>
                <input
                  type="date"
                  value={inicio}
                  min={hoje()}
                  onChange={(e) => setInicio(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Válido até *</label>
                <input
                  type="date"
                  value={fim}
                  min={inicio || hoje()}
                  onChange={(e) => setFim(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                  required
                />
              </div>
            </div>

            {/* Limite de usos + pedido mínimo */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Quantas vezes pode usar?</label>
                <input
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  value={maxUsos}
                  onChange={(e) => setMaxUsos(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <p className="text-[10px] text-zinc-400 mt-1">
                  {Number(maxUsos) > 1 ? `Vale para ${maxUsos} visitas.` : 'Uso único (padrão).'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Pedido mínimo (R$)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={pedidoMinimo}
                  onChange={(e) => setPedidoMinimo(e.target.value)}
                  placeholder="Sem mínimo"
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <p className="text-[10px] text-zinc-400 mt-1">
                  Só deste voucher — independente do mínimo do delivery.
                </p>
              </div>
            </div>

            {/* Observação */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Observação (aparece no voucher)</label>
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Ex: Válido para consumo no salão"
                rows={2}
                maxLength={200}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
            </div>

            {/* Botões */}
            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 cursor-pointer transition-colors">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 cursor-pointer transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Criando...</>
                ) : (
                  <><i className="ri-coupon-3-line" /> Criar voucher</>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* ── Passo 2: voucher criado — enviar link ──────────────────────── */
          <div className="p-6 space-y-4">
            <div className="flex flex-col items-center text-center gap-2 py-2">
              <div className="w-14 h-14 flex items-center justify-center bg-emerald-50 rounded-full">
                <i className="ri-checkbox-circle-fill text-3xl text-emerald-500" />
              </div>
              <p className="text-sm font-bold text-zinc-900">Voucher criado!</p>
              <p className="text-xs text-zinc-500 max-w-[260px]">
                {descricaoOferta} para <span className="font-semibold">{primeiroNome}</span>, válido até {fmtDataBR(fim)}.
                O voucher é ativado automaticamente quando o cliente abrir o link.
              </p>
              <span className="font-mono font-black tracking-wider text-zinc-800 text-lg mt-1">{voucherCriado.code}</span>
            </div>

            {/* Link */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Link de ativação</p>
              <p className="text-xs text-zinc-600 break-all font-mono">{link}</p>
            </div>

            {/* Mensagem editável */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Mensagem</p>
                {mensagemEditada !== null && (
                  <button
                    type="button"
                    onClick={() => setMensagemEditada(null)}
                    className="text-[10px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer"
                  >
                    Restaurar padrão
                  </button>
                )}
              </div>
              <textarea
                value={mensagemFinal}
                onChange={(e) => setMensagemEditada(e.target.value)}
                rows={6}
                className="w-full text-xs border border-zinc-200 rounded-xl px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400 transition-colors resize-none leading-relaxed"
              />
              <p className="text-[10px] text-zinc-400 mt-1">Edite à vontade. O link precisa continuar na mensagem para o cliente ativar o voucher.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={abrirWhatsApp}
                disabled={!cliente.celular}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-green-500 hover:bg-green-600 rounded-xl text-xs font-bold text-white cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="ri-whatsapp-line text-base" />
                Enviar WhatsApp
              </button>
              <button
                onClick={copiarLink}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-700 cursor-pointer transition-colors"
              >
                <i className={`${linkCopiado ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line'} text-base`} />
                {linkCopiado ? 'Copiado!' : 'Copiar mensagem'}
              </button>
            </div>
            {!cliente.celular && (
              <p className="text-[10px] text-zinc-400 text-center">Cliente sem telefone — copie a mensagem e envie por outro canal</p>
            )}

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-zinc-500 hover:bg-zinc-100 cursor-pointer transition-colors"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
