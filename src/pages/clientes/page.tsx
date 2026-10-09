// Clientes & Marketing — uma tela só, em 4 abas (2026-10-05, protótipo aprovado pelo dono):
//   Clientes · Funil · Clube (Fidelidade + Jogos) · Descontos (Promoções + Vouchers).
// Antes eram 6 abas e, no celular, Promoções e Vouchers ficavam fora da tela.
//
// A aba vem da URL (?aba=clientes|funil|clube|descontos e ?secao= dentro dela). Os ids antigos
// continuam valendo (links do assistente, /promocoes e /vouchers, favoritos):
// fidelidade → clube · jogos → clube/jogos · promocoes → descontos · vouchers → descontos/vouchers.
// Cada aba respeita a sua permissão: clientes_ver (Clientes e Funil), gestao_promocoes (Clube),
// gestao_promocoes OU gestao_vouchers (Descontos — cada seção confere a sua).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes, type PermissaoKey } from '@/hooks/usePermissoes';
import type { ClienteCRM } from '@/hooks/useClientes';
import type { Voucher } from '@/types/vouchers';
import EnviarVoucherModal from './components/EnviarVoucherModal';
import ClientesAba from './abas/ClientesAba';
import FunilAba, { type OfertaVoucher } from './abas/FunilAba';
import FidelidadeAba, { type SecaoClube } from './abas/FidelidadeAba';
import DescontosAba from './abas/DescontosAba';

type Aba = 'clientes' | 'funil' | 'clube' | 'descontos';

const ABAS: { id: Aba; label: string; icon: string; permissoes: PermissaoKey[]; desc: string }[] = [
  { id: 'clientes', label: 'Clientes', icon: 'ri-group-line', permissoes: ['clientes_ver'], desc: 'Base de clientes, filtros pelo Funil e campanhas' },
  { id: 'funil', label: 'Funil', icon: 'ri-filter-3-line', permissoes: ['clientes_ver'], desc: 'Quem chamar agora e com qual oferta' },
  // Clube usa a permissão de Promoções: é marketing com dinheiro envolvido (pontos, prêmios).
  { id: 'clube', label: 'Clube', icon: 'ri-vip-crown-line', permissoes: ['gestao_promocoes'], desc: 'Fidelidade: pontos, recompensas, níveis, roleta e jogos' },
  { id: 'descontos', label: 'Descontos', icon: 'ri-coupon-3-line', permissoes: ['gestao_promocoes', 'gestao_vouchers'], desc: 'Promoção do cardápio, vouchers e gift cards' },
];

// Ids antigos (6 abas) → aba nova + seção.
const LEGADO: Record<string, { aba: Aba; secao?: string }> = {
  fidelidade: { aba: 'clube' },
  jogos: { aba: 'clube', secao: 'jogos' },
  promocoes: { aba: 'descontos', secao: 'promocoes' },
  vouchers: { aba: 'descontos', secao: 'vouchers' },
};

const SECOES_CLUBE: SecaoClube[] = ['resumo', 'pontos', 'recompensas', 'trilha', 'roleta', 'indicacao', 'jogos', 'app', 'membros'];

// Mesmo critério da RotaProtegida: só o admin vê tudo; o gerente segue a matriz (2026-10-03).
const PAPEIS_ADMIN = ['admin'];

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

  const ehAdmin = !!user && PAPEIS_ADMIN.includes(user.perfil);
  // Emitir voucher (Clientes, Funil e Descontos) é de quem tem Vouchers & Gift Cards.
  const podeVoucher = ehAdmin || hasPermissao('gestao_vouchers');
  const podePromocoes = ehAdmin || hasPermissao('gestao_promocoes');

  const abasLiberadas = useMemo(
    () => ABAS.filter((a) => ehAdmin || a.permissoes.some((k) => hasPermissao(k))),
    [ehAdmin, hasPermissao],
  );

  const pedidaBruta = params.get('aba') ?? '';
  const legado = LEGADO[pedidaBruta];
  const pedida = (legado?.aba ?? pedidaBruta) as Aba;
  const secao = params.get('secao') ?? legado?.secao ?? undefined;
  const aba: Aba = abasLiberadas.find((a) => a.id === pedida)?.id ?? abasLiberadas[0]?.id ?? 'clientes';
  const abaAtual = ABAS.find((a) => a.id === aba)!;

  // Barra de abas rola até a ativa quando não cabe (tela estreita ou fonte grande).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!nav || !el) return;
    nav.scrollTo({ left: Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' });
  }, [aba, abasLiberadas.length, carregandoPermissoes]);

  const irPara = (id: Aba, novaSecao?: string) => {
    const p = new URLSearchParams(params);
    p.set('aba', id);
    if (novaSecao) p.set('secao', novaSecao); else p.delete('secao');
    setParams(p, { replace: true });
  };

  const abrirVoucher = (cliente: ClienteCRM, oferta?: OfertaVoucher, aoEnviar?: VoucherAlvo['aoEnviar']) => {
    setVoucherAlvo({ cliente, oferta, aoEnviar });
  };

  const secaoClube = SECOES_CLUBE.includes(secao as SecaoClube) ? (secao as SecaoClube) : undefined;
  const secaoDescontos = secao === 'promocoes' || secao === 'vouchers' ? secao : undefined;

  return (
    <div className="flex flex-col h-full bg-zinc-50/50">
      <div className="px-4 md:px-6 pt-4 flex-shrink-0 bg-white border-b border-zinc-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-amber-400 to-rose-500 rounded-xl shadow-sm">
            <i className="ri-heart-3-line text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-zinc-900 leading-tight">Clientes &amp; Marketing</h1>
            <p className="text-xs text-zinc-500 truncate">{abaAtual.desc}</p>
          </div>
        </div>

        <nav
          ref={navRef}
          className="relative flex items-center gap-1 mt-3 -mb-px overflow-x-auto scrollbar-hide"
          role="tablist"
        >
          {abasLiberadas.map((a) => {
            const ativa = a.id === aba;
            return (
              <button
                key={a.id}
                role="tab"
                aria-selected={ativa}
                onClick={() => irPara(a.id)}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  ativa ? 'border-amber-500 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'
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
        {aba === 'funil' && <FunilAba onEnviarVoucher={abrirVoucher} podeVoucher={podeVoucher} />}
        {aba === 'clube' && <FidelidadeAba key={secaoClube ?? 'resumo'} secaoInicial={secaoClube} />}
        {aba === 'descontos' && (
          <DescontosAba podePromocoes={podePromocoes} podeVouchers={podeVoucher} secaoInicial={secaoDescontos} />
        )}
        </>}
      </div>

      {voucherAlvo && podeVoucher && (
        <EnviarVoucherModal
          cliente={voucherAlvo.cliente}
          oferta={voucherAlvo.oferta}
          onEnviado={(v, m) => { voucherAlvo.aoEnviar?.(v, m); }}
          onClose={() => setVoucherAlvo(null)}
        />
      )}
    </div>
  );
}
