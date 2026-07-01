// Página PÚBLICA /voucher/:token — o cliente abre o link recebido (WhatsApp)
// e o voucher já é ativado automaticamente pela Edge Function voucher-claim.
// Sem login, sem AppLayout — mobile-first.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { VoucherClaimPublic } from '@/types/vouchers';

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDataHora(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function valorPrincipal(v: VoucherClaimPublic): string {
  if (v.voucher_type === 'discount') {
    return v.discount_type === 'percent'
      ? `${v.discount_value}% OFF`
      : `${fmtMoeda(v.discount_value ?? 0)} OFF`;
  }
  if (v.voucher_type === 'gift_card') return fmtMoeda(v.current_balance);
  if (v.voucher_type === 'cashback') return fmtMoeda(v.current_balance);
  return 'Item grátis';
}

function tipoLabel(v: VoucherClaimPublic): string {
  if (v.voucher_type === 'gift_card') return 'Vale-presente';
  if (v.voucher_type === 'cashback') return 'Cashback';
  if (v.voucher_type === 'free_item') return 'Cortesia';
  return 'Desconto';
}

export default function VoucherLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [voucher, setVoucher] = useState<VoucherClaimPublic | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const jaBuscou = useRef(false);

  useEffect(() => {
    // Guarda contra o double-invoke do StrictMode (dev) — evita inflar claim_count
    if (jaBuscou.current) return;
    jaBuscou.current = true;
    if (!token) { setErro('not_found'); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/voucher-claim`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          },
        );
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.data) {
          setErro(json?.error ?? 'not_found');
        } else {
          setVoucher(json.data as VoucherClaimPublic);
        }
      } catch {
        setErro('network');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const copiarCodigo = () => {
    if (!voucher) return;
    navigator.clipboard.writeText(voucher.code).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">Ativando seu voucher...</p>
      </div>
    );
  }

  // ── Erro / não encontrado ──────────────────────────────────────────────────
  if (erro || !voucher) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-full">
          <i className="ri-coupon-2-line text-3xl text-zinc-400" />
        </div>
        <p className="text-base font-bold text-zinc-800">
          {erro === 'network' ? 'Sem conexão' : 'Voucher não encontrado'}
        </p>
        <p className="text-sm text-zinc-500 max-w-xs">
          {erro === 'network'
            ? 'Não foi possível carregar seu voucher. Verifique sua internet e tente novamente.'
            : 'Este link é inválido ou o voucher não existe mais. Fale com a loja que enviou o convite.'}
        </p>
        {erro === 'network' && (
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2.5 bg-amber-500 text-white text-sm font-bold rounded-xl cursor-pointer"
          >
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  // ── Estado do voucher ──────────────────────────────────────────────────────
  const usado = voucher.status === 'depleted';
  const expirado = voucher.status === 'expired';
  const cancelado = voucher.status === 'cancelled';
  const agendado = voucher.not_yet_valid;
  const ativo = voucher.status === 'active' && !agendado;
  const primeiroNome = voucher.customer_name?.split(' ')[0];

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-500 via-amber-400 to-amber-50 flex flex-col items-center px-4 py-8">
      {/* Loja */}
      <div className="flex flex-col items-center gap-2 mb-6">
        {voucher.store?.logo_url ? (
          <img
            src={voucher.store.logo_url}
            alt={voucher.store.name}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-white/60"
          />
        ) : (
          <div className="w-16 h-16 flex items-center justify-center bg-white/25 rounded-2xl">
            <i className="ri-store-2-line text-3xl text-white" />
          </div>
        )}
        <p className="text-white font-bold text-lg drop-shadow-sm">{voucher.store?.name ?? 'Sua loja'}</p>
      </div>

      {/* Card do voucher (estilo ticket) */}
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center">
          <p className="text-sm text-zinc-500">
            {primeiroNome ? `${primeiroNome}, você ganhou` : 'Você ganhou'} um presente! 🎁
          </p>
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600 mt-3">{tipoLabel(voucher)}</p>
          <p className="text-4xl font-black text-zinc-900 mt-1">{valorPrincipal(voucher)}</p>
          {voucher.voucher_type === 'discount' && (
            <p className="text-xs text-zinc-400 mt-1">no seu pedido na loja</p>
          )}
        </div>

        {/* Status */}
        <div className="px-6 pb-4">
          {ativo && (
            <div className="flex items-center justify-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <i className="ri-checkbox-circle-fill text-emerald-500 text-lg" />
              <p className="text-xs font-bold text-emerald-700">
                Voucher ativado! {voucher.store?.slug ? 'Use no delivery ou apresente o código na loja.' : 'Apresente o código na loja.'}
              </p>
            </div>
          )}
          {agendado && voucher.valid_from && (
            <div className="flex items-center justify-center gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5">
              <i className="ri-time-line text-sky-500 text-lg" />
              <p className="text-xs font-bold text-sky-700">
                Válido a partir de {fmtDataHora(voucher.valid_from)}
              </p>
            </div>
          )}
          {usado && (
            <div className="flex items-center justify-center gap-2 bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-2.5">
              <i className="ri-check-double-line text-zinc-500 text-lg" />
              <p className="text-xs font-bold text-zinc-600">Este voucher já foi utilizado.</p>
            </div>
          )}
          {expirado && (
            <div className="flex items-center justify-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <i className="ri-close-circle-line text-red-500 text-lg" />
              <p className="text-xs font-bold text-red-600">
                Voucher expirado{voucher.expires_at ? ` em ${fmtDataHora(voucher.expires_at)}` : ''}.
              </p>
            </div>
          )}
          {cancelado && (
            <div className="flex items-center justify-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <i className="ri-forbid-line text-red-500 text-lg" />
              <p className="text-xs font-bold text-red-600">Este voucher foi cancelado pela loja.</p>
            </div>
          )}
        </div>

        {/* Divisor pontilhado estilo ticket */}
        <div className="relative flex items-center px-0">
          <div className="w-5 h-10 bg-amber-100 rounded-r-full -ml-0" style={{ background: 'radial-gradient(circle at 0 50%, #fbbf24 0, #fbbf24 0)', backgroundColor: 'transparent' }} />
          <div className="absolute left-0 -ml-2.5 w-5 h-5 bg-amber-400 rounded-full" />
          <div className="flex-1 border-t-2 border-dashed border-zinc-200 mx-2" />
          <div className="absolute right-0 -mr-2.5 w-5 h-5 bg-amber-300 rounded-full" />
        </div>

        {/* Código */}
        <div className="px-6 py-5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Seu código</p>
          <button
            onClick={copiarCodigo}
            className="w-full flex items-center justify-center gap-2 bg-zinc-50 border-2 border-dashed border-amber-300 rounded-2xl px-4 py-3.5 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <span className="text-xl font-black tracking-wider text-zinc-900">{voucher.code}</span>
            <i className={`${copiado ? 'ri-check-line text-emerald-500' : 'ri-file-copy-line text-zinc-400'} text-lg`} />
          </button>
          {copiado && <p className="text-[10px] text-emerald-600 font-semibold mt-1.5">Código copiado!</p>}

          {/* Validade e usos */}
          <div className="mt-4 space-y-1.5">
            {voucher.expires_at && !expirado && (
              <p className="text-xs text-zinc-500">
                <i className="ri-calendar-line mr-1" />
                Válido até <span className="font-bold text-zinc-700">{fmtDataHora(voucher.expires_at)}</span>
              </p>
            )}
            {voucher.max_uses > 1 && (
              <p className="text-xs text-zinc-500">
                <i className="ri-repeat-line mr-1" />
                Pode ser usado <span className="font-bold text-zinc-700">{voucher.max_uses}x</span>
                {voucher.use_count > 0 && <> — já usado {voucher.use_count}x</>}
              </p>
            )}
            {(voucher.min_order_amount ?? 0) > 0 && (
              <p className="text-xs text-zinc-500">
                <i className="ri-shopping-basket-line mr-1" />
                Pedido mínimo de <span className="font-bold text-zinc-700">{fmtMoeda(voucher.min_order_amount ?? 0)}</span>
              </p>
            )}
            {voucher.notes && (
              <p className="text-[11px] text-zinc-400 pt-1">{voucher.notes}</p>
            )}
          </div>

          {/* Pedir no delivery com o cupom já aplicado */}
          {ativo && voucher.store?.slug && (
            <a
              href={`/${voucher.store.slug}-delivery?voucher=${encodeURIComponent(voucher.code)}`}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 rounded-2xl text-sm font-bold text-white cursor-pointer transition-colors"
            >
              <i className="ri-e-bike-2-line text-lg" />
              Pedir no Delivery com o voucher
            </a>
          )}
        </div>
      </div>

      {/* Endereço da loja */}
      {(voucher.store?.address || voucher.store?.city) && (
        <p className="text-xs text-amber-900/70 mt-5 text-center max-w-xs">
          <i className="ri-map-pin-line mr-1" />
          {[voucher.store?.address, voucher.store?.city].filter(Boolean).join(' — ')}
        </p>
      )}
    </div>
  );
}
