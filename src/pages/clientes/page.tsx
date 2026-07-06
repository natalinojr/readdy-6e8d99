import { useState, useMemo } from 'react';
import { useClientes, type ClienteCRM } from '@/hooks/useClientes';
import ClientePerfil from './components/ClientePerfil';
import EnviarVoucherModal from './components/EnviarVoucherModal';
import EditarClienteModal from './components/EditarClienteModal';
import BirthdayVoucherModal from './components/BirthdayVoucherModal';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

type Filtro = 'todos' | 'frequente' | 'vip' | 'novo' | 'inativo' | 'aniversario';
type SortField = 'recente' | 'visitas' | 'gasto' | 'ticket' | 'aniversario' | 'nome';

function fmtData(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function diasSemVisita(ultima: string) {
  return Math.floor((Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24));
}
// Aniversário (dia/mês) a partir de 'YYYY-MM-DD'. Lê direto da string p/ evitar
// deslocamento de fuso (new Date('YYYY-MM-DD') é UTC e pode "pular" o dia).
function fmtAniversario(d: string | null): string {
  if (!d) return '—';
  const [, mes, dia] = d.slice(0, 10).split('-');
  return dia && mes ? `${dia}/${mes}` : '—';
}
// Dia do mês do aniversário (1-31) para ordenação; sem data vai pro fim.
function diaAniversario(c: ClienteCRM): number {
  if (!c.dataNascimento) return 999;
  const dia = Number(c.dataNascimento.slice(8, 10));
  return dia || 999;
}

// Verifica se o cliente faz aniversário este mês, usando a data de nascimento real.
// Sem data de nascimento, não há como saber — não conta como aniversariante.
function aniversarioEsteMes(c: ClienteCRM): boolean {
  if (!c.dataNascimento) return false;
  // dataNascimento vem como 'YYYY-MM-DD' (coluna date). Lemos o mês direto da string
  // para evitar deslocamento de fuso (new Date('YYYY-MM-DD') é UTC e pode "pular" o mês).
  const mesNasc = Number(c.dataNascimento.slice(5, 7));
  if (!mesNasc) return false;
  return mesNasc === new Date().getMonth() + 1;
}
// Faz aniversário HOJE (dia e mês).
function aniversarioHoje(c: ClienteCRM): boolean {
  if (!c.dataNascimento) return false;
  const mes = Number(c.dataNascimento.slice(5, 7));
  const dia = Number(c.dataNascimento.slice(8, 10));
  const hoje = new Date();
  return mes === hoje.getMonth() + 1 && dia === hoje.getDate();
}
// Cliente comprador que sumiu há mais de 30 dias. Quem nunca comprou NÃO é inativo.
function isInativo(c: ClienteCRM): boolean {
  return c.totalVisitas > 0 && diasSemVisita(c.ultimaVisita) > 30;
}

// ── Mensagem de WhatsApp contextual — o texto muda conforme a relação do cliente ──
function mensagemWhatsApp(c: ClienteCRM): string {
  const nome = c.nome.split(' ')[0];
  if (aniversarioEsteMes(c)) {
    return `Olá, ${nome}! \u{1F382} Passando para desejar um feliz aniversário! Queremos comemorar com você — venha nos visitar e aproveite um mimo especial da casa. \u{1F973}`;
  }
  if (c.totalVisitas === 0) {
    return `Olá, ${nome}! Que bom ter você na nossa lista. \u{1F60A} Ainda não teve a chance de experimentar nossos pratos? Venha nos conhecer, vamos adorar te receber!`;
  }
  if (isInativo(c)) {
    return `Olá, ${nome}! Sentimos sua falta por aqui. \u{1F49B} Já faz um tempinho desde sua última visita — preparamos novidades que você vai gostar. Que tal passar para conferir?`;
  }
  if (c.tags.includes('vip') || c.tags.includes('frequente')) {
    return `Olá, ${nome}! Obrigado por ser um cliente tão especial. \u{1F64C} Temos novidades no cardápio que combinam com o seu gosto — venha experimentar!`;
  }
  return `Olá, ${nome}! Tudo bem? Passando para lembrar que estamos com novidades por aqui. Venha nos visitar e aproveitar! \u{1F60A}`;
}
// Abre o WhatsApp do cliente (mesmo padrão do ClientePerfil): wa.me/55<dígitos>.
function abrirWhatsApp(cliente: ClienteCRM) {
  const numero = (cliente.celular ?? '').replace(/\D/g, '');
  if (!numero) return;
  const msg = encodeURIComponent(mensagemWhatsApp(cliente));
  window.open(`https://wa.me/55${numero}?text=${msg}`, '_blank');
}

const TAG_STYLE: Record<string, string> = {
  vip: 'bg-amber-50 text-amber-700 border border-amber-200',
  frequente: 'bg-green-50 text-green-700 border border-green-200',
  novo: 'bg-sky-50 text-sky-700 border border-sky-200',
  inativo: 'bg-zinc-100 text-zinc-500 border border-zinc-200',
};

const FILTROS: { id: Filtro; label: string; icon?: string; count?: (c: ClienteCRM[]) => number }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'vip', label: 'VIP', icon: 'ri-vip-crown-line', count: (cs) => cs.filter((c) => c.tags.includes('vip')).length },
  { id: 'frequente', label: 'Frequentes', icon: 'ri-repeat-line', count: (cs) => cs.filter((c) => c.tags.includes('frequente')).length },
  { id: 'novo', label: 'Novos', icon: 'ri-user-add-line', count: (cs) => cs.filter((c) => c.tags.includes('novo')).length },
  { id: 'inativo', label: 'Inativos', icon: 'ri-user-unfollow-line', count: (cs) => cs.filter(isInativo).length },
  { id: 'aniversario', label: 'Aniversário', icon: 'ri-cake-line', count: (cs) => cs.filter(aniversarioEsteMes).length },
];

function exportarCSV(clientes: ClienteCRM[]) {
  const headers = ['Nome', 'Celular', 'Aniversário', 'Tags', 'Compras', 'Total Gasto (R$)', 'Ticket Médio (R$)', 'Primeira Compra', 'Última Compra', 'Dias sem Comprar'];
  const rows = clientes.map(c => [
    c.nome,
    c.celular || '',
    fmtAniversario(c.dataNascimento),
    c.tags.join(', '),
    c.totalVisitas,
    c.valorTotal.toFixed(2).replace('.', ','),
    c.ticketMedio.toFixed(2).replace('.', ','),
    c.totalVisitas === 0 ? '' : fmtData(c.primeiraVisita),
    c.totalVisitas === 0 ? '' : fmtData(c.ultimaVisita),
    c.totalVisitas === 0 ? '' : diasSemVisita(c.ultimaVisita),
  ]);
  const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
  baixarArquivo(csv, `clientes_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Exporta no formato de Público Personalizado do Meta Ads (Gerenciador de Anúncios).
// Colunas reconhecidas pelo Meta: phone, email, fn (primeiro nome), ln (sobrenome), country.
function exportarMetaCSV(clientes: ClienteCRM[]) {
  const headers = ['phone', 'email', 'fn', 'ln', 'country'];
  const rows = clientes
    .filter(c => (c.celular ?? '').replace(/\D/g, '').length >= 10)
    .map(c => {
      const tel = (c.celular ?? '').replace(/\D/g, '');
      const partes = c.nome.trim().split(/\s+/);
      const fn = partes[0] ?? '';
      const ln = partes.slice(1).join(' ');
      return [`+55${tel}`, '', fn, ln, 'BR'];
    });
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  baixarArquivo(csv, `meta_ads_publico_${new Date().toISOString().slice(0, 10)}.csv`);
}

function baixarArquivo(csv: string, nome: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Segmentação RFM simplificada ─────────────────────────────────────────────
type SegmentoRFM = 'Campeões' | 'Fiéis' | 'Em Risco' | 'Perdidos' | 'Novos' | 'Sem compras';

function segmentarRFM(c: ClienteCRM): SegmentoRFM {
  if (c.totalVisitas === 0) return 'Sem compras';
  const dias = diasSemVisita(c.ultimaVisita);
  if (dias <= 7 && c.totalVisitas >= 5) return 'Campeões';
  if (dias <= 30 && c.totalVisitas >= 3) return 'Fiéis';
  if (dias > 30 && dias <= 60 && c.totalVisitas >= 2) return 'Em Risco';
  if (dias > 60) return 'Perdidos';
  return 'Novos';
}

const RFM_STYLE: Record<SegmentoRFM, { color: string; bg: string; bar: string; desc: string }> = {
  'Campeões':    { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', bar: '#10b981', desc: 'Compram frequentemente e recentemente' },
  'Fiéis':       { color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     bar: '#f59e0b', desc: 'Compram regularmente, bom relacionamento' },
  'Em Risco':    { color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   bar: '#f97316', desc: 'Compraram antes, mas estão sumindo' },
  'Perdidos':    { color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         bar: '#ef4444', desc: 'Não compram há mais de 60 dias' },
  'Novos':       { color: 'text-sky-700',     bg: 'bg-sky-50 border-sky-200',         bar: '#0ea5e9', desc: 'Primeira ou segunda compra recente' },
  'Sem compras': { color: 'text-zinc-500',    bg: 'bg-zinc-50 border-zinc-200',       bar: '#a1a1aa', desc: 'Cadastrados que ainda não compraram' },
};

// ── Modal de campanha de WhatsApp em massa ───────────────────────────────────
// Percorre os clientes um a um. Cada envio é disparado por clique do usuário —
// isso evita o bloqueio de popups do navegador (abrir várias abas de uma vez é barrado).
function CampanhaWhatsAppModal({ clientes, onClose, onContato }: { clientes: ClienteCRM[]; onClose: () => void; onContato?: (id: string) => void }) {
  const [soOptIn, setSoOptIn] = useState(false);
  const comTelefone = useMemo(
    () => clientes.filter(c =>
      (c.celular ?? '').replace(/\D/g, '').length >= 10 && (!soOptIn || c.aceitaMarketing)
    ),
    [clientes, soOptIn],
  );
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
              <p className="text-[11px] text-zinc-400">{comTelefone.length} cliente{comTelefone.length !== 1 ? 's' : ''} com telefone</p>
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

export default function ClientesPage() {
  const { clientes, loading, error, atualizarCliente, registrarContato } = useClientes();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [filtroRFM, setFiltroRFM] = useState<SegmentoRFM | null>(null);
  const [soDuplicados, setSoDuplicados] = useState(false);
  const [sortField, setSortField] = useState<SortField>('recente');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selecionado, setSelecionado] = useState<ClienteCRM | null>(null);
  const [voucherCliente, setVoucherCliente] = useState<ClienteCRM | null>(null);
  const [editarCliente, setEditarCliente] = useState<ClienteCRM | null>(null);
  const [showRFM, setShowRFM] = useState(false);
  const [showCampanha, setShowCampanha] = useState(false);
  const [showBirthday, setShowBirthday] = useState(false);

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
      l = l.filter((c) =>
        c.nome.toLowerCase().includes(q) || (c.celular ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))
      );
    }

    if (soDuplicados) {
      l = l.filter((c) => duplicados.has(c.id));
    }

    if (filtroRFM) {
      l = l.filter((c) => segmentarRFM(c) === filtroRFM);
    }

    if (filtro !== 'todos') {
      l = l.filter((c) => {
        if (filtro === 'inativo') return isInativo(c);
        if (filtro === 'aniversario') return aniversarioEsteMes(c);
        return c.tags.includes(filtro);
      });
    }

    const cmp = (a: ClienteCRM, b: ClienteCRM): number => {
      let r = 0;
      switch (sortField) {
        case 'nome': r = a.nome.localeCompare(b.nome, 'pt-BR'); break;
        case 'visitas': r = a.totalVisitas - b.totalVisitas; break;
        case 'gasto': r = a.valorTotal - b.valorTotal; break;
        case 'ticket': r = a.ticketMedio - b.ticketMedio; break;
        case 'aniversario': r = diaAniversario(a) - diaAniversario(b); break;
        case 'recente':
        default: r = new Date(a.ultimaVisita).getTime() - new Date(b.ultimaVisita).getTime();
      }
      return sortDir === 'asc' ? r : -r;
    };
    l.sort(cmp);

    return l;
  }, [clientes, busca, filtro, filtroRFM, soDuplicados, duplicados, sortField, sortDir]);

  const totalVisitas = clientes.reduce((acc, c) => acc + c.totalVisitas, 0);
  const totalGasto = clientes.reduce((acc, c) => acc + c.valorTotal, 0);
  const ticketMedioGeral = totalVisitas > 0 ? totalGasto / totalVisitas : 0;
  const aniversariantesCount = clientes.filter(aniversarioEsteMes).length;
  const inativos = clientes.filter(isInativo).length;

  // Métricas acionáveis do topo
  const ativos30d = clientes.filter((c) => c.totalVisitas > 0 && diasSemVisita(c.ultimaVisita) <= 30).length;
  const compradores = clientes.filter((c) => c.totalVisitas > 0).length;
  const retornaram = clientes.filter((c) => c.totalVisitas >= 2).length;
  const taxaRetorno = compradores > 0 ? (retornaram / compradores) * 100 : 0;

  const algumFiltro = !!busca || filtro !== 'todos' || filtroRFM !== null || soDuplicados;

  const limparFiltros = () => {
    setBusca('');
    setFiltro('todos');
    setFiltroRFM(null);
    setSoDuplicados(false);
  };

  // RFM segmentation
  const rfmData = useMemo(() => {
    const grupos: Record<SegmentoRFM, { count: number; gasto: number }> = {
      'Campeões':    { count: 0, gasto: 0 },
      'Fiéis':       { count: 0, gasto: 0 },
      'Em Risco':    { count: 0, gasto: 0 },
      'Perdidos':    { count: 0, gasto: 0 },
      'Novos':       { count: 0, gasto: 0 },
      'Sem compras': { count: 0, gasto: 0 },
    };
    clientes.forEach(c => {
      const seg = segmentarRFM(c);
      grupos[seg].count++;
      grupos[seg].gasto += c.valorTotal;
    });
    return (Object.entries(grupos) as [SegmentoRFM, { count: number; gasto: number }][])
      .map(([seg, v]) => ({ seg, ...v, style: RFM_STYLE[seg] }))
      .filter(s => s.count > 0);
  }, [clientes]);

  // Distribuição por gênero (usa dado que já vem do banco)
  const genero = useMemo(() => {
    let m = 0, f = 0, o = 0;
    clientes.forEach((c) => {
      const g = (c.genero ?? '').trim().toLowerCase();
      if (g.startsWith('m')) m++;
      else if (g.startsWith('f')) f++;
      else o++;
    });
    return { m, f, semInfo: o };
  }, [clientes]);

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <i className="ri-arrow-up-down-line text-zinc-300 text-[11px]" />;
    return <i className={`${sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} text-amber-500 text-[11px]`} />;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-4 flex-shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
              <i className="ri-user-line text-zinc-600 text-sm" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Clientes</h1>
              <p className="text-xs text-zinc-400">
                {loading ? 'Carregando...' : `${clientes.length} clientes cadastrados`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {aniversariantesCount > 0 && (
              <button
                onClick={() => { setFiltroRFM(null); setSoDuplicados(false); setFiltro('aniversario'); }}
                className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-100 cursor-pointer transition-colors"
                title="Ver aniversariantes deste mês"
              >
                <i className="ri-cake-line text-amber-600 text-sm" />
                <span className="text-xs font-semibold text-amber-700">{aniversariantesCount} aniversariante{aniversariantesCount > 1 ? 's' : ''} este mês</span>
              </button>
            )}
            {inativos > 0 && (
              <button
                onClick={() => { setFiltroRFM(null); setSoDuplicados(false); setFiltro('inativo'); }}
                className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 cursor-pointer transition-colors"
                title="Ver clientes inativos"
              >
                <i className="ri-user-unfollow-line text-red-500 text-sm" />
                <span className="text-xs font-semibold text-red-600">{inativos} inativo{inativos > 1 ? 's' : ''}</span>
              </button>
            )}
            <button
              onClick={() => setShowBirthday(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700"
              title="Configurar e gerar vouchers de aniversário"
            >
              <i className="ri-cake-3-line" /> Aniversários
            </button>
            <button
              onClick={() => setShowCampanha(true)}
              disabled={lista.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 disabled:opacity-40"
              title="Enviar mensagem para todos os clientes filtrados"
            >
              <i className="ri-whatsapp-line" /> WhatsApp em massa
            </button>
            <button
              onClick={() => setShowRFM(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors border ${showRFM ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600'}`}
            >
              <i className="ri-pie-chart-2-line" /> Segmentação RFM
            </button>
            <button
              onClick={() => exportarMetaCSV(lista)}
              disabled={lista.length === 0}
              className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40"
              title="Exportar como Público Personalizado para o Meta Ads"
            >
              <i className="ri-meta-line" /> Meta Ads
            </button>
            <button
              onClick={() => exportarCSV(lista)}
              disabled={lista.length === 0}
              className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40"
            >
              <i className="ri-download-line" /> Exportar CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 mb-4">
          {[
            { label: 'Total de clientes', value: String(clientes.length), icon: 'ri-user-line', color: 'text-amber-600 bg-amber-50' },
            { label: 'Ativos (últimos 30d)', value: String(ativos30d), icon: 'ri-user-follow-line', color: 'text-green-600 bg-green-50' },
            { label: 'Taxa de retorno', value: `${taxaRetorno.toFixed(0)}%`, icon: 'ri-repeat-line', color: 'text-sky-600 bg-sky-50', hint: `${retornaram} de ${compradores} compradores voltaram` },
            { label: 'Ticket médio geral', value: fmtMoeda(ticketMedioGeral), icon: 'ri-receipt-line', color: 'text-zinc-600 bg-zinc-100' },
          ].map((s) => (
            <div key={s.label} className="bg-zinc-50 rounded-xl px-3 md:px-4 py-3 flex items-center gap-2 md:gap-3" title={s.hint}>
              <div className={`w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${s.color}`}>
                <i className={`${s.icon} text-sm md:text-base`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-800 truncate">{s.value}</p>
                <p className="text-[10px] md:text-[11px] text-zinc-400 leading-tight">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 md:gap-3">
          <div className="relative flex-1 w-full sm:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              className="w-full pl-9 pr-4 py-2 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 transition-colors"
              placeholder="Buscar por nome ou celular..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                onClick={() => { setFiltroRFM(null); setSoDuplicados(false); setFiltro(f.id); }}
                className={`px-2.5 md:px-3 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${filtro === f.id && !filtroRFM ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
              >
                {f.icon && <i className={`${f.icon} text-xs`} />}
                {f.label}
                {f.count && (
                  <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] ${filtro === f.id && !filtroRFM ? 'bg-white/30 text-white' : 'bg-zinc-200 text-zinc-600'}`}>
                    {f.count(clientes)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <select
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-600 focus:outline-none cursor-pointer w-full sm:w-auto"
            value={sortField}
            onChange={(e) => { setSortField(e.target.value as SortField); setSortDir(e.target.value === 'nome' || e.target.value === 'aniversario' ? 'asc' : 'desc'); }}
          >
            <option value="recente">Mais recentes</option>
            <option value="visitas">Mais compras</option>
            <option value="gasto">Maior gasto</option>
            <option value="ticket">Maior ticket</option>
            <option value="aniversario">Aniversário (dia)</option>
            <option value="nome">Nome (A-Z)</option>
          </select>
        </div>

        {/* Aviso de possíveis duplicados */}
        {duplicados.size > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-orange-800">
              <i className="ri-error-warning-line text-orange-500" />
              <span><strong>{duplicados.size}</strong> possíveis cadastros duplicados (mesmo nome ou telefone) — o histórico deles fica dividido.</span>
            </div>
            <button
              onClick={() => { setSoDuplicados((v) => !v); setFiltro('todos'); setFiltroRFM(null); }}
              className={`text-xs font-semibold px-3 py-1 rounded-lg cursor-pointer whitespace-nowrap transition-colors ${soDuplicados ? 'bg-orange-500 text-white' : 'bg-white border border-orange-300 text-orange-700 hover:bg-orange-100'}`}
            >
              {soDuplicados ? 'Mostrar todos' : 'Revisar'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Painel RFM */}
        {showRFM && clientes.length > 0 && (
          <div className="mb-4 bg-white border border-zinc-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-zinc-900">Segmentação RFM</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Recência · Frequência · Valor — clique num segmento para filtrar a lista</p>
              </div>
              <div className="flex items-center gap-2">
                {(genero.m > 0 || genero.f > 0) && (
                  <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[11px] font-semibold text-zinc-500">
                    <span className="text-sky-600">♂ {genero.m}</span>
                    <span className="text-pink-500">♀ {genero.f}</span>
                    {genero.semInfo > 0 && <span className="text-zinc-400">? {genero.semInfo}</span>}
                  </div>
                )}
                {filtroRFM && (
                  <button
                    onClick={() => setFiltroRFM(null)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs font-semibold text-amber-700 cursor-pointer hover:bg-amber-100"
                  >
                    <i className="ri-filter-off-line" /> {filtroRFM}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Gráfico de barras */}
              <div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={rfmData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="seg" tick={{ fontSize: 11, fill: '#52525b' }} axisLine={false} tickLine={false} width={78} />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        name === 'count' ? `${value} clientes` : fmtMoeda(value),
                        name === 'count' ? 'Clientes' : 'Gasto total',
                      ]}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e4e4e7' }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20} className="cursor-pointer"
                      onClick={(d) => {
                        const seg = (d as unknown as { seg?: SegmentoRFM })?.seg;
                        if (seg) setFiltroRFM((cur) => cur === seg ? null : seg);
                      }}>
                      {rfmData.map((entry) => (
                        <Cell key={entry.seg} fill={entry.style.bar} opacity={filtroRFM && filtroRFM !== entry.seg ? 0.35 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Cards de segmento — clicáveis */}
              <div className="space-y-2">
                {rfmData.map(seg => {
                  const ativo = filtroRFM === seg.seg;
                  return (
                    <button
                      key={seg.seg}
                      onClick={() => setFiltroRFM((cur) => cur === seg.seg ? null : seg.seg)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all cursor-pointer text-left ${seg.style.bg} ${ativo ? 'ring-2 ring-offset-1 ring-amber-400' : 'hover:brightness-95'}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: seg.style.bar }} />
                        <div>
                          <p className={`text-xs font-bold ${seg.style.color}`}>{seg.seg}</p>
                          <p className="text-[10px] text-zinc-400">{seg.style.desc}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-black ${seg.style.color}`}>{seg.count}</p>
                        <p className="text-[10px] text-zinc-400">{fmtMoeda(seg.gasto)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Insight de retenção */}
            {rfmData.find(s => s.seg === 'Em Risco' || s.seg === 'Perdidos') && (
              <div className="mt-4 flex items-start gap-3 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
                <i className="ri-lightbulb-line text-orange-500 text-base flex-shrink-0 mt-0.5" />
                <div className="text-xs text-orange-800">
                  <strong>Oportunidade de retenção:</strong>{' '}
                  {(() => {
                    const emRisco = rfmData.find(s => s.seg === 'Em Risco');
                    const perdidos = rfmData.find(s => s.seg === 'Perdidos');
                    const total = (emRisco?.count ?? 0) + (perdidos?.count ?? 0);
                    const gasto = (emRisco?.gasto ?? 0) + (perdidos?.gasto ?? 0);
                    return `${total} cliente${total > 1 ? 's' : ''} em risco ou perdidos representam ${fmtMoeda(gasto)} em gasto histórico. Uma campanha de reativação pode recuperar parte desse valor.`;
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Banner aniversariantes */}
        {filtro === 'aniversario' && lista.length > 0 && (
          <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <i className="ri-cake-line text-amber-600 text-xl flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">{lista.length} cliente{lista.length > 1 ? 's' : ''} com aniversário este mês!</p>
              <p className="text-xs text-amber-600">Use o "WhatsApp em massa" ou envie um voucher de aniversário para comemorar.</p>
            </div>
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
                  <span className="font-semibold text-zinc-700">{lista.length}</span> resultado{lista.length !== 1 ? 's' : ''} encontrado{lista.length !== 1 ? 's' : ''}
                  {clientes.length !== lista.length && ` de ${clientes.length} clientes`}
                  {filtroRFM && <span className="ml-2 text-amber-600 font-semibold">· Segmento: {filtroRFM}</span>}
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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tags</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <button onClick={() => setSort('visitas')} title="Quantidade de vendas finalizadas (pagas) vinculadas ao cliente" className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Compras <SortArrow field="visitas" /></button>
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <button onClick={() => setSort('gasto')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Total gasto <SortArrow field="gasto" /></button>
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <button onClick={() => setSort('ticket')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Ticket médio <SortArrow field="ticket" /></button>
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <button onClick={() => setSort('aniversario')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Aniversário <SortArrow field="aniversario" /></button>
                    </th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      <button onClick={() => setSort('recente')} className="inline-flex items-center gap-1 hover:text-zinc-700 cursor-pointer uppercase">Última compra <SortArrow field="recente" /></button>
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((cliente, idx) => {
                    const dias = diasSemVisita(cliente.ultimaVisita);
                    const isAniversario = aniversarioEsteMes(cliente);
                    const hojeAniv = aniversarioHoje(cliente);
                    return (
                      <tr
                        key={cliente.id}
                        onClick={() => setSelecionado(cliente)}
                        className={`border-b border-zinc-50 hover:bg-amber-50/40 cursor-pointer transition-colors ${isAniversario ? 'bg-amber-50/20' : idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30'}`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                                <span className="text-sm font-bold text-amber-700">{cliente.nome.charAt(0)}</span>
                              </div>
                              {isAniversario && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-amber-500 rounded-full">
                                  <i className="ri-cake-line text-white text-[8px]" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-zinc-800">{cliente.nome}</p>
                              <p className="text-xs text-zinc-400">{cliente.celular || '—'}</p>
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
                            {cliente.tags.map((tag) => (
                              <span key={tag} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${TAG_STYLE[tag] ?? ''}`}>
                                {tag}
                              </span>
                            ))}
                            {cliente.manualTags.map((tag) => (
                              <span key={`m-${tag}`} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                                {tag}
                              </span>
                            ))}
                            {hojeAniv ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500 text-white border border-amber-500">
                                🎂 hoje!
                              </span>
                            ) : isAniversario && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                🎂 aniversário
                              </span>
                            )}
                            {cliente.notes && (
                              <i className="ri-sticky-note-line text-zinc-400 text-xs" title={cliente.notes} />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-bold text-zinc-800">{cliente.totalVisitas}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-bold text-zinc-800">{fmtMoeda(cliente.valorTotal)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm text-zinc-600">{fmtMoeda(cliente.ticketMedio)}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {cliente.dataNascimento ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${isAniversario ? 'text-amber-600 font-bold' : 'text-zinc-600'}`}>
                              {isAniversario && <i className="ri-cake-line text-[11px]" />}
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
                                {dias === 0 ? 'hoje' : `há ${dias} dias`}
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
                            <button
                              onClick={(e) => { e.stopPropagation(); setVoucherCliente(cliente); }}
                              title="Enviar voucher / gift card"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-amber-600 hover:bg-amber-50 cursor-pointer transition-colors"
                            >
                              <i className="ri-gift-line text-base" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); abrirWhatsApp(cliente); registrarContato([cliente.id]); }}
                              disabled={!cliente.celular}
                              title={cliente.celular ? 'Enviar mensagem no WhatsApp' : 'Cliente sem telefone'}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer transition-colors"
                            >
                              <i className="ri-whatsapp-line text-base" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-zinc-400 text-sm">
                        {clientes.length === 0 ? 'Nenhum cliente cadastrado ainda' : 'Nenhum cliente encontrado para os filtros selecionados'}
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
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-amber-50/40 cursor-pointer transition-colors ${isAniversario ? 'bg-amber-50/20' : ''}`}
                  >
                    <div className="relative">
                      <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                        <span className="text-sm font-bold text-amber-700">{cliente.nome.charAt(0)}</span>
                      </div>
                      {isAniversario && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-amber-500 rounded-full">
                          <i className="ri-cake-line text-white text-[8px]" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-800">{cliente.nome}</p>
                        {cliente.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${TAG_STYLE[tag] ?? ''}`}>{tag}</span>
                        ))}
                      </div>
                      <p className="text-xs text-zinc-400">
                        {cliente.celular || '—'} · {cliente.totalVisitas} compra{cliente.totalVisitas === 1 ? '' : 's'}
                        {cliente.dataNascimento && <> · 🎂 {fmtAniversario(cliente.dataNascimento)}</>}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-zinc-800">{fmtMoeda(cliente.valorTotal)}</p>
                      {cliente.totalVisitas === 0 ? (
                        <p className="text-[10px] text-zinc-400 italic">Sem compras</p>
                      ) : (
                        <p className={`text-[10px] ${dias > 30 ? 'text-red-500' : dias > 14 ? 'text-amber-500' : 'text-green-600'}`}>
                          {dias === 0 ? 'hoje' : `há ${dias}d`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditarCliente(cliente); }}
                        title="Editar cadastro"
                        className="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer transition-colors"
                      >
                        <i className="ri-pencil-line text-lg" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setVoucherCliente(cliente); }}
                        title="Enviar voucher"
                        className="flex items-center justify-center w-9 h-9 rounded-lg text-amber-600 hover:bg-amber-50 cursor-pointer transition-colors"
                      >
                        <i className="ri-gift-line text-lg" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); abrirWhatsApp(cliente); registrarContato([cliente.id]); }}
                        disabled={!cliente.celular}
                        title={cliente.celular ? 'Enviar mensagem no WhatsApp' : 'Cliente sem telefone'}
                        className="flex items-center justify-center w-9 h-9 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-30 cursor-pointer transition-colors"
                      >
                        <i className="ri-whatsapp-line text-lg" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {lista.length === 0 && (
                <div className="px-5 py-12 text-center text-zinc-400 text-sm">
                  {clientes.length === 0 ? 'Nenhum cliente cadastrado ainda' : 'Nenhum cliente encontrado'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {selecionado && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelecionado(null)} />
          <ClientePerfil cliente={selecionado} onClose={() => setSelecionado(null)} />
        </>
      )}

      {voucherCliente && (
        <EnviarVoucherModal cliente={voucherCliente} onClose={() => setVoucherCliente(null)} />
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
        />
      )}

      {showBirthday && (
        <BirthdayVoucherModal
          aniversariantesMes={clientes.filter(aniversarioEsteMes)}
          onClose={() => setShowBirthday(false)}
        />
      )}
    </div>
  );
}
