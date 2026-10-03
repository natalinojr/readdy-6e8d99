// "Abrir a loja" (2026-10-03): uma tela só no lugar de "Iniciar sessão" + "Abrir caixa".
// O operador conta a gaveta (cédulas ou total) e a tela compara na hora com o que ficou no último
// fechamento. modo 'loja' abre o dia e o caixa (SessaoContext.abrirLoja); modo 'caixa' é o dia já
// aberto com o caixa fechado (troca de operador) e abre só o caixa. "Sessão" não aparece para o usuário.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import { confirmar } from '@/components/base/Dialogos';
import ContagemGaveta, { contagemVazia, fmtBRL, valorDe, type ValorContado } from './ContagemGaveta';
import SeloCeu from './SeloCeu';

export interface AberturaFeita { hora: string; valor: number; modo: 'loja' | 'caixa' }

interface UltimoFechamento { valor: number; quando: string; quem: string | null }

const horaAgora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaSemana = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });

function descreverQuando(iso: string): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  if (dateKeyBrasilia(d) === todayBrasilia()) return `hoje às ${hora}`;
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).replace('.', '');
  return `${dia} às ${hora}`;
}

interface Props {
  modo: 'loja' | 'caixa';
  onVoltar: () => void;
  onAberta: (a: AberturaFeita) => void;
  /** Só no modo 'caixa': fechar o dia sem abrir o caixa de novo. */
  onFecharDia: () => void;
}

export default function AbrirLojaView({ modo, onVoltar, onAberta, onFecharDia }: Props) {
  const { user } = useAuth();
  const { sessao, abrirLoja, abrirCaixa } = useSessao();
  const { registrarEvento } = useAuditoria();
  const { hasPermissao, loading: carregandoPerm } = usePermissoes();

  const [contagem, setContagem] = useState<ValorContado>(contagemVazia);
  const [motivo, setMotivo] = useState('');
  const [ultimo, setUltimo] = useState<UltimoFechamento | null | undefined>(undefined);
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState('');

  const nome = user?.nome ?? 'Operador';
  const podeAbrir = hasPermissao('pdv_abrir_caixa');
  const podeFechar = hasPermissao('pdv_fechar_caixa');
  // Dia que ficou aberto de um dia para o outro (ex.: 29/09): conduz a fechar antes de seguir.
  // 10 h de folga: a Vila abre às 18h30 e fecha depois da meia-noite — troca de operador à 00h10 não é "dia anterior".
  const diaAnterior = modo === 'caixa' && !!sessao?.dataRef
    && dateKeyBrasilia(sessao.dataRef) !== todayBrasilia()
    && Date.now() - sessao.dataRef.getTime() >= 10 * 3600_000;

  // Último caixa fechado da loja: o que ficou na gaveta.
  useEffect(() => {
    if (!user?.tenantId) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from('cash_registers')
        .select('closing_value_actual, closed_at, operator_id, session_id')
        .eq('tenant_id', user.tenantId)
        .eq('status', 'closed')
        .not('closing_value_actual', 'is', null)
        .order('closed_at', { ascending: false })
        .limit(8);
      type Reg = { closing_value_actual: number; closed_at: string; operator_id: string | null; session_id: string | null };
      const lista = (data ?? []) as Reg[];
      // Caixa de modo treino não conta como "o que ficou na gaveta".
      const sessIds = [...new Set(lista.map((x) => x.session_id).filter(Boolean))] as string[];
      let treino = new Set<string>();
      if (sessIds.length) {
        const { data: ss } = await supabase.from('sessions').select('id, is_training').in('id', sessIds);
        treino = new Set(((ss ?? []) as { id: string; is_training: boolean | null }[]).filter((x) => x.is_training).map((x) => x.id));
      }
      const r = lista.find((x) => !x.session_id || !treino.has(x.session_id));
      if (!r) { if (!cancel) setUltimo(null); return; }
      let quem: string | null = null;
      if (r.operator_id) {
        const { data: u } = await supabase.from('users').select('name').eq('id', r.operator_id).maybeSingle();
        quem = (u as { name?: string } | null)?.name ?? null;
      }
      if (!cancel) setUltimo({ valor: Number(r.closing_value_actual) || 0, quando: descreverQuando(r.closed_at), quem });
    })().catch(() => { if (!cancel) setUltimo(null); });
    return () => { cancel = true; };
  }, [user?.tenantId]);

  const valor = valorDe(contagem);
  const diferenca = valor != null && ultimo ? Math.round((valor - ultimo.valor) * 100) / 100 : 0;
  const temDiferenca = valor != null && !!ultimo && Math.abs(diferenca) >= 0.01;

  // Enter + clique juntos não podem abrir duas vezes (seriam dois dias abertos).
  const abrindoRef = useRef(false);
  const abrir = useCallback(async () => {
    if (valor == null || abrindoRef.current || !podeAbrir) return;
    abrindoRef.current = true;
    if (modo === 'caixa' && diaAnterior && !(await confirmar({
      titulo: 'Continuar no dia anterior?',
      mensagem: 'O fechamento do turno vai juntar os dois dias. O certo é fechar o dia anterior primeiro.',
      confirmarLabel: 'Continuar mesmo assim',
    }))) { abrindoRef.current = false; return; }
    setAbrindo(true); setErro('');
    try {
      if (modo === 'loja') await abrirLoja(valor, nome);
      else await abrirCaixa(valor, nome);
      const comparacao = ultimo
        ? (temDiferenca ? ` | ${fmtBRL(Math.abs(diferenca))} ${diferenca < 0 ? 'a menos' : 'a mais'} que no fechamento (${fmtBRL(ultimo.valor)})` : ' | igual ao fechamento')
        : '';
      if (modo === 'loja') {
        registrarEvento({
          tipo: 'sessao_aberta', severidade: 'info', usuario: nome, perfil: user?.perfil ?? 'operador',
          descricao: `Loja aberta por ${nome}`, entidade: 'sessao', entidadeId: user?.tenantId ?? '—',
        });
      }
      registrarEvento({
        tipo: 'abertura_caixa', severidade: temDiferenca && Math.abs(diferenca) >= 5 ? 'aviso' : 'info',
        usuario: nome, perfil: user?.perfil ?? 'operador',
        descricao: `Caixa aberto com troco de ${fmtBRL(valor)}${comparacao}${motivo.trim() ? ` — ${motivo.trim()}` : ''}`,
        entidade: 'caixa', entidadeId: user?.tenantId ?? '—',
        depois: { valor_abertura: valor, ...(ultimo ? { ultimo_fechamento: ultimo.valor, diferenca } : {}) },
        detalhes: contagem.modo === 'cedulas' ? 'Contado por cédulas' : 'Total digitado',
      });
      onAberta({ hora: horaAgora(), valor, modo });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui abrir. Tente de novo.');
      setAbrindo(false);
      abrindoRef.current = false;
    }
  }, [valor, podeAbrir, diaAnterior, modo, abrirLoja, abrirCaixa, nome, ultimo, temDiferenca, diferenca, motivo, registrarEvento, user?.perfil, user?.tenantId, contagem.modo, onAberta]);

  // Enter abre (computador). Dentro de botão o Enter faz o clique normal do botão.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'BUTTON' || tag === 'TEXTAREA') return;
      e.preventDefault();
      abrir();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [abrir]);

  const titulo = modo === 'caixa'
    ? (diaAnterior ? 'O dia anterior ficou aberto' : 'A loja está aberta, mas o caixa está fechado')
    : 'A loja está fechada';
  const sub = modo === 'caixa'
    ? (diaAnterior
      ? `A loja foi aberta ${sessao ? descreverQuando(sessao.dataRef.toISOString()) : ''} e não foi fechada. Feche aquele dia antes de começar hoje — assim o fechamento do turno não mistura os dois dias.`
      : `A loja abriu às ${sessao?.iniciadaEm ?? '—'}. Conte a gaveta e abra o caixa para voltar a vender — ou feche a loja.`)
    : 'Conte o troco da gaveta e abra. O caixa, o garçom, o totem e a cozinha começam a funcionar na hora.';
  const btnTxt = modo === 'caixa' ? 'Abrir o caixa' : 'Abrir a loja';

  const status = valor == null
    ? <p className="text-[13px] text-stone-500 bg-stone-100 rounded-xl px-3 py-2.5">Conte as cédulas e moedas da gaveta.</p>
    : !ultimo
      ? <p className="text-[13px] text-stone-500 bg-stone-100 rounded-xl px-3 py-2.5">Primeira abertura: não há fechamento anterior para comparar.</p>
      : !temDiferenca
        ? <p className="text-[13px] font-bold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5 flex items-center gap-1.5"><i className="ri-checkbox-circle-fill" /> Bateu com o fechamento</p>
        : <p className="text-[13px] text-amber-800 bg-amber-50 rounded-xl px-3 py-2.5"><b>{fmtBRL(Math.abs(diferenca))} {diferenca < 0 ? 'a menos' : 'a mais'}</b> que no fechamento. Confira de novo.</p>;

  const campoMotivo = temDiferenca && (
    <div className="mt-3">
      <label className="block text-[12.5px] font-bold text-zinc-600 mb-1.5">
        Se estiver certo, o que aconteceu? <span className="font-medium text-stone-400">(opcional)</span>
      </label>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={200}
        placeholder="Ex.: tirei R$ 7 para o gás"
        className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400"
      />
    </div>
  );

  const fundo = { background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #faf7f2 45%, #f3eee6 100%)' };

  if (!carregandoPerm && !podeAbrir) {
    return (
      <div className="flex flex-col h-full overflow-y-auto items-center justify-start p-6 md:p-10" style={fundo}>
        <div className="w-full max-w-xl">
          <button onClick={onVoltar} className="flex items-center gap-1.5 text-xs font-semibold text-stone-400 hover:text-stone-600 mb-4 cursor-pointer">
            <i className="ri-arrow-left-line" /> Voltar aos módulos
          </button>
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">{modo === 'caixa' ? 'O caixa está fechado' : 'A loja está fechada'}</h1>
          <div className="mt-4 bg-white border border-stone-200 rounded-2xl p-5 text-sm text-zinc-600 leading-relaxed">
            <b className="text-zinc-800">Quem abre:</b> Caixa, Supervisão, Gerente ou Admin.<br />
            O seu perfil não tem a permissão “Abrir caixa”. Peça para alguém da lista — assim que abrir, esta tela vira o PDV sozinha.
          </div>
          {modo === 'caixa' && podeFechar && (
            <button onClick={onFecharDia} className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white border border-stone-200 hover:bg-stone-50 text-sm font-bold text-zinc-700 cursor-pointer">
              <i className="ri-store-2-line" /> Fechar a loja
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={fundo}>
      <div className="w-full max-w-5xl mx-auto px-4 md:px-8 pt-5 md:pt-8 pb-6">
        <button onClick={onVoltar} className="flex items-center gap-1.5 text-xs font-semibold text-stone-400 hover:text-stone-600 mb-3 cursor-pointer">
          <i className="ri-arrow-left-line" /> Voltar aos módulos
        </button>
        <p className="text-[13px] font-semibold text-stone-400 capitalize">{diaSemana(new Date())} · {nome}</p>
        <h1 className="text-[26px] md:text-3xl font-black text-zinc-900 tracking-tight leading-tight mt-1">{titulo}</h1>
        <p className="text-sm text-zinc-500 mt-1 mb-5 max-w-2xl">{sub}</p>

        {diaAnterior && (
          <div className="mb-5 flex flex-wrap items-center gap-3 bg-white border border-amber-200 rounded-2xl p-4">
            <i className="ri-moon-clear-line text-2xl text-amber-500" />
            <p className="flex-1 min-w-[200px] text-sm text-zinc-600">Fechar aquele dia não precisa contar de novo — o caixa já foi contado.</p>
            {podeFechar && (
              <button onClick={onFecharDia} className="px-5 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold cursor-pointer">
                Fechar o dia anterior
              </button>
            )}
          </div>
        )}

        <div className="bg-white border border-stone-200 rounded-3xl p-4 md:p-6">
          <p className="text-[11.5px] font-black text-stone-400 uppercase tracking-wider">Conte o troco da gaveta</p>
          <p className="text-[13px] text-zinc-500 mt-1 mb-4">
            {ultimo === undefined
              ? 'Buscando o último fechamento…'
              : ultimo
                ? <>No último fechamento ficaram <b className="text-zinc-800">{fmtBRL(ultimo.valor)}</b> ({ultimo.quando}{ultimo.quem ? ` · ${ultimo.quem}` : ''}).</>
                : 'Ainda não há fechamento anterior nesta loja.'}
          </p>

          <div className="md:grid md:grid-cols-[1fr_280px] md:gap-6 md:items-start">
            <div>
              <ContagemGaveta estado={contagem} onChange={setContagem} />
              <div className="md:hidden">{campoMotivo}</div>
            </div>

            {/* Total + botão: coluna fixa no computador, rodapé fixo no celular */}
            <div className="sticky bottom-0 md:bottom-auto md:top-4 -mx-4 md:mx-0 mt-4 md:mt-0 px-4 pt-3 pb-4 md:p-4 bg-white md:bg-amber-50/40 border-t md:border border-stone-100 md:border-amber-100 md:rounded-2xl shadow-[0_-10px_20px_rgba(255,255,255,.9)] md:shadow-none">
              <div className="flex md:block items-baseline justify-between gap-3">
                <p className="text-[12.5px] font-bold text-zinc-500">Total contado</p>
                <p className="text-2xl md:text-[32px] font-black text-zinc-900 tracking-tight">{valor != null ? fmtBRL(valor) : '—'}</p>
              </div>
              <div className="mt-2">{status}</div>
              <div className="hidden md:block">{campoMotivo}</div>
              {erro && <p className="mt-2 text-xs font-semibold text-red-600">{erro}</p>}
              <button
                onClick={abrir}
                disabled={valor == null || abrindo}
                className="mt-3 w-full min-h-[56px] rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 text-base font-black cursor-pointer flex items-center justify-center gap-2 transition-colors"
              >
                {abrindo
                  ? <><i className="ri-loader-4-line animate-spin" /> Abrindo…</>
                  : <>{btnTxt}{valor != null && <span className="md:hidden">com {fmtBRL(valor)}</span>}<kbd className="hidden md:inline text-[11px] font-black bg-black/10 rounded-md px-1.5 py-0.5 ml-1">Enter</kbd></>}
              </button>
            </div>
          </div>
        </div>

        {modo === 'caixa' && !diaAnterior && podeFechar && (
          <div className="text-center mt-4">
            <button onClick={onFecharDia} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white border border-stone-200 hover:bg-stone-50 text-sm font-bold text-zinc-700 cursor-pointer">
              <i className="ri-store-2-line" /> Fechar a loja
            </button>
          </div>
        )}
        {modo === 'loja' && (
          <div className="flex flex-wrap gap-2 mt-4">
            {[['ri-safe-2-line', 'Caixa'], ['ri-user-star-line', 'Garçom e mesas'], ['ri-tablet-line', 'Totem e mesa QR'], ['ri-restaurant-line', 'Cozinha (KDS)']].map(([ic, t]) => (
              <span key={t} className="flex items-center gap-1.5 text-xs font-bold text-zinc-600 bg-white border border-stone-200 rounded-full px-3 py-1.5">
                <i className={ic} /> {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tela de "Loja aberta" / "Caixa aberto" depois de abrir. Fica por cima do PDV até tocar no botão (ou Enter). */
export function AberturaFeitaOverlay({ info, onFechar }: { info: AberturaFeita; onFechar: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onFechar]);
  const loja = info.modo === 'loja';
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 text-center bg-[#faf7f2]/85 backdrop-blur-md" onClick={onFechar}>
      <div onClick={(e) => e.stopPropagation()}>
        <SeloCeu fase={loja ? 'dia' : 'tarde'} />
        <p className="text-[26px] font-black text-zinc-900 tracking-tight">{loja ? 'Loja aberta' : 'Caixa aberto'} às {info.hora}</p>
        <p className="text-sm text-zinc-500 mt-1.5 mb-5">
          Troco: {fmtBRL(info.valor)}{loja ? ' · caixa, garçom, totem e cozinha liberados' : ''}
        </p>
        <button
          onClick={onFechar}
          autoFocus
          className="min-h-[56px] px-8 rounded-2xl bg-amber-500 hover:bg-amber-600 text-zinc-900 text-base font-black cursor-pointer inline-flex items-center gap-2"
        >
          Começar a vender <kbd className="hidden md:inline text-[11px] font-black bg-black/10 rounded-md px-1.5 py-0.5">Enter</kbd>
        </button>
      </div>
    </div>
  );
}
