import { useState, useMemo } from 'react';
import { usePaymentMethods, type PaymentMethod } from '../../../../hooks/usePaymentMethods';
import { useSystemSettings } from '../../../../hooks/useSystemSettings';
import type { CarrinhoItem } from '../../../../contexts/PDVContext';
import type { Rodada } from '../types';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Modo = 'unico' | 'dividir' | 'multiplo';
type Etapa = 'selecionar' | 'pagar';

interface Parcela {
  id: string;
  formaPagId: string;
  valor: number;
}

interface PessoaDivisao {
  id: string;
  label: string;
  valor: number;
  formaPagId: string;
}

interface Props {
  mesaNome: string;
  rodadas: Rodada[];
  itensNovos: CarrinhoItem[];
  onConfirmar: () => void;
  onClose: () => void;
  modo?: 'pagar' | 'fechar';
  rodadasJaPagas?: Set<string>;
  onPagarParcial?: (rodadasIds: string[], formaPagamentoId: string) => void;
  /** Nome do operador/garçom logado */
  operadorNome?: string;
}

function FormaPagSelector({
  value,
  onChange,
  compact = false,
  formas,
}: {
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
  formas: PaymentMethod[];
}) {
  return (
    <div className={`grid gap-1.5 ${compact ? 'grid-cols-5' : 'grid-cols-3 sm:grid-cols-5'}`}>
      {formas.map((fp) => (
        <button
          key={fp.id}
          onClick={() => onChange(fp.id)}
          title={fp.nome}
          className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl border-2 transition-all cursor-pointer ${
            value === fp.id
              ? 'border-amber-500 bg-amber-50 text-amber-700'
              : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50'
          }`}
        >
          <i className={`${fp.icone} text-base`} />
          <span className="text-[9px] font-semibold leading-tight text-center">{fp.nome.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Etapa 0: Selecionar quais contas pagar ───────────────────────────────────
function EtapaSelecionar({
  rodadas,
  itensNovos,
  selecionados,
  setSelecionados,
  incluirNovos,
  setIncluirNovos,
  onAvancar,
  onClose,
  modo,
  rodadasJaPagas,
}: {
  rodadas: Rodada[];
  itensNovos: CarrinhoItem[];
  selecionados: Set<string>;
  setSelecionados: (s: Set<string>) => void;
  incluirNovos: boolean;
  setIncluirNovos: (v: boolean) => void;
  onAvancar: () => void;
  onClose: () => void;
  modo?: 'pagar' | 'fechar';
  rodadasJaPagas?: Set<string>;
}) {
  const toggle = (id: string) => {
    if (rodadasJaPagas?.has(id)) return; // can't toggle already paid
    const next = new Set(selecionados);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelecionados(next);
  };

  const totalSelecionado = useMemo(() => {
    const totalRodadas = rodadas
      .filter((r) => selecionados.has(r.id))
      .flatMap((r) => r.itens)
      .reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
    const totalNovos = incluirNovos
      ? itensNovos.reduce((a, i) => a + i.precoTotal * i.quantidade, 0)
      : 0;
    return totalRodadas + totalNovos;
  }, [rodadas, itensNovos, selecionados, incluirNovos]);

  const rodadasSelecionaveis = rodadas.filter((r) => !rodadasJaPagas?.has(r.id));
  const todosSelecionados = selecionados.size === rodadasSelecionaveis.length && (itensNovos.length === 0 || incluirNovos);

  const selecionarTodos = () => {
    setSelecionados(new Set(rodadasSelecionaveis.map((r) => r.id)));
    setIncluirNovos(true);
  };

  const deselecionarTodos = () => {
    setSelecionados(new Set());
    setIncluirNovos(false);
  };

  const podeProsseguir = selecionados.size > 0 || (incluirNovos && itensNovos.length > 0);
  const titulo = modo === 'pagar' ? 'Registrar Pagamento' : 'Selecionar Conta';
  const subtitulo = modo === 'pagar' ? 'Escolha quais pedidos serão pagos agora' : 'Escolha quais pedidos serão pagos agora';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden flex flex-col" style={{ maxHeight: 'min(92dvh, 92vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">{titulo}</h2>
            <p className="text-xs text-zinc-400">{subtitulo}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-600 transition-colors"
          >
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        {/* Selecionar todos */}
        <div className="px-4 py-2 border-b border-zinc-50 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-zinc-500">{selecionados.size + (incluirNovos && itensNovos.length > 0 ? 1 : 0)} selecionado(s)</span>
          <button
            onClick={todosSelecionados ? deselecionarTodos : selecionarTodos}
            className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer whitespace-nowrap"
          >
            {todosSelecionados ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
        </div>

        {/* Lista de rodadas */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {rodadas.map((rodada) => {
            const subtotal = rodada.itens.reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
            const sel = selecionados.has(rodada.id);
            const jaPaga = rodadasJaPagas?.has(rodada.id) ?? false;
            return (
              <button
                key={rodada.id}
                onClick={() => toggle(rodada.id)}
                disabled={jaPaga}
                className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all ${
                  jaPaga ? 'border-green-200 bg-green-50/40 cursor-not-allowed' :
                  sel ? 'border-amber-400 bg-amber-50/40 cursor-pointer' : 'border-zinc-200 bg-white hover:border-zinc-300 cursor-pointer'
                }`}
              >
                {/* Header rodada */}
                <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${
                  jaPaga ? 'border-green-100 bg-green-50' :
                  sel ? 'border-amber-100 bg-amber-50' : 'border-zinc-100 bg-zinc-50'
                }`}>
                  <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                    jaPaga ? 'bg-green-500 border-green-500' :
                    sel ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                  }`}>
                    {(jaPaga || sel) && <i className="ri-check-line text-white text-[10px]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-zinc-800">Pedido #{rodada.numero} · {rodada.nomeResponsavel}</p>
                      {jaPaga && (
                        <span className="text-[9px] font-black text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">PAGO</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-400">{rodada.hora} · {rodada.itens.length} {rodada.itens.length === 1 ? 'item' : 'itens'}</p>
                  </div>
                  <span className={`text-sm font-black flex-shrink-0 ${jaPaga ? 'text-green-600' : sel ? 'text-amber-700' : 'text-zinc-600'}`}>{fmt(subtotal)}</span>
                </div>
                {/* Itens compactos */}
                <div className="px-3 py-2">
                  {rodada.itens.slice(0, 3).map((it) => (
                    <div key={it.cartId} className="flex items-center gap-1.5 py-0.5">
                      <span className="text-[10px] text-zinc-400 w-4 text-right">{it.quantidade}x</span>
                      <span className={`text-[11px] truncate ${jaPaga ? 'text-zinc-400 line-through' : 'text-zinc-600'}`}>{it.nome}</span>
                    </div>
                  ))}
                  {rodada.itens.length > 3 && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">+{rodada.itens.length - 3} mais...</p>
                  )}
                </div>
              </button>
            );
          })}

          {/* Itens novos (carrinho) */}
          {itensNovos.length > 0 && (
            <button
              onClick={() => setIncluirNovos(!incluirNovos)}
              className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all cursor-pointer ${
                incluirNovos ? 'border-amber-400 bg-amber-50/40' : 'border-zinc-200 bg-white hover:border-zinc-300'
              }`}
            >
              <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${incluirNovos ? 'border-amber-100 bg-amber-50' : 'border-zinc-100 bg-zinc-50'}`}>
                <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                  incluirNovos ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                }`}>
                  {incluirNovos && <i className="ri-check-line text-white text-[10px]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-zinc-800">Itens aguardando envio</p>
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">NOVO</span>
                  </div>
                  <p className="text-[10px] text-zinc-400">{itensNovos.length} {itensNovos.length === 1 ? 'item' : 'itens'} no carrinho</p>
                </div>
                <span className={`text-sm font-black flex-shrink-0 ${incluirNovos ? 'text-amber-700' : 'text-zinc-600'}`}>
                  {fmt(itensNovos.reduce((a, i) => a + i.precoTotal * i.quantidade, 0))}
                </span>
              </div>
              <div className="px-3 py-2">
                {itensNovos.slice(0, 3).map((it) => (
                  <div key={it.cartId} className="flex items-center gap-1.5 py-0.5">
                    <span className="text-[10px] text-zinc-400 w-4 text-right">{it.quantidade}x</span>
                    <span className="text-[11px] text-zinc-600 truncate">{it.nome}</span>
                  </div>
                ))}
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-5 pt-3 border-t border-zinc-100 flex-shrink-0 bg-white space-y-3">
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-2.5">
            <span className="text-sm font-semibold text-zinc-600">Total selecionado</span>
            <span className="text-lg font-black text-zinc-900">{fmt(totalSelecionado)}</span>
          </div>
          <button
            onClick={onAvancar}
            disabled={!podeProsseguir}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-arrow-right-line" />
            Ir para Pagamento · {fmt(totalSelecionado)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal principal ───────────────────────────────────────────────────────────
export default function FecharContaModal({ mesaNome, rodadas, itensNovos, onConfirmar, onClose, modo = 'fechar', rodadasJaPagas, onPagarParcial, operadorNome }: Props) {
  const { formasAtivas: formas } = usePaymentMethods();
  const { settings } = useSystemSettings();

  const taxaAtiva = settings.service_fee_enabled;
  const gorjetaAtivaCfg = settings.gorjeta_enabled;

  // Etapa
  const [etapa, setEtapa] = useState<Etapa>('selecionar');

  // Seleção de contas — inicializa apenas com rodadas NÃO pagas
  const rodadasNaoPagas = rodadas.filter((r) => !rodadasJaPagas?.has(r.id));
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set(rodadasNaoPagas.map((r) => r.id)));
  const [incluirNovos, setIncluirNovos] = useState(itensNovos.length > 0);

  // Itens efetivamente selecionados
  const rodadasSelecionadas = rodadas.filter((r) => selecionados.has(r.id));
  const itensSelecionados = [
    ...rodadasSelecionadas.flatMap((r) => r.itens),
    ...(incluirNovos ? itensNovos : []),
  ];

  const subtotal = itensSelecionados.reduce((a, i) => a + i.precoTotal * i.quantidade, 0);
  const taxa = taxaAtiva ? subtotal * (settings.service_fee_percentage / 100) : 0;

  const gorjetaDefaultPct = settings.gorjeta_percentage ?? 10;
  const [gorjetaPct, setGorjetaPct] = useState<number | null>(gorjetaAtivaCfg ? gorjetaDefaultPct : null);
  const [gorjetaCustom, setGorjetaCustom] = useState('');
  const gorjetaValor = gorjetaAtivaCfg
    ? (gorjetaPct !== null
        ? parseFloat((subtotal * gorjetaPct / 100).toFixed(2))
        : parseFloat(gorjetaCustom.replace(',', '.')) || 0)
    : 0;
  const total = subtotal + taxa + gorjetaValor;

  const [modoPag, setModoPag] = useState<Modo>('unico');
  const [confirmado, setConfirmado] = useState(false);

  // Modo único
  const [formaSelecionada, setFormaSelecionada] = useState(formas[0]?.id ?? '');
  const [valorRecebido, setValorRecebido] = useState('');

  const formaSelecionadaTipo = formas.find((f: PaymentMethod) => f.id === formaSelecionada)?.tipo;
  const isDinheiro = formaSelecionadaTipo === 'dinheiro';
  const valorRecebidoNum = parseFloat(valorRecebido.replace(',', '.')) || 0;
  const troco = isDinheiro && valorRecebidoNum > total ? valorRecebidoNum - total : 0;
  const trocoValido = !isDinheiro || valorRecebidoNum >= total;

  // Modo dividir
  const [numPessoas, setNumPessoas] = useState(2);
  const [pessoas, setPessoas] = useState<PessoaDivisao[]>(() =>
    Array.from({ length: 2 }, (_, i) => ({
      id: `p-${i}`,
      label: `Pessoa ${i + 1}`,
      valor: parseFloat((total / 2).toFixed(2)),
      formaPagId: formas[0]?.id ?? '',
    }))
  );

  // Modo múltiplo
  const [parcelas, setParcelas] = useState<Parcela[]>([
    { id: 'parc-0', formaPagId: formas[0]?.id ?? '', valor: total },
  ]);

  /* ── Helpers dividir ── */
  const handleNumPessoas = (n: number) => {
    const clamped = Math.max(2, Math.min(12, n));
    setNumPessoas(clamped);
    const valorPorPessoa = parseFloat((total / clamped).toFixed(2));
    const diff = parseFloat((total - valorPorPessoa * clamped).toFixed(2));
    setPessoas(
      Array.from({ length: clamped }, (_, i) => ({
        id: `p-${i}`,
        label: `Pessoa ${i + 1}`,
        valor: i === 0 ? valorPorPessoa + diff : valorPorPessoa,
        formaPagId: pessoas[i]?.formaPagId ?? formas[0]?.id ?? '',
      }))
    );
  };

  const handlePessoaForma = (idx: number, formaPagId: string) => {
    setPessoas((prev) => prev.map((p, i) => (i === idx ? { ...p, formaPagId } : p)));
  };

  const handlePessoaValor = (idx: number, raw: string) => {
    const v = parseFloat(raw) || 0;
    setPessoas((prev) => prev.map((p, i) => (i === idx ? { ...p, valor: v } : p)));
  };

  const totalDividido = useMemo(() => pessoas.reduce((a, p) => a + p.valor, 0), [pessoas]);
  const diffDividido = parseFloat((total - totalDividido).toFixed(2));

  /* ── Helpers múltiplo ── */
  const totalParcelas = useMemo(() => parcelas.reduce((a, p) => a + p.valor, 0), [parcelas]);
  const restante = parseFloat((total - totalParcelas).toFixed(2));

  const addParcela = () => {
    const r = Math.max(0, restante);
    setParcelas((prev) => [
      ...prev,
      { id: `parc-${Date.now()}`, formaPagId: formas[1]?.id ?? formas[0]?.id ?? '', valor: r },
    ]);
  };

  const removeParcela = (id: string) => {
    setParcelas((prev) => prev.filter((p) => p.id !== id));
  };

  const updateParcelaForma = (id: string, formaPagId: string) => {
    setParcelas((prev) => prev.map((p) => (p.id === id ? { ...p, formaPagId } : p)));
  };

  const updateParcelaValor = (id: string, raw: string) => {
    const v = parseFloat(raw) || 0;
    setParcelas((prev) => prev.map((p) => (p.id === id ? { ...p, valor: v } : p)));
  };

  const temDinheiroMultiplo = useMemo(
    () => parcelas.some((p) => formas.find((f: PaymentMethod) => f.id === p.formaPagId)?.tipo === 'dinheiro'),
    [parcelas, formas]
  );
  const trocoMultiplo = restante < -0.01 && temDinheiroMultiplo ? Math.abs(restante) : 0;

  /* ── Validação ── */
  const podeConfirmar = useMemo(() => {
    if (modoPag === 'unico') return !!formaSelecionada && trocoValido;
    if (modoPag === 'dividir') return Math.abs(diffDividido) < 0.02 && pessoas.every((p) => p.formaPagId);
    if (modoPag === 'multiplo') {
      const todosPreenchidos = parcelas.every((p) => p.formaPagId && p.valor > 0);
      const cobreTotal = totalParcelas >= total - 0.01;
      const excessoComDinheiro = restante < -0.01 && temDinheiroMultiplo;
      return todosPreenchidos && (cobreTotal || excessoComDinheiro) && (Math.abs(restante) < 0.02 || excessoComDinheiro);
    }
    return false;
  }, [modoPag, formaSelecionada, trocoValido, diffDividido, pessoas, restante, parcelas, totalParcelas, total, temDinheiroMultiplo]);

  const handleConfirmar = () => {
    if (!podeConfirmar) return;
    setConfirmado(true);
    if (modo === 'pagar') {
      // Mark selected rodadas as paid without closing the table — passa a forma de pagamento selecionada
      setTimeout(() => {
        onPagarParcial?.(Array.from(selecionados), formaSelecionada);
        onClose();
      }, 2000);
    } else {
      setTimeout(() => onConfirmar(), 2200);
    }
  };

  /* ── Etapa seleção ── */
  if (etapa === 'selecionar') {
    return (
      <EtapaSelecionar
        rodadas={rodadas}
        itensNovos={itensNovos}
        selecionados={selecionados}
        setSelecionados={setSelecionados}
        incluirNovos={incluirNovos}
        setIncluirNovos={setIncluirNovos}
        onAvancar={() => setEtapa('pagar')}
        onClose={onClose}
        modo={modo}
        rodadasJaPagas={rodadasJaPagas}
      />
    );
  }

  /* ── Tela de sucesso ── */
  if (confirmado) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-8 w-full max-w-sm mx-4 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full mx-auto mb-4">
            <i className="ri-check-double-line text-3xl text-green-500" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900 mb-1">
            {modo === 'pagar' ? 'Pagamento Registrado!' : 'Conta Fechada!'}
          </h2>
          <p className="text-sm text-zinc-500">
            {mesaNome} · {fmt(total)}
          </p>
          {modo === 'pagar' && (
            <p className="text-xs text-zinc-400 mt-2">
              {selecionados.size} pedido(s) marcado(s) como pago
            </p>
          )}
          {/* PDV e operador */}
          <div className="mt-3 flex items-center gap-2 flex-wrap justify-center">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 bg-zinc-100 px-2 py-1 rounded-full">
              <i className="ri-walk-line text-zinc-400" />
              PDV Garçom
            </span>
            {operadorNome && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 bg-zinc-100 px-2 py-1 rounded-full">
                <i className="ri-user-line text-zinc-400" />
                {operadorNome}
              </span>
            )}
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-zinc-400 text-xs">
            <i className="ri-loader-4-line animate-spin" />
            {modo === 'pagar' ? 'Registrando...' : 'Liberando mesa...'}
          </div>
        </div>
      </div>
    );
  }

  /* ── Etapa pagamento ── */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden flex flex-col" style={{ maxHeight: 'min(92dvh, 92vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEtapa('selecionar')}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-600 transition-colors"
            >
              <i className="ri-arrow-left-line text-sm" />
            </button>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Fechar Conta</h2>
              <p className="text-xs text-zinc-400">{mesaNome} · {rodadasSelecionadas.length} pedido(s) selecionado(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-zinc-900">{fmt(total)}</span>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-600 transition-colors"
            >
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        </div>

        {/* Resumo compacto */}
        <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
            <span>{itensSelecionados.length} itens · Subtotal</span>
            <span className="font-semibold">{fmt(subtotal)}</span>
          </div>
          {taxaAtiva && (
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-zinc-400">Taxa de serviço ({settings.service_fee_percentage}%)</span>
              <span className="text-zinc-500">{fmt(taxa)}</span>
            </div>
          )}
          {gorjetaAtivaCfg && (
            <div className="mt-2 pt-2 border-t border-zinc-100">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">Gorjeta (opcional)</p>
              <div className="flex gap-1.5 flex-wrap">
                {Array.from(new Set([gorjetaDefaultPct, 5, 10, 15].filter((v) => v > 0))).sort((a, b) => a - b).map((pct) => (
                  <button
                    key={pct}
                    onClick={() => { setGorjetaPct(gorjetaPct === pct ? null : pct); setGorjetaCustom(''); }}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer transition-colors whitespace-nowrap ${
                      gorjetaPct === pct ? 'bg-amber-500 text-white border-amber-500' : 'border-zinc-300 text-zinc-600 hover:border-amber-400'
                    }`}
                  >
                    {pct}%{pct === gorjetaDefaultPct ? ' ★' : ''} · {fmt(subtotal * pct / 100)}
                  </button>
                ))}
                <div className="flex items-center gap-1 border border-zinc-300 rounded-full px-2 py-1">
                  <span className="text-[10px] text-zinc-400">R$</span>
                  <input
                    type="number"
                    value={gorjetaCustom}
                    onChange={(e) => { setGorjetaCustom(e.target.value); setGorjetaPct(null); }}
                    placeholder="Outro"
                    className="w-16 text-[10px] outline-none text-zinc-700"
                    min={0}
                  />
                </div>
              </div>
              {gorjetaValor > 0 && (
                <p className="text-[10px] text-amber-600 font-semibold mt-1">
                  <i className="ri-heart-line mr-0.5" />Gorjeta: {fmt(gorjetaValor)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Modo de pagamento */}
        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Como vai pagar?</p>
          <div className="flex gap-2">
            {([
              { id: 'unico', icon: 'ri-bank-card-line', label: 'Uma forma' },
              { id: 'dividir', icon: 'ri-group-line', label: 'Dividir' },
              { id: 'multiplo', icon: 'ri-stack-line', label: 'Múltiplos' },
            ] as { id: Modo; icon: string; label: string }[]).map((m) => (
              <button
                key={m.id}
                onClick={() => setModoPag(m.id)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all cursor-pointer whitespace-nowrap ${
                  modoPag === m.id
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                }`}
              >
                <i className={`${m.icon} text-lg`} />
                <span className="text-[10px] font-bold">{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo por modo */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">

          {/* ── Modo: Uma forma ── */}
          {modoPag === 'unico' && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-zinc-600 mt-1">Selecione a forma de pagamento:</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {formas.map((fp: PaymentMethod) => (
                  <button
                    key={fp.id}
                    onClick={() => { setFormaSelecionada(fp.id); setValorRecebido(''); }}
                    className={`flex flex-col items-center gap-1 py-3 sm:py-4 rounded-xl border-2 transition-all cursor-pointer ${
                      formaSelecionada === fp.id
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50'
                    }`}
                  >
                    <i className={`${fp.icone} text-xl sm:text-2xl`} />
                    <span className="text-[10px] sm:text-xs font-semibold">{fp.nome}</span>
                  </button>
                ))}
              </div>

              {isDinheiro && (
                <div className="bg-zinc-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-700">Valor recebido</span>
                    <button
                      onClick={() => setValorRecebido(total.toFixed(2).replace('.', ','))}
                      className="text-[10px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer"
                    >
                      Exato ({fmt(total)})
                    </button>
                  </div>
                  <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-zinc-400 flex-shrink-0">R$</span>
                    <input
                      type="number"
                      value={valorRecebido}
                      onChange={(e) => setValorRecebido(e.target.value)}
                      placeholder={total.toFixed(2)}
                      className="flex-1 text-sm text-zinc-900 outline-none font-semibold"
                      min={total}
                      step={0.50}
                    />
                  </div>
                  {valorRecebidoNum > 0 && valorRecebidoNum < total && (
                    <p className="text-[10px] text-red-500 font-semibold flex items-center gap-1">
                      <i className="ri-error-warning-line" />
                      Valor insuficiente — faltam {fmt(total - valorRecebidoNum)}
                    </p>
                  )}
                  {troco > 0 && (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <i className="ri-money-dollar-circle-line text-green-600 text-lg" />
                        <span className="text-sm font-bold text-green-700">Troco</span>
                      </div>
                      <span className="text-lg font-black text-green-700">{fmt(troco)}</span>
                    </div>
                  )}
                </div>
              )}

              {!isDinheiro && (
                <div className="bg-zinc-50 rounded-xl px-4 py-3 flex items-center justify-between mt-2">
                  <span className="text-sm text-zinc-600">Total a cobrar</span>
                  <span className="text-lg font-black text-zinc-900">{fmt(total)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Modo: Dividir ── */}
          {modoPag === 'dividir' && (
            <div className="space-y-3 mt-1">
              <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs font-bold text-zinc-700">Número de pessoas</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    {fmt(total / numPessoas)} por pessoa
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleNumPessoas(numPessoas - 1)}
                    disabled={numPessoas <= 2}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 disabled:opacity-40 cursor-pointer transition-colors text-zinc-700 font-bold"
                  >
                    <i className="ri-subtract-line text-sm" />
                  </button>
                  <span className="text-xl font-black text-zinc-900 w-6 text-center">{numPessoas}</span>
                  <button
                    onClick={() => handleNumPessoas(numPessoas + 1)}
                    disabled={numPessoas >= 12}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 disabled:opacity-40 cursor-pointer transition-colors text-zinc-700 font-bold"
                  >
                    <i className="ri-add-line text-sm" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {pessoas.map((p, idx) => (
                  <div key={p.id} className="border border-zinc-200 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2 bg-zinc-50 border-b border-zinc-100">
                      <div className="w-6 h-6 flex items-center justify-center bg-zinc-200 rounded-full flex-shrink-0">
                        <span className="text-[10px] font-black text-zinc-600">{idx + 1}</span>
                      </div>
                      <span className="text-xs font-semibold text-zinc-700 flex-1">{p.label}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-400">R$</span>
                        <input
                          type="number"
                          value={p.valor}
                          min={0}
                          step={0.01}
                          onChange={(e) => handlePessoaValor(idx, e.target.value)}
                          className="w-20 text-right text-sm font-bold text-zinc-900 border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        />
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <FormaPagSelector
                        value={p.formaPagId}
                        onChange={(id) => handlePessoaForma(idx, id)}
                        compact
                        formas={formas}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {Math.abs(diffDividido) > 0.01 && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
                  diffDividido > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-600 border border-red-200'
                }`}>
                  <i className="ri-information-line" />
                  {diffDividido > 0
                    ? `Faltam ${fmt(diffDividido)} para cobrir o total`
                    : `Excede em ${fmt(Math.abs(diffDividido))}`}
                </div>
              )}
            </div>
          )}

          {/* ── Modo: Múltiplos pagamentos ── */}
          {modoPag === 'multiplo' && (
            <div className="space-y-2 mt-1">
              {parcelas.map((parc, idx) => (
                <div key={parc.id} className="border border-zinc-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-100">
                    <div className="w-5 h-5 flex items-center justify-center bg-amber-500 rounded-full flex-shrink-0">
                      <span className="text-[9px] font-black text-white">{idx + 1}</span>
                    </div>
                    <span className="text-xs font-semibold text-zinc-700 flex-1">Pagamento {idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-zinc-400">R$</span>
                      <input
                        type="number"
                        value={parc.valor}
                        min={0.01}
                        step={0.01}
                        onChange={(e) => updateParcelaValor(parc.id, e.target.value)}
                        className="w-24 text-right text-sm font-bold text-zinc-900 border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                      />
                    </div>
                    {parcelas.length > 1 && (
                      <button
                        onClick={() => removeParcela(parc.id)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 cursor-pointer transition-colors flex-shrink-0"
                      >
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    )}
                  </div>
                  <div className="px-3 py-2">
                    <FormaPagSelector
                      value={parc.formaPagId}
                      onChange={(id) => updateParcelaForma(parc.id, id)}
                      compact
                      formas={formas}
                    />
                  </div>
                </div>
              ))}

              {restante > 0.01 && (
                <button
                  onClick={addParcela}
                  className="w-full py-2.5 border-2 border-dashed border-zinc-300 hover:border-amber-400 hover:bg-amber-50 text-zinc-500 hover:text-amber-600 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5"
                >
                  <i className="ri-add-circle-line" />
                  Adicionar pagamento
                </button>
              )}

              <div className="bg-zinc-50 rounded-xl px-4 py-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Total da conta</span>
                  <span className="font-bold text-zinc-700">{fmt(total)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Alocado</span>
                  <span className="font-bold text-zinc-700">{fmt(totalParcelas)}</span>
                </div>
                <div className={`flex justify-between text-xs pt-1 border-t border-zinc-200 ${
                  Math.abs(restante) < 0.02 ? 'text-green-600' : restante > 0 ? 'text-amber-600' : trocoMultiplo > 0 ? 'text-green-600' : 'text-red-500'
                }`}>
                  <span className="font-bold">
                    {Math.abs(restante) < 0.02 ? 'Coberto' : restante > 0 ? 'Restante' : trocoMultiplo > 0 ? 'Troco' : 'Excede'}
                  </span>
                  <span className="font-black">
                    {Math.abs(restante) < 0.02 ? '✓' : fmt(Math.abs(restante))}
                  </span>
                </div>
              </div>

              {trocoMultiplo > 0 && (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <i className="ri-money-dollar-circle-line text-green-600 text-lg" />
                    <span className="text-sm font-bold text-green-700">Troco (dinheiro)</span>
                  </div>
                  <span className="text-lg font-black text-green-700">{fmt(trocoMultiplo)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botão confirmar */}
        <div className="px-4 pb-5 pt-2 border-t border-zinc-100 flex-shrink-0 bg-white">
          {troco > 0 && modoPag === 'unico' && (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-2">
              <span className="text-sm font-bold text-green-700 flex items-center gap-1.5">
                <i className="ri-money-dollar-circle-line" />
                Troco para o cliente
              </span>
              <span className="text-xl font-black text-green-700">{fmt(troco)}</span>
            </div>
          )}
          <button
            onClick={handleConfirmar}
            disabled={!podeConfirmar}
            className="w-full py-3.5 bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-check-double-line text-base" />
            Confirmar Fechamento · {fmt(total)}
          </button>
          {!podeConfirmar && modoPag === 'unico' && isDinheiro && valorRecebidoNum > 0 && valorRecebidoNum < total && (
            <p className="text-[10px] text-red-400 text-center mt-1.5">Valor recebido insuficiente</p>
          )}
          {!podeConfirmar && modoPag === 'dividir' && Math.abs(diffDividido) > 0.01 && (
            <p className="text-[10px] text-red-400 text-center mt-1.5">Ajuste os valores para que somem {fmt(total)}</p>
          )}
          {!podeConfirmar && modoPag === 'multiplo' && restante > 0.01 && (
            <p className="text-[10px] text-red-400 text-center mt-1.5">Adicione mais {fmt(restante)} nos pagamentos</p>
          )}
        </div>
      </div>
    </div>
  );
}
