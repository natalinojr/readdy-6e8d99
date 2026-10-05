import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDeliveryTela } from '../../DeliveryTela';
import { Nota, SecaoTitulo, brl, btn, haQuanto, waNumero } from '../../ui';
import { mensagemEsperandoPix, nomeDoCliente, numeroCurto } from './calculos';
import { useAtualizacao } from './usarAtualizacao';

// "Esperando o pagamento pelo app": quem escolheu Pix ou cartão pelo app só vai para a cozinha depois de pagar; enquanto não paga o pedido
// fica como rascunho (is_draft) e some das telas de pedido. Aqui a loja vê quem está esperando e pode chamar a
// pessoa. Sem pagamento, o pedido é cancelado sozinho quando o caixa fecha. Só aparece se houver alguém.

interface Rascunho {
  id: string; number: string; destination_name: string | null; destination_phone: string | null;
  total_amount: number | string | null; created_at: string;
}

export default function EsperandoPix() {
  const { tenantId, linkDelivery } = useDeliveryTela();
  const [lista, setLista] = useState<Rascunho[]>([]);
  const [erro, setErro] = useState('');
  const tenantAtual = useRef(tenantId);
  tenantAtual.current = tenantId;

  useEffect(() => { setLista([]); setErro(''); }, [tenantId]);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const t = tenantId;
    const desde = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data, error } = await supabase.from('orders')
      .select('id, number, destination_name, destination_phone, total_amount, created_at')
      .eq('tenant_id', t).eq('origin_type', 'delivery').eq('is_draft', true).neq('status', 'cancelled')
      .gte('created_at', desde).order('created_at', { ascending: true });
    if (tenantAtual.current !== t) return;
    if (error) { setErro(error.message); return; }
    setErro(''); setLista((data ?? []) as Rascunho[]);
  }, [tenantId]);

  useAtualizacao(carregar, 30_000, tenantId);

  if (lista.length === 0 && !erro) return null;

  return (
    <div>
      <SecaoTitulo titulo="Esperando o pagamento pelo app" n={lista.length} tomN="amber" />
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-[13px] text-red-700 mb-2">
          Não consegui ver os pedidos esperando o pagamento: {erro}
        </div>
      )}
      <div className="space-y-2">
        {lista.map((p) => {
          const nome = nomeDoCliente(p.destination_name);
          const fone = (p.destination_phone ?? '').replace(/\D/g, '');
          const total = Number(p.total_amount) || 0;
          const numero = numeroCurto(p.number);
          const texto = mensagemEsperandoPix({ nome, numero, valor: brl(total), link: linkDelivery });
          return (
            <div key={p.id} className="bg-white border border-zinc-200 rounded-2xl px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0"><i className="ri-qr-code-line text-lg" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-extrabold text-zinc-900 truncate">{numero} · {nome}</p>
                  <p className="text-[12.5px] text-zinc-500">{haQuanto(p.created_at)} · {brl(total)}</p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap mt-2.5">
                {fone ? (
                  <>
                    <a href={`https://wa.me/${waNumero(fone)}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer" className={btn('wa', 'sm')}>
                      <i className="ri-whatsapp-line" />Chamar no WhatsApp
                    </a>
                    <a href={`tel:+${waNumero(fone)}`} className={btn('out', 'sm')}><i className="ri-phone-line" />Ligar</a>
                  </>
                ) : <span className="text-xs text-zinc-400 py-1.5">Este pedido não tem telefone.</span>}
              </div>
            </div>
          );
        })}
      </div>
      <Nota className="mt-2">Sem pagamento, ele é cancelado quando o caixa fecha. O pedido só vai para a cozinha depois de pago.</Nota>
    </div>
  );
}
