import { useEffect, useState } from 'react';
import { Folha, btn } from '@/components/kit';
import { Interruptor } from '@/pages/config-delivery/ui';
import { ifoodShipping, type IfoodShippingConfig } from '@/lib/ifoodShipping';

/**
 * Impressão dos pedidos do iFood (funil): ticket da cozinha e comprovante. Botão da impressora no cabeçalho para o caixa
 * também mexer (a engrenagem/Conexão é só de admin/supervisor). Grava pela ação set_print do ifood-shipping.
 */
export default function ImpressaoIfoodFolha({ aberta, tenantId, onFechar }: { aberta: boolean; tenantId: string; onFechar: () => void }) {
  const [cfg, setCfg] = useState<IfoodShippingConfig | null>(null);
  const [lendo, setLendo] = useState(false);
  const [busy, setBusy] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!aberta) return;
    setErro(''); setOk(''); setLendo(true);
    ifoodShipping<{ config: IfoodShippingConfig | null }>('get_config', tenantId).then((r) => {
      setLendo(false);
      if (!r.success) { setErro(r.error || 'Não deu para ler a configuração.'); return; }
      setCfg(r.config);
    });
  }, [aberta, tenantId]);

  const mudar = async (campo: 'order_print_kitchen' | 'order_print_receipt', v: boolean, msg: string) => {
    setBusy(campo); setErro(''); setOk('');
    const r = await ifoodShipping('set_print', tenantId, { [campo]: v });
    setBusy('');
    if (!r.success) { setErro(r.error || 'Não salvou.'); return; }
    setCfg((c) => (c ? { ...c, [campo]: v } : c));
    setOk(msg);
  };

  const noFunil = cfg?.order_mode === 'funnel';
  return (
    <Folha aberta={aberta} titulo="Impressão dos pedidos do iFood" subtitulo="O que sai na impressora quando o pedido do iFood entra na cozinha." onFechar={onFechar}
      rodape={<button type="button" className={btn('out') + ' w-full'} onClick={onFechar}>Fechar</button>}>
      {lendo ? (
        <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : !cfg ? (
        <p className="text-sm text-zinc-600">{erro || 'O iFood ainda não está conectado nesta loja.'}</p>
      ) : (
        <div className="space-y-4">
          {!noFunil && (
            <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Hoje os pedidos do iFood não entram na cozinha do ERPOS (a loja usa o tablet do iFood), então o ERPOS não imprime nada deles. A escolha abaixo vale quando passarem a entrar.
            </p>
          )}
          <Linha titulo="Imprimir na cozinha" texto="Ticket da cozinha/bar quando o pedido do iFood entra. Desligado: aparece só na tela da cozinha."
            ligado={cfg.order_print_kitchen !== false} disabled={!!busy}
            onChange={(v) => mudar('order_print_kitchen', v, v ? 'Pedidos do iFood imprimem na cozinha.' : 'Pedidos do iFood não imprimem mais na cozinha.')} />
          <Linha titulo="Imprimir comprovante" texto="Comprovante de entrega/retirada com cliente, endereço, total e forma de pagamento."
            ligado={cfg.order_print_receipt !== false} disabled={!!busy}
            onChange={(v) => mudar('order_print_receipt', v, v ? 'Comprovante dos pedidos do iFood ligado.' : 'Comprovante dos pedidos do iFood desligado.')} />
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          {ok && <p className="text-xs text-emerald-700"><i className="ri-checkbox-circle-line" /> {ok}</p>}
        </div>
      )}
    </Folha>
  );
}

function Linha({ titulo, texto, ligado, onChange, disabled }: { titulo: string; texto: string; ligado: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-zinc-900">{titulo}</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{texto}</p>
      </div>
      <Interruptor ligado={ligado} onChange={onChange} rotulo={titulo} disabled={disabled} />
    </div>
  );
}
