// Pendências da tela Hoje num lugar só (2026-10-03, "um número só"): a tela e o número do topo
// (BotaoPendencias) leem a MESMA leitura — uma consulta a cada 60 s com a tela visível, não uma por
// componente. Pendências de TODAS as lojas da pessoa (a RLS já limita às lojas dela), filtradas pelo
// papel dela em cada loja com a mesma regra da caixa de pendências (pendenciaVisivelPara).
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth, DB_TO_FRONTEND_ROLE } from '@/contexts/AuthContext';
import { usePendencias } from '@/contexts/PendenciasContext';
import { todayBrasilia } from '@/lib/dateUtils';
import { DONO_EMAIL } from '../../../supabase/functions/_shared/pendencia-visivel';
import { organizarHoje, visivelNaHoje, pendHojeDaLinha, COLUNAS_PEND_HOJE, PORCAO_KINDS, type ItemHoje, type PendHoje } from './organizar';

interface Estado {
  pendencias: PendHoje[] | null;
  itens: ItemHoje[] | null;
  erro: string | null;
  hoje: string;
  /** papel da pessoa em cada loja (caixa numa, gerente noutra) */
  papeis: Map<string, string> | null;
  quando: number;
}

const VAZIO: Estado = { pendencias: null, itens: null, erro: null, hoje: todayBrasilia(), papeis: null, quando: 0 };
let estado: Estado = VAZIO;
let dono = '';
let carregando: Promise<void> | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

interface Quem { id: string; email: string | null; tenantId?: string | null; perfil?: string | null }

/**
 * Lê de novo (se a última leitura tem mais de `idadeMax` ms). Uma leitura por vez para todos.
 * `idadeMax = 0` é "acabei de mudar algo": se já havia leitura em andamento (começada antes da
 * mudança), espera ela e lê de novo — senão o cartão resolvido voltaria até a próxima volta.
 */
export async function recarregarHoje(quem: Quem | null, idadeMax = 0): Promise<void> {
  if (!quem?.id) return;
  if (dono !== quem.id) { estado = { ...VAZIO, hoje: todayBrasilia() }; dono = quem.id; avisar(); }
  if (Date.now() - estado.quando < idadeMax && estado.pendencias) return;
  if (carregando) {
    if (idadeMax > 0) return carregando;
    await carregando.catch(() => {});
    if (carregando) return carregando;
  }
  const eu = quem.id;
  carregando = (async () => {
    const dia = todayBrasilia();
    try {
      let papeis = estado.papeis;
      if (!papeis) {
        const { data, error } = await supabase.rpc('get_user_tenants', { p_user_id: quem.id });
        // Sem os papéis, as pendências das outras lojas sumiriam e a tela diria "tudo em dia": melhor
        // mostrar o erro e tentar de novo na próxima volta do que esconder trabalho (revisão 2026-10-03).
        if (error || !(data ?? []).length) throw new Error(error?.message ?? 'não consegui ler as suas lojas');
        papeis = new Map<string, string>();
        for (const t of (data ?? []) as Array<{ tenant_id: string; role: string }>) papeis.set(t.tenant_id, DB_TO_FRONTEND_ROLE[t.role] ?? t.role);
        if (quem.tenantId && quem.perfil) papeis.set(quem.tenantId, quem.perfil);
      }
      const ehDono = quem.email?.toLowerCase() === DONO_EMAIL;
      const mapa = papeis;
      // Mesma regra do servidor (bom dia, aviso no celular): _shared/hoje-organizar.ts › visivelNaHoje.
      const { data, error } = await supabase.from('pendencias')
        .select(COLUNAS_PEND_HOJE)
        .in('status', ['aberta', 'vista']).order('criada_em', { ascending: true }).limit(400);
      if (error) throw new Error(error.message);
      const pendencias: PendHoje[] = (data ?? [])
        .filter((r) => visivelNaHoje(r.kind, mapa.get(r.tenant_id), quem.email, ehDono))
        .map(pendHojeDaLinha);
      // Porções do dia: total de cada trabalho acumulado guardado pelo cron na 1ª volta do dia.
      const idsPorcao = pendencias.filter((p) => PORCAO_KINDS.has(p.kind)).map((p) => p.id);
      const porcoes = new Map<string, number>();
      if (idsPorcao.length) {
        const { data: pc } = await supabase.from('pendencias_porcao').select('pendencia_id, total_inicio').eq('dia', dia).in('pendencia_id', idsPorcao);
        for (const r of (pc ?? []) as Array<{ pendencia_id: string; total_inicio: number }>) porcoes.set(r.pendencia_id, Number(r.total_inicio));
      }
      // Trocou de usuário no meio da leitura (sair e entrar com outra pessoa): descarta.
      if (dono !== eu) return;
      estado = { pendencias, itens: organizarHoje(pendencias, dia, porcoes), erro: null, hoje: dia, papeis, quando: Date.now() };
    } catch (e) {
      if (dono !== eu) return;
      // Mantém o que já estava; a próxima volta tenta de novo.
      estado = { ...estado, pendencias: estado.pendencias ?? [], itens: estado.itens ?? [], erro: e instanceof Error ? e.message : String(e), hoje: dia, quando: Date.now() };
    } finally {
      carregando = null;
      avisar();
    }
  })();
  return carregando;
}

// Um relógio só para todos os que estão olhando (tela Hoje, número do topo).
let relogio: ReturnType<typeof setInterval> | null = null;
let quemAtual: Quem | null = null;
const tique = () => { if (!document.hidden) recarregarHoje(quemAtual, 30000); };

function inscrever(f: () => void) {
  ouvintes.add(f);
  if (!relogio) {
    relogio = setInterval(tique, 60000);
    document.addEventListener('visibilitychange', tique);
    window.addEventListener('focus', tique);
  }
  return () => {
    ouvintes.delete(f);
    if (!ouvintes.size && relogio) {
      clearInterval(relogio); relogio = null;
      document.removeEventListener('visibilitychange', tique);
      window.removeEventListener('focus', tique);
    }
  };
}

/** Pendências organizadas da tela Hoje (mesma leitura para a tela e para o número do topo). */
export function usePendenciasHoje() {
  const { user } = useAuth();
  // Outra pessoa entrou no mesmo aparelho (sem recarregar a página): nada do usuário anterior aparece,
  // nem por um instante — até a leitura dela chegar, é como se ainda não tivesse lido.
  const snap = useSyncExternalStore(inscrever, () => (user && dono === user.id ? estado : VAZIO));
  const quem: Quem | null = user ? { id: user.id, email: user.email ?? null, tenantId: user.tenantId, perfil: user.perfil } : null;
  useEffect(() => {
    quemAtual = quem;
    recarregarHoje(quem, 30000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.tenantId, user?.perfil]);
  // A caixa de pendências da loja ativa tem tempo real: quando ela muda (pendência nova, resolvida
  // em outra tela, aprovação decidida), a Hoje e o número do topo leem de novo em seguida.
  const { pendencias: daLojaAtiva } = usePendencias();
  useEffect(() => {
    if (quem && estado.quando) recarregarHoje(quem, 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daLojaAtiva]);
  return { ...snap, recarregar: () => recarregarHoje(quem, 0) };
}

/** Quantos cartões em "Agora" — o número do topo é o mesmo da tela Hoje. */
export function useContagemHoje(): { agora: number; urgente: boolean } {
  const { itens } = usePendenciasHoje();
  const agora = (itens ?? []).filter((i) => i.bloco === 'agora');
  return { agora: agora.length, urgente: agora.some((i) => i.urgente || i.ordem === '0000-00-00') };
}
