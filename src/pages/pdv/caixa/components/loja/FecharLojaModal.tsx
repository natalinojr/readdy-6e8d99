// "Fechar a loja" (2026-10-03): um fluxo guiado no lugar de "Fechar caixa" + "Fechar sessão".
//   loja   → pendências → contar → conferir (+ motivo da diferença) → fecha caixa e dia → resumo do dinheiro
//   trocar → retiradas a confirmar → contar → conferir → fecha só o caixa (loja segue aberta)
//   dia    → caixa já fechado: pendências → confirmar → fecha o dia → resumo do último caixa
// As regras continuam no banco: fn_close_cash_register_v2 (recusa sangria prevista pendente) e
// fn_close_session (recusa mesa aberta, item na cozinha, pedido não pago, tablet pago). Aqui só se
// checa ANTES de contar, para o dia não ficar aberto depois do caixa fechado (29/09).
// O motivo da diferença vai junto no fechamento (p_closing_notes) — o aviso do assistente já sai com
// ele. Se o banco apurar diferença que a tela não viu, pede o motivo depois (fn_update_cash_register_notes).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { useNotificacoes } from '@/contexts/NotificacoesContext';
import { useCaixaPing } from '@/hooks/useCaixaPing';
import { usePermissoes } from '@/hooks/usePermissoes';
import { confirmar } from '@/components/base/Dialogos';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import ContagemGaveta, { contagemVazia, fmtBRL, valorDe, type ValorContado } from './ContagemGaveta';
import SeloCeu from './SeloCeu';
import ConfirmaEnter from './ConfirmaEnter';

export type TipoFechamento = 'loja' | 'trocar' | 'dia';
export type DestinoPDV = 'mesas' | 'pedidos' | 'sangria';

interface Prevista { id: string; amount: number; supplier: string | null; description: string | null; created_at: string }
interface PedidoPendente { id: string; numero: string; motivo: 'nao_entregue' | 'nao_pago' }
interface HeldOrder { id: string; is_paid: boolean | null; payments?: Array<{ amount: number; is_refunded: boolean | null }> }
interface Retirada { valor: number; motivo: string; hora: string }
interface Dinheiro { abertura: number; vendas: number; nVendas: number; retiradas: Retirada[]; suprimentos: number }
interface Apurado { contado: number; esperado: number; diferenca: number; motivo: string; abertura: number; vendas: number; nVendas: number; retiradas: Retirada[]; suprimentos: number }

type Passo = 'carregando' | 'bloqueado' | 'pend' | 'contar' | 'conferir' | 'confdia' | 'fechando' | 'justificar' | 'falha' | 'fim';
type Etapa = { id: 'cx' | 'dia'; texto: string; st: 'w' | 'r' | 'k' | 'e' };

const hora = (d: Date | string = new Date()) =>
  new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const r2 = (n: number) => Math.round(n * 100) / 100;
const numeroCurto = (n: string) => (String(n).replace(/\D/g, '').slice(-4) || n);
const recebeuAlgo = (o: HeldOrder) => !!o.is_paid || (o.payments ?? []).some((p) => !p.is_refunded && Number(p.amount) > 0);
const MOTIVOS = ['Troco dado errado', 'Contei errado', 'Pagamento lançado na forma errada', 'Não sei'];

interface Props {
  tipo: TipoFechamento;
  onClose: () => void;
  /** Leva ao lugar do PDV que resolve a pendência (fecha esta janela). Sem ele, só orienta. */
  onIrPara?: (d: DestinoPDV) => void;
}

export default function FecharLojaModal({ tipo, onClose, onIrPara }: Props) {
  const { user } = useAuth();
  const { sessao, caixa, fecharCaixa, fecharSessao, sincronizarSessao, sinalizarCaixaFechadoLocalmente } = useSessao();
  const { hasPermissao } = usePermissoes();
  const { registrarEvento } = useAuditoria();
  const { dispararNotificacao } = useNotificacoes();
  const nome = user?.nome ?? 'Operador';
  const perfil = user?.perfil ?? 'operador';
  const tenantId = user?.tenantId ?? '';

  // O que precisa sobreviver ao fechamento (o contexto zera sessão/caixa quando fecham).
  const sessaoRef = useRef({
    id: sessao?.id ?? '', numero: sessao?.numero ?? '',
    // Dia que atravessou a data (ex.: aberto em 30/04) mostra a data junto da hora.
    abriu: sessao?.dataRef && dateKeyBrasilia(sessao.dataRef) !== todayBrasilia()
      ? `${sessao.dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} às ${sessao.iniciadaEm}`
      : (sessao?.iniciadaEm ?? ''),
  });
  const caixaRef = useRef({ id: caixa?.id ?? '', abertura: Number(caixa?.valorAbertura ?? 0) });

  const [passo, setPasso] = useState<Passo>('carregando');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Pendências
  const [previstas, setPrevistas] = useState<Prevista[]>([]);
  const [pedidos, setPedidos] = useState<PedidoPendente[]>([]);
  const [mesas, setMesas] = useState(0);
  const [tablet, setTablet] = useState(0);
  const [semVerificacao, setSemVerificacao] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [tevePend, setTevePend] = useState(false);

  // Dinheiro
  const [dinheiro, setDinheiro] = useState<Dinheiro | null>(null);
  const [contagem, setContagem] = useState<ValorContado>(contagemVazia);
  const [justificativa, setJustificativa] = useState('');
  const [verRetiradas, setVerRetiradas] = useState(false);
  // Pelo teclado, fechar sempre pergunta antes (o Enter da contagem é costume e não pode fechar sem querer).
  const [confirmando, setConfirmando] = useState(false);
  const [computador] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);

  // Execução
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [erroDia, setErroDia] = useState('');
  const [mostrarForcar, setMostrarForcar] = useState(false);
  const caixaFechou = useRef(tipo === 'dia');
  const diaFechou = useRef(false);
  const [bloqueio, setBloqueio] = useState('');
  const apurado = useRef<Apurado | null>(null);
  const [fechadoAs, setFechadoAs] = useState('');

  const titulo = tipo === 'trocar' ? 'Trocar de operador' : passo === 'fim' ? 'Resumo do dia' : 'Fechar a loja';
  // Pedidos/mesas/tablet resolvidos por fora (sessão velha com lixo de teste): dá para seguir; o banco
  // confere de novo no fim e, se recusar, a tela oferece forçar — como antes. Retirada prevista não:
  // o fn_close_cash_register_v2 recusa o caixa enquanto houver uma pendente.
  const [seguirMesmoAssim, setSeguirMesmoAssim] = useState(false);
  const nPedidos = pedidos.length + (mesas > 0 ? 1 : 0) + tablet;
  const nPend = previstas.length + (seguirMesmoAssim ? 0 : nPedidos);

  /* ── Carregamentos ─────────────────────────────────────────────────────── */
  const carregarDinheiro = useCallback(async (): Promise<Dinheiro | null> => {
    const cxId = caixaRef.current.id;
    if (!cxId || !tenantId) return null;
    const [{ data: metodos }, { data: movs }] = await Promise.all([
      supabase.from('payment_methods').select('id').eq('tenant_id', tenantId).eq('type', 'cash'),
      supabase.from('cash_movements').select('type, amount, reason, created_at').eq('cash_register_id', cxId).order('created_at'),
    ]);
    // Mesma conta do fn_close_cash_register_v2: abertura + dinheiro (não estornado) + entradas − saídas.
    const ids = (metodos ?? []).map((m: { id: string }) => m.id);
    let vendas = 0; let nVendas = 0;
    if (ids.length) {
      const { data: pags } = await supabase.from('payments').select('amount')
        .eq('cash_register_id', cxId).eq('is_refunded', false).in('payment_method_id', ids);
      for (const p of (pags ?? []) as { amount: number }[]) { vendas += Number(p.amount) || 0; nVendas += 1; }
    }
    const lista = (movs ?? []) as { type: string; amount: number; reason: string | null; created_at: string }[];
    const d: Dinheiro = {
      abertura: caixaRef.current.abertura,
      vendas: r2(vendas), nVendas,
      retiradas: lista.filter((m) => m.type === 'out').map((m) => ({ valor: Number(m.amount) || 0, motivo: m.reason || 'Retirada', hora: hora(m.created_at) })),
      suprimentos: r2(lista.filter((m) => m.type === 'in').reduce((s, m) => s + (Number(m.amount) || 0), 0)),
    };
    setDinheiro(d);
    return d;
  }, [tenantId]);

  const verificar = useCallback(async (): Promise<{ prev: number; ped: number }> => {
    if (!tenantId) return { prev: 0, ped: 0 };
    setVerificando(true);
    const sessId = sessaoRef.current.id;
    const [prev, pend, held] = await Promise.all([
      tipo !== 'dia'
        ? invokeWithAuth<{ data?: Prevista[] }>('order-write', { body: { action: 'list_sangrias_previstas', tenant_id: tenantId } }).catch(() => null)
        : Promise.resolve(null),
      tipo !== 'trocar' && sessId
        ? invokeWithAuth<{ pedidosPendentes?: { id: string; numero: string; motivo: string }[]; mesasAbertas?: number; error?: string }>(
          'check-session-pending', { body: { session_id: sessId, tenant_id: tenantId } }).catch(() => null)
        : Promise.resolve(null),
      tipo !== 'trocar' && sessId
        ? invokeWithAuth<{ data?: HeldOrder[] }>('order-write', { body: { action: 'list_held_orders', tenant_id: tenantId, session_id: sessId } }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const lp = (prev?.data?.data ?? []) as Prevista[];
    let lped: PedidoPendente[] = []; let nm = 0; let falhou = false;
    if (tipo !== 'trocar') {
      if (!pend || pend.error || pend.data?.error) falhou = true;
      else {
        lped = (pend.data?.pedidosPendentes ?? []).map((p) => ({ id: p.id, numero: p.numero, motivo: p.motivo === 'nao_entregue' ? 'nao_entregue' : 'nao_pago' }));
        nm = pend.data?.mesasAbertas ?? 0;
      }
    }
    const nt = ((held?.data?.data ?? []) as HeldOrder[]).filter(recebeuAlgo).length;
    setPrevistas(lp); setPedidos(lped); setMesas(nm); setTablet(nt); setSemVerificacao(falhou);
    setVerificando(false);
    return { prev: lp.length, ped: lped.length + (nm > 0 ? 1 : 0) + nt };
  }, [tenantId, tipo]);

  // Resumo do 'dia': o último caixa fechado deste dia (já contado).
  const carregarUltimoCaixa = useCallback(async () => {
    const sessId = sessaoRef.current.id;
    if (!sessId) return;
    const { data } = await supabase.from('cash_registers')
      .select('id, opening_value, closing_value_actual, closing_value_expected, closing_difference, closing_notes, closed_at')
      .eq('session_id', sessId).eq('status', 'closed').order('closed_at', { ascending: false }).limit(1);
    const r = data?.[0] as { opening_value: number; closing_value_actual: number; closing_value_expected: number; closing_difference: number; closing_notes: string | null } | undefined;
    if (!r) return;
    apurado.current = {
      contado: Number(r.closing_value_actual) || 0, esperado: Number(r.closing_value_expected) || 0, diferenca: Number(r.closing_difference) || 0,
      motivo: r.closing_notes ?? '', abertura: Number(r.opening_value) || 0, vendas: 0, nVendas: 0, retiradas: [], suprimentos: 0,
    };
  }, []);

  // 'dia' só fecha se não houver caixa aberto NO BANCO (a tela pode estar até 60 s atrasada — outro
  // aparelho abriu um caixa). Sem essa conferência o dia fechava com um caixa aberto que ninguém contou.
  const conferirSemCaixaAberto = useCallback(async (): Promise<boolean> => {
    const atual = await sincronizarSessao().catch(() => null);
    if (atual === null) { setBloqueio('Sem conexão com o sistema agora. Tente de novo em instantes.'); return false; }
    if (!atual.sessao) { setBloqueio('A loja já foi fechada em outro aparelho.'); return false; }
    if (atual.caixa) { setBloqueio('Tem um caixa aberto neste dia (aberto em outro aparelho). Feche a loja pelo botão do PDV — esse caixa precisa ser contado.'); return false; }
    return true;
  }, [sincronizarSessao]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (tipo === 'dia' && !(await conferirSemCaixaAberto())) { if (vivo) setPasso('bloqueado'); return; }
      const [n] = await Promise.all([verificar(), tipo !== 'dia' ? carregarDinheiro() : carregarUltimoCaixa()]);
      if (!vivo) return;
      const total = n.prev + n.ped;
      setTevePend(total > 0);
      setPasso(total > 0 ? 'pend' : tipo === 'dia' ? 'confdia' : 'contar');
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retirada lançada/confirmada em outro lugar (assistente, financeiro): atualiza a lista sozinha.
  useCaixaPing(tenantId, () => { if (passo === 'pend') verificar(); if (passo === 'conferir') carregarDinheiro(); });

  const sair = useCallback(() => {
    if (caixaFechou.current && tipo !== 'dia' && !diaFechou.current) sinalizarCaixaFechadoLocalmente();
    onClose();
  }, [onClose, sinalizarCaixaFechadoLocalmente, tipo]);

  /* ── Pendências: retiradas previstas ───────────────────────────────────── */
  const confirmarPrevista = async (pv: Prevista) => {
    if (!caixaRef.current.id || ocupado) return;
    setOcupado(pv.id); setErro('');
    const { data, error } = await invokeWithAuth<{ data?: { reason: string }; error?: string }>('order-write', {
      body: { action: 'add_cash_movement', cash_register_id: caixaRef.current.id, tenant_id: tenantId, type: 'out', previsao_id: pv.id, amount: pv.amount, reason: '' },
    });
    setOcupado(null);
    if (error || !data?.data) { setErro((data as { error?: string } | null)?.error ?? error?.message ?? 'Não consegui confirmar.'); return; }
    const motivo = `Fornecedor: ${pv.supplier ?? 'compra'} (cupom)`;
    registrarEvento({
      tipo: 'sangria', severidade: pv.amount >= 200 ? 'aviso' : 'info', usuario: nome, perfil,
      descricao: `Sangria de ${fmtBRL(pv.amount)} confirmada no fechamento — ${motivo}`, entidade: 'Caixa', entidadeId: caixaRef.current.id,
      depois: { valor: pv.amount, motivo, tipo: 'sangria' },
    });
    await Promise.all([verificar(), carregarDinheiro()]);
  };
  const naoSaiu = async (pv: Prevista) => {
    if (ocupado) return;
    if (!(await confirmar({ titulo: `O dinheiro da compra ${pv.supplier ?? ''} (${fmtBRL(pv.amount)}) NÃO saiu deste caixa?`, mensagem: 'O gerente vai ser avisado para conferir.', confirmarLabel: 'Não saiu', perigo: true }))) return;
    setOcupado(pv.id);
    await invokeWithAuth('order-write', { body: { action: 'sangria_prevista_nao_saiu', tenant_id: tenantId, previsao_id: pv.id, motivo: 'informado no fechamento do PDV' } }).catch(() => null);
    setOcupado(null);
    await verificar();
  };

  /* ── Conta do dinheiro ─────────────────────────────────────────────────── */
  const contado = valorDe(contagem);
  const totalRetiradas = r2((dinheiro?.retiradas ?? []).reduce((s, r) => s + r.valor, 0));
  const esperado = dinheiro ? r2(dinheiro.abertura + dinheiro.vendas + dinheiro.suprimentos - totalRetiradas) : 0;
  const diferenca = contado != null ? r2(contado - esperado) : 0;
  const temDiferenca = Math.abs(diferenca) >= 0.01;
  const justOk = !temDiferenca || justificativa.trim().length >= 5;

  /* ── Fechar: caixa (se ainda aberto) e dia (se não for troca) ──────────── */
  const marcar = (id: Etapa['id'], st: Etapa['st'], texto?: string) =>
    setEtapas((l) => l.map((e) => (e.id === id ? { ...e, st, texto: texto ?? e.texto } : e)));

  const fecharDia = async (forcar: boolean) => {
    marcar('dia', 'r', forcar ? 'Forçando o fechamento do dia' : 'Fechando o dia (delivery e totem param)');
    if (tipo === 'dia' && !(await conferirSemCaixaAberto())) { setPasso('bloqueado'); return; }
    try {
      localStorage.removeItem('pdv_rascunhos');
      await fecharSessao(undefined, undefined, forcar);
    } catch (e) {
      marcar('dia', 'e', 'O dia não fechou');
      // A mensagem vem do banco ("fechar a sessão"); na tela o nome é "loja".
      setErroDia((e instanceof Error ? e.message : String(e)).replace(/a sessão/gi, 'a loja'));
      setPasso('falha');
      return;
    }
    registrarEvento({
      tipo: 'sessao_fechada', severidade: forcar ? 'aviso' : 'info', usuario: nome, perfil,
      descricao: `Loja fechada por ${nome}${forcar ? ' (forçado)' : ''}`, entidade: 'Sessão', entidadeId: sessaoRef.current.id || sessaoRef.current.numero || '—',
      detalhes: `Aberta às ${sessaoRef.current.abriu || '—'}.${forcar ? ' Fechamento forçado.' : ''}`,
    });
    diaFechou.current = true;
    marcar('dia', 'k', 'Loja fechada');
    setFechadoAs(hora());
    setPasso('fim');
  };

  // Um clique duplo (ou Enter + clique) não pode fechar duas vezes.
  const rodando = useRef(false);
  const executar = async (forcar = false) => {
    if (rodando.current) return;
    rodando.current = true;
    try { await executarPassos(forcar); } finally { rodando.current = false; }
  };

  const executarPassos = async (forcar: boolean) => {
    setErro(''); setErroDia(''); setMostrarForcar(false);
    if (!etapas.length) {
      setEtapas([
        ...(tipo !== 'dia' ? [{ id: 'cx' as const, texto: 'Fechando o caixa', st: 'w' as const }] : []),
        ...(tipo !== 'trocar' ? [{ id: 'dia' as const, texto: 'Fechando o dia (delivery e totem param)', st: 'w' as const }] : []),
      ]);
    }
    setPasso('fechando');

    if (!caixaFechou.current) {
      const valor = contado ?? 0;
      const motivo = temDiferenca ? justificativa.trim() : '';
      marcar('cx', 'r');
      // fn_close_cash_register_v2 não confere status: num caixa já fechado ele regravaria o fechamento.
      const { data: st } = await supabase.from('cash_registers').select('status').eq('id', caixaRef.current.id).maybeSingle();
      if (st && (st as { status: string }).status !== 'open') {
        setBloqueio('Este caixa já foi fechado em outro aparelho. Nada foi gravado agora.');
        setPasso('bloqueado');
        return;
      }
      // Pedido ou retirada que chegou enquanto contava: resolve antes de fechar qualquer coisa.
      const v = await verificar();
      if (v.prev > 0 || (!seguirMesmoAssim && v.ped > 0)) {
        setEtapas([]); setTevePend(true);
        setErro('Chegou uma pendência enquanto você contava. Resolva e siga — a contagem continua guardada.');
        setPasso('pend');
        return;
      }
      try {
        await fecharCaixa(valor, motivo || undefined, true);
      } catch (e) {
        // Não fechou (ex.: retirada nova esperando confirmação): volta com o motivo.
        setEtapas([]);
        setErro(`O caixa não fechou: ${e instanceof Error ? e.message : String(e)}`);
        const v2 = await verificar();
        if (v2.prev > 0) { setTevePend(true); setPasso('pend'); } else setPasso('conferir');
        return;
      }
      caixaFechou.current = true;
      let esp = esperado; let dif = diferenca;
      const { data: reg } = await supabase.from('cash_registers')
        .select('closing_value_expected, closing_difference').eq('id', caixaRef.current.id).maybeSingle();
      if (reg) { esp = Number((reg as { closing_value_expected: number }).closing_value_expected) || 0; dif = Number((reg as { closing_difference: number }).closing_difference) || 0; }
      apurado.current = {
        contado: valor, esperado: esp, diferenca: dif, motivo,
        abertura: dinheiro?.abertura ?? caixaRef.current.abertura, vendas: dinheiro?.vendas ?? 0, nVendas: dinheiro?.nVendas ?? 0,
        retiradas: dinheiro?.retiradas ?? [], suprimentos: dinheiro?.suprimentos ?? 0,
      };
      registrarEvento({
        tipo: 'fechamento_caixa', severidade: Math.abs(dif) > 50 ? 'aviso' : 'info', usuario: nome, perfil,
        descricao: `Caixa fechado${tipo === 'trocar' ? ' (troca de operador)' : ''}. Contado: ${fmtBRL(valor)} | Esperado: ${fmtBRL(esp)}${Math.abs(dif) >= 0.01 ? ` | Diferença: ${fmtBRL(dif)}` : ' | Sem diferenças'}${motivo ? ` | Justificativa: ${motivo}` : ''}`,
        entidade: 'caixa', entidadeId: caixaRef.current.id || '—',
        depois: { valor_contado: valor, valor_esperado: esp, diferenca: dif },
      });
      if (Math.abs(dif) >= 0.01) {
        dispararNotificacao({
          tipo: 'diferenca_caixa', titulo: 'Diferença no fechamento de caixa',
          mensagem: `${dif < 0 ? 'Faltaram' : 'Sobraram'} ${fmtBRL(Math.abs(dif))} no caixa. Contado: ${fmtBRL(valor)} | Esperado: ${fmtBRL(esp)}`,
          urgente: Math.abs(dif) > 50, perfisAlvo: ['gerente', 'admin'], icone: 'ri-safe-2-line', cor: 'red',
          extra: { diff: dif, valorDeclarado: valor, valorEsperado: esp },
        });
      }
      marcar('cx', 'k', 'Caixa fechado');
      // O banco viu uma diferença que a tela não viu (venda entrou enquanto contava): pede o motivo agora.
      if (Math.abs(dif) >= 0.01 && !motivo) { setJustificativa(''); setPasso('justificar'); return; }
      if (tipo === 'trocar') { setFechadoAs(hora()); setPasso('fim'); return; }
    }
    if (tipo !== 'trocar') await fecharDia(forcar);
  };

  const salvarJustificativaTardia = async () => {
    if (justificativa.trim().length < 5 || ocupado) return;
    setOcupado('just'); setErro('');
    const { error } = await supabase.rpc('fn_update_cash_register_notes', { p_id: caixaRef.current.id, p_notes: justificativa.trim() });
    setOcupado(null);
    if (error) { setErro('Não consegui salvar a justificativa. Tente de novo.'); return; }
    if (apurado.current) apurado.current.motivo = justificativa.trim();
    registrarEvento({
      tipo: 'fechamento_caixa', severidade: 'info', usuario: nome, perfil,
      descricao: `Justificativa da diferença de ${fmtBRL(apurado.current?.diferenca ?? 0)}: ${justificativa.trim()}`,
      entidade: 'caixa', entidadeId: caixaRef.current.id || '—',
    });
    if (tipo === 'trocar') { setFechadoAs(hora()); setPasso('fim'); return; }
    setPasso('fechando');
    await fecharDia(false);
  };

  /* ── Teclado: Enter avança, Esc sai (antes de fechar); atalhos do PDV ficam parados ── */
  const acaoPrincipal = useRef<(() => void) | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const podeSair = ['carregando', 'bloqueado', 'pend', 'contar', 'conferir', 'confdia'].includes(passo);
  // O foco tem que estar aqui dentro: com o foco na busca do PDV (atrás), Enter/F2 iriam para o PDV.
  useEffect(() => {
    if (!raiz.current?.contains(document.activeElement)) raiz.current?.focus();
  }, [passo]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const tag = alvo?.tagName ?? '';
      const digitando = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      // Diálogo do sistema aberto por cima (ex.: "Não saiu?"): as teclas são dele.
      const outroDialogo = [...document.querySelectorAll('[aria-modal="true"]')].some((d) => d !== raiz.current);
      if (outroDialogo || (alvo && alvo !== document.body && !raiz.current?.contains(alvo))) return;
      if (e.key === 'Enter' && alvo?.dataset?.contagem != null) return;
      // F-teclas: os atalhos do PDV não rodam por baixo e o F5 não recarrega no meio do fechamento.
      if (/^F\d{1,2}$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (podeSair) sair();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) acaoPrincipal.current?.(); // Enter segurado não atravessa contar → conferir → fechar
        return;
      }
      if (!digitando && e.key === ' ') e.stopPropagation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [podeSair, sair]);

  /* ── Telas ─────────────────────────────────────────────────────────────── */
  const ordem: { id: Passo; txt: string }[] = [
    ...(tevePend ? [{ id: 'pend' as Passo, txt: 'Pendências' }] : []),
    ...(tipo === 'dia' ? [{ id: 'confdia' as Passo, txt: 'Confirmar' }] : [{ id: 'contar' as Passo, txt: 'Contar' }, { id: 'conferir' as Passo, txt: 'Conferir' }]),
    { id: 'fim', txt: tipo === 'trocar' ? 'Pronto' : 'Resumo' },
  ];
  const idxAtual = (() => {
    if (['fechando', 'justificar', 'falha'].includes(passo)) return ordem.length - 2;
    const i = ordem.findIndex((o) => o.id === passo);
    return i < 0 ? 0 : i;
  })();

  let corpo: ReactNode = null;
  let rodape: ReactNode = null;
  let largo = false;
  acaoPrincipal.current = null;

  const btnPri = 'flex-1 min-h-[52px] rounded-2xl text-[15px] font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors';
  const btnSec = 'min-h-[52px] px-5 rounded-2xl border border-stone-200 bg-white hover:bg-stone-50 text-sm font-bold text-zinc-700 cursor-pointer';
  const kbd = <kbd className="hidden md:inline text-[11px] font-black bg-black/10 rounded-md px-1.5 py-0.5">Enter</kbd>;

  if (passo === 'carregando') {
    corpo = (
      <div className="py-14 flex flex-col items-center gap-3 text-stone-400">
        <i className="ri-loader-4-line animate-spin text-3xl" />
        <p className="text-sm font-semibold">{tipo === 'trocar' ? 'Conferindo as retiradas…' : 'Conferindo pedidos, mesas e retiradas…'}</p>
      </div>
    );
  }

  if (passo === 'bloqueado') {
    acaoPrincipal.current = sair;
    corpo = (
      <div className="py-6 text-center">
        <span className="w-14 h-14 mx-auto mb-3 rounded-full bg-amber-50 ring-[1.5px] ring-inset ring-amber-200 text-amber-600 flex items-center justify-center text-2xl">
          <i className="ri-error-warning-line" />
        </span>
        <p className="text-sm text-zinc-700 max-w-sm mx-auto">{bloqueio}</p>
      </div>
    );
    rodape = <button onClick={sair} className={`${btnPri} bg-amber-500 hover:bg-amber-600 text-zinc-900`}>Entendi {kbd}</button>;
  }

  if (passo === 'pend') {
    const proximo = tipo === 'dia' ? 'confdia' : 'contar';
    if (nPend === 0) acaoPrincipal.current = () => setPasso(proximo);
    const grupo = (icone: string, tituloG: string, n: number, filhos: ReactNode, extra?: ReactNode) => (
      <div className="border border-stone-200 rounded-2xl overflow-hidden mt-3">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 text-[13px] font-black text-zinc-800">
          <i className={icone} /> {tituloG}
          {extra}
          <span className={`ml-auto text-[11px] font-black rounded-full px-2 py-0.5 text-white ${n ? 'bg-red-500' : 'bg-emerald-600'}`}>{n || '✓'}</span>
        </div>
        {filhos}
      </div>
    );
    corpo = (
      <>
        <p className="text-lg font-black text-zinc-900">Antes de contar o dinheiro</p>
        <p className="text-[13px] text-zinc-500 mt-0.5">
          {tipo === 'trocar' ? 'O caixa só fecha com as retiradas confirmadas.' : 'Estas coisas impedem a loja de fechar. Resolvendo agora, o dia fecha de uma vez.'}
        </p>
        {erro && <p className="mt-3 text-xs font-semibold text-red-600 bg-red-50 rounded-xl px-3 py-2">{erro}</p>}

        {previstas.length > 0 && grupo('ri-receipt-line', 'Retiradas para confirmar', previstas.length,
          previstas.map((pv) => (
            <div key={pv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-t border-stone-100">
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm font-bold text-zinc-800">{pv.supplier ?? pv.description ?? 'Compra'}</p>
                <p className="text-xs text-stone-400">Foto do cupom tirada no app às {hora(pv.created_at)}</p>
              </div>
              <span className="text-sm font-black text-zinc-900">{fmtBRL(pv.amount)}</span>
              <div className="flex gap-2 w-full sm:w-auto">
                <button onClick={() => naoSaiu(pv)} disabled={!!ocupado} className="flex-1 sm:flex-none px-3 py-2 rounded-xl border border-stone-200 text-[13px] font-bold text-zinc-600 hover:bg-stone-50 cursor-pointer disabled:opacity-50">Não saiu</button>
                <button onClick={() => confirmarPrevista(pv)} disabled={!!ocupado} className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-[13px] font-bold cursor-pointer disabled:opacity-50">
                  {ocupado === pv.id ? <i className="ri-loader-4-line animate-spin" /> : 'Saiu do caixa'}
                </button>
              </div>
            </div>
          )),
          <span className="hidden sm:inline text-xs font-semibold text-stone-400">· compras pagas com o dinheiro da gaveta</span>,
        )}
        {previstas.length > 0 && onIrPara && hasPermissao('pdv_sangria') && (
          <p className="text-xs text-stone-400 mt-1.5 px-1">
            Saiu um valor diferente?{' '}
            <button onClick={() => onIrPara('sangria')} className="font-bold text-amber-700 hover:underline cursor-pointer">Corrigir na Sangria</button>
          </p>
        )}

        {pedidos.length > 0 && grupo('ri-file-list-3-line', 'Pedidos em aberto', pedidos.length, (
          <div className="px-4 py-3 border-t border-stone-100">
            <ul className="text-sm text-zinc-700 space-y-1">
              {pedidos.slice(0, 6).map((p) => (
                <li key={p.id}><b>Pedido {numeroCurto(p.numero)}</b> · {p.motivo === 'nao_entregue' ? 'na cozinha, falta entregar' : 'falta receber o pagamento'}</li>
              ))}
              {pedidos.length > 6 && <li className="text-stone-400">e mais {pedidos.length - 6}…</li>}
            </ul>
            {onIrPara
              ? <button onClick={() => onIrPara('pedidos')} className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 text-white text-[13px] font-bold cursor-pointer">Ver os pedidos</button>
              : <p className="mt-2 text-xs text-stone-400">Os pedidos ficam no PDV: abra o caixa para resolver.</p>}
          </div>
        ))}

        {tablet > 0 && grupo('ri-tablet-line', 'Tablet', tablet, (
          <div className="px-4 py-3 border-t border-stone-100">
            <p className="text-sm text-zinc-700">{tablet === 1 ? 'Um pedido do tablet já foi pago' : `${tablet} pedidos do tablet já foram pagos`} e ainda não foi para a cozinha.</p>
            {onIrPara && <button onClick={() => onIrPara('pedidos')} className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 text-white text-[13px] font-bold cursor-pointer">Mandar para a cozinha</button>}
          </div>
        ))}

        {mesas > 0 && grupo('ri-layout-grid-line', 'Mesas', 1, (
          <div className="px-4 py-3 border-t border-stone-100">
            <p className="text-sm text-zinc-700">{mesas === 1 ? 'Uma mesa ainda está aberta.' : `${mesas} mesas ainda estão abertas.`}</p>
            {onIrPara
              ? <button onClick={() => onIrPara('mesas')} className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 text-white text-[13px] font-bold cursor-pointer">Ver as mesas</button>
              : <p className="mt-2 text-xs text-stone-400">As mesas ficam no PDV: abra o caixa para fechar a conta.</p>}
          </div>
        ))}

        {nPedidos > 0 && !seguirMesmoAssim && (
          <p className="mt-3 text-center text-xs text-stone-400">
            Já foi tudo resolvido por fora?{' '}
            <button onClick={() => setSeguirMesmoAssim(true)} className="font-bold text-amber-700 hover:underline cursor-pointer">Seguir mesmo assim</button>
            {' '}— no fim o sistema confere de novo e, se precisar, pede para forçar.
          </p>
        )}
        {semVerificacao && (
          <p className="mt-3 text-xs text-stone-500 bg-stone-50 rounded-xl px-3 py-2">Não consegui conferir pedidos e mesas agora. O sistema confere de novo na hora de fechar.</p>
        )}
      </>
    );
    rodape = (
      <>
        <button onClick={sair} className={btnSec}>Depois</button>
        <button onClick={() => verificar()} disabled={verificando} className={btnSec} title="Conferir de novo">
          <i className={`ri-refresh-line ${verificando ? 'animate-spin inline-block' : ''}`} />
        </button>
        <button onClick={() => setPasso(proximo)} disabled={nPend > 0} className={`${btnPri} bg-amber-500 hover:bg-amber-600 text-zinc-900`}>
          {nPend > 0 ? `Faltam ${nPend}` : tipo === 'dia' ? 'Continuar' : 'Contar o dinheiro'} {nPend === 0 && kbd}
        </button>
      </>
    );
  }

  if (passo === 'contar') {
    largo = contagem.modo === 'cedulas';
    if (contado != null) acaoPrincipal.current = () => { carregarDinheiro(); setPasso('conferir'); };
    corpo = (
      <>
        {nPend === 0 && !seguirMesmoAssim && (
          <p className="mb-3 flex items-center gap-2 text-[12.5px] font-bold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
            <i className="ri-checkbox-circle-fill" /> {tipo === 'trocar' ? 'Retiradas em dia' : 'Pedidos, mesas e retiradas em dia'}
          </p>
        )}
        <p className="text-lg font-black text-zinc-900">Quanto tem de dinheiro na gaveta?</p>
        <p className="text-[13px] text-zinc-500 mt-0.5 mb-3">Conte tudo que está na gaveta, troco incluído. O valor esperado só aparece depois — assim a contagem é de verdade.</p>
        <ContagemGaveta estado={contagem} onChange={setContagem} idCampo="fechar-total" focarPrimeiro={computador}
          onEnterNoFim={() => acaoPrincipal.current?.()} />
      </>
    );
    rodape = (
      <>
        <button onClick={nPend > 0 ? () => setPasso('pend') : sair} className={btnSec}>{nPend > 0 ? 'Voltar' : 'Cancelar'}</button>
        <div className="text-right px-1 sm:px-2">
          <p className="text-[11px] font-bold text-stone-400 whitespace-nowrap">Total contado</p>
          <p className="text-base sm:text-lg font-black text-zinc-900 whitespace-nowrap">{contado != null ? fmtBRL(contado) : '—'}</p>
        </div>
        <button onClick={() => acaoPrincipal.current?.()} disabled={contado == null} className={`${btnPri} bg-amber-500 hover:bg-amber-600 text-zinc-900`}>
          Conferir {kbd}
        </button>
      </>
    );
  }

  if (passo === 'conferir') {
    if (justOk && dinheiro) acaoPrincipal.current = () => setConfirmando(true);
    const c = contado ?? 0;
    const banner = !temDiferenca
      ? { cls: 'bg-emerald-50 text-emerald-900', icone: 'ri-check-line', cor: 'text-emerald-600 ring-emerald-200', t: 'Bateu certinho' }
      : diferenca > 0
        ? { cls: 'bg-amber-50 text-amber-900', icone: 'ri-add-line', cor: 'text-amber-600 ring-amber-200', t: `Sobrou ${fmtBRL(diferenca)}` }
        : { cls: 'bg-red-50 text-red-900', icone: 'ri-subtract-line', cor: 'text-red-600 ring-red-200', t: `Faltou ${fmtBRL(-diferenca)}` };
    corpo = !dinheiro ? (
      <div className="py-10 text-center text-stone-400"><i className="ri-loader-4-line animate-spin text-2xl" /></div>
    ) : (
      <>
        <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${banner.cls}`}>
          <span className={`w-11 h-11 rounded-full bg-white ring-[1.5px] ring-inset flex items-center justify-center text-2xl flex-shrink-0 ${banner.cor}`}>
            <i className={banner.icone} />
          </span>
          <div>
            <p className="text-xl font-black">{banner.t}</p>
            <p className="text-xs opacity-80">Contado {fmtBRL(c)} · esperado {fmtBRL(esperado)}</p>
          </div>
        </div>
        <ContaDinheiro d={dinheiro} totalRetiradas={totalRetiradas} esperado={esperado} contado={c} ver={verRetiradas} onVer={() => setVerRetiradas((v) => !v)} />
        {temDiferenca && (
          <div className="mt-4">
            <p className="text-[15px] font-black text-zinc-900">O que aconteceu?</p>
            <div className="flex flex-wrap gap-1.5 my-2">
              {MOTIVOS.map((m) => (
                <button key={m} onClick={() => setJustificativa(m)}
                  className={`px-3 py-1.5 rounded-full border text-[12.5px] font-bold cursor-pointer ${justificativa === m ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-stone-200 text-zinc-600 hover:bg-stone-50'}`}>
                  {m}
                </button>
              ))}
            </div>
            <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={2} maxLength={500}
              placeholder="Conte em poucas palavras (obrigatório para fechar)"
              className="w-full border-2 border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 resize-none" />
            <p className="text-[11.5px] text-stone-400 mt-1">Vai junto com o fechamento para o financeiro.</p>
          </div>
        )}
        <p className="mt-4 flex gap-2 text-[12.5px] text-zinc-600 bg-stone-50 rounded-xl px-3 py-2.5">
          <i className="ri-information-line text-amber-600 text-base" />
          {tipo === 'trocar'
            ? 'Fecha só o caixa. A loja continua aberta; o próximo operador conta a gaveta ao abrir.'
            : 'Fecha o caixa e o dia de uma vez. Delivery e totem param de receber pedidos. Não dá para desfazer.'}
        </p>
        {erro && <p className="mt-3 text-xs font-semibold text-red-600 bg-red-50 rounded-xl px-3 py-2">{erro}</p>}
      </>
    );
    rodape = (
      <>
        <button onClick={() => { setErro(''); setPasso('contar'); }} className={btnSec}>Recontar</button>
        <button onClick={() => executar()} disabled={!justOk || !dinheiro}
          className={`${btnPri} ${tipo === 'trocar' ? 'bg-zinc-900 hover:bg-zinc-800 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}>
          <i className={tipo === 'trocar' ? 'ri-safe-2-line' : 'ri-store-2-line'} />
          {tipo === 'trocar' ? 'Fechar o caixa' : 'Fechar a loja'} {kbd}
        </button>
      </>
    );
  }

  if (passo === 'confdia') {
    acaoPrincipal.current = () => setConfirmando(true);
    corpo = (
      <>
        <p className="mb-3 flex items-center gap-2 text-[12.5px] font-bold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
          <i className="ri-checkbox-circle-fill" /> O caixa já foi contado e fechado{apurado.current ? ` com ${fmtBRL(apurado.current.contado)}` : ''}
        </p>
        <p className="text-lg font-black text-zinc-900">Fechar o dia?</p>
        <p className="text-[13px] text-zinc-500 mt-0.5">Não precisa contar de novo. Delivery e totem param de receber pedidos e o financeiro recebe o fechamento do turno.</p>
      </>
    );
    rodape = (
      <>
        <button onClick={sair} className={btnSec}>Cancelar</button>
        <button onClick={() => executar()} className={`${btnPri} bg-red-600 hover:bg-red-700 text-white`}><i className="ri-store-2-line" /> Fechar a loja {kbd}</button>
      </>
    );
  }

  if (passo === 'fechando') {
    corpo = (
      <div className="py-4">
        {etapas.map((e) => (
          <div key={e.id} className={`flex items-center gap-3 py-3 text-[15px] font-bold ${e.st === 'w' ? 'text-stone-400' : 'text-zinc-800'}`}>
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${
              e.st === 'k' ? 'bg-emerald-50 text-emerald-600' : e.st === 'r' ? 'bg-amber-50 text-amber-600' : e.st === 'e' ? 'bg-red-50 text-red-600' : 'border-2 border-dashed border-stone-300'}`}>
              {e.st === 'k' && <i className="ri-check-line" />}
              {e.st === 'r' && <i className="ri-loader-4-line animate-spin" />}
              {e.st === 'e' && <i className="ri-close-line" />}
            </span>
            {e.texto}
          </div>
        ))}
      </div>
    );
  }

  if (passo === 'justificar') {
    if (justificativa.trim().length >= 5) acaoPrincipal.current = () => { salvarJustificativaTardia(); };
    const dif = apurado.current?.diferenca ?? 0;
    corpo = (
      <>
        <div className={`rounded-2xl px-4 py-3.5 ${dif < 0 ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
          <p className="text-xl font-black">{dif < 0 ? `Faltou ${fmtBRL(-dif)}` : `Sobrou ${fmtBRL(dif)}`}</p>
          <p className="text-xs opacity-80">O caixa já fechou e o sistema achou essa diferença (entrou um pagamento enquanto você contava). Conte o que aconteceu para continuar.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 my-3">
          {MOTIVOS.map((m) => (
            <button key={m} onClick={() => setJustificativa(m)}
              className={`px-3 py-1.5 rounded-full border text-[12.5px] font-bold cursor-pointer ${justificativa === m ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-stone-200 text-zinc-600'}`}>{m}</button>
          ))}
        </div>
        <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={2} maxLength={500}
          placeholder="Conte em poucas palavras" className="w-full border-2 border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 resize-none" />
        {erro && <p className="mt-2 text-xs font-semibold text-red-600">{erro}</p>}
      </>
    );
    rodape = (
      <button onClick={salvarJustificativaTardia} disabled={justificativa.trim().length < 5 || !!ocupado} className={`${btnPri} bg-zinc-900 hover:bg-zinc-800 text-white`}>
        {ocupado ? <i className="ri-loader-4-line animate-spin" /> : 'Salvar e continuar'} {kbd}
      </button>
    );
  }

  if (passo === 'falha') {
    acaoPrincipal.current = () => { executar(false); };
    corpo = (
      <>
        <div className="rounded-2xl px-4 py-3.5 bg-red-50 text-red-900">
          <p className="text-lg font-black">{tipo === 'dia' ? 'A loja ainda não fechou' : 'O caixa fechou, a loja ainda não'}</p>
          <p className="text-[13px] mt-1">{erroDia}</p>
        </div>
        <p className="mt-3 flex gap-2 text-[12.5px] text-zinc-600 bg-stone-50 rounded-xl px-3 py-2.5">
          <i className="ri-information-line text-amber-600 text-base" />
          O dinheiro já foi contado e conferido. Resolva o que falta (abra o caixa se precisar do PDV) e toque em “Tentar de novo” — não precisa contar outra vez.
        </p>
        <div className="text-center mt-3">
          <button onClick={() => setMostrarForcar((v) => !v)} className="text-[13px] font-bold text-amber-700 hover:underline cursor-pointer">
            {mostrarForcar ? 'Esconder' : 'Já foi resolvido por fora? Forçar o fechamento'}
          </button>
        </div>
        {mostrarForcar && (
          <div className="mt-2 rounded-2xl bg-red-50 border border-red-100 p-3 text-[12.5px] text-red-800">
            Forçar ignora pedidos e mesas em aberto e fecha o dia mesmo assim. Fica registrado quem forçou.
            <button onClick={() => executar(true)} className="mt-2 w-full min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold cursor-pointer">Forçar o fechamento</button>
          </div>
        )}
      </>
    );
    rodape = (
      <>
        <button onClick={sair} className={btnSec}>Fechar depois</button>
        <button onClick={() => executar(false)} className={`${btnPri} bg-amber-500 hover:bg-amber-600 text-zinc-900`}>Tentar de novo {kbd}</button>
      </>
    );
  }

  if (passo === 'fim') {
    acaoPrincipal.current = sair;
    const a = apurado.current;
    if (tipo === 'trocar') {
      corpo = (
        <div className="text-center py-2">
          <SeloCeu fase="tarde" />
          <p className="text-[22px] font-black text-zinc-900">Caixa fechado às {fechadoAs}</p>
          <p className="text-sm text-zinc-500 mt-1">
            Ficaram {fmtBRL(a?.contado ?? 0)} na gaveta. O próximo operador conta a gaveta ao abrir e a tela compara com esse valor.
          </p>
          {a && Math.abs(a.diferenca) >= 0.01 && (
            <p className="text-[13px] mt-2 text-zinc-600">Diferença: <b className={a.diferenca < 0 ? 'text-red-600' : 'text-amber-700'}>{a.diferenca < 0 ? 'faltou' : 'sobrou'} {fmtBRL(Math.abs(a.diferenca))}</b>{a.motivo ? ` — “${a.motivo}”` : ''}</p>
          )}
        </div>
      );
    } else {
      largo = true;
      corpo = (
        <>
          <div className="text-center pt-1">
            <SeloCeu fase="noite" />
            <p className="text-[22px] font-black text-zinc-900">Loja fechada às {fechadoAs}</p>
            <p className="text-[13px] text-zinc-500 mt-1">
              {sessaoRef.current.abriu ? `Aberta ${sessaoRef.current.abriu.includes('/') ? 'em' : 'às'} ${sessaoRef.current.abriu} · ` : ''}fechada por {nome}
            </p>
          </div>
          {a && (
            <div className="mt-4 border border-stone-200 rounded-2xl p-4 md:grid md:grid-cols-[220px_1fr] md:gap-5">
              <div>
                <p className="text-[11.5px] font-black text-stone-400 uppercase tracking-wider">Ficou na gaveta</p>
                <p className="text-[30px] font-black text-zinc-900 tracking-tight">{fmtBRL(a.contado)}</p>
                <p className="text-[12.5px] text-zinc-500">É o troco de amanhã. A abertura mostra esse valor para conferir na contagem.</p>
              </div>
              <div className="mt-3 md:mt-0">
                {tipo === 'loja' && dinheiro ? (
                  <ContaDinheiro d={{ ...dinheiro, abertura: a.abertura, vendas: a.vendas, nVendas: a.nVendas, retiradas: a.retiradas, suprimentos: a.suprimentos }}
                    totalRetiradas={r2(a.retiradas.reduce((s, r) => s + r.valor, 0))} esperado={a.esperado} contado={a.contado}
                    ver={verRetiradas} onVer={() => setVerRetiradas((v) => !v)} semBorda />
                ) : (
                  <div>
                    <Linha k="Troco da abertura" v={fmtBRL(a.abertura)} />
                    <Linha k="Devia ter" v={fmtBRL(a.esperado)} forte />
                    <Linha k="Contado" v={fmtBRL(a.contado)} forte />
                  </div>
                )}
                <Linha k="Diferença" v={Math.abs(a.diferenca) < 0.01 ? 'nenhuma ✓' : `${a.diferenca > 0 ? 'sobrou' : 'faltou'} ${fmtBRL(Math.abs(a.diferenca))}`}
                  cor={Math.abs(a.diferenca) < 0.01 ? 'text-emerald-700' : a.diferenca > 0 ? 'text-amber-700' : 'text-red-600'} />
                {a.motivo && Math.abs(a.diferenca) >= 0.01 && <Linha k="Motivo" v={`“${a.motivo}”`} />}
              </div>
            </div>
          )}
          <p className="mt-3 flex items-start gap-2 text-[12.5px] text-zinc-600 bg-stone-50 rounded-xl px-3 py-2.5">
            <i className="ri-send-plane-fill text-emerald-600 text-base" />
            <span>O <b>fechamento do turno</b> foi para o financeiro, já com a diferença e o motivo.</span>
          </p>
        </>
      );
    }
    rodape = <button onClick={sair} className={`${btnPri} bg-amber-500 hover:bg-amber-600 text-zinc-900`}>Pronto {kbd}</button>;
  }

  return (
    <div ref={raiz} tabIndex={-1} className="outline-none fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center md:p-6" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className={`bg-white w-full ${largo ? 'md:max-w-3xl' : 'md:max-w-xl'} rounded-t-3xl md:rounded-3xl max-h-[94vh] md:max-h-[92vh] flex flex-col shadow-2xl`}>
        <div className="px-5 md:px-6 pt-4 md:pt-5 pb-3 relative flex-shrink-0">
          <div className="md:hidden w-10 h-1.5 rounded-full bg-stone-200 mx-auto mb-3" />
          <p className="text-xl font-black text-zinc-900 pr-10">{titulo}</p>
          {podeSair && (
            <button onClick={sair} title="Esc" className="absolute right-4 top-4 md:top-4 w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-zinc-600 cursor-pointer">
              <i className="ri-close-line text-lg" />
            </button>
          )}
          <div className="flex gap-1.5 mt-3">
            {ordem.map((o, i) => (
              <div key={o.id} className="flex-1">
                <div className={`h-1.5 rounded-full ${i < idxAtual ? 'bg-emerald-600' : i === idxAtual ? 'bg-amber-500' : 'bg-stone-100'}`} />
                <p className={`text-[11px] font-bold mt-1 ${i === idxAtual ? 'text-zinc-800' : 'text-stone-400'}`}>{o.txt}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="px-5 md:px-6 pb-4 overflow-y-auto flex-1">{corpo}</div>
        {rodape && <div className="px-5 md:px-6 py-4 border-t border-stone-100 flex items-center gap-2.5 flex-shrink-0">{rodape}</div>}
      </div>
      {confirmando && (passo === 'conferir' || passo === 'confdia') && (
        <ConfirmaEnter
          titulo={tipo === 'trocar' ? `Fechar o caixa com ${fmtBRL(contado ?? 0)}?` : 'Fechar a loja agora?'}
          detalhe={passo === 'confdia' ? 'Delivery e totem param de receber pedidos.'
            : !temDiferenca ? <span className="font-bold text-emerald-700">Bateu certinho: {fmtBRL(contado ?? 0)}</span>
            : <span className={diferenca < 0 ? 'text-red-700' : 'text-amber-800'}><b>{diferenca < 0 ? 'Faltou' : 'Sobrou'} {fmtBRL(Math.abs(diferenca))}</b> — “{justificativa.trim()}”</span>}
          botao={tipo === 'trocar' ? 'Fechar o caixa' : 'Fechar a loja'}
          perigo={tipo !== 'trocar'}
          onConfirmar={() => { setConfirmando(false); executar(); }}
          onCancelar={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}

function Linha({ k, v, forte, cor }: { k: string; v: string; forte?: boolean; cor?: string }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-t border-stone-100 first:border-t-0 text-sm">
      <span className={forte ? 'font-black text-zinc-900' : 'text-zinc-600'}>{k}</span>
      <b className={`text-right ${cor ?? 'text-zinc-900'} ${forte ? 'font-black' : ''}`}>{v}</b>
    </div>
  );
}

function ContaDinheiro({ d, totalRetiradas, esperado, contado, ver, onVer, semBorda }: {
  d: Dinheiro; totalRetiradas: number; esperado: number; contado: number; ver: boolean; onVer: () => void; semBorda?: boolean;
}) {
  return (
    <div className={semBorda ? '' : 'mt-3 border border-stone-200 rounded-2xl px-4 py-1'}>
      <Linha k="Troco da abertura" v={fmtBRL(d.abertura)} />
      <Linha k={`+ Vendas em dinheiro (${d.nVendas})`} v={fmtBRL(d.vendas)} />
      {d.suprimentos > 0 && <Linha k="+ Suprimentos" v={fmtBRL(d.suprimentos)} />}
      <div className="flex justify-between gap-3 py-2 border-t border-stone-100 text-sm">
        <span className="text-zinc-600">
          − Retiradas ({d.retiradas.length})
          {d.retiradas.length > 0 && (
            <button onClick={onVer} className="ml-2 text-xs font-bold text-amber-700 hover:underline cursor-pointer">{ver ? 'esconder' : 'ver'}</button>
          )}
        </span>
        <b className="text-zinc-900">{fmtBRL(totalRetiradas)}</b>
      </div>
      {ver && d.retiradas.length > 0 && (
        <div className="bg-stone-50 rounded-xl px-3 py-1 mb-2">
          {d.retiradas.map((r, i) => (
            <div key={i} className="flex justify-between gap-3 py-1.5 text-xs text-zinc-600 border-t border-stone-100 first:border-t-0">
              <span className="truncate">{r.hora} · {r.motivo}</span><b>{fmtBRL(r.valor)}</b>
            </div>
          ))}
        </div>
      )}
      <Linha k="= Devia ter na gaveta" v={fmtBRL(esperado)} forte />
      <Linha k="Contado" v={fmtBRL(contado)} forte />
    </div>
  );
}
