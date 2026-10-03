// Rotina do dia na tela Hoje (2026-10-03). Uma leitura (fn_rotina_dados) para todas as lojas da pessoa;
// a decisão (vale hoje? feito? mais tarde?) é a de supabase/functions/_shared/rotina.ts — a mesma do bom
// dia da equipe no assistente-cron. Confere a cada 60 s com a tela visível, como o resto da Hoje.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePendenciasHoje } from '../hojeStore';
import {
  contagemDaLoja, insumosDaSituacao, papeisAbaixo, papeisDaPessoa, precisaSituacao, resumoRotina, rotinaDeHoje,
  type ContagemRotina, type DadosRotina, type EstadoItem, type LojaRotina, type PapelRotina, type ResumoRotina,
} from '../../../../supabase/functions/_shared/rotina';
import type { ItemContavel } from '../../../../supabase/functions/_shared/estoque-planos';
import { loginCompartilhado } from './loginCompartilhado';

export interface RotinaDaLoja {
  tenantId: string;
  loja: string;
  papel: string | null;
  /** o que a pessoa faz hoje nesta loja (conta para o "Tudo em dia") */
  meus: EstadoItem[];
  /** o que está abaixo dela na hierarquia (só acompanha; pode marcar por alguém) */
  abaixo: Array<{ papel: PapelRotina; estados: EstadoItem[] }>;
  /** para quem pode criar "tarefa de hoje" */
  podeCriarPara: PapelRotina[];
  /** só o admin configura o que se repete */
  podeConfigurar: boolean;
}

export interface Rotina {
  carregando: boolean;
  erro: string | null;
  hoje: string;
  agora: string;
  lojas: RotinaDaLoja[];
  /** só o que é da pessoa, em todas as lojas */
  resumo: ResumoRotina;
  compartilhado: boolean;
  recarregar: () => Promise<void>;
}

const SITUACAO_MS = 5 * 60_000;

export function useRotinaHoje(): Rotina {
  const { user } = useAuth();
  const { papeis } = usePendenciasHoje();
  const [dados, setDados] = useState<DadosRotina | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Situação do estoque (só para lojas com contagem pelos planos), guardada por 5 min.
  const situacoes = useRef(new Map<string, { em: number; insumos: ItemContavel[] }>());
  const [, setVersao] = useState(0);
  // Só a leitura mais nova vale: uma volta de 60 s que termina depois de "marcar" não traz a lista antiga.
  const seq = useRef(0);
  const compartilhado = loginCompartilhado(user?.email);
  const ids = useMemo(() => (papeis ? [...papeis.keys()].sort() : null), [papeis]);
  const chave = ids?.join(',') ?? '';

  const carregar = useCallback(async (forcarSituacao = false) => {
    if (!ids?.length) return;
    const minha = ++seq.current;
    const { data, error } = await supabase.rpc('fn_rotina_dados', { p_tenant_ids: ids });
    if (minha !== seq.current) return;
    if (error) { setErro(error.message); return; }
    const d = data as DadosRotina;
    const precisa = (d.lojas ?? []).filter(precisaSituacao)
      .filter((l) => forcarSituacao || Date.now() - (situacoes.current.get(l.tenant_id)?.em ?? 0) > SITUACAO_MS);
    let semSituacao = '';
    await Promise.all(precisa.map(async (l) => {
      const r = await supabase.rpc('fn_estoque_situacao', { p_tenant_id: l.tenant_id });
      if (!r.error) situacoes.current.set(l.tenant_id, { em: Date.now(), insumos: insumosDaSituacao(r.data) });
      // Sem a situação do estoque não dá para saber se a contagem do plano foi feita: avisa (e não diz
      // "tudo em dia") em vez de sumir com o item calado.
      else if (!situacoes.current.has(l.tenant_id)) semSituacao = `não consegui conferir a contagem do estoque (${l.loja})`;
    }));
    if (minha !== seq.current) return;
    setErro(semSituacao || null);
    setDados(d);
    setVersao((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 60_000);
    const voltou = () => { if (!document.hidden) carregar(); };
    document.addEventListener('visibilitychange', voltou);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', voltou); };
  }, [carregar]);

  const lojas = useMemo<RotinaDaLoja[]>(() => {
    if (!dados) return [];
    return (dados.lojas ?? []).map((l: LojaRotina) => {
      const sit = situacoes.current.get(l.tenant_id);
      const contagem: ContagemRotina | undefined = precisaSituacao(l) && sit ? contagemDaLoja(l.fatos.planos, sit.insumos, dados.hoje) : undefined;
      const ctx = { hoje: dados.hoje, agora: dados.agora, dow: dados.dow, contagem };
      const abaixo = papeisAbaixo(l.papel);
      return {
        tenantId: l.tenant_id,
        loja: l.loja,
        papel: l.papel,
        meus: rotinaDeHoje(l, papeisDaPessoa(l.papel, compartilhado), ctx),
        abaixo: abaixo.map((p) => ({ papel: p, estados: rotinaDeHoje(l, [p], ctx) })).filter((g) => g.estados.length > 0),
        podeCriarPara: abaixo,
        podeConfigurar: l.papel === 'admin',
      };
    });
    // situacoes muda junto com dados (setVersao)
  }, [dados, compartilhado]);

  const resumo = useMemo(() => resumoRotina(lojas.flatMap((l) => l.meus)), [lojas]);

  return {
    // Sem as lojas ainda (ids null) também é "carregando": a Hoje não pode dizer "tudo em dia" antes de ler a rotina.
    carregando: !erro && !dados && (ids === null || ids.length > 0),
    erro,
    hoje: dados?.hoje ?? '',
    agora: dados?.agora ?? '',
    lojas,
    resumo,
    compartilhado,
    recarregar: () => carregar(true),
  };
}

// ── Escritas (todas por RPC; quem marcou é o servidor que grava) ─────────────────────────────────────
export interface QuemFezEscolha { userId?: string; freelancerId?: string; nome?: string }

export async function marcarItem(itemId: string, quem?: QuemFezEscolha): Promise<void> {
  const { error } = await supabase.rpc('fn_rotina_marcar', {
    p_item_id: itemId, p_pessoa_user_id: quem?.userId ?? null, p_freelancer_id: quem?.freelancerId ?? null, p_pessoa_nome: quem?.nome ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function desmarcarItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('fn_rotina_desmarcar', { p_item_id: itemId });
  if (error) throw new Error(error.message);
}

export interface ItemParaSalvar {
  id?: string | null;
  tenantId: string;
  papel: PapelRotina;
  titulo: string;
  tipo: string;
  dias?: number[] | null;
  diasPlano?: boolean;
  hora?: string | null;
  atalho?: string | null;
  /** "só hoje" (ou outro dia) */
  dia?: string | null;
  receitaId?: string | null;
  quantidade?: string | null;
}

export async function salvarItem(i: ItemParaSalvar): Promise<string> {
  const { data, error } = await supabase.rpc('fn_rotina_salvar_item', {
    p_tenant_id: i.tenantId, p_papel: i.papel, p_titulo: i.titulo, p_tipo: i.tipo, p_dias: i.dias ?? null,
    p_dias_plano: !!i.diasPlano, p_hora: i.hora || null, p_atalho: i.atalho || null, p_dia: i.dia ?? null,
    p_receita_id: i.receitaId ?? null, p_quantidade: i.quantidade ?? null, p_id: i.id ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function apagarItem(id: string): Promise<void> {
  const { error } = await supabase.rpc('fn_rotina_apagar_item', { p_id: id });
  if (error) throw new Error(error.message);
}

export interface PessoaDaLoja { tipo: 'user' | 'freelancer'; id: string; nome: string; funcao: string | null; turno_hoje: boolean }

export async function pessoasDaLoja(tenantId: string): Promise<PessoaDaLoja[]> {
  const { data, error } = await supabase.rpc('fn_rotina_pessoas', { p_tenant_id: tenantId });
  if (error) throw new Error(error.message);
  return (data ?? []) as PessoaDaLoja[];
}
