// "Em qual loja você vai trabalhar agora?" — folha por cima da tela (casca nova e página nova de Módulos,
// 2026-10-05). Desenho aprovado: docs/prototipos/sistema-proposta.html › telas/casca.js › 'trocar-loja'.
// Todos os "Trocar de loja" da casca nova chamam abrirTrocarLoja() (trocaLojaEstado.ts); a folha mora em
// CascaLayout e em ModulosNova.
//
// Dados (leitura leve, só com a folha aberta): lojas e cargo da pessoa (get_user_tenants), aberta/R$/pedidos pelo
// dia da loja (useLojasComparar = fn_lojas_comparar, uma chamada para todas) e "precisam de você" (hojeStore, a
// mesma leitura da Hoje e do número do topo). Montagem e ordem: src/lib/trocaLoja.ts.
//
// Entrar: a mesma troca do AuthContext que a Hoje, o Comparar lojas e o assistente usam (selectTenant), sem passar
// por /selecionar-loja e sem apagar a moldura. Enquanto troca, a casca desmonta a tela da loja anterior (estado
// `trocando`, CascaLayout); depois vai para '/' (o começo do papel, tela montada do zero) e avisa. Os contexts
// (pedidos, sessão, pendências, canais ao vivo) já recarregam pela troca de user.tenantId, como na Hoje.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth, DB_TO_FRONTEND_ROLE } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useLojasComparar } from '@/hooks/useLojasComparar';
import { rotuloComparacao, totalLojas } from '@/lib/lojasComparar';
import { brl, Variacao } from '@/pages/lojas/components/ui';
import { usePendenciasHoje } from '@/pages/hoje/hojeStore';
import { podeSair } from '@/lib/guardaSaida';
import { getLojaAtiva } from '@/lib/lojaAtiva';
import { Folha, btn } from '@/components/kit';
import { linhaVendas, montarCartoesLoja, type CartaoLoja, type LeituraLoja, type LojaDaPessoa } from '@/lib/trocaLoja';
import { useSessao } from '@/contexts/SessaoContext';
import { Bolinha, perfilLabel } from './partes';
import { mudarTroca as mudar, useTrocaLoja } from './trocaLojaEstado';

const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
});
const rotuloCargo = (role: string) => perfilLabel[role] ?? role;

function CartaoTroca({ c, principal, ocupado, onEntrar, onFicar }: {
  c: CartaoLoja; principal: boolean; ocupado: string | null; onEntrar: () => void; onFicar: () => void;
}) {
  const vendas = linhaVendas(c);
  const eu = ocupado === c.tenantId;
  return (
    <div className={`flex gap-3 items-center rounded-[18px] border p-3 mb-2.5 ${c.aqui ? 'border-[#F6DDB0] bg-gradient-to-b from-[#FFF8EB] to-white' : 'border-[#EEE6DA] bg-white'}`}>
      <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0 text-[22px] ${c.teste ? 'bg-blue-50 text-blue-600' : 'bg-[#FFF4E0] text-[#C2700A]'}`}>
        <i className={c.teste ? 'ri-graduation-cap-line' : 'ri-store-2-line'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <b className="text-[14.5px] font-extrabold text-[#1F1A14] leading-tight">{c.nome}</b>
          {c.aqui && <span className="text-[10.5px] font-bold rounded-md px-1.5 py-0.5 bg-amber-50 text-amber-700 whitespace-nowrap">Você está aqui</span>}
          {c.teste && <span className="text-[10.5px] font-bold rounded-md px-1.5 py-0.5 bg-blue-50 text-blue-600 whitespace-nowrap">{c.treino ? 'Loja de teste · modo treino' : 'Loja de teste'}</span>}
          {c.semPdv && <span className="text-[10.5px] font-bold rounded-md px-1.5 py-0.5 bg-sky-100 text-sky-700 whitespace-nowrap">sem PDV</span>}
        </div>
        {c.aberta !== null && (
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#5B5248] mt-0.5">
            <Bolinha aberta={c.aberta} />
            {c.aberta ? (c.desde ? `Aberta desde ${c.desde}` : 'Aberta') : 'Fechada'}
          </div>
        )}
        {vendas && <div className="text-[11.5px] text-[#9A9086] mt-0.5 leading-snug tabular-nums">{vendas}</div>}
        {c.precisam > 0 && (
          <span className="inline-block mt-1.5 text-[11.5px] font-bold rounded-full px-2.5 py-0.5 bg-red-50 text-red-600">
            {c.precisam} {c.precisam === 1 ? 'precisa' : 'precisam'} de você
          </span>
        )}
        <div className="text-[11px] text-[#9A9086] font-semibold mt-1">Seu cargo aqui: {c.cargo}</div>
      </div>
      {c.aqui ? (
        <button type="button" onClick={onFicar} disabled={!!ocupado} className={`${btn('out', 'sm')} flex-shrink-0 min-w-[76px]`}>Ficar aqui</button>
      ) : (
        <button type="button" onClick={onEntrar} disabled={!!ocupado} className={`${btn(principal ? 'p' : 'out', 'sm')} flex-shrink-0 min-w-[76px]`}>
          {eu ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : 'Entrar'}
        </button>
      )}
    </div>
  );
}

function ConteudoTroca({ onFechar }: { onFechar: () => void }) {
  const { user, selectTenant } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { estado: estadoSessao, sessao } = useSessao();
  const { lojas: comparadas, carregando: carregandoComparar, erro: erroComparar } = useLojasComparar('hoje', true, 1);
  const { itens } = usePendenciasHoje();
  const [lojas, setLojas] = useState<LojaDaPessoa[] | null>(null);
  const [erroLojas, setErroLojas] = useState<string | null>(null);
  const [mostrarEscondidas, setMostrarEscondidas] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [cansou, setCansou] = useState(false);

  // As lojas da pessoa e o cargo em cada uma (a lista do AuthContext fica vazia depois de escolher a loja).
  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    supabase.rpc('get_user_tenants', { p_user_id: user.id }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setErroLojas(error.message); setLojas([]); return; }
      setLojas(((data as Record<string, unknown>[] | null) ?? []).map((t) => ({
        tenantId: t.tenant_id as string,
        nome: (t.tenant_name as string) ?? 'Loja',
        role: DB_TO_FRONTEND_ROLE[t.role as string] ?? (t.role as string),
        trainingMode: (t.training_mode as boolean) ?? false,
        kind: (t.kind as string) ?? 'loja',
      })));
    });
    return () => { vivo = false; };
  }, [user?.id]);

  // Não segura a folha por causa dos números: em 4 s mostra o que já chegou.
  useEffect(() => { const t = setTimeout(() => setCansou(true), 4000); return () => clearTimeout(t); }, []);

  const { visiveis, escondidas } = useMemo(() => {
    const leituras = new Map<string, LeituraLoja>();
    for (const l of comparadas) {
      leituras.set(l.tenantId, {
        aberta: !!l.agora.caixa,
        desde: l.agora.caixa?.desde ? horaCurta(l.agora.caixa.desde) : null,
        faturamento: l.atual.faturamento,
        pedidos: l.atual.pedidos,
        oculta: l.oculta,
      });
    }
    const precisam = new Map<string, number>();
    for (const i of itens ?? []) if (i.bloco === 'agora') precisam.set(i.tenantId, (precisam.get(i.tenantId) ?? 0) + 1);
    return montarCartoesLoja({
      lojas: lojas ?? [],
      leituras,
      precisam,
      atualId: user?.tenantId,
      rotuloCargo,
      // Loja atual sem leitura do Comparar (a pessoa não vê o Dashboard dela): o caixa vem da sessão, como no chip do topo.
      estadoAtual: { aberta: estadoSessao !== 'sem_sessao', desde: estadoSessao !== 'sem_sessao' ? sessao?.iniciadaEm ?? null : null },
    });
  }, [comparadas, itens, lojas, user?.tenantId, estadoSessao, sessao?.iniciadaEm]);

  const pronto = lojas !== null && (cansou || ((!carregandoComparar || !!erroComparar) && itens !== null));
  const veComparar = comparadas.length >= 2;
  // As lojas juntas hoje (as mesmas do "Suas lojas agora": sem as escondidas e as paradas).
  const juntas = useMemo(() => comparadas.filter((l) => !l.oculta && !l.parada), [comparadas]);
  const total = useMemo(() => totalLojas(juntas), [juntas]);
  const primeiroOutro = visiveis.find((c) => !c.aqui)?.tenantId ?? null;

  const entrar = useCallback(async (c: CartaoLoja) => {
    if (ocupado) return;
    if (c.aqui) { onFechar(); return; }
    // Algo sem salvar na tela: pergunta antes (como o topo já fazia).
    if (!(await podeSair())) return;
    setOcupado(c.tenantId);
    mudar({ trocando: { tenantId: c.tenantId, nome: c.nome } });
    try {
      await selectTenant(c.tenantId);
    } catch (e) {
      console.error('[TrocarLoja]', e);
    }
    // selectTenant sem sucesso desloga e limpa a loja ativa: aí não há "agora você está".
    const entrou = getLojaAtiva() === c.tenantId;
    if (entrou) navigate('/');
    mudar({ aberta: false, trocando: null });
    setOcupado(null);
    if (entrou) toast.success(`Agora você está na ${c.nome}`);
  }, [ocupado, onFechar, selectTenant, navigate, toast]);

  const irComparar = async () => {
    if (!(await podeSair())) return;
    onFechar();
    navigate('/lojas');
  };

  return (
    <Folha
      aberta
      titulo="Em qual loja você vai trabalhar agora?"
      subtitulo="As que mais precisam de você vêm primeiro"
      onFechar={ocupado ? () => {} : onFechar}
      rodape={veComparar ? (
        <button type="button" onClick={irComparar} disabled={!!ocupado} className={`${btn('out')} w-full`}>
          <i className="ri-bar-chart-grouped-line" />Comparar as lojas
        </button>
      ) : undefined}
    >
      {!pronto ? (
        <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="pb-2">
          {veComparar && juntas.length > 0 && (
            <button type="button" onClick={irComparar} disabled={!!ocupado}
              className="w-full text-left rounded-[18px] bg-[#1F1A14] text-white p-3.5 mb-3 active:scale-[.99] transition-transform">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-[.1em] text-white/60">
                  {juntas.length === 1 ? 'Sua loja hoje' : `Suas ${juntas.length} lojas juntas hoje`}
                </span>
                <span className="text-[11.5px] font-bold text-amber-300 whitespace-nowrap">Comparar <i className="ri-arrow-right-s-line" /></span>
              </div>
              <div className="flex items-end gap-2 flex-wrap mt-1">
                <span className="text-[26px] leading-none font-black tracking-tight tabular-nums">{brl(total.faturamento)}</span>
                <Variacao pct={total.variacao} escuro titulo={total.variacao === null ? 'Uma das lojas não tem base de comparação' : undefined} />
              </div>
              <div className="text-[11.5px] text-white/60 mt-1 tabular-nums">
                {total.pedidos} {total.pedidos === 1 ? 'pedido' : 'pedidos'}
                {total.pedidos > 0 && <> · tíquete {brl(total.ticket)}</>}
                {' · '}{total.abertas} {total.abertas === 1 ? 'aberta' : 'abertas'}
                {juntas[0] && <> · {rotuloComparacao('hoje', juntas[0])}</>}
              </div>
            </button>
          )}
          {erroLojas && <p className="text-[12px] text-red-600 mb-2">Não consegui ler as suas lojas agora. Tente de novo em instantes.</p>}
          {visiveis.map((c) => (
            <CartaoTroca key={c.tenantId} c={c} principal={c.tenantId === primeiroOutro} ocupado={ocupado}
              onEntrar={() => { void entrar(c); }} onFicar={onFechar} />
          ))}
          {escondidas.length > 0 && (
            <>
              <div className="flex gap-3 items-center rounded-[18px] border-[1.5px] border-dashed border-[#DCD2C4] bg-[#FDFBF7] p-3 mb-2.5">
                <div className="w-11 h-11 rounded-[14px] bg-[#F4EFE7] text-[#5B5248] flex items-center justify-center flex-shrink-0 text-[21px]">
                  <i className="ri-eye-off-line" />
                </div>
                <div className="flex-1 min-w-0">
                  <b className="block text-[13.5px] font-extrabold text-[#1F1A14]">
                    {escondidas.length} {escondidas.length === 1 ? 'loja escondida' : 'lojas escondidas'} por você
                  </b>
                  <span className="block text-[11.5px] text-[#9A9086] leading-snug mt-px">Você as tirou da lista no Comparar lojas.</span>
                </div>
                <button type="button" onClick={() => setMostrarEscondidas((v) => !v)} className={`${btn('out', 'sm')} flex-shrink-0`}>
                  {mostrarEscondidas ? 'Recolher' : 'Mostrar'}
                </button>
              </div>
              {mostrarEscondidas && escondidas.map((c) => (
                <CartaoTroca key={c.tenantId} c={c} principal={false} ocupado={ocupado}
                  onEntrar={() => { void entrar(c); }} onFicar={onFechar} />
              ))}
            </>
          )}
        </div>
      )}
    </Folha>
  );
}

/** Mora uma vez na tela (CascaLayout, ModulosNova). Só lê alguma coisa com a folha aberta. */
export default function TrocarLojaFolha() {
  const { aberta } = useTrocaLoja();
  const fechar = useCallback(() => mudar({ aberta: false }), []);
  if (!aberta) return null;
  return <ConteudoTroca onFechar={fechar} />;
}
