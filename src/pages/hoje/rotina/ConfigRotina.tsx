// Configurar a rotina da loja (/hoje/rotina, 2026-10-03): o que cada papel faz todo dia — itens, dias da
// semana e horário opcional. Só o dono/admin da loja muda (fn_rotina_salvar_item confere no servidor).
// As tarefas de um dia só, quem está acima cria na própria Hoje (NovaTarefaDia).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { confirmar } from '@/components/base/Dialogos';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { usePendenciasHoje } from '../hojeStore';
import type { DadosRotina, ItemRotina, PapelRotina, TipoRotina } from '../../../../supabase/functions/_shared/rotina';
import { PAPEIS_ROTINA } from '../../../../supabase/functions/_shared/rotina';
import { apagarItem, salvarItem } from './useRotina';
import { ATALHOS, DIAS_LETRA, TIPOS, diasTexto, rotuloPapel } from './rotulos';

const TODOS = [0, 1, 2, 3, 4, 5, 6];
const SEG_SAB = [1, 2, 3, 4, 5, 6];
type Modelo = { titulo: string; tipo: TipoRotina; dias?: number[]; plano?: boolean; atalho?: string; hora?: string };
const MODELOS: Record<PapelRotina, Modelo[]> = {
  supervisao: [
    { titulo: 'Abrir a loja', tipo: 'abrir', dias: TODOS },
    { titulo: 'Conferir as entregas do dia', tipo: 'receber', dias: SEG_SAB },
    { titulo: 'Contagem do estoque', tipo: 'contagem', plano: true },
    { titulo: 'Conferir a validade', tipo: 'manual', dias: TODOS, atalho: 'validade' },
    // Com horário: antes dele não segura o "Tudo em dia" da supervisão (ajuste ao horário da loja).
    { titulo: 'Fechar a loja', tipo: 'fechar', dias: TODOS, hora: '23:00' },
  ],
  gerente: [
    { titulo: 'Conferir o fechamento de ontem', tipo: 'manual', dias: TODOS, atalho: 'fechamento' },
    { titulo: 'Aprovar os pedidos de pagamento', tipo: 'manual', dias: SEG_SAB, atalho: 'pagamentos' },
    { titulo: 'Olhar a meta', tipo: 'manual', dias: TODOS, atalho: 'meta' },
  ],
  equipe: [
    { titulo: 'Repor guardanapos, molhos e talheres do salão', tipo: 'manual', dias: TODOS },
    { titulo: 'Limpeza geral da cozinha', tipo: 'manual', dias: [6] },
  ],
  cozinha: [
    { titulo: 'Separar o pré-preparo do dia', tipo: 'manual', dias: TODOS },
    { titulo: 'Conferir a validade da câmara fria', tipo: 'manual', dias: TODOS, atalho: 'validade' },
  ],
  caixa: [
    { titulo: 'Conferir o troco da gaveta', tipo: 'manual', dias: TODOS },
  ],
};

interface Edicao { id: string | null; titulo: string; tipo: TipoRotina; dias: number[]; plano: boolean; hora: string; atalho: string }

export default function ConfigRotina() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { papeis } = usePendenciasHoje();
  const lojasAdmin = useMemo(() => [...(papeis?.entries() ?? [])].filter(([, p]) => p === 'admin').map(([id]) => id), [papeis]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [loja, setLoja] = useState('');
  const [papel, setPapel] = useState<PapelRotina>('supervisao');
  const [itens, setItens] = useState<ItemRotina[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [edit, setEdit] = useState<Edicao | null>(null);
  const [copiar, setCopiar] = useState<string[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (loja || !lojasAdmin.length) return;
    setLoja(lojasAdmin.includes(user?.tenantId ?? '') ? (user?.tenantId as string) : lojasAdmin[0]);
  }, [lojasAdmin, loja, user?.tenantId]);

  useEffect(() => {
    if (!lojasAdmin.length) return;
    supabase.from('tenants').select('id, name').in('id', lojasAdmin).then(({ data }) => {
      setNomes(Object.fromEntries(((data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name])));
    });
  }, [lojasAdmin]);

  const carregar = useCallback(async () => {
    if (!loja) return;
    const { data, error } = await supabase.rpc('fn_rotina_dados', { p_tenant_ids: [loja] });
    if (error) { setErro(error.message); return; }
    setErro(null);
    setItens(((data as DadosRotina).lojas?.[0]?.itens ?? []).filter((i) => !i.dia));
  }, [loja]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);

  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 2800); return () => clearTimeout(t); }, [aviso]);

  const doPapel = (itens ?? []).filter((i) => i.papel === papel);

  const rodar = async (fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(true); setErro(null);
    try { await fn(); if (ok) setAviso(ok); await carregar(); return true; }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); return false; }
    finally { setOcupado(false); }
  };

  const aplicarModelo = () => rodar(async () => {
    for (const m of MODELOS[papel]) {
      await salvarItem({ tenantId: loja, papel, titulo: m.titulo, tipo: m.tipo, dias: m.dias ?? null, diasPlano: !!m.plano, atalho: m.atalho ?? null, hora: m.hora ?? null });
    }
  }, 'Modelo aplicado. Ajuste o que quiser.');

  const mover = (k: number, d: number) => rodar(async () => {
    const l = [...doPapel]; const j = k + d;
    [l[k], l[j]] = [l[j], l[k]];
    const { error } = await supabase.rpc('fn_rotina_ordenar', { p_tenant_id: loja, p_ids: l.map((i) => i.id) });
    if (error) throw new Error(error.message);
  });

  const salvar = async () => {
    if (!edit) return;
    if (!edit.titulo.trim()) { setErro('Escreva o que fazer.'); return; }
    if (!(edit.tipo === 'contagem' && edit.plano) && !edit.dias.length) { setErro('Escolha pelo menos um dia.'); return; }
    const ok = await rodar(() => salvarItem({
      id: edit.id, tenantId: loja, papel, titulo: edit.titulo.trim(), tipo: edit.tipo, dias: edit.dias,
      diasPlano: edit.tipo === 'contagem' && edit.plano, hora: edit.hora || null, atalho: edit.tipo === 'manual' ? edit.atalho || null : null,
    }), 'Salvo. Já vale para hoje.');
    if (ok) setEdit(null);
  };

  const apagar = async () => {
    if (!edit?.id) return;
    if (!(await confirmar({ titulo: 'Tirar da rotina?', mensagem: `“${edit.titulo}” some daqui em diante. O que já foi feito fica no histórico.`, confirmarLabel: 'Tirar', perigo: true }))) return;
    const ok = await rodar(() => apagarItem(edit.id as string), 'Tirado da rotina.');
    if (ok) setEdit(null);
  };

  const fazerCopia = async () => {
    if (!copiar?.length) return;
    const ok = await rodar(async () => {
      const { data, error } = await supabase.rpc('fn_rotina_copiar', { p_de: loja, p_papel: papel, p_para: copiar });
      if (error) throw new Error(error.message);
      setAviso(`${(data as { copiados: number }).copiados} itens copiados.`);
    });
    if (ok) setCopiar(null);
  };

  if (papeis && !lojasAdmin.length) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center">
        <p className="text-sm text-zinc-500">Só o dono ou o admin da loja muda a rotina.</p>
        <button onClick={() => navigate('/hoje')} className="mt-3 text-sm font-bold text-amber-600 underline cursor-pointer">Voltar para o Hoje</button>
      </div>
    );
  }

  const chip = (on: boolean) => `h-10 px-3.5 rounded-full border text-[13px] font-bold cursor-pointer ${on ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`;
  const rotulo = 'mt-4 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-zinc-500';

  return (
    <div className="max-w-xl mx-auto pb-12">
      <header className="flex items-center gap-3 py-3">
        <button onClick={() => navigate('/hoje')} className="w-9 h-9 flex items-center justify-center rounded-xl border border-zinc-200 bg-white cursor-pointer" aria-label="Voltar">
          <i className="ri-arrow-left-line text-lg" />
        </button>
        <h1 className="text-lg font-extrabold text-zinc-900">Rotina da loja</h1>
      </header>
      <p className="text-[13px] leading-relaxed text-zinc-500 mb-3">
        O que cada papel faz todo dia. Aparece na tela Hoje de quem tem esse papel nesta loja; “Equipe da loja” aparece no celular da loja.
        Os tracejados marcam automático quando o sistema vê que foi feito. As tarefas de um dia só, quem está acima cria na própria Hoje.
      </p>

      {lojasAdmin.length > 1 && (
        <select value={loja} onChange={(e) => setLoja(e.target.value)} className="w-full mb-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-[15px] font-bold">
          {lojasAdmin.map((id) => <option key={id} value={id}>{nomes[id] ?? 'Loja'}</option>)}
        </select>
      )}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 mb-3" style={{ scrollbarWidth: 'none' }}>
        {PAPEIS_ROTINA.map((p) => {
          const n = (itens ?? []).filter((i) => i.papel === p).length;
          return (
            <button key={p} onClick={() => setPapel(p)}
              className={`flex-1 flex-shrink-0 h-9 px-3 rounded-lg text-[13px] font-bold whitespace-nowrap cursor-pointer ${papel === p ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>
              {rotuloPapel(p)}{n ? <span className="ml-1 text-zinc-400">{n}</span> : null}
            </button>
          );
        })}
      </div>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {itens === null && <div className="mx-auto my-10 w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}

      {itens && doPapel.length === 0 && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-center">
          <p className="text-[13px] text-zinc-600 mb-3">Nenhum item para {rotuloPapel(papel).toLowerCase()} nesta loja.</p>
          <button onClick={aplicarModelo} disabled={ocupado} className="w-full h-11 rounded-xl bg-amber-500 text-sm font-extrabold text-zinc-900 disabled:opacity-50 cursor-pointer">Começar com o modelo</button>
          <p className="mt-1.5 text-[12px] text-zinc-400">{MODELOS[papel].map((m) => m.titulo).join(' · ')}</p>
          <button onClick={() => setEdit({ id: null, titulo: '', tipo: 'manual', dias: TODOS, plano: false, hora: '', atalho: '' })}
            className="mt-3 w-full h-11 rounded-xl border border-zinc-200 text-sm font-bold cursor-pointer">Adicionar um item</button>
        </div>
      )}

      {doPapel.map((i, k) => (
        <div key={i.id} className="flex items-center gap-2.5 rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 mb-2">
          <span className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl ${i.tipo !== 'manual' ? 'bg-violet-50 text-violet-600' : 'bg-zinc-100 text-zinc-500'}`}>
            <i className={`${TIPOS[i.tipo]?.icone ?? 'ri-checkbox-line'} text-base`} />
          </span>
          <button onClick={() => setEdit({ id: i.id, titulo: i.titulo, tipo: i.tipo, dias: i.dias ?? TODOS, plano: i.dias_plano, hora: i.hora ?? '', atalho: i.atalho ?? '' })}
            className="flex-1 min-w-0 text-left cursor-pointer">
            <span className="block text-[14px] font-bold text-zinc-800 leading-snug">{i.titulo}</span>
            <span className="block text-[12px] text-zinc-400">
              {diasTexto(i.dias, i.dias_plano)}{i.hora ? ` · às ${i.hora}` : ''} · {i.tipo !== 'manual' ? <span className="font-bold text-violet-600">automático</span> : 'um toque'}
            </span>
          </button>
          <div className="flex flex-col gap-0.5">
            <button onClick={() => mover(k, -1)} disabled={k === 0 || ocupado} className="w-8 h-6 rounded-md bg-zinc-50 text-zinc-500 disabled:opacity-30 cursor-pointer" aria-label="Subir"><i className="ri-arrow-up-s-line" /></button>
            <button onClick={() => mover(k, 1)} disabled={k === doPapel.length - 1 || ocupado} className="w-8 h-6 rounded-md bg-zinc-50 text-zinc-500 disabled:opacity-30 cursor-pointer" aria-label="Descer"><i className="ri-arrow-down-s-line" /></button>
          </div>
        </div>
      ))}

      {itens && doPapel.length > 0 && (
        <>
          <button onClick={() => setEdit({ id: null, titulo: '', tipo: 'manual', dias: TODOS, plano: false, hora: '', atalho: '' })}
            className="w-full h-12 rounded-2xl border-[1.5px] border-dashed border-zinc-300 text-sm font-bold text-amber-700 hover:border-amber-400 cursor-pointer">
            <i className="ri-add-line" /> Adicionar item
          </button>
          {lojasAdmin.length > 1 && (
            <p className="mt-4 text-center">
              <button onClick={() => setCopiar([])} className="h-9 px-4 rounded-xl border border-zinc-200 bg-white text-[13px] font-bold text-zinc-700 cursor-pointer">Copiar para outra loja</button>
            </p>
          )}
        </>
      )}

      <Folha aberta={!!edit} titulo={edit?.id ? 'Editar item' : 'Novo item'} subtitulo={`${rotuloPapel(papel)} · ${nomes[loja] ?? ''}`} onFechar={() => setEdit(null)} fecharNoFundo={false}
        rodape={<>
          {edit?.id && <button onClick={apagar} disabled={ocupado} className="h-12 w-12 flex-shrink-0 rounded-xl border border-zinc-200 text-red-600 cursor-pointer" aria-label="Tirar da rotina"><i className="ri-delete-bin-line text-lg" /></button>}
          <button onClick={salvar} disabled={ocupado} className="flex-1 h-12 rounded-xl bg-amber-500 text-[15px] font-extrabold text-zinc-900 disabled:opacity-50 cursor-pointer">{ocupado ? 'Salvando…' : 'Salvar'}</button>
        </>}>
        {edit && (
          <>
            <p className={rotulo}>O que fazer</p>
            <input value={edit.titulo} onChange={(e) => setEdit({ ...edit, titulo: e.target.value })} maxLength={200} placeholder="Ex.: Conferir a validade"
              className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-base" />
            <p className={rotulo}>Como marca</p>
            <div className="space-y-1.5">
              {(['manual', 'abrir', 'fechar', 'contagem', 'receber'] as TipoRotina[]).map((t) => (
                <button key={t} onClick={() => setEdit({ ...edit, tipo: t, titulo: edit.titulo || (t === 'contagem' ? 'Contagem do estoque' : '') })}
                  className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left cursor-pointer ${edit.tipo === t ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-200'}`}>
                  <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg ${edit.tipo === t ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}><i className={TIPOS[t].icone} /></span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-bold text-zinc-800">{TIPOS[t].nome}</span>
                    <span className="block text-[11.5px] text-zinc-400">{t === 'manual' ? TIPOS[t].explica : `automático: ${TIPOS[t].explica}`}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className={rotulo}>Em que dias</p>
            {edit.tipo === 'contagem' && (
              <div className="flex flex-wrap gap-2 mb-2">
                <button onClick={() => setEdit({ ...edit, plano: true })} className={chip(edit.plano)}>Nos dias dos planos de contagem</button>
                <button onClick={() => setEdit({ ...edit, plano: false })} className={chip(!edit.plano)}>Escolher os dias</button>
              </div>
            )}
            {edit.tipo === 'contagem' && edit.plano ? (
              <p className="text-[12px] text-zinc-500">O Estoque já sabe quando tem contagem (Estoque › Início › planos). O item aparece nesses dias e marca quando a contagem do plano termina.</p>
            ) : (
              <>
                <div className="flex gap-1.5">
                  {DIAS_LETRA.map((d, k) => (
                    <button key={k} onClick={() => setEdit({ ...edit, dias: edit.dias.includes(k) ? edit.dias.filter((x) => x !== k) : [...edit.dias, k].sort() })}
                      className={`flex-1 h-10 rounded-xl border text-[13px] font-extrabold cursor-pointer ${edit.dias.includes(k) ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-500'}`}>{d}</button>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-2">
                  {[['Todo dia', TODOS], ['Seg a sáb', SEG_SAB], ['Seg a sex', [1, 2, 3, 4, 5]]].map(([l, d]) => (
                    <button key={l as string} onClick={() => setEdit({ ...edit, dias: d as number[] })} className="h-7 px-2.5 rounded-full bg-zinc-100 text-[12px] font-bold text-zinc-600 cursor-pointer">{l as string}</button>
                  ))}
                </div>
              </>
            )}
            <p className={rotulo}>Horário <span className="normal-case font-semibold text-zinc-400">(opcional)</span></p>
            <div className="flex items-center gap-3">
              <input type="time" value={edit.hora} onChange={(e) => setEdit({ ...edit, hora: e.target.value })} className="h-11 w-36 rounded-xl border border-zinc-200 px-3 text-base" />
              {edit.hora && <button onClick={() => setEdit({ ...edit, hora: '' })} className="text-[13px] font-bold text-amber-600 cursor-pointer">Sem horário</button>}
            </div>
            <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
              Com horário, antes dele o item fica “às 10:00” e a Hoje diz “Tudo em dia até agora”. Passou da hora sem marcar, fica vermelho.
            </p>
            {edit.tipo === 'manual' && (
              <>
                <p className={rotulo}>Botão de atalho <span className="normal-case font-semibold text-zinc-400">(opcional)</span></p>
                <select value={edit.atalho} onChange={(e) => setEdit({ ...edit, atalho: e.target.value })} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-base">
                  <option value="">Nenhum</option>
                  {Object.entries(ATALHOS).map(([k, a]) => <option key={k} value={k}>{a.label} — {a.onde}</option>)}
                </select>
              </>
            )}
            <div className="h-3" />
          </>
        )}
      </Folha>

      <Folha aberta={copiar !== null} titulo="Copiar para outra loja" subtitulo={`${rotuloPapel(papel)} · ${doPapel.length} itens`} onFechar={() => setCopiar(null)}
        rodape={<button onClick={fazerCopia} disabled={!copiar?.length || ocupado} className="flex-1 h-12 rounded-xl bg-amber-500 text-[15px] font-extrabold text-zinc-900 disabled:opacity-40 cursor-pointer">Copiar</button>}>
        <div className="space-y-1.5 pb-2">
          {lojasAdmin.filter((id) => id !== loja).map((id) => {
            const on = !!copiar?.includes(id);
            return (
              <button key={id} onClick={() => setCopiar((c) => (on ? (c ?? []).filter((x) => x !== id) : [...(c ?? []), id]))}
                className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left cursor-pointer ${on ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-200'}`}>
                <span className={`w-5 h-5 flex-shrink-0 rounded-md border-2 flex items-center justify-center ${on ? 'bg-zinc-900 border-zinc-900 text-white' : 'border-zinc-300'}`}>{on && <i className="ri-check-line text-xs" />}</span>
                <span className="text-[14px] font-bold text-zinc-800">{nomes[id] ?? 'Loja'}</span>
              </button>
            );
          })}
          <p className="pt-2 text-[12px] text-zinc-500">Cada loja fica com a sua cópia. O que já existe lá (mesmo nome) não duplica.</p>
        </div>
      </Folha>

      {aviso && <div className="fixed left-4 right-4 bottom-24 z-[60] mx-auto max-w-md rounded-2xl bg-zinc-900 px-4 py-3 text-[13px] font-semibold text-white shadow-xl">{aviso}</div>}
    </div>
  );
}
