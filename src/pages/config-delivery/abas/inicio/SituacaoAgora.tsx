import { useEffect, useState } from 'react';
import type { DeliveryOp } from '@/hooks/useDeliveryState';
import { useDeliveryTela } from '../../DeliveryTela';
import { useToast } from '@/contexts/ToastContext';
import { confirmar } from '@/components/base/Dialogos';
import { Chips, Folha, Nota, btn } from '../../ui';
import { descreverSituacao, type TomSituacao } from './calculos';

// "Situação agora": o MESMO botão do caixa (abrir / pausar / fechar / dia corrido). Quem manda é o servidor
// (delivery-write get/set_delivery_state); aqui só lemos e disparamos a ação. O cartão do Início fica no
// topo para o dono ver, sem abrir o caixa, se o cliente consegue pedir agora.

const VISUAL: Record<TomSituacao, { fundo: string; icone: string; icon: string }> = {
  aberto: { fundo: 'bg-gradient-to-b from-emerald-50 to-white border-emerald-200', icone: 'bg-emerald-100 text-emerald-700', icon: 'ri-store-2-fill' },
  pausado: { fundo: 'bg-gradient-to-b from-amber-50 to-white border-amber-200', icone: 'bg-amber-100 text-amber-700', icon: 'ri-pause-circle-fill' },
  fechado: { fundo: 'bg-white border-zinc-200', icone: 'bg-zinc-100 text-zinc-500', icon: 'ri-store-2-line' },
};

type PausaId = '15' | '30' | '60';
type ExtraId = string;

export default function SituacaoAgora() {
  const { state, loading, acting, refresh, setOp } = useDeliveryTela().estado;
  const toast = useToast();

  // Hora em que o estado chegou: o "fecha às HH:MM" é essa hora + os minutos que o servidor mandou.
  const [estadoEm, setEstadoEm] = useState(() => Date.now());
  useEffect(() => { if (state) setEstadoEm(Date.now()); }, [state]);

  const [pausando, setPausando] = useState(false);
  const [minutos, setMinutos] = useState<PausaId>('30');

  /** Roda a ação; mostra o erro do servidor; confere o estado de novo. true = deu certo. */
  const rodar = async (op: DeliveryOp, min?: number): Promise<boolean> => {
    const r = await setOp(op, min);
    if (!r) { toast.error('Não deu certo', 'Sem conexão ou sessão expirada. Entre de novo e tente outra vez.'); return false; }
    if (r.error) { toast.error('Não deu certo', String(r.error)); return false; }
    await refresh();
    return true;
  };

  if (!state) {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-4 flex items-center gap-3">
        <span className="w-12 h-12 rounded-2xl bg-zinc-100 text-zinc-400 flex items-center justify-center flex-shrink-0">
          <i className={`ri-store-2-line text-2xl ${loading ? 'animate-pulse' : ''}`} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-base font-extrabold text-zinc-900">{loading ? 'Conferindo a situação…' : 'Não consegui ver a situação agora'}</p>
          {!loading && <p className="text-[12.5px] text-zinc-500">Pode ser a conexão. Toque em tentar de novo.</p>}
        </div>
        {!loading && <button type="button" className={btn('out', 'sm')} onClick={() => void refresh()}>Tentar de novo</button>}
      </div>
    );
  }

  const sit = descreverSituacao(state, estadoEm);
  const v = VISUAL[sit.tom];
  const extra = state.prazo_extra_min ?? 0;
  const chipsExtra = [
    { id: '0', rotulo: 'Normal' },
    { id: '15', rotulo: '+15 min' },
    { id: '30', rotulo: '+30 min' },
    ...(extra > 0 && extra !== 15 && extra !== 30 ? [{ id: String(extra), rotulo: `+${extra} min` }] : []),
  ];

  const fechar = async () => {
    const dentroDoHorario = state.reason === 'horario';
    const ok = await confirmar({
      titulo: 'Fechar o delivery agora?',
      mensagem: dentroDoHorario
        ? 'O cliente deixa de poder pedir agora. Como está dentro do horário programado, ele volta a abrir no próximo horário.'
        : 'O cliente deixa de poder pedir agora. Para abrir de novo, é só tocar em "Abrir agora".',
      confirmarLabel: 'Fechar agora', perigo: true,
    });
    if (ok) await rodar('close');
  };

  const pausar = async () => {
    if (await rodar('pause', Number(minutos))) setPausando(false);
  };

  const mudarExtra = async (id: ExtraId) => {
    if (acting || Number(id) === extra) return;
    const min = Number(id);
    if (await rodar('prazo_extra', min)) {
      toast.success(min ? `Prazo de entrega +${min} min` : 'Prazo de entrega normal', min ? 'O cliente já vê o prazo maior no cardápio.' : undefined);
    }
  };

  const podeAbrir = !state.open_now && state.reason !== 'pausado' && state.has_session;

  return (
    <div>
      <div className={`border rounded-2xl px-4 py-4 ${v.fundo}`}>
        <div className="flex items-start gap-3">
          <span className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${v.icone}`}><i className={`${v.icon} text-2xl`} /></span>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-extrabold text-zinc-900 leading-tight">{sit.titulo}</p>
            <p className="text-[13px] text-zinc-600 mt-0.5 leading-snug">{sit.frase}</p>
          </div>
        </div>

        {(state.open_now || state.reason === 'pausado' || podeAbrir) && (
          <div className="flex gap-2 flex-wrap mt-3">
            {state.open_now && (
              <>
                <button type="button" disabled={acting} className={`${btn('out')} flex-1`} onClick={() => { setMinutos('30'); setPausando(true); }}>
                  <i className="ri-pause-line" />Pausar
                </button>
                <button type="button" disabled={acting} className={`${btn('perigo')} flex-1`} onClick={() => void fechar()}>
                  <i className="ri-forbid-line" />Fechar agora
                </button>
              </>
            )}
            {state.reason === 'pausado' && (
              <button type="button" disabled={acting} className={`${btn('p')} flex-1`} onClick={() => void rodar('resume')}>
                {acting ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-play-line" />}Voltar agora
              </button>
            )}
            {podeAbrir && (
              <button type="button" disabled={acting} className={`${btn('p')} flex-1`} onClick={() => void rodar('open')}>
                {acting ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-door-open-line" />}Abrir agora
              </button>
            )}
          </div>
        )}

        {state.open_now && state.has_session && (
          <div className="mt-3.5 pt-3 border-t border-emerald-200/70">
            <p className="text-[13px] font-extrabold text-zinc-900 leading-snug">Dia corrido? Some minutos ao prazo que o cliente vê</p>
            <Chips<ExtraId> className="mt-2" opcoes={chipsExtra} valor={String(extra)} onChange={(id) => void mudarExtra(id)} />
            <p className="text-[11.5px] text-zinc-500 mt-1.5">Volta ao normal sozinho quando o caixa fecha.</p>
          </div>
        )}
      </div>
      <Nota className="mt-2">É o mesmo botão do caixa: abrir, pausar ou fechar aqui vale lá, em todos os aparelhos.</Nota>

      <Folha aberta={pausando} onFechar={() => setPausando(false)} titulo="Pausar o delivery"
        subtitulo='O cliente vê "volta às…" e não consegue pedir'
        rodape={(
          <>
            <button type="button" className={`${btn('out')} flex-1`} onClick={() => setPausando(false)}>Cancelar</button>
            <button type="button" disabled={acting} className={`${btn('p')} flex-1`} onClick={() => void pausar()}>
              {acting && <i className="ri-loader-4-line animate-spin" />}Pausar {minutos === '60' ? '1 hora' : `${minutos} min`}
            </button>
          </>
        )}>
        <Chips<PausaId> className="mt-1 mb-3" valor={minutos} onChange={setMinutos}
          opcoes={[{ id: '15', rotulo: '15 min' }, { id: '30', rotulo: '30 min' }, { id: '60', rotulo: '1 hora' }]} />
        <Nota>É o mesmo botão do caixa: pausar aqui pausa lá também, em todos os aparelhos. Passado o tempo, o delivery volta sozinho.</Nota>
      </Folha>
    </div>
  );
}
