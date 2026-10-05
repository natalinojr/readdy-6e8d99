// Aba Clientes da tela Clientes & Marketing: a base de clientes, filtros,
// campanha de WhatsApp e exportação. Os filtros são os ESTÁGIOS DO FUNIL
// (crm_customer_stage, critérios configuráveis por loja na aba Funil) — uma regra só
// (2026-10-05). Antes a lista tinha "VIP/Frequente" com cortes fixos que contradiziam o Funil.
// Aniversários saíram daqui: viraram o cartão "Aniversariantes" do Funil.
import { useState, useMemo, useEffect, useRef } from 'react';
import { useClientes, type ClienteCRM } from '@/hooks/useClientes';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import ClientePerfil from '../components/ClientePerfil';
import EditarClienteModal from '../components/EditarClienteModal';
import {
  AVISO_OPT_OUT, ESTAGIOS_FUNIL, abrirWhatsApp as abrirConversa, aniversarioEsteMes, baixarCsv, celularComDDI,
  diasAteAniversario, diasDesde, estagioFunil, haDias, isInativo, mensagemWhatsApp, montarCsv,
} from '../clienteUtils';

/** 'todos', um estágio do Funil (ESTAGIOS_FUNIL.id) ou 'sem_estagio'. */
type Filtro = string;
type SortField = 'recente' | 'visitas' | 'gasto' | 'ticket' | 'aniversario' | 'nome';

function fmtData(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
const diasSemVisita = diasDesde;
// Aniversário (dia/mês) a partir de 'YYYY-MM-DD'. Lê direto da string p/ evitar
// deslocamento de fuso (new Date('YYYY-MM-DD') é UTC e pode "pular" o dia).
function fmtAniversario(d: string | null): string {
  if (!d) return '—';
  const [, mes, dia] = d.slice(0, 10).split('-');
  return dia && mes ? `${dia}/${mes}` : '—';
}
// Faz aniversário HOJE (dia e mês).
function aniversarioHoje(c: ClienteCRM): boolean {
  return diasAteAniversario(c) === 0;
}

/** Dá para mandar mensagem? (tem celular e não pediu para sair) */
function podeMensagem(c: ClienteCRM): boolean {
  return !!celularComDDI(c.celular) && !c.optOut;
}
function abrirWhatsApp(cliente: ClienteCRM) {
  if (cliente.optOut) return;
  abrirConversa(cliente.celular, mensagemWhatsApp(cliente));
}

/** Selo do estágio do Funil (mesmas cores da aba Funil). */
function SeloEstagio({ id, pequeno }: { id?: string | null; pequeno?: boolean }) {
  const e = estagioFunil(id);
  if (!e) return null;
  return (
    <span className={`${pequeno ? 'text-[9px] px-1.5' : 'text-[10px] px-2'} font-semibold py-0.5 rounded-full border whitespace-nowrap ${e.chip}`}>
      {e.label}
    </span>
  );
}

function exportarCSV(clientes: ClienteCRM[]) {
  const headers = ['Nome', 'Celular', 'E-mail', 'Aniversário', 'Estágio no Funil', 'Tags', 'Compras', 'Total Gasto (R$)', 'Ticket Médio (R$)', 'Primeira Compra', 'Última Compra', 'Dias sem Comprar', 'Aceita marketing', 'Não quer mensagens'];
  const rows = clientes.map(c => [
    c.nome,
    c.celular || '',
    c.email || '',
    fmtAniversario(c.dataNascimento),
    estagioFunil(c.estagio)?.label ?? '',
    c.manualTags.join(', '),
    c.totalVisitas,
    c.valorTotal.toFixed(2).replace('.', ','),
    c.ticketMedio.toFixed(2).replace('.', ','),
    c.totalVisitas === 0 ? '' : fmtData(c.primeiraVisita),
    c.totalVisitas === 0 ? '' : fmtData(c.ultimaVisita),
    c.totalVisitas === 0 ? '' : diasSemVisita(c.ultimaVisita),
    c.aceitaMarketing ? 'sim' : 'não',
    c.optOut ? 'sim' : '',
  ]);
  baixarCsv(montarCsv([headers, ...rows], ';', [1]), `clientes_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Exporta no formato de Público Personalizado do Meta Ads (Gerenciador de Anúncios).
// Colunas reconhecidas pelo Meta: phone, email, fn (primeiro nome), ln (sobrenome), country.
// Quem pediu para não receber mensagens fica de fora.
function exportarMetaCSV(clientes: ClienteCRM[]) {
  const headers = ['phone', 'email', 'fn', 'ln', 'country'];
  const rows = clientes
    .filter(c => !c.optOut && !!celularComDDI(c.celular))
    .map(c => {
      const partes = c.nome.trim().split(/\s+/);
      const fn = partes[0] ?? '';
      const ln = partes.slice(1).join(' ');
      return [`+${celularComDDI(c.celular)}`, c.email ?? '', fn, ln, 'BR'];
    });
  baixarCsv(montarCsv([headers, ...rows], ',', [0]), `meta_ads_publico_${new Date().toISOString().slice(0, 10)}.csv`);
}

// ── Modal de campanha de WhatsApp em massa ───────────────────────────────────
// Percorre os clientes um a um. Cada envio é disparado por clique do usuário —
// isso evita o bloqueio de popups do navegador (abrir várias abas de uma vez é barrado).
function CampanhaWhatsAppModal({ clientes, onClose, onContato }: { clientes: ClienteCRM[]; onClose: () => void; onContato?: (id: string) => void }) {
  const [soOptIn, setSoOptIn] = useState(false);
  // Quem pediu para não receber mensagens nunca entra na campanha.
  const comTelefone = useMemo(
    () => clientes.filter(c => podeMensagem(c) && (!soOptIn || c.aceitaMarketing)),
    [clientes, soOptIn],
  );
  const foraPorOptOut = useMemo(() => clientes.filter(c => !!c.optOut).length, [clientes]);
  const [idx, setIdx] = useState(0);
  const [enviados, setEnviados] = useState(0);
  const atual = comTelefone[idx] ?? null;
  const concluido = idx >= comTelefone.length;

  const enviarEAvancar = () => {
    if (!atual) return;
    abrirWhatsApp(atual);
    onContato?.(atual.id);
    setEnviados(e => e + 1);
    setIdx(i => i + 1);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-green-50 rounded-lg">
              <i className="ri-whatsapp-line text-green-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Campanha WhatsApp</h3>
              <p className="text-[11px] text-zinc-400">
                {comTelefone.length} cliente{comTelefone.length !== 1 ? 's' : ''} com telefone
                {foraPorOptOut > 0 && ` · ${foraPorOptOut} não quer${foraPorOptOut !== 1 ? 'em' : ''} mensagens (fora)`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5">
          <label className="flex items-center gap-2 mb-4 text-[11px] text-zinc-500 cursor-pointer">
            <input type="checkbox" checked={soOptIn} onChange={(e) => { setSoOptIn(e.target.checked); setIdx(0); setEnviados(0); }} className="w-3.5 h-3.5 accent-amber-500 cursor-pointer" />
            Enviar só para quem aceita marketing (respeitar opt-in / LGPD)
          </label>
          {comTelefone.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-400">
              {soOptIn ? 'Nenhum cliente do filtro aceita marketing.' : 'Nenhum cliente com telefone válido no filtro atual.'}
            </div>
          ) : concluido ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto flex items-center justify-center bg-green-50 rounded-full mb-3">
                <i className="ri-check-double-line text-green-600 text-2xl" />
              </div>
              <p className="text-sm font-bold text-zinc-800">Campanha concluída!</p>
              <p className="text-xs text-zinc-400 mt-1">{enviados} conversa{enviados !== 1 ? 's' : ''} aberta{enviados !== 1 ? 's' : ''} no WhatsApp.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-zinc-500">Cliente {idx + 1} de {comTelefone.length}</span>
                <div className="flex-1 mx-3 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(idx / comTelefone.length) * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                  <span className="text-sm font-bold text-amber-700">{atual?.nome.charAt(0)}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 truncate">{atual?.nome}</p>
                  <p className="text-xs text-zinc-400">{atual?.celular}</p>
                </div>
              </div>
              <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs text-zinc-600 mb-4 max-h-28 overflow-auto">
                {atual && mensagemWhatsApp(atual)}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setIdx(i => i + 1)}
                  className="px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-500 text-sm font-semibold hover:bg-zinc-50 cursor-pointer"
                >
                  Pular
                </button>
                <button
                  onClick={enviarEAvancar}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 cursor-pointer"
                >
                  <i className="ri-whatsapp-line" /> Abrir e avançar
                </button>
              </div>
              <p className="text-[10px] text-zinc-400 text-center mt-3">
                A mensagem se ajusta automaticamente a cada cliente (aniversário, inativo, novo…).
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Loja sem nenhum cliente ainda (ex.: só vende no tablet/balcão sem identificar ninguém):
 *  explica de onde os clientes vêm em vez de um "nenhum cliente" seco. */
function SemClientes() {
  return (
    <div className="max-w-sm mx-auto">
      <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-rose-100">
        <i className="ri-user-heart-line text-xl text-rose-500" />
      </div>
      <p className="text-sm font-semibold text-zinc-700">Nenhum cliente identificado ainda</p>
      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
        Os clientes entram sozinhos quando pedem pelo delivery próprio ou entram no clube de fidelidade
        (tablet, QR da mesa e caixa). Pedido sem cliente identificado não aparece aqui.
      </p>
    </div>
  );
}

interface Props {
  /** Abre o modal de voucher (fica na página, compartilhado com o Funil). */
  onEnviarVoucher: (cliente: ClienteCRM) => void;
  /** Leva para a aba Funil (atalho do card "Em risco"). */
  onAbrirFunil?: () => void;
}

export default function ClientesAba({ onEnviarVoucher, onAbrirFunil }: Props) {
  const { clientes, loading, error, recarregar, atualizarCliente, juntarClientes, registrarContato } = useClientes();
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  // Emitir voucher/gift card e mexer no voucher de aniversário é da aba Vouchers: quem só
  // vê clientes (ex.: Líder) não emite (o servidor confere de novo no voucher-write).
  const podeVoucher = user?.perfil === 'admin' || hasPermissao('gestao_vouchers');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [soDuplicados, setSoDuplicados] = useState(false);
  const [sortField, setSortField] = useState<SortField>('recente');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selecionado, setSelecionado] = useState<ClienteCRM | null>(null);
  const [editarCliente, setEditarCliente] = useState<ClienteCRM | null>(null);
  const [showCampanha, setShowCampanha] = useState(false);
  const [menuExportar, setMenuExportar] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fecha o menu "Exportar" ao clicar fora.
  useEffect(() => {
    if (!menuExportar) return;
    const fechar = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuExportar(false);
    };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [menuExportar]);

  // Detecção de possíveis duplicados: mesmo celular (dígitos) ou mesmo nome normalizado.
  const duplicados = useMemo(() => {
    const ids = new Set<string>();
    const porTelefone = new Map<string, string[]>();
    const porNome = new Map<string, string[]>();
    clientes.forEach((c) => {
      const tel = (c.celular ?? '').replace(/\D/g, '');
      if (tel.length >= 8) {
        const arr = porTelefone.get(tel) ?? [];
        arr.push(c.id);
        porTelefone.set(tel, arr);
      }
      const nome = c.nome.trim().toLowerCase().replace(/\s+/g, ' ');
      if (nome) {
        const arr = porNome.get(nome) ?? [];
        arr.push(c.id);
        porNome.set(nome, arr);
      }
    });
    [...porTelefone.values(), ...porNome.values()].forEach((arr) => {
      if (arr.length > 1) arr.forEach((id) => ids.add(id));
    });
    return ids;
  }, [clientes]);

  const setSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // padrão amigável: nome/aniversário ascendente, números decrescente
      setSortDir(field === 'nome' || field === 'aniversario' ? 'asc' : 'desc');
    }
  };

  const lista = useMemo(() => {
    let l = [...clientes];

    if (busca.trim()) {
      const q = busca.toLowerCase();
      const qDigitos = q.replace(/\D/g, '');
      l = l.filter((c) =>
        c.nome.toLowerCase().includes(q) || (!!qDigitos && (c.celular ?? '').replace(/\D/g, '').includes(qDigitos))
      );
    }

    if (soDuplicados) {
      l = l.filter((c) => duplicados.has(c.id));
    }

    if (filtro !== 'todos') {
      l = l.filter((c) => (filtro === 'sem_estagio' ? !estagioFunil(c.estagio) : c.estagio === filtro));
    }

    const cmp = (a: ClienteCRM, b: ClienteCRM): number => {
      let r = 0;
      switch (sortField) {
        case 'nome': r = a.nome.localeCompare(b.nome, 'pt-BR'); break;
        case 'visitas': r = a.totalVisitas - b.totalVisitas; break;
        case 'gasto': r = a.valorTotal - b.valorTotal; break;
        case 'ticket': r = a.ticketMedio - b.ticketMedio; break;
        case 'aniversario': r = diasAteAniversario(a) - diasAteAniversario(b); break;
        case 'recente':
        default: r = new Date(a.ultimaVisita).getTime() - new Date(b.ultimaVisita).getTime();
      }
      return sortDir === 'asc' ? r : -r;
    };
    l.sort(cmp);

    return l;
  }, [clientes, busca, filtro, soDuplicados, duplicados, sortField, sortDir]);

  const totalVisitas = clientes.reduce((acc, c) => acc + c.totalVisitas, 0);
  const totalGasto = clientes.reduce((acc, c) => acc + c.valorTotal, 0);
  const ticketMedioGeral = totalVisitas > 0 ? totalGasto / totalVisitas : 0;
  const inativos = clientes.filter(isInativo).length;
  // Chips de filtro = estágios do Funil (com a contagem de cada um).
  const chipsEstagio = [
    { id: 'todos', label: 'Todos', ponto: '', n: clientes.length },
    ...ESTAGIOS_FUNIL.map((e) => ({ id: e.id, label: e.label, ponto: e.ponto, n: clientes.filter((c) => c.estagio === e.id).length })),
  ];
  const semEstagio = clientes.filter((c) => !estagioFunil(c.estagio)).length;
  if (semEstagio > 0) chipsEstagio.push({ id: 'sem_estagio', label: 'Sem estágio', ponto: 'bg-zinc-300', n: semEstagio });
  const ativos30d = clientes.filter((c) => c.totalVisitas > 0 && diasSemVisita(c.ultimaVisita) <= 30).length;
  const compradores = clientes.filter((c) => c.totalVisitas > 0).length;
  const retornaram = clientes.filter((c) => c.totalVisitas >= 2).length;
  const taxaRetorno = compradores > 0 ? (retornaram / compradores) * 100 : 0;
  const comTelefone = lista.filter(podeMensagem).length;

  const algumFiltro = !!busca || filtro !== 'todos' || soDuplicados;

  const limparFiltros = () => {
    setBusca('');
    setFiltro('todos');
    setSoDuplicados(false);
  };

  const aplicarFiltro = (f: Filtro) => {
    setSoDuplicados(false);
    setFiltro((atual) => (atual === f && f !== 'todos' ? 'todos' : f));
  };

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <i className="ri-arrow-up-down-line text-zinc-300 text-[11px]" />;
    return <i className={`${sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} text-amber-500 text-[11px]`} />;
  };

  // KPIs do topo. Os que viram filtro são clicáveis (clicar de novo limpa).
  const kpis: { label: string; value: string; icon: string; color: string; hint?: string; filtro?: Filtro; acao?: () => void }[] = [
    { label: 'Clientes', value: String(clientes.length), icon: 'ri-group-line', color: 'text-amber-600 bg-amber-50', filtro: 'todos' },
    { label: 'Ativos (30 dias)', value: String(ativos30d), icon: 'ri-user-follow-line', color: 'text-green-600 bg-green-50', hint: 'Compraram nos últimos 30 dias' },
    { label: 'Sumidos (+30 dias)', value: String(inativos), icon: 'ri-user-unfollow-line', color: 'text-red-500 bg-red-50', acao: onAbrirFunil, hint: 'Já compraram e não voltam há mais de 30 dias — clique para ver no Funil quem chamar' },
    { label: 'Voltaram a comprar', value: `${taxaRetorno.toFixed(0)}%`, icon: 'ri-repeat-line', color: 'text-sky-600 bg-sky-50', hint: `${retornaram} de ${compradores} compradores fizeram 2 ou mais compras` },
    { label: 'Ticket médio', value: fmtMoeda(ticketMedioGeral), icon: 'ri-receipt-line', color: 'text-zinc-600 bg-zinc-100' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* KPIs — no celular, 3 por linha e sem o ícone (antes ocupavam a primeira tela inteira) */}
      <div className="grid grid-cols-3 xl:grid-cols-5 gap-2 md:gap-3">
        {kpis.map((s) => {
          const ativo = !!s.filtro && s.filtro !== 'todos' && filtro === s.filtro;
          const clicavel = !!s.filtro || !!s.acao;
          return (
            <button
              key={s.label}
              type="button"
              title={s.hint}
              disabled={!clicavel}
              onClick={() => (s.acao ? s.acao() : s.filtro && aplicarFiltro(s.filtro))}
              className={`text-left bg-white border rounded-xl px-2.5 sm:px-3 py-2.5 sm:py-3 flex items-center gap-2.5 transition-all ${
                ativo ? 'border-amber-400 ring-2 ring-amber-100' : 'border-zinc-100'
              } ${clicavel ? 'cursor-pointer hover:border-zinc-300' : 'cursor-default'}`}
            >
              <div className={`w-9 h-9 hidden sm:flex items-center justify-center rounded-xl flex-shrink-0 ${s.color}`}>
                <i className={`${s.icon} text-base`} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] sm:text-base font-bold text-zinc-800 truncate leading-tight">{loading ? '—' : s.value}</p>
                <p className="text-[10.5px] sm:text-[11px] text-zinc-400 leading-tight">{s.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Dica: segmentação mora no Funil */}
      {!loading && inativos > 0 && onAbrirFunil && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-2.5">
          <p className="text-xs text-amber-800">
            <i className="ri-lightbulb-line text-amber-500 mr-1" />
            <strong>{inativos}</strong> cliente{inativos > 1 ? 's' : ''} já compraram e sumiram. O Funil mostra quem abordar agora e com qual oferta — respeitando o ritmo de cada um.
          </p>
          <button
            onClick={onAbrirFunil}
            className="self-start sm:self-auto flex-shrink-0 text-xs font-semibold text-amber-700 hover:text-amber-800 cursor-pointer whitespace-nowrap"
          >
            Abrir Funil <i className="ri-arrow-right-line" />
          </button>
        </div>
      )}

      {/* Barra de busca, filtros e ações */}
      <div className="bg-white border border-zinc-100 rounded-2xl">
        <div className="p-3 md:p-4 flex flex-col lg:flex-row lg:items-center gap-2 md:gap-3 border-b border-zinc-100">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              className="w-full pl-9 pr-8 py-2 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 transition-colors"
              placeholder="Buscar por nome ou celular..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {busca && (
              <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer">
                <i className="ri-close-line" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="min-w-0 flex-1 sm:flex-none border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-600 focus:outline-none cursor-pointer bg-white"
              value={sortField}
              onChange={(e) => { setSortField(e.target.value as SortField); setSortDir(e.target.value === 'nome' || e.target.value === 'aniversario' ? 'asc' : 'desc'); }}
              title="Ordenar"
            >
              <option value="recente">Compra mais recente</option>
              <option value="visitas">Mais compras</option>
              <option value="gasto">Maior gasto</option>
              <option value="ticket">Maior ticket</option>
              <option value="aniversario">Próximo aniversário</option>
              <option value="nome">Nome (A-Z)</option>
            </select>
            <button
              onClick={() => setShowCampanha(true)}
              disabled={comTelefone === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors bg-green-500 hover:bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              title="Abrir o WhatsApp de cada cliente da lista abaixo, um por vez"
            >
              <i className="ri-whatsapp-line" /> WhatsApp{algumFiltro ? ` (${comTelefone})` : <span className="hidden sm:inline">&nbsp;em massa</span>}
            </button>
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuExportar((v) => !v)}
                disabled={lista.length === 0}
                aria-label="Exportar"
                className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40"
              >
                <i className="ri-download-line" /><span className="hidden sm:inline">Exportar</span> <i className="ri-arrow-down-s-line" />
              </button>
              {menuExportar && (
                <div className="absolute right-0 mt-1 w-64 bg-white border border-zinc-200 rounded-xl shadow-lg z-20 overflow-hidden">
                  <button
                    onClick={() => { exportarCSV(lista); setMenuExportar(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 cursor-pointer flex items-start gap-2"
                  >
                    <i className="ri-file-excel-2-line text-green-600 mt-0.5" />
                    <span>
                      <span className="block text-xs font-semibold text-zinc-800">Planilha (CSV)</span>
                      <span className="block text-[11px] text-zinc-400">{lista.length} clientes da lista atual</span>
                    </span>
                  </button>
                  <button
                    onClick={() => { exportarMetaCSV(lista); setMenuExportar(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 cursor-pointer flex items-start gap-2 border-t border-zinc-100"
                  >
                    <i className="ri-meta-line text-sky-600 mt-0.5" />
                    <span>
                      <span className="block text-xs font-semibold text-zinc-800">Público do Meta Ads</span>
                      <span className="block text-[11px] text-zinc-400">{comTelefone} com celular válido (sem quem pediu para sair)</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="px-3 md:px-4 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Estágio no Funil
        </p>
        <div className="px-3 md:px-4 pt-1.5 pb-2.5 flex flex-wrap items-center gap-1.5">
          {chipsEstagio.map((f) => {
            const ativo = filtro === f.id;
            return (
              <button
                key={f.id}
                onClick={() => aplicarFiltro(f.id)}
                aria-pressed={ativo}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 border ${ativo ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
              >
                {f.ponto && <span className={`w-1.5 h-1.5 rounded-full ${ativo ? 'bg-white' : f.ponto}`} />}
                {f.label}
                <span className={`text-[10px] ${ativo ? 'text-white/75' : 'text-zinc-400'}`}>{f.n}</span>
              </button>
            );
          })}
          {duplicados.size > 0 && (
            <button
              onClick={() => { setSoDuplicados((v) => !v); setFiltro('todos'); }}
              title="Mesmo nome ou telefone — o histórico desses clientes fica dividido"
              className={`px-2.5 md:px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${soDuplicados ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100'}`}
            >
              <i className="ri-error-warning-line text-xs" /> {duplicados.size} possíveis duplicados
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <span><i className="ri-error-warning-line mr-1" />{error}</span>
          <button onClick={() => recarregar()} className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-white border border-red-200 font-semibold hover:bg-red-100 cursor-pointer">
            Tentar de novo
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
          {/* Contador de resultados */}
          {algumFiltro && (
            <div className="px-5 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
              <p className="text-xs text-zinc-500">
                <span className="font-semibold text-zinc-700">{lista.length}</span> de {clientes.length} clientes
                {soDuplicados && <span className="ml-2 text-orange-600 font-semibold">· Possíveis duplicados</span>}
              </p>
              <button
                onClick={limparFiltros}
                className="text-xs text-amber-600 hover:text-amber-700 cursor-pointer font-semibold"
              >
                Limpar filtros
              </button>
            </div>
          )}

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    <button onClick={() => setSort('nome')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Cliente <SortArrow field="nome" /></button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Estágio</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    <button onClick={() => setSort('visitas')} title="Quantidade de vendas finalizadas (pagas) vinculadas ao cliente" className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Compras <SortArrow field="visitas" /></button>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    <button onClick={() => setSort('gasto')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Total gasto <SortArrow field="gasto" /></button>
                  </th>
                  <th className="hidden 2xl:table-cell text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    <button onClick={() => setSort('ticket')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Ticket <SortArrow field="ticket" /></button>
                  </th>
                  <th className="hidden xl:table-cell text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    <button onClick={() => setSort('aniversario')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Aniv. <SortArrow field="aniversario" /></button>
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    <button onClick={() => setSort('recente')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Última compra <SortArrow field="recente" /></button>
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((cliente) => {
                  const dias = diasSemVisita(cliente.ultimaVisita);
                  const isAniversario = aniversarioEsteMes(cliente);
                  const hojeAniv = aniversarioHoje(cliente);
                  return (
                    <tr
                      key={cliente.id}
                      onClick={() => setSelecionado(cliente)}
                      className="border-b border-zinc-50 hover:bg-amber-50/40 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                              <span className="text-sm font-bold text-amber-700">{cliente.nome.charAt(0)}</span>
                            </div>
                            {isAniversario && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-pink-500 rounded-full">
                                <i className="ri-cake-line text-white text-[8px]" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-zinc-800">{cliente.nome}</p>
                            <p className="text-xs text-zinc-400">{cliente.celular || (cliente.cpf ? 'Só CPF da nota · sem celular' : '—')}</p>
                            {cliente.itensFavoritos.length > 0 && (
                              <p className="text-[10px] text-zinc-400 truncate max-w-[200px]" title={cliente.itensFavoritos.join(', ')}>
                                <i className="ri-heart-3-line text-rose-300" /> {cliente.itensFavoritos[0]}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <SeloEstagio id={cliente.estagio} />
                          {cliente.manualTags.map((tag) => (
                            <span key={`m-${tag}`} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                              {tag}
                            </span>
                          ))}
                          {hojeAniv && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-pink-500 text-white border border-pink-500">
                              🎂 hoje!
                            </span>
                          )}
                          {cliente.optOut && (
                            <span title={AVISO_OPT_OUT} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200">
                              <i className="ri-chat-off-line" /> sem msg
                            </span>
                          )}
                          {cliente.notes && (
                            <i className="ri-sticky-note-line text-amber-500 text-xs" title={cliente.notes} />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-bold text-zinc-800">{cliente.totalVisitas}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-zinc-800">{fmtMoeda(cliente.valorTotal)}</span>
                      </td>
                      <td className="hidden 2xl:table-cell px-4 py-3 text-right">
                        <span className="text-sm text-zinc-600">{fmtMoeda(cliente.ticketMedio)}</span>
                      </td>
                      <td className="hidden xl:table-cell px-4 py-3 text-center">
                        {cliente.dataNascimento ? (
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${isAniversario ? 'text-pink-600 font-bold' : 'text-zinc-600'}`}>
                            {fmtAniversario(cliente.dataNascimento)}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {cliente.totalVisitas === 0 ? (
                          <span className="text-xs text-zinc-400 italic">Sem compras</span>
                        ) : (
                          <>
                            <p className="text-sm text-zinc-600">{fmtData(cliente.ultimaVisita)}</p>
                            <p className={`text-[11px] ${dias > 30 ? 'text-red-500' : dias > 14 ? 'text-amber-500' : 'text-green-600'}`}>
                              {haDias(dias)}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditarCliente(cliente); }}
                            title="Editar cadastro / anotações"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer transition-colors"
                          >
                            <i className="ri-pencil-line text-base" />
                          </button>
                          {podeVoucher && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onEnviarVoucher(cliente); }}
                              title="Enviar voucher / gift card"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-amber-600 hover:bg-amber-50 cursor-pointer transition-colors"
                            >
                              <i className="ri-gift-line text-base" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); abrirWhatsApp(cliente); registrarContato([cliente.id]); }}
                            disabled={!podeMensagem(cliente)}
                            title={cliente.optOut ? AVISO_OPT_OUT : cliente.celular ? 'Enviar mensagem no WhatsApp' : 'Cliente sem telefone'}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors"
                          >
                            <i className="ri-whatsapp-line text-base" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {lista.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-zinc-400 text-sm">
                      {error ? 'Lista não carregada.' : clientes.length === 0 ? <SemClientes /> : 'Nenhum cliente encontrado para os filtros selecionados'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-zinc-50">
            {lista.map((cliente) => {
              const dias = diasSemVisita(cliente.ultimaVisita);
              const isAniversario = aniversarioEsteMes(cliente);
              return (
                <div
                  key={cliente.id}
                  onClick={() => setSelecionado(cliente)}
                  className="px-4 py-3 hover:bg-amber-50/40 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                        <span className="text-sm font-bold text-amber-700">{cliente.nome.charAt(0)}</span>
                      </div>
                      {isAniversario && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-pink-500 rounded-full">
                          <i className="ri-cake-line text-white text-[8px]" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-800 truncate">{cliente.nome}</p>
                        <SeloEstagio id={cliente.estagio} pequeno />
                        {cliente.manualTags.slice(0, 2).map((tag) => (
                          <span key={`m-${tag}`} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">{tag}</span>
                        ))}
                      </div>
                      <p className="text-xs text-zinc-400 truncate">
                        {cliente.celular || (cliente.cpf ? 'Só CPF' : '—')} · {cliente.totalVisitas} compra{cliente.totalVisitas === 1 ? '' : 's'}
                        {cliente.dataNascimento && <> · 🎂 {fmtAniversario(cliente.dataNascimento)}</>}
                      </p>
                      {cliente.notes && (
                        <p className="text-[11px] text-amber-700 truncate"><i className="ri-sticky-note-line" /> {cliente.notes}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-zinc-800">{fmtMoeda(cliente.valorTotal)}</p>
                      {cliente.totalVisitas === 0 ? (
                        <p className="text-[10px] text-zinc-400 italic">Sem compras</p>
                      ) : (
                        <p className={`text-[10px] ${dias > 30 ? 'text-red-500' : dias > 14 ? 'text-amber-500' : 'text-green-600'}`}>
                          {haDias(dias)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 pl-[52px]">
                    <button
                      onClick={(e) => { e.stopPropagation(); abrirWhatsApp(cliente); registrarContato([cliente.id]); }}
                      disabled={!podeMensagem(cliente)}
                      title={cliente.optOut ? AVISO_OPT_OUT : undefined}
                      className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold border border-green-200 bg-green-50 text-green-700 disabled:opacity-30 cursor-pointer"
                    >
                      <i className={cliente.optOut ? 'ri-chat-off-line' : 'ri-whatsapp-line'} /> {cliente.optOut ? 'Sem msg' : 'WhatsApp'}
                    </button>
                    {podeVoucher && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEnviarVoucher(cliente); }}
                        className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-700 cursor-pointer"
                      >
                        <i className="ri-gift-line" /> Voucher
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditarCliente(cliente); }}
                      title="Editar cadastro"
                      className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-200 text-zinc-500 cursor-pointer"
                    >
                      <i className="ri-pencil-line" />
                    </button>
                  </div>
                </div>
              );
            })}
            {lista.length === 0 && (
              <div className="px-5 py-12 text-center text-zinc-400 text-sm">
                {error ? 'Lista não carregada.' : clientes.length === 0 ? <SemClientes /> : 'Nenhum cliente encontrado'}
              </div>
            )}
          </div>
        </div>
      )}

      {selecionado && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelecionado(null)} />
          <ClientePerfil
            cliente={clientes.find((c) => c.id === selecionado.id) ?? selecionado}
            onClose={() => setSelecionado(null)}
            onEditar={() => setEditarCliente(clientes.find((c) => c.id === selecionado.id) ?? selecionado)}
            onContato={() => registrarContato([selecionado.id])}
            podeVoucher={podeVoucher}
          />
        </>
      )}

      {showCampanha && (
        <CampanhaWhatsAppModal
          clientes={lista}
          onClose={() => setShowCampanha(false)}
          onContato={(id) => registrarContato([id])}
        />
      )}

      {editarCliente && (
        <EditarClienteModal
          cliente={editarCliente}
          onClose={() => setEditarCliente(null)}
          onSave={(patch) => atualizarCliente(editarCliente.id, patch)}
          onOptOutDesfeito={() => recarregar(true)}
          onJuntar={juntarClientes}
        />
      )}

    </div>
  );
}
