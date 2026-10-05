import { useEffect, useMemo, useState } from 'react';
import { confirmar } from '@/components/base/Dialogos';
import { useDeliveryTela } from '../DeliveryTela';
import {
  btn, Cartao, CartaoAcao, Chips, Colunas, Etiqueta, LinhaInterruptor, Manchete, Nota, PaginaDelivery, SecaoTitulo,
} from '../ui';
import Trilho, { EixoHoras } from './horario/Trilho';
import FolhaDia from './horario/FolhaDia';
import FolhaData from './horario/FolhaData';
import { Aviso } from './horario/EditorIntervalos';
import {
  DIAS_CURTO, DIAS_LONGO, MODELOS, TODOS_OS_DIAS, agoraBrasilia, janelasDoDia, aplicarDia, aplicarModelo, apagarDataEspecial,
  apagarDatasPassadas, descData, modeloAtual, resumoHoje, salvarDataEspecial, semanaVazia, separarDatas, tituloData, txtJanelas,
  type DataEspecial, type HorarioDelivery, type ModeloId,
} from './horario/horarioUtil';
import { normalizarHorarioDelivery } from '../../../../supabase/functions/_shared/horario-delivery';

// Delivery › Pedido › Horário (layout novo aprovado em 2026-10-05, protótipo docs/prototipos/delivery-proposta.html).
// Mexe só no rascunho (`cfg.horario`); a barra "Salvar" da página grava e o servidor normaliza de novo.

export default function HorarioAba() {
  const { cfg, mudar } = useDeliveryTela();
  const h = cfg.horario;

  // Relógio da tela (hora de Brasília): atualiza a cada meio minuto para "agora" e o cartão Hoje ficarem certos.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const br = agoraBrasilia(agora);

  const [diaAberto, setDiaAberto] = useState<number | null>(null);
  const [dataAberta, setDataAberta] = useState<{ original: DataEspecial | null } | null>(null);
  const [verPassadas, setVerPassadas] = useState(false);

  const mudarHorario = (fn: (x: HorarioDelivery) => HorarioDelivery) => mudar((c) => ({ horario: fn(c.horario) }));

  const hoje = useMemo(() => resumoHoje(h, agora), [h, agora]);
  const { proximas, passadas } = useMemo(() => separarDatas(h, br.ymd), [h, br.ymd]);
  const atual = modeloAtual(h);
  const ligado = h.enabled === true;
  const nenhumDia = ligado && semanaVazia(h);

  // De madrugada (antes das 6h) o "agora" cai na barra do dia anterior, que vai até as 6h.
  const diaDaLinha = br.minutes < 360 ? (br.dow + 6) % 7 : br.dow;
  const hhAgora = `${String(Math.floor(br.minutes / 60)).padStart(2, '0')}:${String(br.minutes % 60).padStart(2, '0')}`;

  const trocarModelo = async (id: ModeloId) => {
    const m = MODELOS.find((x) => x.id === id);
    if (!m) return;
    if (!semanaVazia(h)) {
      const ok = await confirmar({
        titulo: `Usar "${m.rotulo}" na semana toda?`,
        mensagem: 'Os 7 dias passam a ter esse horário, no lugar do que está na grade agora. As datas especiais não mudam. Nada é gravado até você tocar em Salvar.',
        confirmarLabel: 'Trocar a semana',
      });
      if (!ok) return;
    }
    mudarHorario((x) => aplicarModelo(x, id));
  };

  return (
    <PaginaDelivery>
      <Manchete titulo="Quando o delivery abre">
        Cada dia pode ter mais de um horário, como almoço e jantar. Entre um e outro o delivery fica fechado e o cliente vê &quot;abre às 18h&quot;.
      </Manchete>

      <Colunas>
        <div className="min-w-0 space-y-4">
          <Cartao>
            <LinhaInterruptor
              titulo="Abrir e fechar sozinho"
              texto={ligado ? 'Só abre com o caixa aberto' : 'Desligado: o delivery só abre e fecha pelo botão do caixa. Dá para preparar a grade abaixo e ligar depois.'}
              ligado={ligado}
              onChange={(v) => mudarHorario((x) => normalizarHorarioDelivery({ ...x, enabled: v }))}
            />
            {nenhumDia && (
              <Aviso tom="aviso">Nenhum dia tem horário. Com o horário ligado assim, o delivery nunca abre sozinho. Escolha um modelo ou toque num dia.</Aviso>
            )}
          </Cartao>

          <div>
            <div className={`rounded-2xl border border-zinc-200 bg-white px-3 pb-1 pt-2 transition-opacity ${ligado ? '' : 'opacity-60'}`}>
              <div className="grid grid-cols-[38px_minmax(0,1fr)_20px] gap-2">
                <span />
                <EixoHoras />
                <span />
              </div>
              {TODOS_OS_DIAS.map((d) => {
                const js = janelasDoDia(h.days?.[String(d)]);
                const ehHoje = d === br.dow;
                return (
                  <button key={d} type="button" onClick={() => setDiaAberto(d)} aria-label={`Editar ${DIAS_LONGO[d]}`}
                    className={`grid w-full cursor-pointer grid-cols-[38px_minmax(0,1fr)_20px] items-center gap-2 border-t border-zinc-100 py-2.5 text-left first:border-t-0 ${ehHoje ? 'rounded-xl bg-amber-50/70 ring-2 ring-inset ring-amber-400' : ''}`}>
                    <b className={`pl-1 text-[13px] font-extrabold ${js.length ? (ehHoje ? 'text-amber-700' : 'text-zinc-900') : 'text-zinc-400'}`}>{DIAS_CURTO[d]}</b>
                    <div className="min-w-0">
                      <Trilho janelas={js} agora={d === diaDaLinha ? br.minutes : null} />
                      <span className={`mt-1.5 block truncate text-[11.5px] font-bold tabular-nums ${js.length ? 'text-zinc-700' : 'text-zinc-400'}`}>{txtJanelas(js)}</span>
                    </div>
                    <i className="ri-arrow-right-s-line text-lg text-zinc-400" />
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-[11.5px] leading-snug text-zinc-500">
              Toque num dia para mudar. A linha preta é agora ({DIAS_LONGO[br.dow].toLowerCase()}, {hhAgora}
              {br.minutes < 360 ? '; de madrugada ela aparece na barra do dia anterior, que vai até as 6h' : ''}).
            </p>
          </div>

          <div>
            <p className="mb-1.5 px-0.5 text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">Começar de um modelo</p>
            <Chips<string> valor={atual ?? ''} onChange={(id) => { void trocarModelo(id as ModeloId); }}
              opcoes={MODELOS.map((m) => ({ id: m.id, rotulo: m.rotulo }))} />
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <SecaoTitulo titulo="Hoje" />
            <CartaoAcao tom={hoje.tom === 'ok' ? 'ok' : 'neutro'} icone={hoje.tom === 'ok' ? 'ri-calendar-check-line' : 'ri-time-line'} titulo={hoje.titulo}>
              <div className="space-y-1">
                {hoje.linhas.map((l, k) => <p key={k}>{l}</p>)}
              </div>
            </CartaoAcao>
          </div>

          <div>
            <SecaoTitulo titulo="Datas especiais" direita={(
              <button type="button" onClick={() => setDataAberta({ original: null })} className={btn('ghost', 'sm')}>
                <i className="ri-add-line" />Data
              </button>
            )} />
            {proximas.length === 0 ? (
              <Cartao><p className="text-[12.5px] leading-snug text-zinc-500">Nenhuma data programada. Use <b>+ Data</b> para um feriado, um evento ou uma folga.</p></Cartao>
            ) : (
              <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                {proximas.map((e) => (
                  <button key={e.date} type="button" onClick={() => setDataAberta({ original: e })}
                    className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-zinc-50">
                    <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${e.closed ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                      <i className={`${e.closed ? 'ri-calendar-close-line' : 'ri-time-line'} text-lg`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[13.5px] font-bold text-zinc-900">
                        {tituloData(e, br.ymd)}{e.date === br.ymd && <span className="ml-1.5 align-middle"><Etiqueta tom="amber">Hoje</Etiqueta></span>}
                      </b>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-zinc-500">{descData(e)}</span>
                    </span>
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-zinc-200 text-zinc-500"><i className="ri-edit-line text-lg" /></span>
                  </button>
                ))}
              </div>
            )}

            {passadas.length > 0 && (
              <div className="mt-2">
                <button type="button" onClick={() => setVerPassadas((v) => !v)}
                  className="inline-flex cursor-pointer items-center gap-1 px-1 py-1 text-[12px] font-bold text-zinc-500 hover:text-zinc-700">
                  <i className={verPassadas ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                  {passadas.length === 1 ? '1 data que já passou' : `${passadas.length} datas que já passaram`}
                </button>
                {verPassadas && (
                  <div className="mt-1 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                    {passadas.map((e) => (
                      <div key={e.date} className="flex items-center gap-3 px-3.5 py-2.5">
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[13px] font-bold text-zinc-500">{tituloData(e, br.ymd)}</b>
                          <span className="block text-[11.5px] text-zinc-400">{descData(e)}</span>
                        </span>
                        <button type="button" aria-label={`Apagar ${tituloData(e, br.ymd)}`}
                          onClick={() => mudarHorario((x) => apagarDataEspecial(x, e.date))}
                          className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100">
                          <i className="ri-delete-bin-line text-lg" />
                        </button>
                      </div>
                    ))}
                    {passadas.length > 1 && (
                      <div className="px-3 py-2">
                        <button type="button" onClick={() => { mudarHorario((x) => apagarDatasPassadas(x, br.ymd)); setVerPassadas(false); }} className={btn('perigo', 'sm')}>
                          Apagar as {passadas.length} que já passaram
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <Nota className="mt-2">
              Vale só naquele dia; no dia seguinte volta ao horário da semana. Para fechar agora, sem programar, use <b>Pausar</b> no Início.
            </Nota>
          </div>
        </div>
      </Colunas>

      {diaAberto != null && (
        <FolhaDia
          key={diaAberto} dow={diaAberto} horario={h}
          aoFechar={() => setDiaAberto(null)}
          aoPronto={(dias, lig, ints) => { mudarHorario((x) => aplicarDia(x, dias, lig, ints)); setDiaAberto(null); }}
        />
      )}

      {dataAberta && (
        <FolhaData
          key={dataAberta.original?.date ?? 'nova'}
          original={dataAberta.original} hoje={br.ymd}
          outrasDatas={(h.exceptions ?? []).map((e) => e.date).filter((d) => d !== dataAberta.original?.date)}
          aoFechar={() => setDataAberta(null)}
          aoPronto={(d) => { mudarHorario((x) => salvarDataEspecial(x, dataAberta.original?.date ?? null, d)); setDataAberta(null); }}
          aoApagar={dataAberta.original ? () => { mudarHorario((x) => apagarDataEspecial(x, dataAberta.original!.date)); setDataAberta(null); } : undefined}
        />
      )}
    </PaginaDelivery>
  );
}
