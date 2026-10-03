// Piloto automático (/hoje/piloto, 2026-10-03): o que o sistema faz sozinho, num lugar só.
// Pedido do dono: "sistema inteligente que conduz, ativo e pró-ativo" — e que dê confiança: mostra o
// que ele fez nos últimos 7 dias, o que roda sempre, e as regras que a pessoa ensinou (ligar/desligar
// e desfazer). Dinheiro nunca sai sozinho: pagar continua pedindo o PIN.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { usePendenciasHoje } from './hojeStore';
import { definirAutomacao, salvarModoRegra, type RegraLancamento } from './aprender';

interface Diario { id: string; tenant_id: string; chave: string; quando: string; titulo: string; detalhe: string | null; pendencia_ids: string[]; desfazer: string | null; desfeito_em: string | null }
interface Automacao { id: string; tenant_id: string; chave: string; alvo: string; ligada: boolean; origem: string; atualizada_em: string }
interface Dados {
  banco: { sozinho: number; mao: number };
  fechadas: number;
  diario: Diario[];
  automacoes: Automacao[];
  regras: RegraLancamento[];
  lojas: Map<string, string>;
}

// O que roda sempre, sem ninguém pedir (conferido no código: assistente-cron, crons do banco e edges).
const SEMPRE: Array<{ icone: string; titulo: string; quando: string }> = [
  { icone: 'ri-bank-line', titulo: 'Confere o extrato do banco com as maquininhas, o iFood e as contas pagas', quando: 'todo dia às 7h' },
  { icone: 'ri-check-double-line', titulo: 'Dá baixa nas contas quando o valor do banco bate certinho', quando: 'todo dia às 7h30' },
  { icone: 'ri-flashlight-line', titulo: 'Lança os pagamentos das regras que estão em "lança sozinho"', quando: 'todo dia às 7h30' },
  { icone: 'ri-qr-code-line', titulo: 'Pix pago pelo Inter dá baixa na conta na hora', quando: 'na hora' },
  { icone: 'ri-price-tag-3-line', titulo: 'Classifica os itens das notas como você classificou da última vez', quando: 'quando a nota chega' },
  { icone: 'ri-close-circle-line', titulo: 'Fecha as pendências que se resolveram (boleto chegou, nota lançada, pagamento feito)', quando: 'a cada 30 min' },
  { icone: 'ri-sun-line', titulo: 'Resumo da manhã para o dono e bom dia para gerente e supervisão', quando: '7h30 e 8h30' },
  { icone: 'ri-notification-3-line', titulo: 'Avisa no celular do supervisor quando o caixa pede aprovação', quando: 'na hora' },
];

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export default function PilotoPage() {
  const navigate = useNavigate();
  const { papeis, erro: erroLojas } = usePendenciasHoje();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [verRecusadas, setVerRecusadas] = useState(false);

  // Só as lojas em que a pessoa é administradora ou gerente (as tabelas do piloto também só abrem para elas).
  const lojaIds = useMemo(() => [...(papeis ?? new Map()).entries()].filter(([, p]) => p === 'admin' || p === 'gerente').map(([id]) => id), [papeis]);
  const gestorEm = useCallback((t: string) => ['admin', 'gerente'].includes(papeis?.get(t) ?? ''), [papeis]);
  const semAcesso = !!papeis && lojaIds.length === 0;

  const carregar = useCallback(async () => {
    if (!lojaIds.length) return;
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const [resumo, diario, automacoes, regras, lojas] = await Promise.all([
      // contagens pelo banco: o extrato não tem leitura direta pelo app (fn_piloto_resumo)
      supabase.rpc('fn_piloto_resumo', { p_tenants: lojaIds, p_desde: desde }),
      supabase.from('automacoes_diario').select('id, tenant_id, chave, quando, titulo, detalhe, pendencia_ids, desfazer, desfeito_em')
        .in('tenant_id', lojaIds).gte('quando', new Date(Date.now() - 30 * 86400000).toISOString()).order('quando', { ascending: false }).limit(40),
      supabase.from('automacoes').select('id, tenant_id, chave, alvo, ligada, origem, atualizada_em').in('tenant_id', lojaIds).order('atualizada_em', { ascending: false }),
      // regras de lançamento: só pelo banco, e só das lojas em que a pessoa é administradora ou gerente
      supabase.rpc('fn_regras_lancamento_gestor', { p_tenants: lojaIds }),
      supabase.from('tenants').select('id, name').in('id', lojaIds),
    ]);
    const falha = [resumo, diario, automacoes, regras, lojas].find((r) => r.error)?.error;
    if (falha) { setErro(`Não consegui carregar: ${falha.message || 'sem permissão'}`); return; }
    setErro(null);
    const n = (resumo.data ?? {}) as { banco_sozinho?: number; banco_mao?: number; fechadas?: number };
    setDados({
      banco: { sozinho: Number(n.banco_sozinho ?? 0), mao: Number(n.banco_mao ?? 0) },
      fechadas: Number(n.fechadas ?? 0),
      diario: (diario.data ?? []) as Diario[],
      automacoes: (automacoes.data ?? []) as Automacao[],
      regras: (regras.data ?? []) as RegraLancamento[],
      lojas: new Map(((lojas.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name])),
    });
  }, [lojaIds]);

  useEffect(() => { carregar(); }, [carregar]);

  const agir = async (chave: string, fn: () => Promise<unknown>) => {
    setBusy(chave); setErro(null);
    // Recarrega mesmo se falhar: na regra de lançamento o modo pode ter mudado e só a 2ª gravação falhado.
    try { await fn(); } catch (e) { setErro((e instanceof Error ? e.message : String(e)) || 'Não deu certo — tente de novo.'); }
    finally { await carregar().catch(() => {}); setBusy(null); }
  };

  const varias = lojaIds.length > 1;
  const loja = (t: string) => (varias ? dados?.lojas.get(t) ?? '' : '');
  const ativos = dados?.diario.filter((d) => !d.desfeito_em) ?? [];
  const semBoleto = dados?.automacoes.filter((a) => a.chave === 'sem_boleto_fornecedor' && a.origem !== 'recusada') ?? [];
  const recusadas = dados?.automacoes.filter((a) => a.origem === 'recusada') ?? [];
  const totalBanco = dados ? dados.banco.sozinho + dados.banco.mao : 0;
  // Quantas pendências as regras fecharam (não quantas voltas do cron).
  const feitasSemana = ativos.filter((d) => Date.now() - new Date(d.quando).getTime() < 7 * 86400000).reduce((s, d) => s + (d.pendencia_ids?.length ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto pb-10 space-y-6">
      <header>
        <button onClick={() => navigate('/hoje')} className="text-[13px] font-bold text-amber-600 cursor-pointer"><i className="ri-arrow-left-line" /> Hoje</button>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-zinc-900">Piloto automático</h1>
        <p className="text-sm text-zinc-500 mt-0.5">O que o sistema faz sozinho por você. Tudo aqui pode ser desligado — e dinheiro nunca sai sem o seu PIN.</p>
      </header>

      {semAcesso && (
        <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-[13px] text-zinc-600">
          Esta tela é para administrador ou gerente da loja. <button onClick={() => navigate('/hoje')} className="font-bold text-amber-600 underline cursor-pointer">Voltar para a Hoje</button>
        </p>
      )}
      {!papeis && erroLojas && <p className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">Não consegui ler as suas lojas: {erroLojas}</p>}
      {erro && <p className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {!dados && !erro && !semAcesso && !(!papeis && erroLojas) && <div className="mx-auto my-10 w-7 h-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />}

      {dados && (
        <>
          {/* Últimos 7 dias */}
          <section>
            <h2 className="text-[15px] font-extrabold text-zinc-900 mb-2 px-0.5">Nos últimos 7 dias</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <Numero n={dados.banco.sozinho} texto={`linhas do extrato conferidas sozinho${totalBanco ? ` (de ${totalBanco})` : ''}`} sub={dados.banco.mao ? `${dados.banco.mao} precisaram de alguém` : 'nenhuma precisou de alguém'} />
              <Numero n={dados.fechadas} texto={dados.fechadas === 1 ? 'pendência fechou sozinha' : 'pendências fecharam sozinhas'} sub="o problema se resolveu e ela saiu da sua lista" />
              <Numero n={feitasSemana} texto={feitasSemana === 1 ? 'pendência fechada pelas suas regras' : 'pendências fechadas pelas suas regras'} sub="estão no diário abaixo" />
            </div>
          </section>

          {/* Diário */}
          <section>
            <h2 className="text-[15px] font-extrabold text-zinc-900 mb-2 px-0.5">Diário das suas regras <span className="text-[12px] font-normal text-zinc-400">últimos 30 dias</span></h2>
            {dados.diario.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-200 bg-white px-4 py-4 text-[13px] text-zinc-500">Nada ainda. Quando você ensinar uma regra (na Hoje, em "Aprendi com você"), o que ela fizer aparece aqui, com o botão de desfazer.</p>
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                {dados.diario.map((d) => (
                  <div key={d.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg ${d.desfeito_em ? 'bg-zinc-100 text-zinc-400' : 'bg-violet-50 text-violet-600'}`}><i className={d.desfeito_em ? 'ri-arrow-go-back-line' : 'ri-robot-2-line'} /></span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] font-semibold leading-snug ${d.desfeito_em ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{d.titulo}</p>
                      <p className="text-[11px] text-zinc-400">{dataHora(d.quando)}{loja(d.tenant_id) ? ` · ${loja(d.tenant_id)}` : ''}{d.detalhe ? ` · ${d.detalhe}` : ''}{d.desfeito_em ? ` · desfeito em ${dataHora(d.desfeito_em)}` : ''}</p>
                    </div>
                    {!d.desfeito_em && d.desfazer && gestorEm(d.tenant_id) && (
                      <button onClick={() => agir(d.id, async () => { const { error } = await supabase.rpc('fn_automacao_desfazer', { p_diario: d.id }); if (error) throw new Error(error.message); })}
                        disabled={busy === d.id} className="flex-shrink-0 h-8 px-3 rounded-lg border border-zinc-200 text-[12px] font-bold text-zinc-600 hover:border-zinc-300 disabled:opacity-60 cursor-pointer">
                        {busy === d.id ? '…' : 'Desfazer'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1.5 px-0.5 text-[11px] text-zinc-400">Desfazer volta o que a regra fechou e desliga a regra.</p>
          </section>

          {/* Regras ensinadas */}
          <section>
            <h2 className="text-[15px] font-extrabold text-zinc-900 mb-2 px-0.5">Regras que você ensinou</h2>
            <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
              {semBoleto.map((a) => (
                <LinhaRegra key={a.id} icone="ri-file-forbid-line" titulo={`Não cobrar boleto de ${a.alvo}`}
                  sub={`${a.origem === 'aprendida' ? 'Você ensinou' : 'Ajustada'} em ${dataHora(a.atualizada_em)}${loja(a.tenant_id) ? ` · ${loja(a.tenant_id)}` : ''}`}
                  ligada={a.ligada} pode={gestorEm(a.tenant_id)} ocupado={busy === a.id}
                  onTrocar={() => agir(a.id, () => definirAutomacao(a.tenant_id, 'sem_boleto_fornecedor', a.alvo, !a.ligada, 'manual'))} />
              ))}
              {dados.regras.map((r) => {
                const nome = r.supplier_name || r.counterpart_label || r.counterpart_doc || 'Regra';
                return (
                  <LinhaRegra key={r.id} icone="ri-flashlight-line" titulo={`Pagamentos de ${nome}`}
                    sub={`${r.mode === 'auto' ? 'Lança sozinho' : 'Só sugere — você confirma'} · acertou ${r.match_count ?? 0}×${loja(r.tenant_id) ? ` · ${loja(r.tenant_id)}` : ''}`}
                    ligada={r.mode === 'auto'} pode={gestorEm(r.tenant_id)} ocupado={busy === r.id}
                    onTrocar={() => agir(r.id, async () => {
                      const modo = r.mode === 'auto' ? 'suggest' : 'auto';
                      await salvarModoRegra(r, modo);
                      // a decisão manual vale como resposta: "Aprendi com você" não pergunta de novo
                      await definirAutomacao(r.tenant_id, 'regra_lancamento_auto', r.id, modo === 'auto', 'manual');
                    })} />
                );
              })}
              {semBoleto.length === 0 && dados.regras.length === 0 && (
                <p className="px-4 py-4 text-[13px] text-zinc-500">Nenhuma ainda. O sistema pergunta na Hoje quando perceber uma decisão que você repete.</p>
              )}
            </div>
            <p className="mt-1.5 px-0.5 text-[11px] text-zinc-400">
              As regras de lançamento completas (categoria, competência) ficam em{' '}
              <button onClick={() => navigate('/financeiro?tab=conciliacao')} className="font-semibold text-zinc-500 underline cursor-pointer">Financeiro › Conciliação</button>.
            </p>
            {recusadas.length > 0 && (
              <div className="mt-3">
                <button onClick={() => setVerRecusadas((v) => !v)} className="text-[12px] font-bold text-zinc-500 cursor-pointer">
                  {verRecusadas ? 'Esconder' : 'Ver'} {recusadas.length} {recusadas.length === 1 ? 'sugestão que você recusou' : 'sugestões que você recusou'}
                </button>
                {verRecusadas && (
                  <div className="mt-2 rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                    {recusadas.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                        <p className="flex-1 min-w-0 text-[13px] text-zinc-600">{a.chave === 'sem_boleto_fornecedor' ? `Continuar cobrando boleto de ${a.alvo}` : 'Continuar confirmando a regra de lançamento'}{loja(a.tenant_id) ? ` · ${loja(a.tenant_id)}` : ''}</p>
                        {gestorEm(a.tenant_id) && a.chave === 'sem_boleto_fornecedor' && (
                          <button onClick={() => agir(a.id, () => definirAutomacao(a.tenant_id, 'sem_boleto_fornecedor', a.alvo, true, 'manual'))} disabled={busy === a.id}
                            className="h-8 px-3 rounded-lg border border-zinc-200 text-[12px] font-bold text-violet-700 hover:border-violet-300 disabled:opacity-60 cursor-pointer">Mudei de ideia</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Sempre ligado */}
          <section>
            <h2 className="text-[15px] font-extrabold text-zinc-900 mb-2 px-0.5">Sempre ligado</h2>
            <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
              {SEMPRE.map((s) => (
                <div key={s.titulo} className="flex items-start gap-3 px-4 py-3">
                  <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><i className={s.icone} /></span>
                  <p className="flex-1 min-w-0 text-[13px] text-zinc-700 leading-snug">{s.titulo}</p>
                  <span className="flex-shrink-0 text-[11px] font-semibold text-zinc-400 mt-0.5">{s.quando}</span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 px-0.5 text-[11px] text-zinc-400">Pagar é sempre com você: o sistema prepara, você confirma com o PIN.</p>
          </section>
        </>
      )}
    </div>
  );
}

function Numero({ n, texto, sub }: { n: number; texto: string; sub: string }) {
  return (
    // No celular vira linha (número à esquerda) para os três caberem sem rolar; na tela larga, cartão.
    <div className="relative overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/50 px-4 py-3 sm:p-4 flex items-center gap-3 sm:block">
      <div className="absolute -right-8 -top-8 w-24 h-24 rounded-full bg-violet-100/70 pointer-events-none" />
      <p className="relative min-w-[56px] text-3xl font-extrabold text-violet-700 leading-none">{n}</p>
      <div className="relative min-w-0">
        <p className="sm:mt-1.5 text-[13px] font-bold text-zinc-800 leading-snug">{texto}</p>
        <p className="text-[11px] text-zinc-500">{sub}</p>
      </div>
    </div>
  );
}

function LinhaRegra({ icone, titulo, sub, ligada, pode, ocupado, onTrocar }: { icone: string; titulo: string; sub: string; ligada: boolean; pode: boolean; ocupado: boolean; onTrocar: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg ${ligada ? 'bg-violet-50 text-violet-600' : 'bg-zinc-100 text-zinc-400'}`}><i className={icone} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-zinc-800 leading-snug">{titulo}</p>
        <p className="text-[11px] text-zinc-400">{sub}</p>
      </div>
      <button role="switch" aria-checked={ligada} aria-label={ligada ? 'Desligar' : 'Ligar'} onClick={onTrocar} disabled={!pode || ocupado}
        title={pode ? undefined : 'Só administrador ou gerente da loja'}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${ligada ? 'bg-violet-600' : 'bg-zinc-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${ligada ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
