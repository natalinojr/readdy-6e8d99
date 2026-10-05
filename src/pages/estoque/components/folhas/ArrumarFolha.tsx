import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { fmtQtd, rotuloUnidade } from '@/lib/estoqueRegras';
import {
  fornecedoresSugeridos, lerNumero, montarFila, precoNaUnidadeDoEstoque, umaSemanaDeUso, unidadeDoPreco,
  type ItemFila, type Pergunta, type SugestoesFornecedor,
} from '@/lib/estoqueArrumar';
import type { InventarioItemContado, UnidadeEstoque } from '@/types/estoque';
import Folha from '../inicio/Folha';
import { useEstoqueTela, type FiltroArrumar } from '../../EstoqueTela';
import { btn, Nota } from '../ui/EstoqueUi';
import EscolherFornecedor, { type FornecedorEscolhido } from './EscolherFornecedor';

// "Arrumar a lista" (layout novo, protótipo S.arrumar): percorre os insumos que têm cadastro faltando, um por
// um, e pergunta SÓ o que falta naquele insumo (quem vende, mínimo, preço, quanto tem). A fila é calculada ao
// abrir e não muda enquanto a pessoa arruma. Cada "Salvar e próximo" grava de verdade antes de avançar; se o
// servidor recusar, o erro aparece e a tela não avança.

interface Form { forn: FornecedorEscolhido | null; minimo: string; preco: string; contagem: string }

const VAZIO: Form = { forn: null, minimo: '', preco: '', contagem: '' };
const UNIDADE_FRONT: Record<string, UnidadeEstoque> = { g: 'g', kg: 'kg', ml: 'ml', L: 'l', unit: 'un' };

export default function ArrumarFolha({ aberta, filtro, insumoId, onFechar }: {
  aberta: boolean;
  filtro?: FiltroArrumar;
  insumoId?: string;
  onFechar: () => void;
}) {
  const { user } = useAuth();
  const { confirmarInventario } = useEstoque();
  const { situacao, podeConfigurar, podeContar } = useEstoqueTela();

  const [dados, setDados] = useState<{ fila: ItemFila[]; sug: SugestoesFornecedor } | null>(null);
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState<Form>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvos, setSalvos] = useState(0);
  const [pulados, setPulados] = useState(0);
  const [escolhendo, setEscolhendo] = useState(false);
  // Contagens respondidas: gravam juntas no fim, numa contagem só (uma por insumo enchia o histórico de
  // "Contagem #N" de 1 item e virava a base do Estoque teórico).
  const [contadas, setContadas] = useState<InventarioItemContado[]>([]);
  const [gravandoContagem, setGravandoContagem] = useState(false);
  const [erroContagem, setErroContagem] = useState<string | null>(null);
  const topo = useRef<HTMLDivElement>(null);

  // Ao abrir calcula a fila uma vez; ao fechar zera tudo. Recarregar a situação no meio NÃO refaz a fila.
  useEffect(() => {
    if (!aberta) {
      setDados(null); setPasso(0); setForm(VAZIO); setErro(null); setSalvos(0); setPulados(0); setEscolhendo(false); setSalvando(false);
      setContadas([]); setGravandoContagem(false); setErroContagem(null);
      return;
    }
    if (!dados && situacao && podeConfigurar) setDados(montarFila(situacao, filtro as Pergunta | undefined, insumoId, podeContar));
  }, [aberta, dados, situacao, podeConfigurar, podeContar, filtro, insumoId]);

  // Cada insumo novo começa no alto da janela
  useEffect(() => { topo.current?.scrollIntoView({ block: 'start' }); }, [passo]);

  const fila = dados?.fila ?? [];
  const total = fila.length;
  const terminou = !!dados && passo >= total;
  const item = dados && passo < total ? fila[passo] : null;
  const ins = item?.ins ?? null;

  // Fornecedores sugeridos para o insumo atual: o mais comum da categoria + os mais usados da loja
  const { sugerido, chips } = useMemo(
    () => (dados && ins ? fornecedoresSugeridos(ins, dados.sug) : { sugerido: null, chips: [] }),
    [dados, ins],
  );

  // ── Leitura dos campos ──
  const lm = lerNumero(form.minimo);
  const lp = lerNumero(form.preco);
  const lc = lerNumero(form.contagem);
  const invalidoMinimo = !lm.vazio && !(lm.valor != null && lm.valor > 0);
  const invalidoPreco = !lp.vazio && !(lp.valor != null && lp.valor > 0);
  const invalidoContagem = !lc.vazio && !(lc.valor != null && lc.valor >= 0);
  const preenchido = !!form.forn || !lm.vazio || !lp.vazio || !lc.vazio;
  const invalido = invalidoMinimo || invalidoPreco || invalidoContagem;

  const proximo = () => {
    setForm(VAZIO);
    setErro(null);
    setPasso((p) => p + 1);
  };

  const pular = () => {
    if (salvando) return;
    setPulados((n) => n + 1);
    proximo();
  };

  const salvar = async () => {
    if (!item || !ins || salvando || !preenchido || invalido) return;
    if (!user?.tenantId) { setErro('Loja não identificada. Entre de novo.'); return; }
    setSalvando(true);
    setErro(null);
    // O estoque pode ter mudado desde que a fila foi montada: a contagem usa o número vivo, se houver.
    const vivo = situacao?.insumos.find((x) => x.id === ins.id) ?? ins;
    const precoGravar = lp.valor != null && lp.valor > 0 ? precoNaUnidadeDoEstoque(lp.valor, ins.unidade) : null;
    let cadastroGravado = false;
    try {
      const mexeNoCadastro = !!form.forn || (lm.valor != null && lm.valor > 0) || precoGravar != null;
      if (mexeNoCadastro) {
        const args: Record<string, unknown> = { p_tenant_id: user.tenantId, p_ingredient_id: ins.id };
        if (form.forn) args.p_supplier_id = form.forn.id;
        if (lm.valor != null && lm.valor > 0) args.p_min_stock = lm.valor;
        if (precoGravar != null) args.p_unit_price = precoGravar;
        const { data, error } = await supabase.rpc('fn_estoque_arrumar_insumo', args);
        if (error) throw new Error(error.message);
        if ((data as { ok?: boolean } | null)?.ok !== true) throw new Error('O servidor não confirmou o cadastro.');
        cadastroGravado = true;
      }
      if (lc.valor != null && lc.valor >= 0) {
        const fator = ins.unidadeContagem && ins.fatorContagem ? ins.fatorContagem : 1;
        const q = Math.round(lc.valor * fator * 10000) / 10000;
        const contado: InventarioItemContado = {
          insumoId: ins.id, insumoNome: ins.nome, unidade: UNIDADE_FRONT[ins.unidade] ?? 'un',
          qtdTeorica: vivo.estoque, qtdContada: q, diferenca: parseFloat((q - vivo.estoque).toFixed(4)),
          precoUnitario: precoGravar != null ? precoGravar : vivo.preco,
        };
        setContadas((lista) => [...lista.filter((c) => c.insumoId !== ins.id), contado]);
      }
      setSalvos((n) => n + 1);
      proximo();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'Erro desconhecido.';
      setErro(cadastroGravado
        ? `O cadastro foi salvo, mas a contagem não: ${msg} Toque em Salvar de novo para tentar a contagem.`
        : `Não salvei: ${msg}`);
    } finally {
      setSalvando(false);
    }
  };

  // Grava as contagens juntas (fim do passo a passo ou ao fechar). false = deu erro e a janela fica aberta.
  const gravarContagens = async (): Promise<boolean> => {
    if (!contadas.length || gravandoContagem) return !contadas.length;
    setGravandoContagem(true);
    setErroContagem(null);
    const r = await confirmarInventario(contadas, user?.nome ?? 'Operador');
    setGravandoContagem(false);
    if (!r.ok) { setErroContagem(r.erro ?? 'A contagem não foi gravada.'); return false; }
    setContadas([]);
    return true;
  };
  useEffect(() => {
    if (terminou && contadas.length && !gravandoContagem && !erroContagem) void gravarContagens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminou, contadas.length]);
  const fechar = async () => {
    if (contadas.length && !(await gravarContagens())) return;
    onFechar();
  };

  // ── Sem permissão (só depois de a situação carregar: antes disso podeConfigurar ainda é falso) ──
  if (aberta && situacao && !podeConfigurar) {
    return (
      <Folha aberta titulo="Arrumar a lista" onFechar={onFechar}
        rodape={<button type="button" onClick={onFechar} className={`${btn('dark')} flex-1 min-h-[46px]`}>Fechar</button>}>
        <p className="text-sm text-zinc-600 leading-relaxed py-4">
          Só quem configura o estoque (Administrador, Supervisor ou quem faz o inventário) arruma o cadastro.
        </p>
      </Folha>
    );
  }

  const up = ins ? unidadeDoPreco(ins.unidade) : null;
  const unidadeConta = ins ? (ins.unidadeContagem && ins.fatorContagem ? ins.unidadeContagem : rotuloUnidade(ins.unidade)) : '';
  const suge = ins ? umaSemanaDeUso(ins) : null;
  const algoDigitado = preenchido;

  // Numeração das perguntas que existem para este insumo
  const num = (p: Pergunta) => `${(item?.perguntas.indexOf(p) ?? 0) + 1}.`;
  const campoNum = (invalidoCampo: boolean) =>
    `flex-1 min-w-0 rounded-2xl border px-4 py-3 text-2xl font-extrabold focus:outline-none ${invalidoCampo ? 'border-red-300 focus:border-red-400' : 'border-zinc-200 focus:border-amber-400'}`;

  const titulo = !dados ? 'Arrumar a lista' : terminou ? 'Lista arrumada' : `Arrumar a lista · ${passo + 1} de ${total}`;
  const rodape = !dados ? undefined : terminou ? (
    <button type="button" disabled={gravandoContagem} onClick={() => { void fechar(); }} className={`${btn('dark')} flex-1 min-h-[46px]`}>{gravandoContagem ? 'Gravando a contagem…' : 'Fechar'}</button>
  ) : (
    <>
      <button type="button" disabled={salvando} onClick={pular} className={`${btn('out')} flex-1 min-h-[46px]`}>Pular</button>
      <button type="button" disabled={salvando || !preenchido || invalido} onClick={() => { void salvar(); }} className={`${btn('p')} flex-1 min-h-[46px]`}>
        {salvando ? 'Salvando…' : passo === total - 1 ? 'Salvar e terminar' : 'Salvar e próximo'}
      </button>
    </>
  );

  return (
    <>
      <Folha aberta={aberta} fecharNoFundo={!algoDigitado && !salvando && !contadas.length} titulo={titulo} onFechar={() => { void fechar(); }} rodape={rodape}>
        <div ref={topo} />
        {!dados ? (
          <p className="text-sm text-zinc-500 py-6 text-center">Carregando a lista…<span className="block text-xs text-zinc-400 mt-1">Se demorar, feche e abra de novo.</span></p>
        ) : terminou ? (
          <div className="text-center py-5">
            <span className="w-16 h-16 rounded-full bg-emerald-600 text-white inline-flex items-center justify-center mb-3"><i className="ri-check-line text-4xl" /></span>
            <p className="text-lg font-extrabold text-zinc-900">{total === 0 ? 'Nada para arrumar' : 'Lista arrumada ✓'}</p>
            <p className="text-sm text-zinc-600 mt-1.5 leading-relaxed">
              {total === 0
                ? (insumoId ? 'Este insumo já está com o cadastro completo.' : 'Nenhum insumo com cadastro faltando.')
                : `${salvos} ${salvos === 1 ? 'salvo' : 'salvos'} · ${pulados} ${pulados === 1 ? 'pulado' : 'pulados'}`}
            </p>
            {pulados > 0 && <p className="text-xs text-zinc-400 mt-2">Os pulados continuam na lista para arrumar depois.</p>}
            {gravandoContagem && <p className="text-xs text-zinc-500 mt-2">Gravando as contagens…</p>}
            {erroContagem && (
              <div className="mt-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-[12.5px] leading-snug px-3 py-2 text-left">
                A contagem não foi gravada: {erroContagem}
                <button type="button" onClick={() => { setErroContagem(null); void gravarContagens(); }} className="block mt-1.5 font-bold underline cursor-pointer">Tentar de novo</button>
              </div>
            )}
          </div>
        ) : ins && item ? (
          <div className="pb-2">
            <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-amber-500 transition-all" style={{ width: `${(passo / total) * 100}%` }} /></div>
            <p className="text-xl font-extrabold text-zinc-900 mt-3">{ins.nome}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {ins.categoria ? `${ins.categoria} · ` : ''}
              <span className={ins.estoque < 0 ? 'text-red-600 font-bold' : ''}>{fmtQtd(ins.estoque, ins.unidade)}</span>
              {ins.consumoDia && ins.consumoDia > 0 ? ` · usa ${fmtQtd(ins.consumoDia, ins.unidade)}/dia` : ''}
            </p>

            {item.perguntas.includes('fornecedor') && (
              <div>
                <p className="text-[15px] font-extrabold text-zinc-900 mt-5">
                  {num('fornecedor')} Quem vende?
                  <small className="block text-xs font-medium text-zinc-400 mt-0.5">
                    {sugerido && ins.categoria ? `Em ${ins.categoria}, o mais comum é ${sugerido.nome}.` : 'Os fornecedores mais usados da loja.'}
                  </small>
                </p>
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {form.forn && !chips.some((c) => c.id === form.forn!.id) && (
                    <ChipForn ativo nome={form.forn.nome} onClick={() => setForm((f) => ({ ...f, forn: null }))} />
                  )}
                  {chips.map((c) => (
                    <ChipForn key={c.id} nome={c.nome} ativo={form.forn?.id === c.id} sugerido={sugerido?.id === c.id}
                      onClick={() => setForm((f) => ({ ...f, forn: f.forn?.id === c.id ? null : { id: c.id, nome: c.nome } }))} />
                  ))}
                  <button type="button" onClick={() => setEscolhendo(true)}
                    className="h-9 px-3 rounded-full border border-zinc-200 bg-white text-[12.5px] font-bold text-zinc-700 cursor-pointer hover:border-zinc-300 inline-flex items-center gap-1">
                    <i className="ri-search-line" />Outro
                  </button>
                </div>
              </div>
            )}

            {item.perguntas.includes('minimo') && (
              <div>
                <p className="text-[15px] font-extrabold text-zinc-900 mt-5">
                  {num('minimo')} Qual o mínimo?
                  <small className="block text-xs font-medium text-zinc-400 mt-0.5">
                    {suge != null
                      ? `Usa ${fmtQtd(ins.consumoDia!, ins.unidade)} por dia. Uma semana ≈ ${fmtQtd(suge, ins.unidade)}.`
                      : 'Abaixo desse número o sistema avisa para comprar. Ainda não há histórico de uso para sugerir.'}
                  </small>
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <input value={form.minimo} onChange={(e) => setForm((f) => ({ ...f, minimo: e.target.value }))}
                    inputMode="decimal" placeholder="0" aria-label="Estoque mínimo" className={campoNum(invalidoMinimo)} />
                  <span className="text-base font-extrabold text-zinc-600">{rotuloUnidade(ins.unidade)}</span>
                </div>
                {invalidoMinimo && <p className="text-xs text-red-600 mt-1">Digite um número maior que zero.</p>}
                {suge != null && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, minimo: String(suge).replace('.', ',') }))} className={`${btn('out', 'sm')} mt-2`}>
                    Usar {fmtQtd(suge, ins.unidade)} (uma semana)
                  </button>
                )}
              </div>
            )}

            {item.perguntas.includes('preco') && up && (
              <div>
                <p className="text-[15px] font-extrabold text-zinc-900 mt-5">
                  {num('preco')} Quanto custa?
                  <small className="block text-xs font-medium text-zinc-400 mt-0.5">O preço de compra, por {up.rotulo === 'un' ? 'unidade' : up.rotulo}. Serve para o custo dos pratos.</small>
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-base font-extrabold text-zinc-600">R$</span>
                  <input value={form.preco} onChange={(e) => setForm((f) => ({ ...f, preco: e.target.value }))}
                    inputMode="decimal" placeholder="0,00" aria-label="Preço de compra" className={campoNum(invalidoPreco)} />
                  <span className="text-base font-extrabold text-zinc-600">por {up.rotulo}</span>
                </div>
                {invalidoPreco && <p className="text-xs text-red-600 mt-1">Digite um valor maior que zero.</p>}
              </div>
            )}

            {item.perguntas.includes('negativo') && (
              <div>
                <p className="text-[15px] font-extrabold text-zinc-900 mt-5">
                  {num('negativo')} Quanto tem agora?
                  <small className="block text-xs font-medium text-zinc-400 mt-0.5">
                    {ins.estoque < 0
                      ? `O sistema diz ${fmtQtd(ins.estoque, ins.unidade)}, que não existe. Conte e digite.`
                      : `Está marcado como esgotado, mas o sistema tem ${fmtQtd(ins.estoque, ins.unidade)}. Conte e digite.`}
                  </small>
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <input value={form.contagem} onChange={(e) => setForm((f) => ({ ...f, contagem: e.target.value }))}
                    inputMode="decimal" placeholder="contar…" aria-label="Quanto tem agora" className={campoNum(invalidoContagem)} />
                  <span className="text-base font-extrabold text-zinc-600">{unidadeConta}</span>
                </div>
                {invalidoContagem && <p className="text-xs text-red-600 mt-1">Digite um número (zero também vale).</p>}
                {ins.unidadeContagem && ins.fatorContagem && ins.fatorContagem !== 1 && (
                  <p className="text-[11px] text-zinc-400 mt-1">1 {ins.unidadeContagem} = {fmtQtd(ins.fatorContagem, ins.unidade)}</p>
                )}
              </div>
            )}

            {erro && <div className="mt-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-[12.5px] leading-snug px-3 py-2">{erro}</div>}
            {erroContagem && <div className="mt-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-[12.5px] leading-snug px-3 py-2">As contagens não foram gravadas: {erroContagem}</div>}
            <Nota className="mt-5">Só pergunta o que falta em cada insumo. Fornecedor, mínimo e preço gravam na hora; o que você contar grava junto, numa contagem só, quando terminar ou fechar.</Nota>
          </div>
        ) : null}
      </Folha>

      <EscolherFornecedor
        aberta={aberta && escolhendo}
        titulo="Quem vende?"
        subtitulo={ins?.nome}
        sugestoes={chips.map((c) => ({ id: c.id, nome: c.nome }))}
        onEscolher={(f) => setForm((x) => ({ ...x, forn: f }))}
        onFechar={() => setEscolhendo(false)}
      />
    </>
  );
}

function ChipForn({ nome, ativo, sugerido = false, onClick }: { nome: string; ativo: boolean; sugerido?: boolean; onClick: () => void }) {
  const cor = ativo
    ? 'bg-zinc-900 border-zinc-900 text-white'
    : sugerido ? 'bg-amber-50 border-amber-300 text-amber-800'
    : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300';
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={`h-9 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer max-w-full truncate ${cor}`}>
      {nome}
    </button>
  );
}
