// Seção "Rotina de hoje" da tela Hoje (2026-10-03). Protótipo aprovado: docs/prototipos/rotina-proposta.html.
// - O que a pessoa FAZ hoje (conta para o "Tudo em dia"): um toque marca; os tracejados marcam automático
//   quando o sistema vê (loja aberta/fechada, contagem, recebimento, produção registrada).
// - O que está ABAIXO dela na hierarquia: acompanha, marca por alguém e cria "tarefa do dia"/"pedir produção".
// - Login compartilhado (celular da loja): toda marca pergunta "quem fez?" (QuemFez).
// Dados e regras: useRotina.ts + supabase/functions/_shared/rotina.ts.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProducao } from '@/contexts/ProducaoContext';
import Folha from '@/pages/estoque/components/inicio/Folha';
import RegistroProducaoModal from '@/pages/estoque/components/RegistroProducaoModal';
import type { EstadoItem, PapelRotina } from '../../../../supabase/functions/_shared/rotina';
import { desmarcarItem, marcarItem, type QuemFezEscolha, type Rotina, type RotinaDaLoja } from './useRotina';
import QuemFez from './QuemFez';
import NovaTarefaDia from './NovaTarefaDia';
import { ATALHOS, TIPOS, rotuloPapel } from './rotulos';

/** porOutro = item de quem está abaixo: marcar pergunta quem fez ("eu" primeiro). */
type Alvo = { e: EstadoItem; l: RotinaDaLoja; porOutro?: boolean };

export default function RotinaHoje({ rotina, filtroLoja }: { rotina: Rotina; filtroLoja?: string }) {
  const navigate = useNavigate();
  const { user, selectTenant } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Alvo | null>(null);
  const [quemFez, setQuemFez] = useState<(Alvo & { producao?: boolean }) | null>(null);
  const [nova, setNova] = useState<{ l: RotinaDaLoja; tipo: 'tarefa' | 'producao' } | null>(null);
  const [lojaAberta, setLojaAberta] = useState<{ l: RotinaDaLoja; papel: PapelRotina } | null>(null);
  const [producao, setProducao] = useState<{ receitaId: string; operador: string } | null>(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2800); return () => clearTimeout(t); }, [toast]);

  const lojas = filtroLoja ? rotina.lojas.filter((l) => l.tenantId === filtroLoja) : rotina.lojas;
  const varias = rotina.lojas.filter((l) => l.meus.length || l.abaixo.length || l.podeCriarPara.length).length > 1;
  const meus = useMemo(() => lojas.flatMap((l) => l.meus.map((e) => ({ e, l }))), [lojas]);

  const ir = async (tenantId: string, rota: string) => {
    if (tenantId && tenantId !== user?.tenantId) await selectTenant(tenantId);
    navigate(rota);
  };

  const gravar = async (a: Alvo, quem?: QuemFezEscolha & { nomeMostrado?: string }) => {
    setOcupado(a.e.item.id); setErro(null);
    try {
      await marcarItem(a.e.item.id, quem);
      setToast(`“${a.e.item.titulo}” feito${quem?.nomeMostrado ? ` por ${quem.nomeMostrado}` : ''} ✓`);
      await rotina.recarregar();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setOcupado(null); }
  };

  /** Toque no círculo: feito ou automático abre o detalhe; à mão marca (pergunta quem fez quando precisa). */
  const tocar = (a: Alvo) => {
    if (a.e.feito || a.e.item.tipo !== 'manual') { setDetalhe(a); return; }
    marcarAMao(a);
  };
  const marcarAMao = (a: Alvo) => {
    if (rotina.compartilhado || a.porOutro) { setQuemFez(a); return; }
    gravar(a);
  };

  const fazer = (a: Alvo) => {
    const t = a.e.item.tipo;
    if (t === 'producao' && a.e.item.receita_id) {
      if (rotina.compartilhado) { setQuemFez({ ...a, porOutro: false, producao: true }); return; }
      abrirProducao(a, user?.nome ?? 'Operador');
      return;
    }
    const rota = TIPOS[t]?.rota ?? (a.e.item.atalho ? ATALHOS[a.e.item.atalho]?.rota : undefined);
    if (rota) ir(a.l.tenantId, rota);
  };

  const abrirProducao = async (a: Alvo, operador: string) => {
    if (a.l.tenantId !== user?.tenantId) await selectTenant(a.l.tenantId);
    setProducao({ receitaId: a.e.item.receita_id as string, operador });
  };

  const escolheuQuem = (q: QuemFezEscolha & { nomeMostrado: string }) => {
    const alvo = quemFez; setQuemFez(null);
    if (!alvo) return;
    if (alvo.producao) { abrirProducao(alvo, q.nomeMostrado); return; }
    gravar(alvo, q);
  };

  const desmarcar = async (a: Alvo) => {
    setDetalhe(null); setOcupado(a.e.item.id); setErro(null);
    try { await desmarcarItem(a.e.item.id); setToast('Desmarcado.'); await rotina.recarregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setOcupado(null); }
  };

  const linha = (a: Alvo, porOutro = false) => (
    <LinhaRotina key={`${a.l.tenantId}-${a.e.item.id}`} e={a.e} loja={varias ? a.l.loja : null} ocupado={ocupado === a.e.item.id}
      onTocar={() => tocar({ ...a, porOutro })} onFazer={() => fazer(a)} />
  );

  // Abaixo na hierarquia: a supervisão e o gerente sempre veem a loja deles (é onde criam a tarefa do dia);
  // o dono (admin, muitas lojas) só as lojas que têm rotina — ou a que escolheu no topo.
  const comAbaixo = lojas.filter((l) => l.podeCriarPara.length > 0 && (l.papel !== 'admin' || l.abaixo.length > 0 || !!filtroLoja));
  const adminSemRotina = lojas.some((l) => l.podeConfigurar) && !lojas.some((l) => l.papel === 'admin' && l.abaixo.length > 0) && !filtroLoja;
  const total = meus.length, feitos = meus.filter((m) => m.e.feito).length;
  const pend = meus.filter((m) => !m.e.feito && !m.e.maisTarde).length;
  const papeisMeus = [...new Set(meus.map((m) => m.e.item.papel))];

  if (rotina.carregando) return null;
  // Erro de leitura sempre aparece (senão a Hoje ficava sem "Tudo em dia" e sem dizer por quê).
  if (!rotina.erro && total === 0 && comAbaixo.length === 0 && !adminSemRotina) return null;

  return (
    <>
      {erro && <p className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {rotina.erro && <p className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">Não consegui ler a rotina: {rotina.erro}</p>}

      {total > 0 && (
        <section>
          <Cabeca titulo="Rotina de hoje" n={`${feitos} de ${total}`} ok={pend === 0}
            explica={pend ? `falta${pend === 1 ? '' : 'm'} ${pend}` : feitos === total ? 'tudo feito' : 'em dia até agora'}
            config={lojas.some((l) => l.podeConfigurar) ? () => navigate('/hoje/rotina') : undefined} />
          {rotina.compartilhado && (
            <p className="mb-2 flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-[12.5px] text-white">
              <i className="ri-smartphone-line text-amber-400 text-base" /> Login da loja: ao marcar, pergunto quem fez.
            </p>
          )}
          <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            <Barra feitos={feitos} total={total} />
            {papeisMeus.length > 1
              ? papeisMeus.map((p) => (
                <div key={p}>
                  <p className="px-4 pt-2 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-zinc-400 bg-zinc-50/70 border-t border-zinc-100">{rotuloPapel(p)}</p>
                  {meus.filter((m) => m.e.item.papel === p).map((m) => linha(m))}
                </div>
              ))
              : meus.map((m) => linha(m))}
            <p className="border-t border-zinc-100 px-4 py-2 text-[12px] text-zinc-400"><i className="ri-flashlight-line text-violet-500" /> Círculo tracejado = marca automático, quando o sistema vê que foi feito.</p>
          </div>
        </section>
      )}

      {adminSemRotina && (
        <section>
          <Cabeca titulo="Rotina das lojas" explica="Monte o que cada papel faz todo dia (abrir a loja, conferir entregas, contagem…). Aparece aqui e na Hoje de cada um." />
          <button onClick={() => navigate('/hoje/rotina')} className="w-full flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left hover:border-zinc-300 cursor-pointer">
            <span className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-amber-50 text-amber-600"><i className="ri-list-check-3 text-lg" /></span>
            <span className="flex-1 text-[14px] font-bold text-zinc-800">Montar a rotina</span>
            <i className="ri-arrow-right-s-line text-zinc-400 text-xl" />
          </button>
        </section>
      )}

      {comAbaixo.map((l) => l.papel === 'supervisao' ? (
        // Supervisão: a lista inteira da equipe (é ela quem conduz a loja) + criar tarefa do dia / pedir produção.
        <section key={`eq-${l.tenantId}`}>
          {(() => {
            const itens = l.abaixo.flatMap((g) => g.estados);
            const f = itens.filter((e) => e.feito).length;
            const p = itens.filter((e) => !e.feito && !e.maisTarde).length;
            return (
              <>
                <Cabeca titulo={`Equipe hoje${varias ? ` · ${l.loja}` : ''}`} n={itens.length ? `${f} de ${itens.length}` : undefined} ok={p === 0}
                  explica="o celular da loja vê esta lista; você também pode marcar por alguém" />
                <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                  {itens.length === 0 && <p className="px-4 py-3 text-[13px] text-zinc-400">Nada para a equipe hoje.</p>}
                  {l.abaixo.map((g) => (
                    <div key={g.papel}>
                      {l.abaixo.length > 1 && <p className="px-4 pt-2 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-zinc-400 bg-zinc-50/70 border-t border-zinc-100 first:border-t-0">{rotuloPapel(g.papel)}</p>}
                      {g.estados.map((e) => linha({ e, l }, true))}
                    </div>
                  ))}
                  <BotoesCriar onTarefa={() => setNova({ l, tipo: 'tarefa' })} onProducao={() => setNova({ l, tipo: 'producao' })} />
                </div>
              </>
            );
          })()}
        </section>
      ) : (
        // Gerente e dono: o andamento de cada papel abaixo (toque abre a lista com quem fez).
        <section key={`ac-${l.tenantId}`}>
          <Cabeca titulo={`Rotina na loja${varias ? ` · ${l.loja}` : ''}`}
            explica="só acompanha — não conta para o seu “tudo em dia”. Toque para ver quem fez."
            config={l.podeConfigurar ? () => navigate('/hoje/rotina') : undefined} />
          <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            {l.abaixo.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-zinc-500">
                Nenhuma rotina para hoje nesta loja.
                {l.podeConfigurar && <> <button onClick={() => navigate('/hoje/rotina')} className="font-bold text-amber-600 underline cursor-pointer">Montar a rotina</button></>}
              </p>
            )}
            {l.abaixo.map((g) => {
              const f = g.estados.filter((e) => e.feito).length;
              const falta = g.estados.filter((e) => !e.feito && !e.maisTarde);
              return (
                <button key={g.papel} onClick={() => setLojaAberta({ l, papel: g.papel })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left border-t border-zinc-100 first:border-t-0 hover:bg-zinc-50 cursor-pointer">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-bold text-zinc-800">{rotuloPapel(g.papel)}</span>
                    <span className={`block text-[12px] ${falta.some((e) => e.atrasado) ? 'text-red-600' : 'text-zinc-400'}`}>
                      {falta.length ? `falta: ${falta.slice(0, 2).map((e) => e.item.titulo.toLowerCase()).join(', ')}${falta.length > 2 ? ` e mais ${falta.length - 2}` : ''}` : f === g.estados.length ? 'tudo feito' : 'em dia até agora'}
                    </span>
                  </span>
                  <span className="w-16 h-1.5 rounded-full bg-zinc-100 overflow-hidden flex-shrink-0"><span className="block h-full bg-emerald-600" style={{ width: `${Math.round((f / g.estados.length) * 100)}%` }} /></span>
                  <span className="w-9 text-right text-[13px] font-extrabold text-zinc-700">{f}/{g.estados.length}</span>
                </button>
              );
            })}
            <BotoesCriar onTarefa={() => setNova({ l, tipo: 'tarefa' })} onProducao={() => setNova({ l, tipo: 'producao' })} />
          </div>
        </section>
      ))}

      {/* A lista de um papel vem antes: o detalhe e o "quem fez?" abrem POR CIMA dela. */}
      {lojaAberta && (() => {
        const l = rotina.lojas.find((x) => x.tenantId === lojaAberta.l.tenantId) ?? lojaAberta.l;
        const estados = l.abaixo.find((g) => g.papel === lojaAberta.papel)?.estados ?? [];
        return (
          <Folha aberta titulo={`${rotuloPapel(lojaAberta.papel)} · ${l.loja}`} subtitulo="Rotina de hoje · quem fez e quando" onFechar={() => setLojaAberta(null)}>
            <div className="-mx-5 border-t border-zinc-100">{estados.map((e) => linha({ e, l }, true))}</div>
            <p className="my-3 rounded-xl bg-zinc-50 px-3 py-2 text-[12px] text-zinc-500">Só acompanha. Se precisar, dá para marcar por alguém — pergunto quem fez.</p>
          </Folha>
        );
      })()}

      {/* Detalhe de um item: feito (quem/quando, desmarcar) ou automático ainda não feito */}
      <Folha aberta={!!detalhe} titulo={detalhe?.e.item.titulo ?? ''} onFechar={() => setDetalhe(null)}
        subtitulo={detalhe ? (detalhe.e.feito ? `${detalhe.e.quem ?? 'Alguém'}${detalhe.e.quando ? ` · ${detalhe.e.quando}` : ''} · ${detalhe.e.origem === 'auto' ? 'automático' : 'à mão'}` : 'Esse item marca automático') : ''}
        rodape={detalhe && (detalhe.e.feito ? (
          detalhe.e.origem === 'mao'
            ? <><button onClick={() => setDetalhe(null)} className="flex-1 h-11 rounded-xl border border-zinc-200 text-sm font-bold cursor-pointer">Manter</button>
                <button onClick={() => desmarcar(detalhe)} className="flex-1 h-11 rounded-xl bg-zinc-900 text-sm font-bold text-white cursor-pointer">Desmarcar</button></>
            : <button onClick={() => setDetalhe(null)} className="flex-1 h-11 rounded-xl border border-zinc-200 text-sm font-bold cursor-pointer">Entendi</button>
        ) : (
          <>
            <button onClick={() => { const a = detalhe; setDetalhe(null); marcarAMao(a); }}
              className="flex-1 h-11 rounded-xl border border-zinc-200 text-sm font-bold cursor-pointer">Marcar à mão</button>
            {TIPOS[detalhe.e.item.tipo]?.acao && (
              <button onClick={() => { const a = detalhe; setDetalhe(null); fazer(a); }} className="flex-1 h-11 rounded-xl bg-amber-500 text-sm font-extrabold text-zinc-900 cursor-pointer">{TIPOS[detalhe.e.item.tipo].acao}</button>
            )}
          </>
        ))}>
        {detalhe && (detalhe.e.feito ? (
          <div className="space-y-2 pb-2 text-[13px] text-zinc-600">
            {detalhe.e.origem === 'auto'
              ? <p className="rounded-xl bg-violet-50 px-3 py-2 text-violet-800"><i className="ri-flashlight-line" /> Marcado automático: {TIPOS[detalhe.e.item.tipo]?.explica}.{detalhe.e.det ? ` ${detalhe.e.det}.` : ''}</p>
              : <p className="rounded-xl bg-zinc-50 px-3 py-2">Feito por <b>{detalhe.e.quem}</b>{detalhe.e.freelancer ? ' (freelancer)' : ''}{detalhe.e.registradoPor ? `, marcado por ${detalhe.e.registradoPor}` : ''}. Marcou sem querer? Desmarcar volta o item para a lista.</p>}
          </div>
        ) : (
          <div className="space-y-2 pb-2 text-[13px] text-zinc-600">
            <p className="rounded-xl bg-violet-50 px-3 py-2 text-violet-800"><i className="ri-flashlight-line" /> Marca automático {TIPOS[detalhe.e.item.tipo]?.nome.toLowerCase()} ({TIPOS[detalhe.e.item.tipo]?.explica}).</p>
            <p className="rounded-xl bg-zinc-50 px-3 py-2">Fez de outro jeito (no papel, sem o sistema)? Dá para marcar à mão — fica registrado que foi à mão, com o nome e a hora.</p>
          </div>
        ))}
      </Folha>

      {quemFez && (
        <QuemFez aberta tenantId={quemFez.l.tenantId} titulo={quemFez.e.item.titulo}
          pergunta={quemFez.producao ? 'Quem vai produzir?' : 'Quem fez?'}
          eu={quemFez.porOutro && !rotina.compartilhado && user ? { id: user.id, nome: user.nome ?? 'Eu' } : null}
          onEscolher={escolheuQuem} onFechar={() => setQuemFez(null)} />
      )}


      {nova && (
        <NovaTarefaDia aberta tipoInicial={nova.tipo} tenantId={nova.l.tenantId} loja={nova.l.loja} hoje={rotina.hoje}
          papeis={nova.l.podeCriarPara}
          onFechar={() => setNova(null)} onCriou={(msg) => { setNova(null); setToast(msg); rotina.recarregar(); }} />
      )}

      {producao && <AbrirProducao {...producao} onFechar={() => { setProducao(null); rotina.recarregar(); }} />}

      {toast && (
        <div className="fixed left-4 right-4 bottom-24 z-[60] mx-auto max-w-md rounded-2xl bg-zinc-900 px-4 py-3 text-[13px] font-semibold text-white shadow-xl">{toast}</div>
      )}
    </>
  );
}

/** Abre o card de registrar produção da ficha (o mesmo do Estoque › Produção) quando a ficha carregou. */
function AbrirProducao({ receitaId, operador, onFechar }: { receitaId: string; operador: string; onFechar: () => void }) {
  const { getRecipeById, reload } = useProducao();
  const [tentou, setTentou] = useState(false);
  const ficha = getRecipeById(receitaId);
  useEffect(() => {
    if (ficha || tentou) return;
    setTentou(true);
    reload().catch(() => {});
  }, [ficha, tentou, reload]);
  if (ficha) return <RegistroProducaoModal recipeId={receitaId} operador={operador} onClose={onFechar} />;
  return (
    <Folha aberta titulo="Abrindo a ficha…" onFechar={onFechar}>
      <div className="my-6 flex flex-col items-center gap-3 text-sm text-zinc-500">
        <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        {tentou && <p>Se não abrir, a ficha pode ter sido apagada em Estoque › Produção.</p>}
      </div>
    </Folha>
  );
}

function Cabeca({ titulo, n, ok, explica, config }: { titulo: string; n?: string; ok?: boolean; explica?: string; config?: () => void }) {
  return (
    <div className="mb-2 px-0.5">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-extrabold text-zinc-900">{titulo}</h2>
        {n && <span className={`px-2 rounded-full text-[11px] font-bold leading-5 ${ok ? 'bg-emerald-600 text-white' : 'bg-zinc-200 text-zinc-600'}`}>{n}</span>}
        {config && (
          <button onClick={config} className="ml-auto w-8 h-8 -my-1 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 cursor-pointer" aria-label="Configurar a rotina" title="Configurar a rotina">
            <i className="ri-settings-3-line text-lg" />
          </button>
        )}
      </div>
      {/* Explicação inteira, quebrando linha (no celular o texto cortado com "…" não dava para ler). */}
      {explica && <p className="text-[12px] leading-snug text-zinc-400 mt-0.5">{explica}</p>}
    </div>
  );
}

function Barra({ feitos, total }: { feitos: number; total: number }) {
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-4 pt-3 pb-2.5">
      <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} /></div>
      <span className="text-[13px] font-extrabold text-zinc-700">{pct}%</span>
    </div>
  );
}

function BotoesCriar({ onTarefa, onProducao }: { onTarefa: () => void; onProducao: () => void }) {
  const cls = 'flex-1 h-11 rounded-xl border-[1.5px] border-dashed border-zinc-300 bg-white text-[13px] font-bold text-amber-700 hover:border-amber-400 cursor-pointer';
  return (
    <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
      <button onClick={onTarefa} className={cls}><i className="ri-add-line" /> Tarefa do dia</button>
      <button onClick={onProducao} className={cls}><i className="ri-restaurant-2-line" /> Pedir produção</button>
    </div>
  );
}

function LinhaRotina({ e, loja, ocupado, onTocar, onFazer }: { e: EstadoItem; loja: string | null; ocupado: boolean; onTocar: () => void; onFazer: () => void }) {
  const i = e.item;
  const auto = i.tipo !== 'manual';
  const tipo = TIPOS[i.tipo];
  const atalho = i.atalho ? ATALHOS[i.atalho] : null;
  let sub: string;
  if (i.tipo === 'producao') sub = `Pedido por ${i.criado_por_nome ?? 'alguém'}. Marca automático quando registrar a produção.`;
  else if (i.tipo === 'contagem') sub = e.contagem?.aplica ? `Hoje tem contagem: ${e.contagem.pendentes} ${e.contagem.pendentes === 1 ? 'item' : 'itens'} (${e.contagem.planos.join(' e ')}).` : 'Marca automático quando confirmar a contagem do dia.';
  else if (i.tipo === 'receber') sub = 'Marca automático no primeiro recebimento de hoje. Não veio nada? Toque no círculo.';
  else if (auto) sub = `Marca automático: ${tipo.explica}.`;
  else if (i.dia) sub = `Pedido por ${i.criado_por_nome ?? 'alguém'}.`;
  else sub = 'Um toque no círculo quando fizer.';

  const botao = !e.feito && (auto && tipo.acao ? tipo.acao : !auto && atalho ? atalho.label : null);
  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-t border-zinc-100 first:border-t-0 ${ocupado ? 'opacity-60' : ''}`}>
      <button onClick={onTocar} disabled={ocupado} aria-label={e.feito ? 'Ver quem fez' : 'Marcar como feito'}
        className={`mt-0.5 w-[30px] h-[30px] flex-shrink-0 rounded-full border-2 flex items-center justify-center cursor-pointer ${
          e.feito ? 'bg-emerald-600 border-emerald-600 text-white'
          : e.maisTarde ? 'border-zinc-200 bg-zinc-50 text-transparent'
          : `${auto ? 'border-dashed' : ''} border-zinc-300 text-transparent hover:border-emerald-500 hover:text-emerald-400`}`}>
        <i className="ri-check-line text-lg" />
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-[14.5px] font-bold leading-snug ${e.feito ? 'text-zinc-400 line-through decoration-zinc-300' : e.maisTarde ? 'text-zinc-500' : 'text-zinc-800'}`}>
          {i.titulo}
          {i.dia && !e.feito && <span className={`ml-1.5 align-[2px] px-1.5 py-px rounded-md text-[10px] font-extrabold uppercase tracking-wide ${e.deOntem ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>{e.deOntem ? 'de ontem' : 'só hoje'}</span>}
          {!e.feito && i.hora && <span className={`ml-1.5 align-[2px] px-1.5 py-px rounded-md text-[10px] font-extrabold uppercase tracking-wide ${e.atrasado ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-500'}`}>{e.atrasado ? `passou das ${i.hora}` : `às ${i.hora}`}</span>}
        </p>
        {e.feito ? (
          <span className={`mt-1 inline-flex flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-bold ${e.origem === 'auto' ? 'bg-violet-50 text-violet-700' : 'bg-zinc-100 text-zinc-600'}`}>
            {e.origem === 'auto' && <i className="ri-flashlight-fill" />}
            {`${e.origem === 'auto' ? 'automático · ' : ''}${e.quem ?? 'alguém'}${e.quando ? ` · ${e.quando}` : ''}${e.det ? ` · ${e.det}` : ''}${e.registradoPor ? ` · marcado por ${e.registradoPor}` : ''}`}
          </span>
        ) : (
          <p className="text-[12.5px] leading-snug text-zinc-400 mt-0.5">{sub}</p>
        )}
        {loja && <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 mt-1">{loja}</p>}
      </div>
      {botao && (
        <button onClick={onFazer} disabled={ocupado}
          className={`self-center flex-shrink-0 h-9 px-3 rounded-xl text-[12.5px] font-bold whitespace-nowrap cursor-pointer ${auto && !e.maisTarde ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800'}`}>
          {botao}
        </button>
      )}
    </div>
  );
}
