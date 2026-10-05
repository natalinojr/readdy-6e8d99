// Lista do cartão "Aniversariantes" (aba Quem chamar): quem faz aniversário hoje e nos próximos
// 6 dias, com o voucher do ano quando existe. "Mandar parabéns" abre o WhatsApp com a mensagem
// pronta (aniversarioMensagem.ts). O envio é sempre um clique humano.
//
// Registro do contato: crm_sends.stage é um enum (crm_stage) sem o valor 'aniversario', então o
// envio NÃO vai para o log do funil (log_send); marca só o "último contato" do cliente pela ação
// touch_contact do customer-write (a mesma da aba Clientes). Não conta no cooldown nem no teto
// semanal do funil — é de propósito: parabéns não pode ser barrado pela pausa de uma oferta.
import { useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { AVISO_OPT_OUT, abrirWhatsApp, celularComDDI } from '../clienteUtils';
import {
  ddmmBrasilia, descricaoVoucher, mensagemAniversario, rotuloDia, voucherVale,
  type Aniversariante,
} from '../aniversarioMensagem';

interface Props {
  tenantId: string;
  loja: string;
  carregando: boolean;
  erro: string;
  lista: Aniversariante[];
  onTentarDeNovo: () => void;
}

export default function AniversariantesLista({ tenantId, loja, carregando, erro, lista, onTentarDeNovo }: Props) {
  // Quem já teve o WhatsApp aberto nesta sessão (a tela mostra "aberto" e o botão vira "de novo").
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [avisoContato, setAvisoContato] = useState('');
  const [avisoLinha, setAvisoLinha] = useState('');

  const comVoucher = lista.filter(function (a) { return voucherVale(a.voucher); }).length;

  function mandar(a: Aniversariante) {
    setAvisoLinha('');
    if (a.opt_out) { setAvisoLinha(AVISO_OPT_OUT + ': ' + a.nome + '.'); return; }
    const texto = mensagemAniversario(a, { loja, origin: window.location.origin });
    if (!abrirWhatsApp(a.phone, texto)) { setAvisoLinha(a.nome + ' não tem um celular válido para o WhatsApp.'); return; }
    setAbertos(function (prev) { return new Set(prev).add(a.customer_id); });
    setAvisoContato('');
    invokeWithAuth<{ ok?: boolean; error?: string }>('customer-write', {
      body: { action: 'touch_contact', active_tenant_id: tenantId, customer_ids: [a.customer_id] },
    }).then(function (res) {
      const falha = res.error?.message || res.data?.error;
      if (falha) setAvisoContato('A mensagem foi aberta, mas não consegui marcar o "último contato" de ' + a.nome + ' (' + falha + ').');
    });
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-pink-500 bg-pink-50">
          <i className="ri-cake-3-line" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900">Aniversariantes</p>
          <p className="text-[11px] text-zinc-400">
            {carregando ? 'Carregando…' : erro ? 'Não foi possível carregar a lista'
              : `${lista.length} nos próximos 7 dias${comVoucher > 0 ? ` · ${comVoucher} com voucher pronto` : ''}`}
          </p>
        </div>
      </div>

      {(avisoLinha || avisoContato) && (
        <p role="status" className="px-4 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100">
          {avisoLinha || avisoContato}
        </p>
      )}

      <div className="max-h-[55vh] overflow-auto divide-y divide-zinc-50">
        {carregando ? (
          <p className="text-xs text-zinc-400 text-center py-8">Carregando…</p>
        ) : erro ? (
          <div className="text-center py-10 px-4">
            <i className="ri-error-warning-line text-3xl text-red-300" />
            <p className="text-xs text-red-600 mt-1">Não consegui carregar os aniversariantes: {erro}</p>
            <button
              onClick={onTentarDeNovo}
              className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700"
            >
              <i className="ri-refresh-line" /> Tentar de novo
            </button>
          </div>
        ) : lista.length === 0 ? (
          <div className="text-center py-10">
            <i className="ri-cake-3-line text-3xl text-zinc-200" />
            <p className="text-xs text-zinc-400 mt-1">Ninguém faz aniversário nos próximos 7 dias.</p>
          </div>
        ) : lista.map(function (a) {
          const vale = voucherVale(a.voucher);
          const venceu = !!a.voucher && !vale;
          const semCelular = !celularComDDI(a.phone);
          const aberto = abertos.has(a.customer_id);
          return (
            <div key={a.customer_id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 hover:bg-zinc-50/60">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-zinc-800 truncate">{a.nome}</span>
                  <span className={'text-[11px] font-semibold ' + (a.dias_ate === 0 ? 'text-pink-600' : 'text-zinc-500')}>{rotuloDia(a)}</span>
                  {a.opt_out && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">pediu para não receber</span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{a.phone_fmt || 'sem celular'}</span>
                  {a.voucher && vale && (
                    <span
                      className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-pink-50 text-pink-700"
                      title={descricaoVoucher(a.voucher)}
                    >
                      <i className="ri-coupon-3-line" /> {a.voucher.code}
                    </span>
                  )}
                  {venceu && a.voucher?.expires_at && (
                    <span className="text-[10px] text-zinc-400">voucher venceu em {ddmmBrasilia(a.voucher.expires_at)}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {aberto && <span className="text-[10px] text-green-700 font-semibold"><i className="ri-check-line" /> aberto</span>}
                <button
                  onClick={function () { mandar(a); }}
                  disabled={semCelular || a.opt_out}
                  title={a.opt_out ? AVISO_OPT_OUT : semCelular ? 'Sem celular válido para o WhatsApp' : 'Abrir o WhatsApp com os parabéns' + (vale ? ' e o voucher' : '')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <i className="ri-whatsapp-line" /> {aberto ? 'Mandar de novo' : 'Mandar parabéns'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
