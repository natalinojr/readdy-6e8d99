import { useEffect, useMemo, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useDreGroups, isGrupoDespesa } from '@/hooks/useDreGroups';
import { formatCurrency } from '@/lib/formatters';
import CategoriaCombobox from '../CategoriaCombobox';
import LerNotaBotoes from '../compras/LerNotaBotoes';
import { linhasParaValor, aprenderVinculos, type ScanResult } from '@/lib/leituraNotinha';
import type { StatementImport } from '@/hooks/useConciliacao';

// Pagamento sem nota: lança uma DESPESA (conta a pagar já baixada, com categoria da DRE), uma
// COMPRA (CMV, categoria de mercadoria) ou um pagamento de FREELANCER (despesa em RH que também
// registra o freela e as diárias, 2026-09-20) a partir da linha do extrato, na data e na conta do
// pagamento. Edge conciliacao-pagamentos › create_from_statement; "Desfazer" (undo) apaga o que
// foi criado e devolve a linha para pendente.

// Linhas que já têm destino: vínculo sugerido com nota/conta, transferência própria, repasse.
const JA_TEM_DESTINO = ['payable', 'inbound_doc', 'internal_transfer', 'stone_deposit', 'stone_detail', 'ifood_deposit', 'card_deposit'];

export function podeLancarDoExtrato(s: StatementImport) {
  return s.transaction_type === 'debit' && s.status === 'pending' && !s.reconciled && !JA_TEM_DESTINO.includes(String(s.match_kind ?? ''));
}

export type LancarTipo = 'despesa' | 'compra' | 'freelancer' | 'fora_dre' | 'prestador';

/** Saída que não é despesa da loja: não vira conta nem compra, só sai das pendências com o motivo. */
export const MOTIVOS_FORA_DRE = [
  ['retirada_dono', 'Retirada do dono', 'Dinheiro que o dono tirou da empresa (pró-labore/lucro não entra como despesa).'],
  ['transferencia', 'Transferência entre contas', 'Saiu daqui e entrou em outra conta sua: o dinheiro não saiu da empresa.'],
  ['emprestimo', 'Empréstimo', 'Empréstimo concedido ou devolvido — não é despesa do mês.'],
  ['particular', 'Gasto particular', 'Gasto pessoal pago pela conta da empresa.'],
  ['investimento', 'Investimento / compra de bem', 'Compra de equipamento ou obra: vira patrimônio, não despesa do mês.'],
  ['outro', 'Outro (não entra no DRE)', 'Qualquer outra saída que não deve afetar o resultado. Explique no campo acima.'],
] as const;
export interface LancarResultado { id: string; ok: boolean; msg: string; code?: string }
export interface LancarOpcoes {
  kind: LancarTipo;
  /** fora_dre: chave de MOTIVOS_FORA_DRE */
  motivo?: string | null;
  dre_category_id?: string | null;
  merchandise_category_id?: string | null;
  description?: string | null;
  supplier?: string | null;
  allow_payroll?: boolean;
  /** freelancer: dias trabalhados ('YYYY-MM-DD'). Vazio = a aba Freelancers pergunta depois. */
  dias?: string[];
  funcao?: string | null;
  /** 'YYYY-MM': mês a que o gasto pertence (competência). Vazio = só a data do pagamento. */
  competence_month?: string | null;
  /** prestador MEI (2026-09-28): quem e se é o serviço do mês ou um reembolso */
  prestador_id?: string | null;
  prestador_tipo?: 'servico' | 'reembolso' | null;
  /** compra (2026-09-28): itens com insumo opcional; a soma tem que fechar com o pagamento */
  items?: Array<{ description: string; quantity: number; total: number; unit_label: string | null; ingredient_id: string | null }> | null;
  /** compra com itens: já recebi → os insumos entram no estoque na hora */
  received?: boolean;
  /** compra lida da nota (2026-09-29): nº da nota e chave da NFC-e vão para a compra */
  invoice_number?: string | null;
  access_key?: string | null;
}

/** Insumos da loja para ligar os itens da compra (só carrega quando a compra é aberta). */
type InsumoLista = { id: string; name: string; unit: string | null };
export function useInsumos(ativo: boolean) {
  const { user } = useAuth();
  const [lista, setLista] = useState<{ tenant: string; itens: InsumoLista[] } | null>(null);
  useEffect(() => {
    if (!ativo || !user?.tenantId || lista?.tenant === user.tenantId) return;
    const tenant = user.tenantId;
    let vivo = true;
    supabase.from('ingredients').select('id, name, unit').eq('tenant_id', tenant).is('deleted_at', null).order('name')
      .then(({ data }) => { if (vivo) setLista({ tenant, itens: (data ?? []) as InsumoLista[] }); });
    return () => { vivo = false; };
  }, [ativo, user?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Troca de loja: nunca mostra os insumos da loja anterior
  const itens = lista && lista.tenant === user?.tenantId ? lista.itens : [];
  const options = useMemo(() => [
    { id: SEM_INSUMO, label: 'Sem insumo (não entra no estoque)', sub: null },
    ...itens.map((i) => ({ id: i.id, label: i.name, sub: i.unit ?? null })),
  ], [itens]);
  return { insumos: itens, insumoOptions: options };
}
export const SEM_INSUMO = '__sem_insumo';
// raw = descrição como veio na nota (para memorizar o vínculo com o insumo)
type ItemCompra = { key: number; descricao: string; qtd: string; unidade: string; total: string; insumoId: string; raw?: string };
// "1.234,56" e "12,50" (vírgula = decimal) ou "12.50" (ponto como decimal, sem vírgula)
export const numBR = (s: string) => {
  const t = String(s).trim();
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return t && Number.isFinite(n) ? n : NaN;
};
// Quantidade: "1,5" e "1.5" = um e meio; "1.000" / "12.500" (ponto + 3 dígitos, sem vírgula) = milhar —
// em insumo controlado em g, ler "1.000" como 1 jogaria 1 g no estoque e o custo da grama 1000× (revisão 2026-09-28)
export const numBRqtd = (s: string) => {
  const t = String(s).trim();
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t);
  return t && Number.isFinite(n) ? n : NaN;
};

// A edge aceita até 30 por chamada (e ignora o resto): manda em blocos.
export async function lancarDoExtrato(tenantId: string, ids: string[], opts: LancarOpcoes) {
  const results: LancarResultado[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const r = await invokeWithAuth<{ success?: boolean; error?: string; results?: LancarResultado[] }>('conciliacao-pagamentos', {
      body: { action: 'create_from_statement', tenant_id: tenantId, ids: ids.slice(i, i + 30), ...opts },
    });
    const error = r.data?.error ?? r.error?.message ?? null;
    if (error) return { results, error };
    results.push(...(r.data?.results ?? []));
  }
  return { results, error: null as string | null };
}

/** Freelancers já cadastrados na loja, para escolher em vez de digitar o nome de novo. */
export function useFreelancers() {
  const { user } = useAuth();
  const [lista, setLista] = useState<Array<{ id: string; name: string; role: string | null }>>([]);
  useEffect(() => {
    setLista([]);
    if (!user?.tenantId) return;
    let vivo = true;
    supabase.from('hr_freelancers').select('id, name, role').eq('tenant_id', user.tenantId).eq('is_active', true).order('name')
      .then(({ data }) => { if (vivo) setLista((data ?? []) as Array<{ id: string; name: string; role: string | null }>); });
    return () => { vivo = false; };
  }, [user?.tenantId]);
  const options = useMemo(() => lista.map((f) => ({ id: f.id, label: f.name, sub: f.role ?? null })), [lista]);
  return { freelancers: lista, freelaOptions: options };
}

/** Prestadores MEI da loja (RH / Folha › Prestadores MEI). */
type PrestadorLista = { id: string; name: string; role: string | null; cpf: string | null; cnpj: string | null; competencia_regra: 'same' | 'prev' };
export function usePrestadores() {
  const { user } = useAuth();
  const [lista, setLista] = useState<PrestadorLista[]>([]);
  useEffect(() => {
    setLista([]);
    if (!user?.tenantId) return;
    let vivo = true;
    supabase.from('hr_prestadores').select('id, name, role, cpf, cnpj, competencia_regra').eq('tenant_id', user.tenantId).eq('is_active', true).order('name')
      .then(({ data }) => { if (vivo) setLista((data ?? []) as PrestadorLista[]); });
    return () => { vivo = false; };
  }, [user?.tenantId]);
  const options = useMemo(() => lista.map((p) => ({ id: p.id, label: p.name, sub: p.role ?? 'MEI' })), [lista]);
  return { prestadores: lista, prestadorOptions: options };
}

/** Categorias de despesa (DRE) e de mercadoria (CMV) da loja, no formato do CategoriaCombobox. */
export function useCategoriasLancamento() {
  const { user } = useAuth();
  const { groupMeta } = useDreGroups();
  const [dre, setDre] = useState<Array<{ id: string; name: string; group_type: string }>>([]);
  const [mercs, setMercs] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    setDre([]); setMercs([]);
    if (!user?.tenantId) return;
    let vivo = true;
    Promise.all([
      supabase.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', user.tenantId)
        .is('deleted_at', null).eq('is_active', true).order('name'),
      supabase.from('fin_merchandise_categories').select('id, name').eq('tenant_id', user.tenantId)
        .eq('is_active', true).order('sort_order').order('name'),
    ]).then(([d, m]) => {
      if (!vivo) return;
      setDre(((d.data ?? []) as Array<{ id: string; name: string; group_type: string }>).filter((c) => isGrupoDespesa(c.group_type)));
      setMercs((m.data ?? []) as Array<{ id: string; name: string }>);
    });
    return () => { vivo = false; };
  }, [user?.tenantId]);
  const dreOptions = useMemo(() => dre.map((c) => ({ id: c.id, label: c.name, sub: groupMeta(c.group_type)?.label ?? null })), [dre, groupMeta]);
  const mercOptions = useMemo(() => mercs.map((m) => ({ id: m.id, label: m.name, sub: 'CMV' })), [mercs]);
  const dreNome = (id: string | null | undefined) => dre.find((c) => c.id === id)?.name ?? null;
  return { dreOptions, mercOptions, dreNome };
}

interface Props {
  transaction: StatementImport;
  onDone: () => void;
  /** Avisa o modal quando o painel abre/fecha (o modal esconde o formulário antigo de categoria). */
  onAbertoChange?: (aberto: boolean) => void;
}

export default function LancarDoExtrato({ transaction, onDone, onAbertoChange }: Props) {
  const { user } = useAuth();
  const { dreOptions, mercOptions } = useCategoriasLancamento();
  const { freelancers, freelaOptions } = useFreelancers();
  const { prestadores, prestadorOptions } = usePrestadores();
  const [prestadorId, setPrestadorId] = useState('');
  const [prestadorTipo, setPrestadorTipo] = useState<'servico' | 'reembolso'>('servico');
  const nomePadrao = transaction.counterpart_name || transaction.description || '';
  const [aberto, setAberto] = useState(false);
  useEffect(() => { onAbertoChange?.(aberto); }, [aberto, onAbertoChange]);
  const [tipo, setTipo] = useState<LancarTipo>('despesa');
  const [descricao, setDescricao] = useState(nomePadrao);
  const [fornecedor, setFornecedor] = useState(transaction.counterpart_name || '');
  const [dreCat, setDreCat] = useState('');
  const [merc, setMerc] = useState('');
  const [lembrar, setLembrar] = useState(false);
  // Freelancer: dias trabalhados (um Pix pode cobrir vários dias; o valor é dividido entre eles)
  const [dias, setDias] = useState<string[]>([]);
  const [diaNovo, setDiaNovo] = useState(transaction.transaction_date);
  const [funcao, setFuncao] = useState('');
  const [freelaId, setFreelaId] = useState('');
  // Competência (2026-09-18): mês do pagamento, o anterior (royalties, contas de consumo) ou outro
  const mesPag = transaction.transaction_date.slice(0, 7);
  const mesAnt = (() => { const [y, m] = mesPag.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
  // Dia do pagamento e os seis anteriores: o freela quase sempre trabalhou num deles
  const ultimosDias = useMemo(() => {
    const base = new Date(transaction.transaction_date + 'T00:00:00');
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    }).reverse();
  }, [transaction.transaction_date]);
  const [compModo, setCompModo] = useState<'same' | 'prev' | 'outro'>('same');
  const [compOutro, setCompOutro] = useState(mesPag);
  const competencia = compModo === 'same' ? mesPag : compModo === 'prev' ? mesAnt : compOutro;
  const [motivo, setMotivo] = useState('');
  const [avisoFolha, setAvisoFolha] = useState<string | null>(null);
  const [permitirFolha, setPermitirFolha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Compra com itens (2026-09-28): cada item pode ser ligado a um insumo; a soma fecha com o pagamento
  const { insumos, insumoOptions } = useInsumos(aberto && tipo === 'compra');
  const [itens, setItens] = useState<ItemCompra[]>([]);
  const [recebido, setRecebido] = useState(true);
  const [avisoFinal, setAvisoFinal] = useState<string | null>(null);
  // Nota lida (QR/foto/arquivo): preenche fornecedor e itens; nº da nota vai junto na compra
  const [lida, setLida] = useState<ScanResult | null>(null);
  const valorPag = Math.round(Number(transaction.amount) * 100) / 100;
  const somaItens = Math.round(itens.reduce((s, it) => s + (numBR(it.total) || 0), 0) * 100) / 100;
  const faltaItens = Math.round((valorPag - somaItens) * 100) / 100;
  const itemInvalido = itens.find((it) => !it.descricao.trim() || !(numBRqtd(it.qtd) > 0) || !(numBR(it.total) > 0));
  const itensComInsumo = itens.some((it) => it.insumoId);
  const itensOk = tipo !== 'compra' || itens.length === 0 || (!itemInvalido && Math.abs(faltaItens) < 0.005);
  const novoItem = (): ItemCompra => ({
    key: Date.now() + Math.random(), descricao: itens.length === 0 ? (descricao.trim() === nomePadrao ? '' : descricao.trim()) : '',
    qtd: '1', unidade: 'un', total: faltaItens > 0 ? faltaItens.toFixed(2).replace('.', ',') : '', insumoId: '',
  });
  const aplicarNota = (r: ScanResult) => {
    const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
    const linhas = linhasParaValor(r, valorPag).map((l, i): ItemCompra => ({
      key: Date.now() + i + Math.random(), descricao: l.descricao, qtd: fmt(l.qtd), unidade: l.unidade,
      total: l.total.toFixed(2).replace('.', ','), insumoId: l.insumoId ?? '', raw: l.raw,
    }));
    // Linhas que a pessoa já preencheu ficam; as da nota entram depois
    setItens((v) => [...v.filter((it) => it.descricao.trim() && !it.raw), ...linhas]);
    if (r.supplier_name && (!fornecedor.trim() || fornecedor === (transaction.counterpart_name || ''))) setFornecedor(r.supplier_name);
    setLida(r);
  };
  const mudaItem = (key: number, patch: Partial<ItemCompra>) => setItens((v) => v.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  useEffect(() => {
    setAberto(false); setTipo('despesa'); setDescricao(nomePadrao); setFornecedor(transaction.counterpart_name || '');
    setDreCat(''); setMerc(''); setLembrar(false); setAvisoFolha(null); setPermitirFolha(false); setErro(null);
    setDias([]); setDiaNovo(transaction.transaction_date); setFuncao(''); setFreelaId(''); setMotivo('');
    setCompModo('same'); setCompOutro(transaction.transaction_date.slice(0, 7));
    setPrestadorId(''); setPrestadorTipo('servico');
    setItens([]); setRecebido(true); setLida(null);
  }, [transaction.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quem recebeu o Pix já está cadastrado? Então a opção certa vem marcada sozinha.
  useEffect(() => {
    if (tipo !== 'freelancer' || freelaId) return;
    const igual = freelancers.find((f) => f.name.trim().toLowerCase() === (transaction.counterpart_name ?? '').trim().toLowerCase());
    if (igual) { setFreelaId(igual.id); setDescricao(igual.name); }
  }, [tipo, freelancers]); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = transaction.counterpart_doc ?? '';

  // Pix para o CPF/CNPJ de um prestador MEI: abre já em "Prestador MEI" com ele escolhido
  const docDig = doc.replace(/\D/g, '');
  const prestadorDoPix = docDig ? prestadores.find((p) => p.cpf === docDig || p.cnpj === docDig) : undefined;
  useEffect(() => {
    if (!aberto || !prestadorDoPix || prestadorId) return;
    setTipo('prestador'); setPrestadorId(prestadorDoPix.id);
  }, [aberto, prestadorDoPix?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Serviço do prestador: a competência já vem da regra do cadastro (em geral, o mês anterior ao Pix) —
  // lançar no mês do pagamento deixaria o gerador recorrente pedir aquele mês de novo (revisão 2026-09-28)
  useEffect(() => {
    if (tipo !== 'prestador' || prestadorTipo !== 'servico') return;
    const pr = prestadores.find((x) => x.id === prestadorId);
    if (pr) setCompModo(pr.competencia_regra === 'same' ? 'same' : 'prev');
  }, [tipo, prestadorTipo, prestadorId, prestadores]);

  const lancar = async () => {
    if (!user?.tenantId) return;
    if (tipo === 'despesa' && !dreCat) { setErro('Escolha a categoria da despesa.'); return; }
    if (tipo === 'fora_dre' && !motivo) { setErro('Escolha o motivo de não entrar no DRE.'); return; }
    if (tipo === 'prestador' && !prestadorId) { setErro('Escolha o prestador.'); return; }
    if (tipo === 'prestador' && prestadorTipo === 'reembolso' && !dreCat) { setErro('Escolha a categoria do que foi reembolsado.'); return; }
    if (tipo === 'compra' && itemInvalido) { setErro('Todo item precisa de descrição, quantidade e valor.'); return; }
    if (!itensOk) { setErro(`Os itens somam ${formatCurrency(somaItens)} e o pagamento é ${formatCurrency(valorPag)}: ajuste até fechar.`); return; }
    setErro(null);
    setBusy(true);
    const { results, error } = await lancarDoExtrato(user.tenantId, [transaction.id], {
      kind: tipo,
      motivo: tipo === 'fora_dre' ? motivo : null,
      dre_category_id: tipo === 'despesa' || (tipo === 'prestador' && prestadorTipo === 'reembolso') ? dreCat : null,
      merchandise_category_id: tipo === 'compra' ? merc || null : null,
      description: descricao.trim() || null,
      supplier: tipo === 'compra' ? fornecedor.trim() || null : null,
      dias: tipo === 'freelancer' ? dias : undefined,
      funcao: tipo === 'freelancer' ? funcao.trim() || null : null,
      allow_payroll: permitirFolha,
      competence_month: /^\d{4}-\d{2}$/.test(competencia) ? competencia : null,
      prestador_id: tipo === 'prestador' ? prestadorId : null,
      prestador_tipo: tipo === 'prestador' ? prestadorTipo : null,
      items: tipo === 'compra' && itens.length ? itens.map((it) => ({
        description: it.descricao.trim(), quantity: numBRqtd(it.qtd), total: Math.round(numBR(it.total) * 100) / 100,
        unit_label: it.unidade.trim() || null, ingredient_id: it.insumoId || null,
      })) : null,
      received: tipo === 'compra' && itensComInsumo && recebido,
      invoice_number: tipo === 'compra' ? lida?.invoice_number ?? null : null,
      access_key: tipo === 'compra' ? lida?.access_key ?? null : null,
    });
    const r = results[0];
    if (error || !r) { setBusy(false); setErro(error ?? 'Não foi possível lançar.'); return; }
    if (!r.ok) {
      setBusy(false);
      if (r.code === 'folha') { setAvisoFolha(r.msg); return; }
      setErro(r.msg);
      return;
    }
    // Nota lida: memoriza o insumo que a pessoa ligou em cada linha (a próxima nota já vem ligada)
    if (tipo === 'compra' && lida) {
      aprenderVinculos(user.tenantId, lida.supplier_key, itens.filter((it) => it.raw).map((it) => ({
        raw_description: it.raw!, ingredient_id: it.insumoId || null, unit_label: it.unidade.trim() || null,
      })));
    }
    // "Fazer sempre assim": regra de LANÇAMENTO para este CPF/CNPJ/chave (2026-09-18). Antes só
    // etiquetava o extrato — não entrava na DRE e ainda escondia o pagamento do alerta.
    if (lembrar && doc && tipo !== 'fora_dre' && tipo !== 'prestador') {
      const rr = await invokeWithAuth<{ success?: boolean; error?: string }>('conciliacao-pagamentos', {
        body: {
          action: 'launch_rule_save', tenant_id: user.tenantId, counterpart_doc: doc,
          counterpart_label: transaction.counterpart_name ?? transaction.description,
          kind: tipo, dre_category_id: tipo === 'despesa' ? dreCat : null, merchandise_category_id: tipo === 'compra' ? merc || null : null,
          competence_rule: compModo === 'prev' ? 'prev' : 'same', supplier_name: tipo === 'compra' ? fornecedor.trim() || null : descricao.trim() || null,
          allow_payroll: permitirFolha,
        },
      });
      const e = rr.data?.error ?? rr.error?.message;
      // Lançamento feito; só a regra falhou: mostra aqui em vez de fechar (antes: alerta do navegador)
      if (e) { setBusy(false); setErro('Lançado, mas a regra não foi salva: ' + e); return; }
    }
    setBusy(false);
    // Compra com itens: aviso de conversão de unidade ou de estoque que falhou não pode sumir com o painel
    if (/Atenção:|falhou/.test(r.msg)) { setAvisoFinal(r.msg); return; }
    onDone();
  };

  if (avisoFinal) {
    return (
      <div className="border border-amber-300 rounded-xl p-3 space-y-2 bg-amber-50 text-xs text-amber-900">
        <p><i className="ri-alert-line mr-1" />{avisoFinal}</p>
        <button onClick={() => { setAvisoFinal(null); onDone(); }}
          className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-amber-700">Entendi</button>
      </div>
    );
  }

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-violet-300 bg-violet-50/50 text-left hover:bg-violet-50 cursor-pointer">
        <i className="ri-add-circle-line text-violet-600 text-lg" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-violet-800">Lançar a partir deste pagamento</span>
          <span className="block text-xs text-violet-600">Pagamento sem nota? Vira despesa, compra ou diária de freelancer já paga nesta data e conta.</span>
        </span>
      </button>
    );
  }

  return (
    <div className="border border-violet-200 rounded-xl p-3 space-y-3 bg-violet-50/40">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-violet-800"><i className="ri-add-circle-line mr-1" />Lançar {formatCurrency(Number(transaction.amount))} de {new Date(transaction.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
        <button onClick={() => setAberto(false)} className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer">Cancelar</button>
      </div>

      <div className="flex flex-wrap bg-white border border-zinc-200 rounded-lg overflow-hidden w-fit max-w-full">
        {([['despesa', 'Despesa', 'ri-file-list-3-line'], ['compra', 'Compra (CMV)', 'ri-shopping-cart-line'], ['freelancer', 'Freelancer', 'ri-user-star-line'], ['prestador', 'Prestador MEI', 'ri-briefcase-line'], ['fora_dre', 'Não entra no DRE', 'ri-eye-off-line']] as const).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTipo(k)}
            className={`px-3 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1 ${tipo === k ? 'bg-violet-600 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className={icon} /> {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500">
        {tipo === 'despesa'
          ? 'Vira uma conta a pagar já baixada nesta data, com a categoria da DRE (limpeza, manutenção, serviço, frete…).'
          : tipo === 'compra'
          ? 'Vira uma compra de mercadoria já paga nesta data: entra no CMV na categoria escolhida. Para mexer no estoque, adicione os itens e ligue cada um ao insumo.'
          : tipo === 'prestador'
          ? 'Serviço do mês: despesa de RH na competência. Reembolso: despesa na categoria do que ele comprou para a loja. Aparece em RH / Folha › Prestadores MEI.'
          : tipo === 'freelancer'
          ? 'Vira despesa de RH já paga nesta data e registra a diária em Financeiro › Freelancers. Sem informar os dias, o freela fica com "dias a informar".'
          : 'Não cria conta nem compra: o pagamento só sai das pendências com o motivo e não mexe no resultado (DRE).'}
      </p>

      {tipo === 'prestador' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Prestador *</label>
            <CategoriaCombobox value={prestadorId} options={prestadorOptions} onChange={setPrestadorId} placeholder="Escolha o prestador…"
              buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
            {prestadores.length === 0 && <p className="text-[11px] text-amber-700 mt-1">Nenhum prestador cadastrado: cadastre em RH / Folha › Prestadores MEI.</p>}
          </div>
          <div className="flex flex-wrap bg-white border border-zinc-200 rounded-lg overflow-hidden w-fit">
            {([['servico', 'Serviço do mês'], ['reembolso', 'Reembolso']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setPrestadorTipo(k); if (k === 'reembolso' && descricao === nomePadrao) setDescricao(''); }}
                className={`px-3 py-1.5 text-xs font-semibold cursor-pointer ${prestadorTipo === k ? 'bg-violet-600 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                {label}
              </button>
            ))}
          </div>
          {prestadorTipo === 'reembolso' && (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">O que ele comprou</label>
                <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: gás, material de limpeza"
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Categoria da DRE *</label>
                <CategoriaCombobox value={dreCat} options={dreOptions} onChange={setDreCat} placeholder="Escolha a categoria…"
                  buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
              </div>
            </>
          )}
        </div>
      )}

      {tipo === 'fora_dre' && (
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">Motivo *</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {MOTIVOS_FORA_DRE.map(([k, label, ajuda]) => (
              <button key={k} type="button" onClick={() => { setMotivo(k); setErro(null); }}
                className={`text-left px-3 py-2 rounded-lg border cursor-pointer ${motivo === k ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}>
                <span className="block text-xs font-semibold">{label}</span>
                <span className={`block text-[11px] ${motivo === k ? 'text-violet-100' : 'text-zinc-400'}`}>{ajuda}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tipo !== 'prestador' && (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-zinc-600 mb-1">{tipo === 'compra' ? 'O que foi comprado' : tipo === 'freelancer' ? 'Quem trabalhou' : 'Descrição'}</label>
          {tipo === 'freelancer' ? (
            <>
              <CategoriaCombobox
                value={freelaId} options={freelaOptions} placeholder="Escolha o freelancer…"
                onChange={(id) => { setFreelaId(id); const f = freelancers.find((x) => x.id === id); if (f) setDescricao(f.name); }}
                onCreate={(texto) => { setFreelaId(''); setDescricao(texto || transaction.counterpart_name || ''); }}
                createLabel={(texto) => (texto ? `Cadastrar “${texto}” como freelancer` : 'Cadastrar um freelancer novo')}
                buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
              {!freelaId && (
                <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Nome de quem trabalhou"
                  className="w-full mt-1.5 px-3 py-2 border border-violet-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
              )}
              <p className="text-[11px] text-zinc-400 mt-1">
                {freelaId ? 'Freelancer já cadastrado: a diária entra na ficha dele.' : 'Não está na lista? O nome acima vira um cadastro novo de freelancer.'}
              </p>
            </>
          ) : (
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)}
              placeholder={tipo === 'compra' ? 'Ex.: Gelo, verduras da feira…' : tipo === 'fora_dre' ? 'Observação (opcional). Ex.: parcela do financiamento' : 'Ex.: Diária de limpeza'}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
          )}
        </div>
        {tipo === 'compra' && (
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Fornecedor</label>
            <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        )}
        {tipo === 'freelancer' && (
          <div className="sm:col-span-2 space-y-2">
            {!freelaId && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Função (opcional)</label>
              <input value={funcao} onChange={(e) => setFuncao(e.target.value)} maxLength={60}
                placeholder="Ex.: garçom, cozinha, entregador"
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            )}
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Dias trabalhados</label>
              {/* Um toque nos dias mais prováveis: o dia do pagamento e os seis anteriores. */}
              <div className="flex flex-wrap items-center gap-1 mb-1.5">
                {ultimosDias.map((d) => {
                  const on = dias.includes(d);
                  return (
                    <button key={d} type="button"
                      onClick={() => setDias((v) => (on ? v.filter((x) => x !== d) : [...v, d].sort()))}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${on ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
                      {new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {dias.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-100 text-violet-800 text-xs font-semibold">
                    {new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')}
                    <button type="button" onClick={() => setDias((v) => v.filter((x) => x !== d))} className="cursor-pointer" aria-label={`Tirar ${d}`}>
                      <i className="ri-close-line" />
                    </button>
                  </span>
                ))}
                <input type="date" value={diaNovo} onChange={(e) => setDiaNovo(e.target.value)}
                  className="px-2 py-1 border border-zinc-200 rounded-lg text-xs bg-white" />
                <button type="button" onClick={() => { if (diaNovo && !dias.includes(diaNovo)) setDias((v) => [...v, diaNovo].sort()); }}
                  className="px-2 py-1 rounded-lg border border-violet-300 text-violet-700 text-xs font-semibold cursor-pointer hover:bg-violet-50">
                  + Adicionar dia
                </button>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                {dias.length === 0
                  ? 'Toque nos dias acima (ou escolha outra data). Sem nenhum dia, a diária fica "aguardando dias" e você informa depois em Financeiro › Freelancers.'
                  : `${formatCurrency(Number(transaction.amount) / dias.length)} por dia (${dias.length} dia${dias.length > 1 ? 's' : ''}).`}
              </p>
            </div>
          </div>
        )}
        {(tipo === 'despesa' || tipo === 'compra') && (
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">{tipo === 'despesa' ? 'Categoria da DRE *' : 'Categoria do CMV'}</label>
          {tipo === 'despesa' ? (
            <CategoriaCombobox value={dreCat} options={dreOptions} onChange={setDreCat} placeholder="Escolha a categoria…"
              buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
          ) : (
            <CategoriaCombobox value={merc} options={mercOptions} onChange={setMerc} placeholder="Escolha a categoria…"
              buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
          )}
        </div>
        )}
      </div>
      )}

      {tipo === 'compra' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-zinc-600">Itens {itens.length === 0 && <span className="text-zinc-400 font-normal">(opcional: sem itens, a compra fica com 1 item e não mexe no estoque)</span>}</label>
            <button type="button" onClick={() => setItens((v) => [...v, novoItem()])}
              className="px-2 py-1 rounded-lg border border-violet-300 text-violet-700 text-xs font-semibold cursor-pointer hover:bg-violet-50 whitespace-nowrap">
              <i className="ri-add-line" /> Adicionar item
            </button>
          </div>
          <LerNotaBotoes onLido={aplicarNota} disabled={busy} />
          {lida && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 px-2.5 py-2 text-xs text-violet-900 space-y-0.5">
              <p>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold mr-1 ${lida.source === 'qrcode' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'}`}>
                  {lida.source === 'qrcode' ? 'SEFAZ · QR Code' : 'Leitura por IA'}
                </span>
                {lida.supplier_name ?? 'Nota'}{lida.invoice_number ? ' · nº ' + lida.invoice_number : ''}
                {lida.document_total != null ? ' · total ' + formatCurrency(lida.document_total) : ''}
              </p>
              {lida.document_total != null && Math.abs(lida.document_total - valorPag) >= 0.01 && (
                <p className="text-amber-700">O total da nota é diferente do pagamento ({formatCurrency(valorPag)}): ajuste os itens até fechar, ou use "Este pagamento é de…" se ela já foi lançada.</p>
              )}
              {lida.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
              <p className="text-violet-700">Confira os itens e ligue ao insumo o que for de estoque — o vínculo fica lembrado para a próxima nota.</p>
            </div>
          )}
          {itens.map((it) => {
            const ins = insumos.find((x) => x.id === it.insumoId);
            return (
              <div key={it.key} className="bg-white border border-zinc-200 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input value={it.descricao} onChange={(e) => mudaItem(it.key, { descricao: e.target.value })} placeholder="Item (ex.: Gelo 5 kg)"
                    className="flex-1 min-w-0 px-2 py-1.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                  <button type="button" onClick={() => setItens((v) => v.filter((x) => x.key !== it.key))} aria-label="Tirar item"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                    <i className="ri-delete-bin-line" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="text-[11px] text-zinc-500">Qtd
                    <input value={it.qtd} onChange={(e) => mudaItem(it.key, { qtd: e.target.value })} inputMode="decimal"
                      className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-zinc-800" />
                  </label>
                  <label className="text-[11px] text-zinc-500">Unidade
                    <input value={it.unidade} onChange={(e) => mudaItem(it.key, { unidade: e.target.value })} maxLength={20}
                      className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-zinc-800" />
                  </label>
                  <label className="text-[11px] text-zinc-500">Valor total (R$)
                    <input value={it.total} onChange={(e) => mudaItem(it.key, { total: e.target.value })} inputMode="decimal" placeholder="0,00"
                      className="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm text-zinc-800" />
                  </label>
                </div>
                <CategoriaCombobox value={it.insumoId || SEM_INSUMO} options={insumoOptions} placeholder="Insumo do estoque…"
                  onChange={(id) => {
                    const novo = insumos.find((x) => x.id === id);
                    // Unidade do insumo por padrão: a compra entra 1:1 no estoque sem pedir conversão
                    mudaItem(it.key, { insumoId: id === SEM_INSUMO ? '' : id, ...(novo?.unit ? { unidade: novo.unit } : {}), ...(novo && !it.descricao.trim() ? { descricao: novo.name } : {}) });
                  }}
                  buttonClassName="w-full px-2 py-1.5 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
                {ins && ins.unit && it.unidade.trim() && it.unidade.trim().toLowerCase() !== ins.unit.toLowerCase() && (
                  <p className="text-[11px] text-amber-700">
                    O insumo é controlado em "{ins.unit}". Em "{it.unidade.trim()}" o sistema só converte kg↔g e L↔ml; senão o item fica fora do estoque até você informar a conversão na Classificação de itens.
                  </p>
                )}
              </div>
            );
          })}
          {itens.length > 0 && (
            <p className={`text-xs font-semibold ${Math.abs(faltaItens) < 0.005 ? 'text-emerald-700' : 'text-red-600'}`}>
              Itens: {formatCurrency(somaItens)} de {formatCurrency(valorPag)}
              {Math.abs(faltaItens) < 0.005 ? ' ✓ fechou' : faltaItens > 0 ? ` · faltam ${formatCurrency(faltaItens)}` : ` · passou ${formatCurrency(-faltaItens)}`}
            </p>
          )}
          {itensComInsumo && (
            <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={recebido} onChange={(e) => setRecebido(e.target.checked)} className="mt-0.5" />
              <span><b>Já recebi a mercadoria</b>: os itens ligados a insumo entram no estoque agora. Desmarcado, entram quando o recebimento for confirmado em Compras.</span>
            </label>
          )}
        </div>
      )}

      {/* Fora do DRE não tem competência nem regra "fazer sempre assim" (a edge não cria nada) */}
      {tipo !== 'fora_dre' && (
      <div>
        <label className="block text-xs font-medium text-zinc-600 mb-1">Competência (mês a que o gasto pertence)</label>
        <div className="flex flex-wrap items-center gap-2">
          {([['same', `Mês do pagamento (${mesPag.slice(5)}/${mesPag.slice(0, 4)})`], ['prev', `Mês anterior (${mesAnt.slice(5)}/${mesAnt.slice(0, 4)})`], ['outro', 'Outro']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setCompModo(k)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${compModo === k ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
              {label}
            </button>
          ))}
          {compModo === 'outro' && (
            <input type="month" value={compOutro} onChange={(e) => setCompOutro(e.target.value)}
              className="px-2 py-1 border border-zinc-200 rounded-lg text-xs bg-white" />
          )}
        </div>
      </div>
      )}

      {doc && tipo !== 'fora_dre' && tipo !== 'prestador' && (
        <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
          <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Fazer sempre assim</b> para {transaction.counterpart_name || doc}: os próximos pagamentos viram{' '}
            {tipo === 'compra' ? 'compra' : tipo === 'freelancer' ? 'diária deste freelancer — os dias você informa depois, em Financeiro › Freelancers' : 'esta despesa'}
            {tipo !== 'freelancer' && (compModo === 'prev' ? ' com competência do mês anterior' : ' com competência do mês do pagamento')} (sugerido em "Confirmar vínculos").
          </span>
        </label>
      )}

      {avisoFolha && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-xs text-amber-800 space-y-1.5">
          <p><i className="ri-alert-line mr-1" />{avisoFolha}</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={permitirFolha} onChange={(e) => setPermitirFolha(e.target.checked)} />
            Não é salário: lançar mesmo assim
          </label>
        </div>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}

      <div className="flex items-center gap-2">
        <button onClick={lancar} disabled={busy || (!!avisoFolha && !permitirFolha) || !itensOk}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
          {busy ? 'Lançando...' : tipo === 'despesa' ? 'Lançar despesa paga' : tipo === 'compra' ? 'Lançar compra paga' : tipo === 'freelancer' ? 'Lançar pagamento de freelancer' : tipo === 'prestador' ? (prestadorTipo === 'servico' ? 'Lançar serviço do prestador' : 'Lançar reembolso') : 'Marcar como fora do DRE'}
        </button>
        <span className="text-[11px] text-zinc-400">Dá para desfazer depois, no próprio pagamento.</span>
      </div>
    </div>
  );
}
