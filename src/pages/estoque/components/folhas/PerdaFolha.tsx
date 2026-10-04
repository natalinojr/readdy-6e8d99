import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque, type Insumo } from '@/contexts/EstoqueContext';
import { useToast } from '@/contexts/ToastContext';
import { convertUnit } from '@/lib/unitConversion';
import { fmtQtd } from '@/lib/estoqueRegras';
import Folha from '../inicio/Folha';
import { Chips, btn, brl, semAcento } from '../ui/EstoqueUi';
import { useEstoqueTela } from '../../EstoqueTela';

// Registrar perda em 3 toques (layout novo): qual insumo, quanto, por quê. Grava pelo mesmo
// registrarPerda do KDS (stock-write add_stock_movement, tipo "perda"); se o servidor recusar, o erro
// aparece aqui e a folha continua aberta com o que foi digitado.

const MOTIVOS = [
  { id: 'venceu', rotulo: 'Venceu' },
  { id: 'estragou', rotulo: 'Estragou' },
  { id: 'caiu', rotulo: 'Caiu / derramou' },
  { id: 'preparo', rotulo: 'Erro no preparo' },
  { id: 'outro', rotulo: 'Outro' },
] as const;
type MotivoId = (typeof MOTIVOS)[number]['id'];
type UnidadeId = 'estoque' | 'equiv' | 'contagem';

/** Unidade do estoque (front: un, l) → a do banco, que o fmtQtd espera (unit, L). */
const paraBanco = (u: string) => (u === 'un' ? 'unit' : u === 'l' ? 'L' : u);
const rotulo = (u: string) => (u === 'l' ? 'L' : u);
const EQUIVALENTE: Record<string, string | undefined> = { kg: 'g', g: 'kg', l: 'ml', ml: 'l' };
const arred = (n: number) => Math.round(n * 10000) / 10000;

/** "1,5" ou "1.5" → 1.5; "1.500,5" → 1500.5. Vazio ou inválido → NaN. */
function lerNumero(t: string): number {
  let s = t.trim();
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "1.500" = mil e quinhentos
  return Number(s);
}

interface Feito { texto: string; valor: number; motivo: string }

export default function PerdaFolha({ aberta, insumoId, onFechar }: { aberta: boolean; insumoId?: string; onFechar: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { insumos, registrarPerda } = useEstoque();
  const { situacao, recarregarSituacao } = useEstoqueTela();

  const [selId, setSelId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [qtdTxt, setQtdTxt] = useState('');
  const [unid, setUnid] = useState<UnidadeId>('estoque');
  const [motivoId, setMotivoId] = useState<MotivoId | ''>('');
  const [outro, setOutro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<Feito | null>(null);
  const qtdRef = useRef<HTMLInputElement>(null);

  const limpar = (id: string | null) => {
    setSelId(id); setBusca(''); setQtdTxt(''); setUnid('estoque'); setMotivoId(''); setOutro('');
    setSalvando(false); setErro(null); setFeito(null);
  };
  // Cada vez que abre começa do zero (já com o insumo escolhido, se veio da ficha); ao fechar, limpa também.
  useEffect(() => { limpar(aberta ? insumoId ?? null : null); }, [aberta, insumoId]);

  const insumo: Insumo | undefined = selId ? insumos.find((i) => i.id === selId) : undefined;

  // Com o insumo escolhido, o cursor já vai para a quantidade (só quando ele muda, não a cada recarga).
  const idEscolhido = insumo?.id;
  useEffect(() => { if (aberta && idEscolhido && !feito) qtdRef.current?.focus(); }, [aberta, idEscolhido, feito]);

  // ── Qual insumo? Os 6 que mais saem (regra única) ou o que a busca achou ──
  const maisUsados = useMemo(() => {
    if (!situacao) return [] as Insumo[];
    const porId = new Map(insumos.map((i) => [i.id, i]));
    return [...situacao.insumos]
      .filter((s) => (s.consumoDia ?? 0) > 0 && porId.has(s.id))
      .sort((a, b) => (b.consumoDia ?? 0) - (a.consumoDia ?? 0))
      .slice(0, 6)
      .map((s) => porId.get(s.id)!);
  }, [situacao, insumos]);

  const achados = useMemo(() => {
    const t = semAcento(busca);
    if (!t) return null;
    return insumos
      .filter((i) => semAcento(i.nome).includes(t))
      .sort((a, b) => Number(semAcento(b.nome).startsWith(t)) - Number(semAcento(a.nome).startsWith(t)) || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 8);
  }, [busca, insumos]);

  const opcoesInsumo = useMemo(() => {
    const base = achados ?? maisUsados;
    // O escolhido fica sempre na frente, mesmo que a busca mude.
    const lista = insumo && !base.some((i) => i.id === insumo.id) ? [insumo, ...base] : base;
    return lista.map((i) => ({ id: i.id, rotulo: i.nome }));
  }, [achados, maisUsados, insumo]);

  const escolher = (id: string) => {
    if (id !== selId) { setQtdTxt(''); setUnid('estoque'); setErro(null); }
    setSelId(id);
  };

  // ── Quanto? Na unidade do estoque, na equivalente (g↔kg, ml↔L) ou na de contagem (pote, pacote…) ──
  const unidades = useMemo(() => {
    if (!insumo) return [];
    const lista: Array<{ id: UnidadeId; rotulo: string; paraEstoque: (q: number) => number }> = [
      { id: 'estoque', rotulo: rotulo(insumo.unidade), paraEstoque: (q) => q },
    ];
    const eq = EQUIVALENTE[insumo.unidade];
    if (eq) lista.push({ id: 'equiv', rotulo: rotulo(eq), paraEstoque: (q) => convertUnit(q, eq, insumo.unidade) ?? q });
    const uc = insumo.unidadeContagem?.trim();
    const fator = insumo.fatorContagem ?? 0;
    if (uc && fator > 0 && !lista.some((u) => semAcento(u.rotulo) === semAcento(uc))) {
      lista.push({ id: 'contagem', rotulo: uc, paraEstoque: (q) => q * fator });
    }
    return lista;
  }, [insumo]);
  const unidadeAtual = unidades.find((u) => u.id === unid) ?? unidades[0];

  const qtdDigitada = lerNumero(qtdTxt);
  const qtdOk = Number.isFinite(qtdDigitada) && qtdDigitada > 0;
  const qtdEstoque = qtdOk && unidadeAtual ? arred(unidadeAtual.paraEstoque(qtdDigitada)) : 0;
  const valor = insumo ? qtdEstoque * (insumo.precoUnitario || 0) : 0;
  const emEstoque = insumo ? fmtQtd(insumo.estoqueAtual, paraBanco(insumo.unidade)) : '';

  // ── Por quê? ──
  const motivoTxt = motivoId === 'outro' ? outro.trim() : MOTIVOS.find((m) => m.id === motivoId)?.rotulo ?? '';
  const motivoOk = motivoId !== '' && (motivoId !== 'outro' || outro.trim().length >= 3);
  const podeGravar = !!insumo && qtdEstoque > 0 && motivoOk && !salvando;

  const gravar = async () => {
    if (!insumo || !podeGravar) return;
    setSalvando(true);
    setErro(null);
    try {
      await registrarPerda(
        [{ insumoId: insumo.id, insumoNome: insumo.nome, quantidade: qtdEstoque, unidade: insumo.unidade }],
        motivoTxt,
        user?.nome ?? 'Operador',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg);
      toast.error('Perda não registrada', msg);
      setSalvando(false);
      return;
    }
    setSalvando(false);
    setFeito({
      texto: `${fmtQtd(qtdEstoque, paraBanco(insumo.unidade))} de ${insumo.nome}`,
      valor,
      motivo: motivoTxt,
    });
    Promise.resolve(recarregarSituacao()).catch(() => undefined);
  };

  // Aviso: estoque já negativo, ou a perda passa do que o sistema diz que tem.
  const jaNegativo = !!insumo && insumo.estoqueAtual < 0;
  const passaDoEstoque = !!insumo && !jaNegativo && qtdEstoque > insumo.estoqueAtual;
  const alerta = jaNegativo || passaDoEstoque;

  // Folha de sucesso
  if (feito) {
    return (
      <Folha aberta={aberta} titulo="Perda registrada" onFechar={onFechar}
        rodape={(
          <>
            <button type="button" onClick={() => limpar(null)} className={`${btn('out')} flex-1 !min-h-[46px]`}>Registrar outra</button>
            <button type="button" onClick={onFechar} className={`${btn('dark')} flex-1 !min-h-[46px]`}>Pronto</button>
          </>
        )}>
        <div className="text-center py-5">
          <span className="w-16 h-16 rounded-full bg-emerald-600 text-white inline-flex items-center justify-center"><i className="ri-check-line text-4xl" /></span>
          <p className="text-xl font-extrabold text-zinc-900 mt-3">Perda registrada</p>
          <p className="text-[13px] text-zinc-600 mt-1.5">
            {feito.texto}{feito.valor > 0 ? ` · ${brl(feito.valor)}` : ''} · {feito.motivo}
          </p>
        </div>
      </Folha>
    );
  }

  return (
    <Folha aberta={aberta} titulo="Registrar perda" subtitulo="O que estragou ou foi jogado fora" onFechar={onFechar}
      fecharNoFundo={!qtdTxt.trim() && !motivoId && !salvando}
      rodape={(
        <>
          <button type="button" onClick={onFechar} className={`${btn('out')} flex-1 !min-h-[46px]`}>Cancelar</button>
          <button type="button" disabled={!podeGravar} onClick={gravar} className={`${btn('p')} flex-1 !min-h-[46px]`}>
            {salvando ? 'Gravando…' : 'Registrar perda'}
          </button>
        </>
      )}>
      <div className="pb-3">
        <Pergunta>Qual insumo?</Pergunta>
        <div className="flex items-center gap-2 h-11 px-3 rounded-xl border border-zinc-200 bg-white focus-within:border-amber-400">
          <i className="ri-search-line text-zinc-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar insumo (acha sem acento)"
            className="flex-1 min-w-0 bg-transparent outline-none text-base text-zinc-800" />
          {busca && (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpar a busca" className="text-zinc-400 cursor-pointer"><i className="ri-close-circle-fill text-lg" /></button>
          )}
        </div>
        {opcoesInsumo.length > 0 ? (
          <Chips opcoes={opcoesInsumo} valor={selId ?? ''} onChange={escolher} className="!flex-wrap !overflow-visible !mx-0 !px-0 mt-2.5" />
        ) : (
          <p className="text-xs text-zinc-400 mt-2.5">{achados ? 'Nenhum insumo com esse nome.' : 'Digite o nome do insumo.'}</p>
        )}
        {insumo && (
          <p className="text-xs text-zinc-500 mt-2">
            No sistema: <b className={insumo.estoqueAtual < 0 ? 'text-red-600' : 'text-zinc-700'}>{emEstoque}</b>
          </p>
        )}

        {insumo && (
          <>
            <Pergunta dica="Na unidade que for mais fácil">Quanto?</Pergunta>
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={qtdRef} value={qtdTxt} onChange={(e) => setQtdTxt(e.target.value.replace(/[^\d.,]/g, ''))}
                inputMode="decimal" enterKeyHint="done" placeholder="0" aria-label="Quantidade perdida"
                className="flex-1 min-w-[120px] rounded-2xl border border-zinc-200 px-4 py-3 text-2xl font-extrabold focus:outline-none focus:border-amber-400" />
              {unidades.length > 1 ? (
                <Chips opcoes={unidades.map((u) => ({ id: u.id, rotulo: u.rotulo }))} valor={unidadeAtual?.id ?? 'estoque'}
                  onChange={(v) => setUnid(v)} className="!flex-wrap !overflow-visible !mx-0 !px-0 !flex-none" />
              ) : (
                <span className="text-base font-extrabold text-zinc-600">{unidadeAtual?.rotulo}</span>
              )}
            </div>
            {unidadeAtual?.id === 'contagem' && (
              <p className="text-[11px] text-zinc-400 mt-1">1 {unidadeAtual.rotulo} = {fmtQtd(unidadeAtual.paraEstoque(1), paraBanco(insumo.unidade))}</p>
            )}

            <Pergunta>Por quê?</Pergunta>
            <Chips<string> opcoes={MOTIVOS.map((m) => ({ id: m.id, rotulo: m.rotulo }))} valor={motivoId} onChange={(v) => setMotivoId(v as MotivoId)}
              className="!flex-wrap !overflow-visible !mx-0 !px-0" />
            {motivoId === 'outro' && (
              <input value={outro} onChange={(e) => setOutro(e.target.value)} maxLength={80} placeholder="O que aconteceu?" aria-label="Motivo da perda"
                className="mt-2.5 w-full h-11 rounded-xl border border-zinc-200 px-3 text-base focus:outline-none focus:border-amber-400" />
            )}

            {qtdEstoque > 0 && (
              <div className={`mt-4 rounded-xl px-3 py-2.5 text-[12.5px] leading-snug ${alerta ? 'bg-amber-50 text-amber-900' : 'bg-zinc-50 text-zinc-700'}`}>
                Vai sair <b>{fmtQtd(qtdEstoque, paraBanco(insumo.unidade))} de {insumo.nome}</b>
                {valor > 0 ? <> (<b>{brl(valor)}</b>)</> : <span className="text-zinc-400"> · sem preço cadastrado, fica sem valor em R$</span>}.
                {unidadeAtual?.id !== 'estoque' && <span className="text-zinc-500"> Você digitou {qtdTxt.trim()} {unidadeAtual?.rotulo}.</span>}
                {jaNegativo && <> O estoque já está negativo ({emEstoque}): <b>depois conte para acertar</b>.</>}
                {passaDoEstoque && <> É mais do que o sistema diz que tem ({emEstoque}): o estoque vai ficar negativo, <b>depois conte para acertar</b>.</>}
              </div>
            )}
          </>
        )}

        {erro && (
          <div role="alert" className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 text-[12.5px] text-red-800 leading-snug">
            <b>Não registrei a perda.</b> {erro}
          </div>
        )}
      </div>
    </Folha>
  );
}

function Pergunta({ children, dica }: { children: ReactNode; dica?: string }) {
  return (
    <div className="mt-4 mb-1.5">
      <p className="text-[15px] font-extrabold text-zinc-900">{children}</p>
      {dica && <p className="text-xs text-zinc-400 mt-0.5">{dica}</p>}
    </div>
  );
}
