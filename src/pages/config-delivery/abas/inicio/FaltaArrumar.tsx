import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { situacaoPagamentoOnline } from '../../config';
import { useDeliveryTela } from '../../DeliveryTela';
import { CartaoAcao, Nota, SecaoTitulo, btn } from '../../ui';
import { itensFaltaArrumar, type SituacaoMp, type TomFalta } from './calculos';

// "Falta arrumar": o que impede o cliente de pedir ou deixa a operação pela metade, lido da configuração GRAVADA
// (não do rascunho que está sendo editado). Cada item leva à aba que resolve. Sem pendência: "Tudo em dia".

const TOM_CARTAO: Record<TomFalta, 'alerta' | 'prop' | 'neutro'> = { alerta: 'alerta', prop: 'prop', neutro: 'neutro' };

export default function FaltaArrumar() {
  const { tenantId, salvo, motoboys, motoboysCarregando, ehDono, irPara } = useDeliveryTela();

  // Mercado Pago (o que o cliente vê como "pelo app") e assistente do WhatsApp: leituras à parte da configuração.
  const [mp, setMp] = useState<SituacaoMp | null>(null);
  const [mpPronto, setMpPronto] = useState(false);
  const [assistente, setAssistente] = useState<boolean | null>(null);
  const [assistentePronto, setAssistentePronto] = useState(false);
  const [aviso, setAviso] = useState<string[]>([]);
  const tenantAtual = useRef(tenantId);
  tenantAtual.current = tenantId;

  useEffect(() => {
    if (!tenantId) return;
    const t = tenantId;
    setMp(null); setMpPronto(false); setAssistente(null); setAssistentePronto(false); setAviso([]);
    const falhou = (txt: string) => { if (tenantAtual.current === t) setAviso((a) => (a.includes(txt) ? a : [...a, txt])); };

    void situacaoPagamentoOnline(t).then((r) => {
      if (tenantAtual.current !== t) return;
      setMp(r); setMpPronto(true);
      if (!r) falhou('o Mercado Pago');
    });

    if (!ehDono) { setAssistentePronto(true); return; }
    void supabase.from('wa_loja_bots').select('is_active').eq('tenant_id', t).maybeSingle().then(({ data, error }) => {
      if (tenantAtual.current !== t) return;
      if (error) { setAssistente(null); falhou('o assistente do WhatsApp'); }
      else setAssistente(!!data?.is_active);
      setAssistentePronto(true);
    });
  }, [tenantId, ehDono]);

  const itens = useMemo(
    () => itensFaltaArrumar({ salvo, nMotoboys: motoboys.length, mp, ehDono, assistenteLigado: assistente }),
    [salvo, motoboys.length, mp, ehDono, assistente],
  );
  const conferindo = !mpPronto || !assistentePronto || motoboysCarregando;
  const temVermelho = itens.some((i) => i.tom === 'alerta');

  return (
    <div>
      <SecaoTitulo titulo="Falta arrumar" n={itens.length > 0 ? itens.length : undefined} tomN={temVermelho ? 'red' : 'amber'} />
      <div className="space-y-2">
        {itens.map((i) => (
          <CartaoAcao key={i.id} tom={TOM_CARTAO[i.tom]} icone={i.icone} titulo={i.titulo}
            acoes={<button type="button" className={i.tom === 'neutro' ? btn('out', 'sm') : btn('p', 'sm')} onClick={() => irPara(i.aba)}>{i.botao}</button>}>
            {i.texto}
          </CartaoAcao>
        ))}
        {itens.length === 0 && conferindo && (
          <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-4 text-sm text-zinc-500">
            <i className="ri-loader-4-line animate-spin mr-1.5" />Conferindo…
          </div>
        )}
        {itens.length === 0 && !conferindo && (
          <CartaoAcao tom="ok" icone="ri-checkbox-circle-line" titulo="Tudo em dia">
            O cliente consegue pedir e a equipe tem o que precisa.
          </CartaoAcao>
        )}
      </div>
      {aviso.length > 0 && <Nota className="mt-2">Não consegui conferir {aviso.join(' e ')} agora; por isso essa parte não aparece na lista.</Nota>}
    </div>
  );
}
