import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { confirmar } from '@/components/base/Dialogos';
import { chamarDelivery } from '../../config';
import { useDeliveryTela } from '../../DeliveryTela';
import { Folha, Nota, SecaoTitulo, Vazio, brl, btn, fmtTelefone, waNumero } from '../../ui';
import { descreverEntrega, horaBrasilia, numeroCurto, problemasDoPedido, type EntregaAberta, type TomEntrega } from './calculos';
import { useAtualizacao } from './usarAtualizacao';

// "Entregas agora": o que era a aba Gerir entregas. Lista as entregas em aberto (atualiza a cada 30 s) e,
// no ⋯ de cada uma, deixa a loja mudar a fase quando o motoboy não consegue (override total, ignora a trava
// do entregador). O quadro completo continua no Gestor de Entregas.

const AVATAR: Record<TomEntrega, string> = {
  o: 'bg-amber-100 text-amber-700', r: 'bg-red-100 text-red-600', g: 'bg-emerald-100 text-emerald-700', z: 'bg-zinc-100 text-zinc-500',
};

const FASES: { signal: string; label: string; icone: string; frase: string }[] = [
  { signal: 'a_caminho_loja', label: 'A caminho', icone: 'ri-store-2-line', frase: 'a caminho da loja' },
  { signal: 'coletou', label: 'Coletou', icone: 'ri-shopping-bag-3-line', frase: 'coletou' },
  { signal: 'entregou', label: 'Entregue', icone: 'ri-checkbox-circle-line', frase: 'entregue' },
  { signal: 'problema', label: 'Problema', icone: 'ri-alert-line', frase: 'com problema' },
];

const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function EntregasAgora() {
  const { tenantId } = useDeliveryTela();
  const { user } = useAuth();
  const toast = useToast();

  const [lista, setLista] = useState<EntregaAberta[] | null>(null); // null = ainda carregando
  const [erro, setErro] = useState('');
  const [prontoEm, setProntoEm] = useState<Record<string, string>>({});
  const [agora, setAgora] = useState(() => Date.now());
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [problema, setProblema] = useState<string | null>(null); // null = não está escrevendo o motivo
  const [ocupado, setOcupado] = useState('');
  const tenantAtual = useRef(tenantId);
  tenantAtual.current = tenantId;

  // Trocou de loja: nada da loja anterior fica na tela.
  useEffect(() => { setLista(null); setErro(''); setProntoEm({}); setAbertaId(null); setProblema(null); }, [tenantId]);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const t = tenantId;
    try {
      const d = await chamarDelivery<{ orders?: EntregaAberta[] }>('list_delivery_orders', { tenant_id: t });
      if (tenantAtual.current !== t) return;
      const pedidos = d.orders ?? [];
      setLista(pedidos); setErro(''); setAgora(Date.now());

      // "Pronto há X min": a lista do servidor não traz a hora em que a cozinha terminou; ela está nos itens.
      // Se essa leitura falhar, a frase só perde os minutos (o resto da lista segue certo).
      const prontos = pedidos.filter((o) => o.status === 'ready').map((o) => o.id);
      if (prontos.length) {
        const { data, error } = await supabase.from('order_items').select('order_id, ready_at').in('order_id', prontos).not('ready_at', 'is', null);
        if (tenantAtual.current !== t) return;
        if (!error && data) {
          const mapa: Record<string, string> = {};
          for (const r of data as { order_id: string; ready_at: string }[]) {
            if (!mapa[r.order_id] || r.ready_at > mapa[r.order_id]) mapa[r.order_id] = r.ready_at;
          }
          setProntoEm(mapa);
        }
      }
    } catch (e) {
      if (tenantAtual.current !== t) return;
      setErro(msgErro(e));
    }
  }, [tenantId]);

  useAtualizacao(carregar, 30_000, tenantId);

  const aberta = useMemo(() => (lista ?? []).find((o) => o.id === abertaId) ?? null, [lista, abertaId]);
  const linhas = useMemo(() => {
    const l = (lista ?? []).map((o) => ({ o, d: descreverEntrega(o, prontoEm[o.id], agora) }));
    // O que pede atenção (vermelho) sobe; dentro de cada grupo segue a ordem de chegada.
    return l.map((x, i) => ({ ...x, i })).sort((a, b) => (Number(b.d.tom === 'r') - Number(a.d.tom === 'r')) || a.i - b.i);
  }, [lista, prontoEm, agora]);
  const temAtencao = linhas.some((x) => x.d.tom === 'r');

  const fechar = () => { setAbertaId(null); setProblema(null); };

  const mudarFase = async (o: EntregaAberta, signal: string, motivo?: string) => {
    setOcupado(signal);
    try {
      await chamarDelivery('set_motoboy_status', { tenant_id: tenantId, order_id: o.id, signal, motivo, autor: user?.nome || undefined });
      const fase = FASES.find((f) => f.signal === signal);
      toast.success('Fase mudada', `${numeroCurto(o.number)} · ${fase?.frase ?? signal}`);
      fechar();
      await carregar();
    } catch (e) {
      toast.error('Não mudou a fase', msgErro(e));
    } finally {
      setOcupado('');
    }
  };

  const liberar = async (o: EntregaAberta) => {
    const ok = await confirmar({
      titulo: 'Liberar o entregador?',
      mensagem: 'Tira este pedido do entregador atual e volta uma fase da entrega. Ele fica disponível para o próximo entregador assumir.',
      confirmarLabel: 'Liberar', perigo: true,
    });
    if (!ok) return;
    setOcupado('liberar');
    try {
      await chamarDelivery('clear_motoboy_driver', { tenant_id: tenantId, order_id: o.id });
      toast.success('Entregador liberado', `${numeroCurto(o.number)} voltou uma fase.`);
      fechar();
      await carregar();
    } catch (e) {
      toast.error('Não liberou o entregador', msgErro(e));
    } finally {
      setOcupado('');
    }
  };

  const tel = aberta?.telefone ? waNumero(aberta.telefone) : '';
  const problemas = aberta ? problemasDoPedido(aberta) : [];

  return (
    <div>
      <SecaoTitulo titulo="Entregas agora" n={lista?.length} tomN={temAtencao ? 'red' : lista?.length ? 'amber' : 'zinc'}
        direita={<Link to="/gestor-entregas" className={btn('ghost', 'sm')}>Gestor de Entregas<i className="ri-arrow-right-s-line" /></Link>} />

      {lista === null && !erro && (
        <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-6 text-center text-sm text-zinc-500">
          <i className="ri-loader-4-line animate-spin mr-1.5" />Carregando as entregas…
        </div>
      )}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-[13px] text-red-700 mb-2">
          {lista === null ? 'Não consegui carregar as entregas' : 'Não consegui atualizar as entregas agora'}: {erro}
          <div className="mt-2"><button type="button" className={btn('out', 'sm')} onClick={() => void carregar()}>Tentar de novo</button></div>
        </div>
      )}

      {lista !== null && lista.length === 0 && !erro && <Vazio icone="ri-e-bike-2-line" titulo="Nenhuma entrega em aberto." />}

      {linhas.length > 0 && (
        <div className="space-y-2">
          {linhas.map(({ o, d }) => (
            <div key={o.id} className="bg-white border border-zinc-200 rounded-2xl pl-3 pr-2 py-2.5 flex items-center gap-3">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${AVATAR[d.tom]}`}><i className={`${d.icone} text-lg`} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-extrabold text-zinc-900 truncate">{numeroCurto(o.number)} · {o.cliente}</p>
                <p className={`text-[12.5px] leading-snug line-clamp-2 ${d.tom === 'r' ? 'text-red-600 font-bold' : 'text-zinc-500'}`}>{d.frase}</p>
                <p className="text-[11.5px] text-zinc-400 leading-snug truncate">{brl(o.total)}{o.endereco ? ` · ${o.endereco}` : ''}</p>
              </div>
              <button type="button" aria-label={`Mais ações do pedido ${numeroCurto(o.number)}`} title="Mudar a fase, ligar, chamar no WhatsApp"
                onClick={() => { setProblema(null); setAbertaId(o.id); }}
                className="w-10 h-10 flex-shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 cursor-pointer">
                <i className="ri-more-2-fill text-lg" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Nota className="mt-2">Tocar em ⋯ muda a fase quando o motoboy não consegue. O quadro completo está no Gestor de Entregas.</Nota>

      <Folha aberta={!!aberta} onFechar={fechar}
        titulo={aberta ? `${numeroCurto(aberta.number)} · ${aberta.cliente}` : ''}
        subtitulo={aberta ? `${aberta.endereco || 'Sem endereço'} · ${brl(aberta.total)}` : undefined}
        rodape={aberta && problema !== null ? (
          <>
            <button type="button" className={`${btn('out')} flex-1`} onClick={() => setProblema(null)}>Voltar</button>
            <button type="button" disabled={!problema.trim() || !!ocupado} className={`${btn('perigo')} flex-1`}
              onClick={() => void mudarFase(aberta, 'problema', problema.trim())}>
              {ocupado === 'problema' && <i className="ri-loader-4-line animate-spin" />}Registrar problema
            </button>
          </>
        ) : undefined}>
        {aberta && problema !== null && (
          <div className="pb-2">
            <p className="text-[13px] font-extrabold text-zinc-900 mb-1.5">O que aconteceu? <span className="font-semibold text-zinc-400">Fica registrado no pedido.</span></p>
            <textarea value={problema} onChange={(e) => setProblema(e.target.value)} rows={3} autoFocus maxLength={500}
              placeholder="Ex.: cliente ausente, endereço não encontrado, motoboy sem acesso…"
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 focus:border-red-400 outline-none text-sm resize-none" />
          </div>
        )}

        {aberta && problema === null && (
          <div className="pb-2">
            <div className="flex gap-2 flex-wrap items-center">
              {tel ? (
                <>
                  <a href={`tel:+${tel}`} className={btn('out', 'sm')}><i className="ri-phone-line" />Ligar</a>
                  <a href={`https://wa.me/${tel}`} target="_blank" rel="noopener noreferrer" className={btn('wa', 'sm')}><i className="ri-whatsapp-line" />WhatsApp</a>
                  <span className="text-xs text-zinc-500 tabular-nums">{fmtTelefone(aberta.telefone)}</span>
                </>
              ) : <span className="text-xs text-zinc-400">Este pedido não tem telefone.</span>}
            </div>

            <div className="flex items-center gap-2 mt-3 text-[13px] text-zinc-600">
              <i className="ri-e-bike-2-line text-zinc-400 text-base" />
              {aberta.driver_id ? (
                <>
                  <span className="flex-1 min-w-0 truncate">Entregador: <b className="text-zinc-900">{aberta.driver_nome || 'sem nome'}</b></span>
                  <button type="button" disabled={!!ocupado} className={btn('perigo', 'sm')} onClick={() => void liberar(aberta)}>
                    {ocupado === 'liberar' && <i className="ri-loader-4-line animate-spin" />}Liberar entregador
                  </button>
                </>
              ) : <span>Sem entregador.</span>}
            </div>

            <p className="text-[13px] font-extrabold text-zinc-900 mt-4 mb-1.5">Mudar a fase <span className="font-semibold text-zinc-400">quando o motoboy não consegue</span></p>
            <div className="grid grid-cols-4 gap-1.5">
              {FASES.map((f) => {
                const ativa = aberta.motoboy_status === f.signal;
                const carregando = ocupado === f.signal;
                return (
                  <button key={f.signal} type="button" disabled={!!ocupado}
                    onClick={() => (f.signal === 'problema' ? setProblema('') : void mudarFase(aberta, f.signal))}
                    className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                      ativa ? 'bg-amber-500 text-zinc-900'
                        : f.signal === 'problema' ? 'bg-red-50 text-red-600 hover:bg-red-100'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                    <i className={`${carregando ? 'ri-loader-4-line animate-spin' : f.icone} text-lg`} />{f.label}
                  </button>
                );
              })}
            </div>
            {aberta.motoboy_status && (
              <p className="text-[11.5px] text-zinc-500 mt-1.5">Agora: {FASES.find((f) => f.signal === aberta.motoboy_status)?.label ?? aberta.motoboy_status}.</p>
            )}

            {problemas.length > 0 && (
              <>
                <p className="text-[13px] font-extrabold text-zinc-900 mt-4 mb-1.5">Problemas registrados</p>
                <div className="space-y-1.5">
                  {problemas.map((p, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[12.5px] text-red-600">
                      <i className="ri-alert-line mt-0.5 flex-shrink-0" />
                      <span className="leading-snug">
                        {p.at ? <span className="font-bold tabular-nums">{horaBrasilia(p.at)} · </span> : null}
                        {p.text || 'Problema relatado'}
                        {p.by === 'loja' ? <span className="text-red-400"> (loja)</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Folha>
    </div>
  );
}
