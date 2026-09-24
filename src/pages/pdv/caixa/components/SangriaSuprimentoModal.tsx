import { useCallback, useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useSessao } from '@/contexts/SessaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { useCaixaPing } from '@/hooks/useCaixaPing';

type TipoMovimento = 'sangria' | 'suprimento';

interface MovimentoCaixa {
  tipo: TipoMovimento;
  valor: number;
  motivo: string;
  hora: string;
}

interface SangriaSuprimentoModalProps {
  tipoInicial?: TipoMovimento;
  historico: MovimentoCaixa[];
  onRegistrar: (mov: MovimentoCaixa) => void;
  onClose: () => void;
}

type MotivoRetirada = 'Sangria' | 'Fornecedor' | 'Freelancer' | 'Troco' | 'Outro';
// Tipo que vai ao Financeiro (2026-09-19): "Sangria" é o dinheiro que o dono retira (retirada do sócio,
// fora das despesas); Fornecedor pago em dinheiro liga à compra lançada pelo cupom.
const CATEGORIA: Record<MotivoRetirada, string> = {
  Sangria: 'retirada_socio', Fornecedor: 'fornecedor', Freelancer: 'freelancer', Troco: 'troco', Outro: 'outro',
};
const ROTULO: Record<MotivoRetirada, string> = {
  Sangria: 'Sangria (dono)', Fornecedor: 'Fornecedor', Freelancer: 'Freelancer', Troco: 'Troco', Outro: 'Outro',
};

// Sangria prevista: compra paga em dinheiro que o assistente lançou pelo cupom do grupo.
interface ItemPrevisto { description: string | null; quantity: number | null; unit_label: string | null; unit_price: number | null; total_price: number | null }
interface SangriaPrevista { id: string; amount: number; supplier: string | null; description: string | null; created_at: string; itens?: ItemPrevisto[] }
type MotivoAdicao = 'Troco' | 'Outros';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function SangriaSuprimentoModal({
  tipoInicial = 'sangria',
  historico,
  onRegistrar,
  onClose,
}: SangriaSuprimentoModalProps) {
  const { caixa } = useSessao();
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();

  const [tipo, setTipo] = useState<TipoMovimento>(tipoInicial);
  const [valor, setValor] = useState('');
  const [motivoRetirada, setMotivoRetirada] = useState<MotivoRetirada | ''>('');
  const [motivoAdicao, setMotivoAdicao] = useState<MotivoAdicao | ''>('');
  const [nomeFornecedor, setNomeFornecedor] = useState('');
  const [nomeFreelancer, setNomeFreelancer] = useState('');
  const [motivoOutro, setMotivoOutro] = useState('');
  const [erro, setErro] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [previstas, setPrevistas] = useState<SangriaPrevista[]>([]);
  // Freelancer: escolhe do cadastro ou cadastra aqui mesmo (dono, 2026-09-19).
  const [freelas, setFreelas] = useState<{ id: string; name: string; daily_rate: number | null }[]>([]);
  const [freelaId, setFreelaId] = useState<string>('');
  const [freelaNovo, setFreelaNovo] = useState(false);
  const [telefoneFreela, setTelefoneFreela] = useState('');
  useEffect(() => {
    if (!user?.tenantId) return;
    // Pelo order-write: a leitura direta falhava na sessão do PDV (lista vazia em Paranaguá, 2026-09-19).
    invokeWithAuth<{ data?: { id: string; name: string; daily_rate: number | null }[] }>('order-write', { body: { action: 'list_freelancers', tenant_id: user.tenantId } })
      .then(({ data }) => setFreelas(data?.data ?? []));
  }, [user?.tenantId]);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  // Conferência da prevista (dono, 2026-09-21): ver os itens do cupom e corrigir o valor que saiu.
  // Corrigir aqui muda SÓ a sangria — a compra fica como está e o financeiro é avisado da diferença.
  const [itensAbertos, setItensAbertos] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunhoValor, setRascunhoValor] = useState('');
  const [valorSaiu, setValorSaiu] = useState<Record<string, number>>({});

  const carregarPrevistas = useCallback(async () => {
    if (!user?.tenantId) return;
    const { data } = await invokeWithAuth<{ data?: SangriaPrevista[] }>('order-write', { body: { action: 'list_sangrias_previstas', tenant_id: user.tenantId } });
    setPrevistas(data?.data ?? []);
  }, [user?.tenantId]);
  useEffect(() => { carregarPrevistas(); }, [carregarPrevistas]);
  useCaixaPing(user?.tenantId, carregarPrevistas);

  // Confirmar a prevista: o valor e a compra vêm do servidor, o operador só confirma que o dinheiro saiu.
  const confirmarPrevista = async (pv: SangriaPrevista) => {
    if (!caixa?.id || !user?.tenantId || resolvendo) return;
    const saiu = valorSaiu[pv.id] ?? pv.amount;
    const corrigido = Math.abs(saiu - pv.amount) > 0.001;
    setResolvendo(pv.id); setErro('');
    const { data, error } = await invokeWithAuth<{ data?: { reason: string }; error?: string }>('order-write', {
      body: { action: 'add_cash_movement', cash_register_id: caixa.id, tenant_id: user.tenantId, type: 'out', previsao_id: pv.id, amount: saiu, reason: '' },
    });
    setResolvendo(null);
    if (error || !data?.data) { setErro((data as { error?: string } | null)?.error ?? error?.message ?? 'Não consegui confirmar.'); return; }
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const motivo = `Fornecedor: ${pv.supplier ?? 'compra'} (cupom)${corrigido ? ` — nota ${fmt(pv.amount)}` : ''}`;
    registrarEvento({
      tipo: 'sangria', severidade: corrigido || saiu >= 200 ? 'aviso' : 'info', usuario: user?.nome ?? 'Operador', perfil: user?.perfil ?? 'operador',
      descricao: `Sangria de ${fmt(saiu)} confirmada — ${motivo}`, entidade: 'Caixa', entidadeId: caixa.id,
      detalhes: `Valor: ${fmt(saiu)} | Motivo: ${motivo} | Hora: ${hora}`, depois: { valor: saiu, motivo, tipo: 'sangria' },
    });
    onRegistrar({ tipo: 'sangria', valor: saiu, motivo, hora });
    setEditando(null);
    await carregarPrevistas();
  };
  const naoSaiu = async (pv: SangriaPrevista) => {
    if (!user?.tenantId || resolvendo) return;
    if (!window.confirm(`O dinheiro da compra ${pv.supplier ?? ''} (${fmt(pv.amount)}) NÃO saiu deste caixa? O gerente vai ser avisado para conferir.`)) return;
    setResolvendo(pv.id);
    await invokeWithAuth('order-write', { body: { action: 'sangria_prevista_nao_saiu', tenant_id: user.tenantId, previsao_id: pv.id, motivo: 'informado no PDV' } });
    setResolvendo(null);
    await carregarPrevistas();
  };

  const motivoFinal = (): string => {
    if (tipo === 'suprimento') return motivoAdicao === 'Outros' ? motivoOutro : motivoAdicao;
    if (motivoRetirada === 'Fornecedor') return nomeFornecedor ? `Fornecedor: ${nomeFornecedor}` : '';
    if (motivoRetirada === 'Freelancer') {
      const nome = freelaNovo || !freelaId ? nomeFreelancer : (freelas.find((f) => f.id === freelaId)?.name ?? '');
      return nome ? `Freelancer: ${nome}` : '';
    }
    if (motivoRetirada === 'Outro') return motivoOutro;
    return motivoRetirada;
  };

  const handleRegistrar = async () => {
    const v = parseFloat(valor.replace(',', '.'));
    if (isNaN(v) || v <= 0) { setErro('Informe um valor válido.'); return; }
    const mf = motivoFinal();
    if (!mf.trim()) { setErro('Informe o motivo da movimentação.'); return; }
    if (motivoRetirada === 'Fornecedor' && !nomeFornecedor.trim()) { setErro('Informe o nome do fornecedor.'); return; }
    if (motivoRetirada === 'Freelancer' && !(freelaId && !freelaNovo) && !nomeFreelancer.trim()) { setErro('Escolha o freelancer ou cadastre o nome.'); return; }
    if (tipo === 'suprimento' && motivoAdicao === 'Outros' && !motivoOutro.trim()) { setErro('Descreva o motivo da movimentação.'); return; }

    setSalvando(true);
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Persist to DB via Edge Function
    if (caixa?.id && user?.tenantId) {
      const { data, error } = await invokeWithAuth('order-write', {
        body: {
          action: 'add_cash_movement',
          cash_register_id: caixa.id,
          tenant_id: user.tenantId,
          type: tipo === 'sangria' ? 'out' : 'in',
          amount: v,
          reason: mf,
          category: tipo === 'sangria' && motivoRetirada ? CATEGORIA[motivoRetirada] : undefined,
          freelancer: tipo === 'sangria' && motivoRetirada === 'Freelancer'
            ? (freelaId && !freelaNovo ? { id: freelaId } : { nome: nomeFreelancer.trim(), telefone: telefoneFreela.trim() || undefined })
            : undefined,
        },
      });

      if (error || !data) {
        console.error('[SangriaSuprimentoModal] persist error:', error?.message ?? data);
        setErro('Erro ao registrar no banco. Tente novamente.');
        setSalvando(false);
        return;
      }
    }

    // Registrar auditoria
    registrarEvento({
      tipo: tipo === 'sangria' ? 'sangria' : 'suprimento',
      severidade: tipo === 'sangria' && v >= 200 ? 'aviso' : 'info',
      usuario: user?.nome ?? 'Operador',
      perfil: user?.perfil ?? 'operador',
      descricao: tipo === 'sangria'
        ? `Sangria de ${fmt(v)} — motivo: ${mf}`
        : `Suprimento de ${fmt(v)} — motivo: ${mf}`,
      entidade: 'Caixa',
      entidadeId: caixa?.id ?? '—',
      detalhes: `Valor: ${fmt(v)} | Motivo: ${mf} | Hora: ${hora}`,
      depois: { valor: v, motivo: mf, tipo },
    });

    onRegistrar({ tipo, valor: v, motivo: mf, hora });
    setSalvando(false);
    setConfirmado(true);
    setTimeout(onClose, 1400);
  };

  const handleTipo = (t: TipoMovimento) => {
    setTipo(t);
    setMotivoRetirada('');
    setMotivoAdicao('');
    setNomeFornecedor('');
    setNomeFreelancer('');
    setMotivoOutro('');
    setErro('');
  };

  const totalRetiradas = historico.filter((m) => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
  const totalAdicoes = historico.filter((m) => m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);

  if (confirmado) {
    const v = parseFloat(valor.replace(',', '.')) || 0;
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 w-full max-w-xs flex flex-col items-center gap-4 text-center">
          <div className={`w-16 h-16 flex items-center justify-center rounded-full ${tipo === 'sangria' ? 'bg-red-100' : 'bg-emerald-100'}`}>
            <i className={`${tipo === 'sangria' ? 'ri-arrow-down-circle-line text-red-500' : 'ri-arrow-up-circle-line text-emerald-500'} text-3xl`} />
          </div>
          <div>
            <p className="text-lg font-black text-zinc-900">
              {tipo === 'sangria' ? 'Retirada registrada!' : 'Adição registrada!'}
            </p>
            <p className="text-2xl font-black mt-1 text-zinc-800">{fmt(v)}</p>
            <p className="text-xs text-zinc-400 mt-1">{motivoFinal()}</p>
            <p className="text-[10px] text-emerald-600 mt-1 font-semibold">Salvo no banco ✓</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-bold text-zinc-900">Movimentação de Caixa</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          {/* Sangrias previstas: compra paga em dinheiro lançada pelo cupom — é só confirmar. */}
          {previstas.length > 0 && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-xs font-black text-amber-900"><i className="ri-receipt-line" /> Aguardando sua confirmação ({previstas.length})</p>
              <p className="text-[11px] text-amber-800">Compras pagas em dinheiro do caixa (cupom já lançado). O caixa só fecha depois de confirmar.</p>
              {previstas.map((pv) => {
                const saiu = valorSaiu[pv.id] ?? pv.amount;
                const corrigido = Math.abs(saiu - pv.amount) > 0.001;
                const itens = pv.itens ?? [];
                const aberto = !!itensAbertos[pv.id];
                return (
                  <div key={pv.id} className="bg-white rounded-lg border border-amber-200 px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-zinc-900 truncate">{pv.supplier ?? 'Compra'}</p>
                        <p className="text-[11px] text-zinc-500">
                          {new Date(pv.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          {itens.length > 0 && (
                            <button onClick={() => setItensAbertos((a) => ({ ...a, [pv.id]: !a[pv.id] }))}
                              className="ml-1.5 text-amber-700 font-semibold underline cursor-pointer">
                              {itens.length} {itens.length === 1 ? 'item' : 'itens'} <i className={aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                            </button>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-black text-red-600 whitespace-nowrap">-{fmt(saiu)}</span>
                        {corrigido && <p className="text-[10px] text-zinc-400 line-through leading-tight">{fmt(pv.amount)}</p>}
                      </div>
                      <button onClick={() => { setEditando(editando === pv.id ? null : pv.id); setRascunhoValor(saiu.toFixed(2)); }}
                        title="Corrigir o valor que saiu do caixa" disabled={!!resolvendo}
                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 cursor-pointer disabled:opacity-50">
                        <i className="ri-pencil-line text-sm" />
                      </button>
                    </div>

                    {/* Conferência linha a linha: o operador tem o cupom na mão. */}
                    {aberto && itens.length > 0 && (
                      <div className="border-t border-amber-100 pt-1.5 space-y-1">
                        {itens.map((it, i) => (
                          <div key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                            <span className="text-zinc-600 truncate">
                              <span className="text-zinc-400">{Number(it.quantity ?? 0)}{it.unit_label ? ` ${it.unit_label}` : ''}</span> {it.description ?? '-'}
                            </span>
                            <span className="text-zinc-500 whitespace-nowrap">{fmt(Number(it.total_price ?? 0))}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Corrigir o valor mexe SÓ na sangria; a compra fica como o cupom lançou. */}
                    {editando === pv.id && (
                      <div className="border-t border-amber-100 pt-2 space-y-1.5">
                        <label className="block text-[11px] font-semibold text-zinc-600">Quanto saiu mesmo do caixa?</label>
                        <div className="flex gap-1.5">
                          <input type="number" min="0.01" step="0.01" value={rascunhoValor} autoFocus
                            onChange={(e) => setRascunhoValor(e.target.value)}
                            className="flex-1 min-w-0 text-sm border border-zinc-200 rounded-lg px-2.5 py-1.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                          <button onClick={() => {
                            const v = Math.round(Number(rascunhoValor.replace(',', '.')) * 100) / 100;
                            if (!Number.isFinite(v) || v <= 0) { setErro('Valor inválido.'); return; }
                            setValorSaiu((m) => ({ ...m, [pv.id]: v })); setEditando(null); setErro('');
                          }} className="px-3 py-1.5 text-xs font-bold text-white bg-zinc-700 hover:bg-zinc-800 rounded-lg cursor-pointer whitespace-nowrap">
                            Usar
                          </button>
                          {corrigido && (
                            <button onClick={() => { setValorSaiu((m) => { const copia = { ...m }; delete copia[pv.id]; return copia; }); setEditando(null); }}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 rounded-lg cursor-pointer whitespace-nowrap">
                              Voltar ao da nota
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500">A compra continua valendo {fmt(pv.amount)} — aqui muda só o que sai do caixa. O financeiro é avisado da diferença.</p>
                      </div>
                    )}

                    <div className="flex gap-1.5">
                      <button onClick={() => confirmarPrevista(pv)} disabled={!!resolvendo}
                        className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg cursor-pointer disabled:opacity-50 whitespace-nowrap">
                        {resolvendo === pv.id ? '...' : `Confirmar ${fmt(saiu)}`}
                      </button>
                      <button onClick={() => naoSaiu(pv)} disabled={!!resolvendo} title="O dinheiro não saiu deste caixa"
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 rounded-lg cursor-pointer disabled:opacity-50 whitespace-nowrap">
                        Não saiu
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleTipo('sangria')}
              className={`flex items-center justify-center gap-2.5 py-3.5 rounded-xl border-2 cursor-pointer transition-all ${tipo === 'sangria' ? 'border-red-400 bg-red-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
            >
              <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${tipo === 'sangria' ? 'bg-red-100' : 'bg-zinc-200'}`}>
                <i className={`ri-arrow-down-line text-base font-bold ${tipo === 'sangria' ? 'text-red-600' : 'text-zinc-500'}`} />
              </div>
              <div className="text-left">
                <p className={`text-xs font-bold ${tipo === 'sangria' ? 'text-red-700' : 'text-zinc-600'}`}>Retirada de dinheiro</p>
                <p className="text-[10px] text-zinc-400">Saída do caixa</p>
              </div>
            </button>
            <button
              onClick={() => handleTipo('suprimento')}
              className={`flex items-center justify-center gap-2.5 py-3.5 rounded-xl border-2 cursor-pointer transition-all ${tipo === 'suprimento' ? 'border-emerald-400 bg-emerald-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
            >
              <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${tipo === 'suprimento' ? 'bg-emerald-100' : 'bg-zinc-200'}`}>
                <i className={`ri-arrow-up-line text-base font-bold ${tipo === 'suprimento' ? 'text-emerald-600' : 'text-zinc-500'}`} />
              </div>
              <div className="text-left">
                <p className={`text-xs font-bold ${tipo === 'suprimento' ? 'text-emerald-700' : 'text-zinc-600'}`}>Adição de dinheiro</p>
                <p className="text-[10px] text-zinc-400">Entrada no caixa</p>
              </div>
            </button>
          </div>

          {/* Valor */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Valor (R$)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-semibold">R$</span>
              <input
                type="number" min="0.01" step="0.01" value={valor}
                onChange={(e) => { setValor(e.target.value); setErro(''); }}
                placeholder="0,00"
                className="w-full pl-9 pr-4 py-3 text-lg font-bold border border-zinc-200 rounded-xl text-zinc-800 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex gap-2 mt-2">
              {[50, 100, 200, 500].map((v) => (
                <button key={v} onClick={() => setValor(String(v))}
                  className="flex-1 py-1.5 text-xs font-semibold bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 cursor-pointer transition-colors whitespace-nowrap">
                  R$ {v}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Motivo <span className="text-red-400">*</span></label>

            {tipo === 'sangria' ? (
              <>
                <select value={motivoRetirada} onChange={(e) => { setMotivoRetirada(e.target.value as MotivoRetirada | ''); setErro(''); }}
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 mb-3 text-zinc-800 bg-white cursor-pointer focus:outline-none focus:border-amber-400">
                  <option value="">Escolha o motivo...</option>
                  {(['Sangria', 'Fornecedor', 'Freelancer', 'Troco', 'Outro'] as MotivoRetirada[]).map((m) => (
                    <option key={m} value={m}>{ROTULO[m]}</option>
                  ))}
                </select>
                {motivoRetirada === 'Sangria' && (
                  <p className="text-[11px] text-zinc-500 mb-2">Dinheiro retirado pelo dono — não entra como despesa da loja.</p>
                )}
                {motivoRetirada === 'Fornecedor' && (
                  <>
                    <input value={nomeFornecedor} onChange={(e) => setNomeFornecedor(e.target.value)}
                      placeholder="Nome do fornecedor..."
                      className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                    <p className="text-[11px] text-amber-700 mt-1.5"><i className="ri-camera-line" /> Sem cupom: mande a foto do cupom no grupo da loja — o assistente lança a compra e liga a esta retirada. Até lá fica pendente.</p>
                  </>
                )}
                {motivoRetirada === 'Freelancer' && (
                  <div className="space-y-2">
                    {!freelaNovo && freelas.length > 0 && (
                      <select value={freelaId} onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__novo') { setFreelaNovo(true); setFreelaId(''); return; }
                        setFreelaId(v);
                        const f = freelas.find((x) => x.id === v);
                        if (f?.daily_rate && !valor) setValor(String(f.daily_rate));
                      }}
                        className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 bg-white focus:outline-none focus:border-amber-400">
                        <option value="">Escolha o freelancer...</option>
                        {freelas.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        <option value="__novo">+ Cadastrar novo</option>
                      </select>
                    )}
                    {(freelaNovo || freelas.length === 0) && (
                      <>
                        <input value={nomeFreelancer} onChange={(e) => setNomeFreelancer(e.target.value)}
                          placeholder="Nome completo do freelancer (novo cadastro)"
                          className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                        <input value={telefoneFreela} onChange={(e) => setTelefoneFreela(e.target.value)} inputMode="tel"
                          placeholder="Telefone (opcional)"
                          className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                        {freelas.length > 0 && (
                          <button type="button" onClick={() => { setFreelaNovo(false); setNomeFreelancer(''); }} className="text-[11px] text-zinc-500 underline cursor-pointer">Escolher da lista</button>
                        )}
                      </>
                    )}
                    <p className="text-[11px] text-zinc-500">Registra a diária de hoje paga em dinheiro (aparece em Financeiro › Freelancers).</p>
                  </div>
                )}
                {motivoRetirada === 'Outro' && (
                  <input value={motivoOutro} onChange={(e) => setMotivoOutro(e.target.value)}
                    placeholder="Descreva o motivo..."
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                )}
              </>
            ) : (
              <>
                <select value={motivoAdicao} onChange={(e) => { setMotivoAdicao(e.target.value as MotivoAdicao | ''); setErro(''); }}
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 bg-white cursor-pointer focus:outline-none focus:border-amber-400">
                  <option value="">Escolha o motivo...</option>
                  {(['Troco', 'Outros'] as MotivoAdicao[]).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {motivoAdicao === 'Outros' && (
                  <input value={motivoOutro} onChange={(e) => setMotivoOutro(e.target.value)}
                    placeholder="Descreva o motivo..."
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 mt-3" />
                )}
              </>
            )}
          </div>

          {erro && <p className="text-xs text-red-500 font-medium">{erro}</p>}

          {/* Histórico resumido */}
          {historico.length > 0 && (
            <div className="bg-zinc-50 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Movimentos desta sessão</p>
              {historico.slice(-3).map((h, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <i className={`text-xs ${h.tipo === 'sangria' ? 'ri-arrow-down-line text-red-400' : 'ri-arrow-up-line text-emerald-500'}`} />
                    <span className="text-zinc-500 truncate max-w-[140px]">{h.motivo}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400">{h.hora}</span>
                    <span className={`font-bold ${h.tipo === 'sangria' ? 'text-red-500' : 'text-emerald-600'}`}>
                      {h.tipo === 'sangria' ? '-' : '+'}{fmt(h.valor)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="border-t border-zinc-200 pt-2 flex justify-between text-xs">
                <div className="flex gap-4">
                  <span className="text-zinc-500">Retiradas: <span className="text-red-500 font-bold">-{fmt(totalRetiradas)}</span></span>
                  <span className="text-zinc-500">Adições: <span className="text-emerald-600 font-bold">+{fmt(totalAdicoes)}</span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-zinc-100 bg-white flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
            Cancelar
          </button>
          <button
            onClick={handleRegistrar}
            disabled={salvando}
            className={`flex-1 py-2.5 text-sm font-bold text-white rounded-xl cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50 ${tipo === 'sangria' ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
          >
            {salvando ? 'Salvando...' : `Registrar ${tipo === 'sangria' ? 'retirada' : 'adição'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
