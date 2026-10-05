import { useCallback, useMemo, useRef, useState, type FocusEvent } from 'react';
import { useDeliveryTela } from '../DeliveryTela';
import { chamarDelivery, type FaixaEntrega } from '../config';
import { btn, brl, CampoNumero, CartaoAcao, Colunas, Manchete, Nota, PaginaDelivery, SecaoTitulo } from '../ui';
import MapaArea from './area/MapaArea';
import PinoFolha from './area/PinoFolha';
import { usePedidos30d } from './area/usePedidos30d';
import {
  FAIXAS_INICIAIS, FATOR_CAMINHO, avisosDasLinhas, cotarComFaixas, distanciaKm, faixaDoKm, faixasIguais, faixasSemPedido,
  faixasValidas, kmTxt, listaKm, proximaFaixa, raiosDoMapa, resumoDistancia, usoPorLinha,
} from './area/calculos';

// Pedido › Área e taxa. Mapa com os círculos das faixas e os pedidos do mês, teste de endereço (toque no mapa),
// faixas editáveis com quantos pedidos caíram em cada uma, pino da loja e cidade. Nada grava aqui: muda o
// rascunho e a barra "Salvar" da página grava tudo.

/** Resposta de delivery-write › quote_delivery_fee (a conta do servidor, com a configuração SALVA). */
interface Cotacao {
  mode?: string;
  km: number | null;
  fee?: number;
  fee_faixa?: number;
  tempo_max_min: number | null;
  route_min: number | null;
  dentro_area?: boolean;
  prazo_extra_min?: number;
}

type Teste =
  | { lat: number; lng: number; estado: 'carregando' }
  | { lat: number; lng: number; estado: 'aviso' | 'erro'; msg: string }
  | {
      lat: number; lng: number; estado: 'ok'; resp: Cotacao;
      /** O que estava salvo quando o servidor calculou (a conta dele vale só para isso). */
      baseFaixas: FaixaEntrega[]; baseLat: number | null; baseLng: number | null;
    };

interface Resultado {
  dentro: boolean;
  km: number;
  taxa: number;
  ateKm: number;
  tempo: number | null;
  rotaMin: number | null;
  /** Maior km entre as faixas usadas na conta. */
  ultimaKm: number;
  /** Km é estimativa em linha reta (o pino novo ainda não foi salvo). */
  estimado: boolean;
  nota: string | null;
}

/** 1 casa (2; 2,5); 2 só quando o km tem centésimos (2,25), para a tela não arredondar o que está salvo. */
const casasKm = (v: number) => (Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2);
const msgDe = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));

export default function AreaTaxaAba() {
  const { tenantId, cfg, salvo, mudar } = useDeliveryTela();
  const { pedidos, carregando, erro } = usePedidos30d(tenantId);

  const [pinoAberto, setPinoAberto] = useState(false);
  const [modo, setModo] = useState<'perto' | 'tudo'>('perto');
  const [teste, setTeste] = useState<Teste | null>(null);
  const seqTeste = useRef(0);

  const loja = cfg.lojaLat != null && cfg.lojaLng != null ? { lat: cfg.lojaLat, lng: cfg.lojaLng } : null;
  const validas = useMemo(() => faixasValidas(cfg.faixas), [cfg.faixas]);

  // ── pedidos dos 30 dias ──
  const kms = useMemo(() => pedidos.map((p) => p.km).filter((k): k is number => k != null && k > 0), [pedidos]);
  const pontos = useMemo(
    () => pedidos.filter((p) => p.lat != null && p.lng != null).map((p) => ({ lat: p.lat as number, lng: p.lng as number })),
    [pedidos],
  );
  const uso = useMemo(() => usoPorLinha(cfg.faixas, kms), [cfg.faixas, kms]);
  const avisos = useMemo(() => avisosDasLinhas(cfg.faixas), [cfg.faixas]);
  const semPedido = useMemo(() => faixasSemPedido(cfg.faixas, uso), [cfg.faixas, uso]);
  const resumo = useMemo(() => resumoDistancia(kms, cfg.faixas), [kms, cfg.faixas]);
  const raios = useMemo(() => raiosDoMapa(cfg.faixas, kms), [cfg.faixas, kms]);
  const temTudo = raios.tudoKm > raios.pertoKm * 1.05;

  // ── edição das faixas (só o rascunho) ──
  const editar = (i: number, patch: Partial<FaixaEntrega>) =>
    mudar((c) => ({ faixas: c.faixas.map((f, k) => (k === i ? { ...f, ...patch } : f)) }));
  const remover = (i: number) => mudar((c) => ({ faixas: c.faixas.filter((_, k) => k !== i) }));
  const adicionar = () => mudar((c) => ({ faixas: [...c.faixas, proximaFaixa(c.faixas)] }));
  const criarIniciais = () => mudar({ faixas: FAIXAS_INICIAIS.map((f) => ({ ...f })) });
  // Ao sair da lista, põe em ordem de km (o servidor ordena ao salvar; aqui a ordem na tela passa a ser a mesma).
  const ordenarAoSair = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    const ordenadas = cfg.faixas.slice().sort((a, b) => a.ate_km - b.ate_km);
    if (ordenadas.some((f, i) => f !== cfg.faixas[i])) mudar({ faixas: ordenadas });
  };

  // ── testar um endereço (toque no mapa) ──
  const testar = useCallback(async (lat: number, lng: number) => {
    const seq = ++seqTeste.current;
    if (salvo.lojaLat == null || salvo.lojaLng == null) {
      setTeste({ lat, lng, estado: 'aviso', msg: 'O pino da loja ainda não foi salvo. Salve (barra de baixo) para poder testar um endereço.' });
      return;
    }
    if (faixasValidas(salvo.faixas).length === 0) {
      setTeste({ lat, lng, estado: 'aviso', msg: 'Nenhuma faixa foi salva ainda. Salve as faixas (barra de baixo) para poder testar um endereço.' });
      return;
    }
    setTeste({ lat, lng, estado: 'carregando' });
    try {
      const r = await chamarDelivery<Cotacao>('quote_delivery_fee', { tenant_id: tenantId, lat, lng });
      if (seq !== seqTeste.current) return;
      if (r.mode !== 'distancia' || r.km == null) {
        setTeste({ lat, lng, estado: 'aviso', msg: 'O servidor não calculou pela distância. Confira se o pino e as faixas estão salvos.' });
        return;
      }
      setTeste({ lat, lng, estado: 'ok', resp: r, baseFaixas: salvo.faixas, baseLat: salvo.lojaLat, baseLng: salvo.lojaLng });
    } catch (e) {
      if (seq === seqTeste.current) setTeste({ lat, lng, estado: 'erro', msg: msgDe(e) });
    }
  }, [salvo.lojaLat, salvo.lojaLng, salvo.faixas, tenantId]);

  // O servidor calcula com o que estava SALVO na hora do toque (`base`). Se as faixas (ou o pino) da tela são outras —
  // ainda não salvas, ou salvas depois do teste —, refaz a conta aqui com o km que ele devolveu, e acompanha a edição
  // das faixas sem tocar no mapa de novo.
  const resultado = useMemo<Resultado | 'sem_faixas' | null>(() => {
    if (!teste || teste.estado !== 'ok') return null;
    const r = teste.resp;
    const km = Number(r.km);
    const extra = Number(r.prazo_extra_min) || 0;
    const pinoDiferente = cfg.lojaLat !== teste.baseLat || cfg.lojaLng !== teste.baseLng;
    const faixasDiferentes = !faixasIguais(cfg.faixas, teste.baseFaixas);

    if (!pinoDiferente && !faixasDiferentes) {
      const f = faixaDoKm(km, teste.baseFaixas);
      return {
        dentro: r.dentro_area === true, km, taxa: Number(r.fee_faixa) || 0, ateKm: f?.faixa.ate_km ?? 0,
        tempo: r.tempo_max_min, rotaMin: r.route_min, ultimaKm: faixasValidas(teste.baseFaixas).slice(-1)[0]?.ate_km ?? 0,
        estimado: false, nota: null,
      };
    }

    let kmUsado = km;
    let estimado = false;
    if (pinoDiferente && cfg.lojaLat != null && cfg.lojaLng != null) {
      kmUsado = Math.round(distanciaKm(cfg.lojaLat, cfg.lojaLng, teste.lat, teste.lng) * FATOR_CAMINHO * 100) / 100;
      estimado = true;
    }
    const c = cotarComFaixas(kmUsado, cfg.faixas, extra);
    if (!c) return 'sem_faixas';
    const partes: string[] = [];
    if (!faixasIguais(cfg.faixas, salvo.faixas)) partes.push('Calculado com as faixas ainda não salvas.');
    if (estimado) {
      partes.push(cfg.lojaLat !== salvo.lojaLat || cfg.lojaLng !== salvo.lojaLng
        ? 'Calculado com o pino novo, ainda não salvo: a distância é uma estimativa em linha reta + 30%.'
        : 'O pino mudou depois do teste: a distância é uma estimativa em linha reta + 30%. Toque no mapa de novo para medir pelo caminho de moto.');
    }
    return {
      dentro: c.dentro, km: kmUsado, taxa: c.taxa, ateKm: c.ateKm, tempo: c.tempoMax,
      rotaMin: estimado ? null : r.route_min, ultimaKm: validas.slice(-1)[0]?.ate_km ?? c.ateKm,
      estimado, nota: partes.length ? partes.join(' ') : null,
    };
  }, [teste, cfg.faixas, cfg.lojaLat, cfg.lojaLng, salvo.faixas, salvo.lojaLat, salvo.lojaLng, validas]);

  const pinoMudou = cfg.lojaLat !== salvo.lojaLat || cfg.lojaLng !== salvo.lojaLng;
  const ultimo = validas.length ? validas[validas.length - 1].ate_km : 0;
  const foraDoMes = uso.fora;
  const abrangeTudo = modo === 'tudo';

  return (
    <PaginaDelivery>
      <Colunas>
        {/* ── esquerda: mapa e teste ── */}
        <div className="space-y-3 min-w-0">
          <Manchete titulo="Até onde você entrega">
            A taxa e o prazo saem do caminho de moto da loja até o pino do cliente. Mais longe que a última faixa, o app não deixa pedir.
          </Manchete>

          {!loja && (
            <CartaoAcao tom="alerta" icone="ri-map-pin-2-line" titulo="Falta marcar a loja no mapa"
              acoes={<button type="button" className={btn('p', 'sm')} onClick={() => setPinoAberto(true)}>Marcar a loja</button>}>
              Sem o pino, o app não sabe a distância e o cliente não consegue pedir entrega.
            </CartaoAcao>
          )}

          <MapaArea
            loja={loja}
            faixas={validas}
            pedidos={pontos}
            teste={teste ? { lat: teste.lat, lng: teste.lng } : null}
            raioKm={abrangeTudo ? raios.tudoKm : raios.pertoKm}
            enquadre={`${modo}|${loja?.lat ?? ''}|${loja?.lng ?? ''}|${carregando ? 'c' : 'ok'}`}
            onTestar={testar}
            onMoverPino={() => setPinoAberto(true)}
            acaoExtra={temTudo ? (
              <button type="button" onClick={() => setModo(abrangeTudo ? 'perto' : 'tudo')}
                title={abrangeTudo ? 'Aproximar da loja' : `Ver até ${kmTxt(ultimo)} km`}
                className="h-9 px-2.5 rounded-xl bg-white border border-zinc-200 shadow text-zinc-700 hover:bg-zinc-50 flex items-center gap-1 text-[12px] font-bold cursor-pointer">
                <i className={abrangeTudo ? 'ri-zoom-in-line' : 'ri-zoom-out-line'} />
                {abrangeTudo ? 'De perto' : `Ver até ${kmTxt(ultimo)} km`}
              </button>
            ) : null}
          />

          {/* legenda */}
          <div className="text-[12.5px] text-zinc-600 leading-snug px-0.5">
            {carregando ? (
              <span className="text-zinc-400"><i className="ri-loader-4-line animate-spin mr-1" />Lendo os pedidos dos últimos 30 dias…</span>
            ) : erro ? (
              <span className="text-red-600"><i className="ri-error-warning-line mr-1" />Não consegui ler os pedidos do mês: {erro}</span>
            ) : resumo ? (
              <>
                <b className="text-zinc-900">{resumo.pct}% dos pedidos até {kmTxt(resumo.ateKm)} km</b>
                <br />
                <i className="ri-checkbox-blank-circle-fill text-[9px] text-blue-600 mr-1" />
                {pontos.length === 1 ? '1 pedido' : `${pontos.length} pedidos`} dos últimos 30 dias no mapa
                {pontos.length < resumo.total && ` (${resumo.total} no total; os outros não guardaram o endereço)`}
              </>
            ) : (
              <span className="text-zinc-400">Nenhum pedido de entrega com distância nos últimos 30 dias.</span>
            )}
          </div>

          {/* testar um endereço */}
          <div>
            <p className="text-[13.5px] font-extrabold text-zinc-900 px-0.5 mb-1.5">
              Testar um endereço <small className="text-[11.5px] font-semibold text-zinc-400">toque no mapa</small>
            </p>
            <CartaoTeste teste={teste} resultado={resultado} />
          </div>

          <Nota>
            Os círculos são em linha reta; a taxa usa o caminho de moto, que costuma dar uns 30% a mais. Na dúvida, teste o endereço.
          </Nota>
        </div>

        {/* ── direita: faixas e loja ── */}
        <div className="space-y-3 min-w-0">
          <div>
            <SecaoTitulo titulo="Faixas" n={cfg.faixas.length} tomN="zinc"
              direita={<button type="button" className={btn('ghost', 'sm')} onClick={adicionar}><i className="ri-add-line" />Faixa</button>} />

            {validas.length === 0 && (
              <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo="Sem faixas, o cliente não consegue pedir entrega"
                acoes={<button type="button" className={btn('p', 'sm')} onClick={criarIniciais}>Criar faixas</button>}
                className="mb-2">
                Cada faixa tem a distância, a taxa e o prazo. Começo com 2 km a {brl(6)} (40 min) e 4 km a {brl(9)} (50 min); você ajusta depois.
              </CartaoAcao>
            )}

            {(cfg.faixas.length > 0) && (
              <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100 overflow-hidden" onBlur={ordenarAoSair}>
                {cfg.faixas.map((f, i) => {
                  const anterior = faixasValidas(cfg.faixas).filter((g) => g.ate_km < f.ate_km).slice(-1)[0];
                  const n = uso.contagem[i];
                  const valida = f.ate_km > 0 && !uso.duplicada[i];
                  return (
                    <div key={i} className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CampoNumero valor={f.ate_km} onChange={(v) => editar(i, { ate_km: v })} prefixo="até" sufixo="km"
                          casas={casasKm(f.ate_km)}
                          largura="w-9" rotulo={`Distância da faixa ${i + 1}, em km`} placeholder="0" />
                        <CampoNumero valor={f.taxa} onChange={(v) => editar(i, { taxa: v })} prefixo="R$" casas={2}
                          largura="w-12" rotulo={`Taxa da faixa ${i + 1}`} placeholder="0,00" />
                        <CampoNumero valor={f.tempo_max_min} onChange={(v) => editar(i, { tempo_max_min: Math.round(v) })} sufixo="min" casas={0}
                          largura="w-9" rotulo={`Prazo da faixa ${i + 1}, em minutos`} placeholder="0" />
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 text-[11.5px] text-zinc-500">
                            <span className="truncate">
                              {!valida ? 'não vale' : anterior ? `de ${kmTxt(anterior.ate_km)} a ${kmTxt(f.ate_km)} km` : 'perto'}
                            </span>
                            {valida && !carregando && !erro && (
                              <b className="text-zinc-800 whitespace-nowrap">{n} {n === 1 ? 'pedido' : 'pedidos'}</b>
                            )}
                          </div>
                          {valida && !carregando && !erro && (
                            <div className="h-1.5 rounded-full bg-zinc-100 mt-1 overflow-hidden" aria-hidden>
                              <div className="h-full rounded-full bg-amber-400" style={{ width: `${uso.total ? Math.round((n / uso.total) * 100) : 0}%` }} />
                            </div>
                          )}
                        </div>
                        <button type="button" onClick={() => remover(i)} title="Remover esta faixa" aria-label={`Remover a faixa ${i + 1}`}
                          className="w-9 h-9 flex-shrink-0 rounded-xl border border-zinc-200 text-zinc-400 hover:text-red-600 hover:border-red-200 flex items-center justify-center cursor-pointer">
                          <i className="ri-delete-bin-line text-base" />
                        </button>
                      </div>
                      {avisos[i]?.map((a) => (
                        <p key={a} className="text-[11.5px] text-amber-700 mt-1.5 flex items-start gap-1 leading-snug">
                          <i className="ri-error-warning-line mt-px" />{a}
                        </p>
                      ))}
                    </div>
                  );
                })}
                {validas.length > 0 && (
                  <div className="px-3 py-3 flex items-start gap-2 text-[12.5px] text-zinc-500 leading-snug bg-zinc-50/60">
                    <i className="ri-forbid-2-line text-base text-red-500 flex-shrink-0" />
                    <span>
                      Mais de {kmTxt(ultimo)} km: não entrega (o cliente vê "fora da área")
                      {foraDoMes > 0 && <b className="text-zinc-700"> · {foraDoMes} {foraDoMes === 1 ? 'pedido' : 'pedidos'} do mês ficou além</b>}
                    </span>
                  </div>
                )}
              </div>
            )}
            {cfg.faixas.length > 1 && <p className="text-[11px] text-zinc-400 mt-1.5 px-0.5">As faixas ficam em ordem de km ao salvar.</p>}
          </div>

          {semPedido.length > 0 && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 leading-snug">
              <i className="ri-lightbulb-line text-base text-amber-600 flex-shrink-0" />
              <span>
                {semPedido.length === 1 ? `A faixa de ${listaKm(semPedido)} não teve pedido` : `As faixas de ${listaKm(semPedido)} não tiveram pedido`} no mês.
                Não precisa mudar; é só para você saber onde estão os seus clientes.
              </span>
            </div>
          )}

          <div>
            <SecaoTitulo titulo="Onde fica a loja" />
            <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
              <div className="flex items-center gap-3 px-3 py-3">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${loja ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  <i className="ri-map-pin-2-fill text-lg" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold text-zinc-900">{loja ? 'Pino da loja marcado' : 'Pino da loja não marcado'}</p>
                  <p className="text-xs text-zinc-500 leading-snug">
                    {!loja ? 'Sem ele o cliente não consegue pedir entrega'
                      : pinoMudou ? 'Pino novo, ainda não salvo: a taxa dos próximos pedidos muda quando você salvar'
                      : 'É de onde sai o caminho de cada entrega'}
                  </p>
                  {loja && (
                    <p className="text-[11px] text-zinc-400 leading-snug mt-0.5 tabular-nums">
                      Loja marcada em {loja.lat.toFixed(5)}, {loja.lng.toFixed(5)}
                    </p>
                  )}
                </div>
                <button type="button" className={btn(loja ? 'out' : 'p', 'sm')} onClick={() => setPinoAberto(true)}>{loja ? 'Mover' : 'Marcar'}</button>
              </div>
              <div className="flex items-center gap-3 px-3 py-3">
                <span className="w-9 h-9 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center flex-shrink-0"><i className="ri-building-line text-lg" /></span>
                <label className="flex-1 min-w-0 block">
                  <span className="block text-sm font-extrabold text-zinc-900">Cidade de entrega</span>
                  <input type="text" value={cfg.cidade} onChange={(e) => mudar({ cidade: e.target.value })} placeholder="Ex.: Paranaguá"
                    className="mt-1 w-full h-9 px-3 rounded-xl border border-zinc-200 bg-white text-[13.5px] text-zinc-900 outline-none focus:border-amber-400" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </Colunas>

      <PinoFolha
        aberta={pinoAberto}
        lat={cfg.lojaLat}
        lng={cfg.lojaLng}
        onFechar={() => setPinoAberto(false)}
        onUsar={(lat, lng) => { mudar({ lojaLat: lat, lojaLng: lng }); setPinoAberto(false); }}
      />
    </PaginaDelivery>
  );
}

/** Cartão do resultado do teste: verde dentro da área, vermelho fora, cinza enquanto não testou. */
function CartaoTeste({ teste, resultado }: { teste: Teste | null; resultado: Resultado | 'sem_faixas' | null }) {
  if (!teste) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-3 flex items-center gap-2.5 text-[12.5px] text-zinc-500 leading-snug">
        <i className="ri-map-pin-line text-lg text-zinc-400" />
        Toque no mapa onde fica o endereço do cliente para ver a taxa, a distância e o prazo.
      </div>
    );
  }
  if (teste.estado === 'carregando') {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 flex items-center gap-2.5 text-[12.5px] text-zinc-600">
        <i className="ri-loader-4-line animate-spin text-lg" />Calculando o caminho de moto…
      </div>
    );
  }
  if (teste.estado === 'erro') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700 leading-snug">
        <b>Não consegui calcular.</b> {teste.msg}
      </div>
    );
  }
  if (teste.estado === 'aviso') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900 leading-snug">
        <i className="ri-information-line mr-1" />{teste.msg}
      </div>
    );
  }
  if (resultado === 'sem_faixas' || !resultado) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900 leading-snug">
        <i className="ri-information-line mr-1" />Não há faixa na tela para calcular. Crie as faixas e toque no mapa de novo.
      </div>
    );
  }
  const r = resultado;
  return (
    <div className="space-y-1.5">
      {r.dentro ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
          <p className="text-[26px] leading-none font-extrabold text-emerald-800 tabular-nums flex-shrink-0">{brl(r.taxa)}</p>
          <div className="min-w-0 text-[12.5px] text-emerald-900/80 leading-snug">
            <b className="block text-[13px] text-emerald-900">
              {kmTxt(r.km, 1)} km {r.estimado ? 'estimados' : 'pelo caminho'} · faixa até {kmTxt(r.ateKm)} km
            </b>
            {r.tempo != null && <>Chega em até {r.tempo} min</>}
            {r.rotaMin != null && <> · rota de moto ≈ {r.rotaMin} min</>}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
          <i className="ri-forbid-2-line text-2xl text-red-500 flex-shrink-0" />
          <div className="min-w-0 text-[12.5px] text-red-800/80 leading-snug">
            <b className="block text-[13px] text-red-800">Fora da área ({kmTxt(r.km, 1)} km)</b>
            A última faixa vai até {kmTxt(r.ultimaKm)} km: o cliente vê "fora da área" e não consegue pedir daí.
          </div>
        </div>
      )}
      {r.nota && <p className="text-[11.5px] text-amber-700 leading-snug px-0.5"><i className="ri-information-line mr-1" />{r.nota}</p>}
    </div>
  );
}
