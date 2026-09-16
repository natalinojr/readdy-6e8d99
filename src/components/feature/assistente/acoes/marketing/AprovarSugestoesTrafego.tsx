// Ação rápida: sugestões pendentes do gestor de tráfego IA (sem IA aqui).
// Mesmo caminho da aba Tráfego Pago › Agente: meta-ads-agent list_actions {status:'sugerida'} e
// decide {action_id, decision}. APROVAR EXECUTA NA META (pausar, reativar, orçamento, criar campanha).
// Só o perfil admin decide (mesma regra da tela).
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, brl, dataBR, horaBR, type AcaoProps } from '../kit';

type Acao = {
  id: string; kind: string; level: string | null; target_name: string | null; params: Record<string, unknown>;
  reason: string | null; expected_impact: string | null; status: string; risk: string; created_at: string;
};
type Passo = 'carregando' | 'lista' | 'detalhe' | 'confirmar' | 'gravando' | 'fim';

const KIND: Record<string, string> = {
  pause: 'Pausar', resume: 'Reativar', set_budget: 'Ajustar orçamento', create_campaign: 'Criar campanha',
  rotate_creative: 'Trocar criativo', alert: 'Alerta',
};
const LEVEL: Record<string, string> = { account: 'conta', campaign: 'campanha', adset: 'conjunto', ad: 'anúncio' };

function titulo(a: Acao) {
  const p = a.params ?? {};
  const alvo = a.kind === 'create_campaign' ? String(p.campaign_name ?? '') : (a.target_name ?? '');
  return `${KIND[a.kind] ?? a.kind}${alvo ? `: ${alvo}` : ''}`;
}

function detalhe(a: Acao) {
  const p = a.params ?? {};
  const l = [`*${titulo(a)}*`];
  if (a.level && a.kind !== 'create_campaign') l.push(`Nível: ${LEVEL[a.level] ?? a.level}`);
  if (a.kind === 'set_budget' && typeof p.daily_budget === 'number') {
    l.push(`Orçamento: ${typeof p.previous === 'number' ? `${brl(p.previous)} → ` : ''}${brl(p.daily_budget)}/dia`);
  }
  if (a.kind === 'create_campaign') {
    l.push(`Objetivo: ${String(p.objetivo ?? '—')} · ${typeof p.daily_budget === 'number' ? `${brl(p.daily_budget)}/dia` : 'orçamento —'}`);
    if (p.item_name) l.push(`Prato: ${String(p.item_name)}`);
    if (p.headline) l.push(`Título: ${String(p.headline)}`);
    if (p.primary_text) l.push(`Texto: ${String(p.primary_text)}`);
  }
  if (a.reason) l.push(`Motivo: ${a.reason}`);
  if (a.expected_impact) l.push(`Esperado: ${a.expected_impact}`);
  l.push(`Risco ${a.risk} · ${dataBR(a.created_at)} ${horaBR(a.created_at)}`);
  return l.join('\n');
}

export default function AprovarSugestoesTrafego({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const isAdmin = user?.perfil === 'admin';
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [lista, setLista] = useState<Acao[]>([]);
  const [sel, setSel] = useState<Acao | null>(null);
  const [decisao, setDecisao] = useState<'aprovar' | 'rejeitar'>('aprovar');

  const carregar = async (primeira: boolean) => {
    setPasso('carregando');
    const { data, error } = await invokeWithAuth<{ success: boolean; actions: Acao[]; error?: string }>('meta-ads-agent', {
      body: { action: 'list_actions', tenant_id: tenantId, status: 'sugerida', limit: 80 },
    });
    if (error || !data?.success) { bot(`Não consegui carregar as sugestões: ${error?.message ?? data?.error ?? 'erro'}`); setPasso('fim'); return; }
    const pend = (data.actions ?? []).filter((a) => a.status === 'sugerida');
    setLista(pend);
    if (!pend.length) { bot(primeira ? `*${user?.loja}*\nNenhuma sugestão esperando você.` : 'Não há mais sugestões pendentes.'); setPasso('fim'); return; }
    bot(`${primeira ? `*${user?.loja}*\n` : ''}${pend.length} sugestão(ões) esperando. Toque numa para ver.${isAdmin ? '' : '\nSó o perfil admin pode aprovar ou rejeitar.'}`);
    setPasso('lista');
  };

  useEffect(() => {
    if (!tenantId) { bot('Escolha uma loja no app antes.'); setPasso('fim'); return; }
    carregar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = (a: Acao) => {
    setSel(a);
    eu(titulo(a));
    bot(detalhe(a));
    setPasso('detalhe');
  };

  const pedirConfirmacao = (d: 'aprovar' | 'rejeitar') => {
    const a = sel!;
    setDecisao(d);
    const dispensar = a.kind === 'rotate_creative';
    eu(d === 'rejeitar' ? (dispensar ? 'Dispensar' : 'Rejeitar') : (dispensar ? 'Vou providenciar' : 'Aprovar'));
    if (d === 'rejeitar') bot(`Rejeitar "${titulo(a)}"? Nada muda na Meta.`);
    else if (a.kind === 'create_campaign') bot('⚠️ Criar e ATIVAR esta campanha na Meta agora? Ela começa a gastar hoje.');
    else if (dispensar) bot('Marcar como "vou providenciar"? Nada é executado na Meta.');
    else bot(`⚠️ Executar "${KIND[a.kind] ?? a.kind}" em "${a.target_name ?? ''}" na Meta agora?`);
    setPasso('confirmar');
  };

  const decidir = async () => {
    const a = sel!;
    setPasso('gravando');
    const { data, error } = await invokeWithAuth<{ success: boolean; status?: string; error?: string | null }>('meta-ads-agent', {
      body: { action: 'decide', tenant_id: tenantId, action_id: a.id, decision: decisao },
    });
    if (!error && data?.status === 'falhou') {
      bot(`❌ A Meta recusou: ${data.error ?? 'erro'}\nA sugestão ficou como "falhou" na aba Agente.`);
    } else if (error || !data?.success) {
      bot(`❌ ${decisao === 'aprovar' ? 'Não consegui executar' : 'Não consegui rejeitar'}: ${error?.message ?? data?.error ?? 'erro'}\nConfira na aba Agente antes de tentar de novo.`);
    } else {
      const st = data.status ?? '';
      bot(decisao === 'rejeitar' ? '✅ Sugestão rejeitada.'
        : st === 'executada' ? '✅ Executada na Meta.'
        : st === 'falhou' ? `❌ A Meta recusou: ${data.error ?? 'erro'}`
        : `✅ Registrado (${st || 'ok'}).`);
    }
    setSel(null);
    await carregar(false);
  };

  return (
    <Roteiro titulo="Sugestões do tráfego" icone="ri-robot-2-line" cor="bg-amber-50 text-amber-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Enviando à Meta…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {lista.map((a) => <Opcao key={a.id} onClick={() => abrir(a)} detalhe={`risco ${a.risk}`}>{titulo(a)}</Opcao>)}
          <Fim onFechar={onFechar} acoes={[{ label: 'Abrir aba Agente', onClick: () => irPara('/trafego-pago#agente') }]} />
        </>
      )}
      {passo === 'detalhe' && sel && (
        <>
          {isAdmin && (
            <Opcao onClick={() => pedirConfirmacao('aprovar')}>{sel.kind === 'rotate_creative' ? 'Vou providenciar' : 'Aprovar e executar'}</Opcao>
          )}
          {isAdmin && <Opcao perigo onClick={() => pedirConfirmacao('rejeitar')}>{sel.kind === 'rotate_creative' ? 'Dispensar' : 'Rejeitar'}</Opcao>}
          <OpcaoNeutra onClick={() => { setSel(null); setPasso('lista'); }}>Voltar à lista</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && sel && (
        <>
          <Opcao perigo={decisao === 'aprovar' && sel.kind !== 'rotate_creative'} onClick={decidir}>
            {decisao === 'rejeitar' ? 'Sim, rejeitar' : sel.kind === 'rotate_creative' ? 'Sim, marcar' : 'Sim, executar na Meta'}
          </Opcao>
          <OpcaoNeutra onClick={() => { bot('Ok, nada foi feito.'); setPasso('detalhe'); }}>Não</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tráfego Pago', onClick: () => irPara('/trafego-pago#agente') }]} />}
    </Roteiro>
  );
}
