import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useEstoque, type InventarioSession } from '../../../contexts/EstoqueContext';
import { contagemDeHoje, descreverFrequencia, itensDoPlano, quandoFica, type InsumoSituacao } from '@/lib/estoqueRegras';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import { dataBRparaYmd, diaCurto, diasEntre, reaisComSinal, resumirContagem, textoDiasSemContar } from '@/lib/contagemResumo';
import { useEstoqueTela } from '../EstoqueTela';
import ContagemInventario from './ContagemInventario';
import DetalheInventario from './DetalheInventario';
import DivergenciaPanel from './DivergenciaPanel';
import { CartaoAcao, CartaoBarra, Etiqueta, Pagina, SecaoTitulo, Vazio, btn, brl } from './ui/EstoqueUi';

type View = 'historico' | 'contagem' | 'detalhe';

function temRascunhoSalvo(tenantId: string): boolean {
  if (!tenantId) return false;
  try {
    const raw = localStorage.getItem(`erpos_inventario_draft_${tenantId}`);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    return draft.contagens && Object.keys(draft.contagens).length > 0;
  } catch {
    return false;
  }
}

const minutosPara = (n: number) => Math.max(1, Math.round(n * 0.7));
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export default function InventarioTab() {
  const { inventarioSessions } = useEstoque();
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const { situacao, recarregarSituacao, contar, abrirFicha, abrirProgramar, podeConfigurar, podeContar, duvidas } = useEstoqueTela();
  const duvidasLista = (situacao?.insumos ?? []).filter((i) => duvidas.has(i.id));
  const podeInventariar = hasPermissao('estoque_inventario');
  const [view, setView] = useState<View>('historico');
  const [sessionDetalhe, setSessionDetalhe] = useState<InventarioSession | null>(null);
  const [startFresh, setStartFresh] = useState(false);
  // 'escolher' = quem pediu contagem cheia com rascunho aberto; 'descartar' = quem tocou em "Descartar".
  const [modalRascunho, setModalRascunho] = useState<null | 'escolher' | 'descartar'>(null);

  const tenantId = user?.tenantId ?? '';
  // Rascunho pode estar neste aparelho ou no banco (começado em outro celular).
  const [temNoBanco, setTemNoBanco] = useState(false);
  useEffect(() => {
    if (!tenantId || view !== 'historico') return;
    let vivo = true;
    supabase.rpc('inventario_rascunho_ler', { p_tenant_id: tenantId }).then(({ data, error }) => {
      if (vivo) setTemNoBanco(!error && Array.isArray(data) && data.length > 0);
    });
    return () => { vivo = false; };
  }, [tenantId, view]);
  const hasDraft = temRascunhoSalvo(tenantId) || temNoBanco;

  const handleNovaContagem = () => {
    if (!podeInventariar) return;
    if (hasDraft) {
      setModalRascunho('escolher');
    } else {
      setStartFresh(false);
      setView('contagem');
    }
  };

  const handleRetomarRascunho = () => {
    if (!podeInventariar) return;
    setModalRascunho(null);
    setStartFresh(false);
    setView('contagem');
  };

  const handleNovaContagemLimpa = () => {
    if (!podeInventariar) return;
    setModalRascunho(null);
    setStartFresh(true);
    setView('contagem');
  };

  const sairDaContagem = () => { setView('historico'); void recarregarSituacao(); };

  if (view === 'contagem') {
    return (
      <Pagina>
        <ContagemInventario
          operador={user?.nome ?? 'Operador'}
          onConcluido={sairDaContagem}
          onCancelar={() => setView('historico')}
          startFresh={startFresh}
        />
      </Pagina>
    );
  }

  if (view === 'detalhe' && sessionDetalhe) {
    // Versão mais recente da contagem (depois de uma edição a lista é recarregada)
    const atual = inventarioSessions.find((s) => s.id === sessionDetalhe.id) ?? sessionDetalhe;
    return (
      <Pagina>
        <DetalheInventario
          session={atual}
          sessoesMaisNovas={inventarioSessions.filter((s) => s.numero > atual.numero)}
          podeEditar={podeInventariar}
          onVoltar={() => { setView('historico'); setSessionDetalhe(null); }}
        />
      </Pagina>
    );
  }

  // ── View padrão: o que contar agora + contagens feitas ──────────────────────
  const hoje = situacao?.hoje ?? todayBrasilia();
  const contagem = situacao ? contagemDeHoje(situacao) : null;
  const conferir = contagem?.conferir ?? [];
  const devidos = contagem?.devidos ?? [];
  const planos = contagem?.planos ?? [];

  // Itens das contagens programadas que estão para hoje (ou atrasadas), sem repetir.
  const itensDevidos: InsumoSituacao[] = [];
  const vistos = new Set<string>();
  for (const d of devidos) for (const i of d.pendentes) if (!vistos.has(i.id)) { vistos.add(i.id); itensDevidos.push(i); }

  // Há quantos dias foi a última contagem (dia de Brasília)
  const ultimaTs = (situacao?.insumos ?? []).reduce<string | null>(
    (m, i) => (i.ultimaContagem && (!m || new Date(i.ultimaContagem).getTime() > new Date(m).getTime()) ? i.ultimaContagem : m), null);
  const ultimaYmd = ultimaTs ? dateKeyBrasilia(ultimaTs) : inventarioSessions[0] ? dataBRparaYmd(inventarioSessions[0].data) : null;
  const diasSemContar = ultimaYmd ? diasEntre(ultimaYmd, hoje) : null;

  const negativos = conferir.filter((i) => i.estoque < 0).length;
  const marcados = conferir.length - negativos;
  const tituloConferir = marcados === 0
    ? `${conferir.length} ${plural(conferir.length, 'insumo com número negativo', 'insumos com número negativo')}`
    : `${conferir.length} ${plural(conferir.length, 'insumo', 'insumos')} para conferir`;

  const proximos = [...planos].sort((a, b) => Number(b.pendentes.length > 0) - Number(a.pendentes.length > 0) || a.proxima.localeCompare(b.proxima));
  const proxima = devidos.length === 0 && planos.length > 0 ? proximos[0] : null;

  return (
    <Pagina>
      {/* Rascunho pendente */}
      {hasDraft && podeInventariar && (
        <CartaoAcao tom="prop" icone="ri-draft-line" titulo="Você começou uma contagem e não terminou"
          acoes={(
            <>
              <button onClick={handleRetomarRascunho} className={btn('p', 'sm')}><i className="ri-play-line" />Continuar</button>
              <button onClick={() => setModalRascunho('descartar')} className={btn('perigo', 'sm')}>Descartar e começar do zero</button>
            </>
          )}>
          Continue de onde parou. O que já foi contado está guardado.
        </CartaoAcao>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {/* Esquerda: o que contar agora */}
        <div className="space-y-3">
          {duvidasLista.length > 0 && (
            <CartaoAcao tom="prop" icone="ri-flag-fill" titulo={`${duvidasLista.length} ${plural(duvidasLista.length, 'item em dúvida', 'itens em dúvida')}`}
              acoes={podeContar ? (
                <button onClick={() => contar(duvidasLista, 'Em dúvida')} className={`${btn('dark')} w-full`}>
                  <i className="ri-scales-3-line" />Contar {duvidasLista.length === 1 ? 'esse' : `os ${duvidasLista.length}`} de novo
                </button>
              ) : undefined}>
              A contagem deixou para decidir depois: {duvidasLista.slice(0, 6).map((i) => i.nome).join(', ')}{duvidasLista.length > 6 ? '…' : ''}. Contando, a marca sai sozinha.
            </CartaoAcao>
          )}

          {conferir.length > 0 && (
            <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo={tituloConferir}
              direita={<Etiqueta tom="amber">~{minutosPara(conferir.length)} min</Etiqueta>}
              acoes={podeContar ? (
                <button onClick={() => contar(conferir, 'Conferir')} className={`${btn('dark')} w-full`}>
                  <i className="ri-scales-3-line" />Contar {conferir.length === 1 ? 'esse' : `os ${conferir.length}`} agora
                </button>
              ) : undefined}>
              <p>
                Não existe estoque menor que zero: alguma venda baixou o que não tinha.
                {' '}Conte só {conferir.length === 1 ? 'esse' : `esses ${conferir.length}`} e o número volta a valer.
                {marcados > 0 && ` ${marcados} ${plural(marcados, 'está marcado', 'estão marcados')} como esgotado, mas ${plural(marcados, 'tem', 'têm')} saldo.`}
              </p>
              <div className="flex gap-1.5 flex-wrap mt-2">
                {conferir.slice(0, 6).map((i) => (
                  <button key={i.id} type="button" onClick={() => abrirFicha(i.id)} title="Abrir a ficha do insumo"
                    className="inline-flex items-center h-7 px-2.5 rounded-full border border-red-200 bg-red-50 text-red-700 text-xs font-bold cursor-pointer hover:bg-red-100 whitespace-nowrap">
                    {i.nome}
                  </button>
                ))}
                {conferir.length > 6 && (
                  <span className="inline-flex items-center h-7 px-2.5 rounded-full border border-zinc-200 bg-white text-zinc-500 text-xs font-bold">+{conferir.length - 6}</span>
                )}
              </div>
              {!podeContar && <p className="text-[11.5px] text-zinc-400 mt-2">Contar é com quem tem a permissão de inventário.</p>}
            </CartaoAcao>
          )}

          <CartaoAcao tom="neutro" icone="ri-calendar-schedule-line"
            titulo={!situacao ? 'Próxima contagem'
              : devidos.length > 0 ? 'Tem contagem para fazer agora'
              : proxima ? `Próxima contagem: ${quandoFica(proxima.proxima, hoje)}`
              : 'Próxima contagem: nenhuma programada'}
            acoes={(
              <>
                {devidos.length > 0 && podeContar && (
                  <button onClick={() => contar(itensDevidos, devidos.length === 1 ? devidos[0].plano.nome : 'Contagem de hoje')} className={btn('dark', 'sm')}>
                    <i className="ri-scales-3-line" />Contar agora ({itensDevidos.length} · ~{minutosPara(itensDevidos.length)} min)
                  </button>
                )}
                {situacao && podeConfigurar && (
                  <button onClick={abrirProgramar} className={btn(planos.length === 0 ? 'p' : 'out', 'sm')}>
                    <i className="ri-calendar-schedule-line" />{planos.length === 0 ? 'Programar contagens' : 'Mudar as contagens programadas'}
                  </button>
                )}
                {podeInventariar && (
                  <button onClick={handleNovaContagem} className={btn('out', 'sm')}><i className="ri-clipboard-line" />Contagem cheia agora</button>
                )}
              </>
            )}>
            {!situacao ? (
              <p>Carregando as contagens programadas…</p>
            ) : planos.length === 0 ? (
              <>
                <p>
                  {textoDiasSemContar(diasSemContar)} Programe quando contar e o que contar:
                  {' '}no dia, quem cuida do estoque recebe aviso no celular.
                </p>
                {!podeConfigurar && <p className="text-[11.5px] text-zinc-400 mt-1.5">Quem programa é o supervisor ou o dono.</p>}
              </>
            ) : (
              <ul className="space-y-1">
                {proximos.map((p) => {
                  const total = p.pendentes.length + p.contados.length;
                  const devido = p.pendentes.length > 0;
                  const nItens = itensDoPlano(p.plano, situacao.insumos).length;
                  return (
                    <li key={p.plano.id}>
                      <b className="text-zinc-800">{p.plano.nome}</b> · {descreverFrequencia(p.plano)}
                      {devido
                        ? <> · {p.pendentes.length} de {total} {plural(total, 'item', 'itens')} por contar, <span className={p.atraso > 0 ? 'font-bold text-red-600' : 'font-bold text-amber-700'}>
                            {p.atraso > 0 ? `atrasada ${p.atraso} ${plural(p.atraso, 'dia', 'dias')}` : 'é hoje'}</span></>
                        : <> · {quandoFica(p.proxima, hoje)} · {nItens} {plural(nItens, 'item', 'itens')}</>}
                    </li>
                  );
                })}
              </ul>
            )}
            {devidos.length > 0 && !podeContar && <p className="text-[11.5px] text-zinc-400 mt-1.5">Contar é com quem tem a permissão de inventário.</p>}
          </CartaoAcao>
        </div>

        {/* Direita: contagens feitas */}
        <div>
          <SecaoTitulo titulo="Contagens feitas" n={inventarioSessions.length} tomN="zinc" />
          {inventarioSessions.length === 0 ? (
            <Vazio icone="ri-clipboard-line" titulo="Nenhuma contagem ainda">
              A primeira contagem define o estoque de partida. Quando você fizer, ela aparece aqui com o que deu diferença.
              {podeInventariar ? ' Para começar, use “Contagem cheia agora”.' : ' Seu perfil não tem permissão para realizar inventário.'}
            </Vazio>
          ) : (
            <div className="space-y-2.5">
              {inventarioSessions.map((s, idx) => (
                <CartaoContagem key={s.id} session={s} hoje={hoje} maisRecente={idx === 0}
                  onAbrir={() => { setSessionDetalhe(s); setView('detalhe'); }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Contagem cheia com rascunho aberto: continuar ou recomeçar */}
      {modalRascunho === 'escolher' && (
        <Janela titulo="Já tem uma contagem começada" onFechar={() => setModalRascunho(null)}
          texto="Você começou uma contagem de inventário e não terminou. Continue de onde parou ou descarte o que foi contado e comece do zero.">
          <button onClick={handleRetomarRascunho} className={`${btn('p')} w-full`}><i className="ri-play-line" />Continuar</button>
          <button onClick={handleNovaContagemLimpa} className={`${btn('perigo')} w-full`}>Descartar e começar do zero</button>
          <button onClick={() => setModalRascunho(null)} className={`${btn('ghost')} w-full`}>Voltar</button>
        </Janela>
      )}

      {/* Descartar: pergunta antes de apagar */}
      {modalRascunho === 'descartar' && (
        <Janela titulo="Descartar a contagem começada?" onFechar={() => setModalRascunho(null)}
          texto="O que você já contou nela será apagado e a contagem recomeça do zero. As contagens já confirmadas não mudam.">
          <button onClick={handleNovaContagemLimpa} className="inline-flex items-center justify-center gap-1.5 font-bold cursor-pointer min-h-[42px] px-4 rounded-xl text-[13.5px] bg-red-600 hover:bg-red-700 text-white w-full">
            Descartar e começar do zero
          </button>
          <button onClick={() => setModalRascunho(null)} className={`${btn('out')} w-full`}>Voltar e continuar de onde parou</button>
        </Janela>
      )}
    </Pagina>
  );
}

/** Janela de pergunta (centro da tela). */
function Janela({ titulo, texto, onFechar, children }: { titulo: string; texto: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-start gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200">
          <span className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0"><i className="ri-draft-line text-amber-600 text-lg" /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-zinc-900 mb-1">{titulo}</h2>
            <p className="text-xs text-zinc-600 leading-relaxed">{texto}</p>
          </div>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}

/** Cartão de uma contagem feita: quando, quem, quantos, quanto deu de diferença e o que mais pesou. */
function CartaoContagem({ session, hoje, maisRecente, onAbrir }: {
  session: InventarioSession; hoje: string; maisRecente: boolean; onAbrir: () => void;
}) {
  const r = resumirContagem(session.itens);
  const temDif = session.itensComDiferenca > 0;
  const valorEstoque = session.itens.reduce((s, i) => s + i.qtdContada * i.precoUnitario, 0);
  const ymd = dataBRparaYmd(session.data);
  const dia = ymd ? diaCurto(ymd, hoje) : session.data;

  return (
    <CartaoBarra cor={temDif ? 'amber' : 'green'} onClick={onAbrir}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14.5px] font-extrabold text-zinc-900 leading-snug">
              #{session.numero} · {dia} às {session.hora}
              <span className="font-semibold text-zinc-500"> · {session.operador}</span>
            </p>
            {session.numero === 1 && <Etiqueta tom="blue">contagem inicial</Etiqueta>}
          </div>
          <p className="text-[12.5px] text-zinc-600 mt-1">
            {session.itensContados} {plural(session.itensContados, 'contado', 'contados')}
            {' · '}
            {temDif
              ? <b className="text-amber-700">{session.itensComDiferenca} com diferença</b>
              : <b className="text-emerald-700">nenhuma diferença</b>}
            {temDif && (
              <>
                {' · '}
                <b className={session.valorAjusteLiquido < 0 ? 'text-red-600' : session.valorAjusteLiquido > 0 ? 'text-emerald-700' : 'text-zinc-600'}>{reaisComSinal(session.valorAjusteLiquido)}</b>
              </>
            )}
          </p>
          {r.explicam && (
            <p className="text-[12px] text-zinc-500 mt-0.5">
              {r.explicam.n} {plural(r.explicam.n, 'item explica', 'itens explicam')} {Math.round(r.explicam.fracao * 100)}% da diferença
            </p>
          )}
          <p className="text-[11.5px] text-zinc-400 mt-0.5">Estoque contado: {brl(valorEstoque)}</p>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onAbrir(); }} className={btn('out', 'sm')}>
          Abrir<i className="ri-arrow-right-s-line" />
        </button>
      </div>
      {maisRecente && <DivergenciaPanel session={session} />}
    </CartaoBarra>
  );
}
