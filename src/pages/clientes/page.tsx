// Clientes & Marketing — uma tela só para o que antes eram três (Clientes,
// Promoções e Vouchers) mais o Funil, que vivia num modal dentro de Clientes.
//
// A aba vem da URL (?aba=clientes|funil|fidelidade|promocoes|vouchers), então /promocoes e
// /vouchers continuam funcionando (redirecionam para cá) e links do assistente
// abrem direto na aba certa. Cada aba respeita a sua permissão de antes:
// clientes_ver (Clientes e Funil), gestao_promocoes e gestao_vouchers.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes, type PermissaoKey } from '@/hooks/usePermissoes';
import type { ClienteCRM } from '@/hooks/useClientes';
import type { Voucher } from '@/types/vouchers';
import EnviarVoucherModal from './components/EnviarVoucherModal';
import ClientesAba from './abas/ClientesAba';
import FunilAba, { type OfertaVoucher } from './abas/FunilAba';
import PromocoesAba from './abas/PromocoesAba';
import VouchersAba from './abas/VouchersAba';
import FidelidadeAba from './abas/FidelidadeAba';

type Aba = 'clientes' | 'funil' | 'fidelidade' | 'promocoes' | 'vouchers';

const ABAS: { id: Aba; label: string; icon: string; permissao: PermissaoKey; desc: string }[] = [
  { id: 'clientes', label: 'Clientes', icon: 'ri-group-line', permissao: 'clientes_ver', desc: 'Base de clientes, aniversários e campanhas' },
  { id: 'funil', label: 'Funil', icon: 'ri-filter-3-line', permissao: 'clientes_ver', desc: 'Quem abordar agora e com qual oferta' },
  // Fidelidade usa a permissão de Promoções: é marketing com dinheiro envolvido.
  { id: 'fidelidade', label: 'Fidelidade', icon: 'ri-vip-crown-line', permissao: 'gestao_promocoes', desc: 'Pontos, recompensas, trilha de níveis e roleta' },
  { id: 'promocoes', label: 'Promoções', icon: 'ri-price-tag-3-line', permissao: 'gestao_promocoes', desc: 'Preço promocional e regras de desconto' },
  { id: 'vouchers', label: 'Vouchers', icon: 'ri-gift-line', permissao: 'gestao_vouchers', desc: 'Vouchers, gift cards e links enviados' },
];

// Mesmo critério da RotaProtegida: admin e gerente veem tudo.
const PAPEIS_ADMIN = ['admin', 'gerente'];

interface VoucherAlvo {
  cliente: ClienteCRM;
  oferta?: OfertaVoucher;
  aoEnviar?: (voucher?: Voucher, mensagem?: string) => void;
}

export default function ClientesMarketingPage() {
  const { user } = useAuth();
  const { hasPermissao, loading: carregandoPermissoes } = usePermissoes();
  const [params, setParams] = useSearchParams();
  const [voucherAlvo, setVoucherAlvo] = useState<VoucherAlvo | null>(null);

  const abasLiberadas = useMemo(
    () => ABAS.filter((a) => (user && PAPEIS_ADMIN.includes(user.perfil)) || hasPermissao(a.permissao)),
    [user, hasPermissao],
  );

  const pedida = params.get('aba') as Aba | null;
  const aba: Aba = abasLiberadas.find((a) => a.id === pedida)?.id ?? abasLiberadas[0]?.id ?? 'clientes';
  const abaAtual = ABAS.find((a) => a.id === aba)!;

  const irPara = (id: Aba) => {
    const p = new URLSearchParams(params);
    p.set('aba', id);
    setParams(p, { replace: true });
  };

  const abrirVoucher = (cliente: ClienteCRM, oferta?: OfertaVoucher, aoEnviar?: VoucherAlvo['aoEnviar']) => {
    setVoucherAlvo({ cliente, oferta, aoEnviar });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50/50">
      <div className="px-4 md:px-6 pt-4 flex-shrink-0 bg-white border-b border-zinc-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-amber-400 to-rose-500 rounded-xl shadow-sm">
            <i className="ri-heart-3-line text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-zinc-900 leading-tight">Clientes &amp; Marketing</h1>
            <p className="text-xs text-zinc-400 truncate">{abaAtual.desc}</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 mt-3 -mb-px overflow-x-auto" role="tablist">
          {abasLiberadas.map((a) => {
            const ativa = a.id === aba;
            return (
              <button
                key={a.id}
                role="tab"
                aria-selected={ativa}
                onClick={() => irPara(a.id)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  ativa ? 'border-amber-500 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-700'
                }`}
              >
                <i className={`${a.icon} hidden sm:inline ${ativa ? 'text-amber-500' : ''}`} />
                {a.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Sem as permissões reais ainda, não assume aba nenhuma (evita piscar Clientes). */}
        {carregandoPermissoes ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : <>
        {aba === 'clientes' && (
          <ClientesAba onEnviarVoucher={(c) => abrirVoucher(c)} onAbrirFunil={() => irPara('funil')} />
        )}
        {aba === 'funil' && <FunilAba onEnviarVoucher={abrirVoucher} />}
        {aba === 'fidelidade' && <FidelidadeAba />}
        {aba === 'promocoes' && <PromocoesAba />}
        {aba === 'vouchers' && <VouchersAba />}
        </>}
      </div>

      {voucherAlvo && (
        <EnviarVoucherModal
          cliente={voucherAlvo.cliente}
          oferta={voucherAlvo.oferta}
          onSent={(v, m) => { voucherAlvo.aoEnviar?.(v, m); }}
          onClose={() => setVoucherAlvo(null)}
        />
      )}
    </div>
  );
}
