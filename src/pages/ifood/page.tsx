import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useIfoodDados } from './lib/useIfoodDados';
import { supabase } from '@/lib/supabase';
import { custoDoItem } from '@/lib/ifoodArea';
import type { AbaIfood, AcessoIfood, AbaProps } from './lib/tipos';
import IfoodCabecalho from './components/Cabecalho';
import PeriodoIfoodFolha from './components/PeriodoFolha';
import PedidoIfoodFolha from './components/PedidoIfoodFolha';
import HojeAba from './components/HojeAba';
import PedidosAba from './components/PedidosAba';
import ItensAba from './components/ItensAba';
import DinheiroAba from './components/DinheiroAba';
import ResultadosAba from './components/ResultadosAba';
import LojaAba from './components/LojaAba';
import ConexaoAba from './components/ConexaoAba';

// Área iFood (2026-10-05, aprovada pelo dono: docs/prototipos/ifood-proposta.html). Um lugar só para os
// pedidos, os itens e o custo, o dinheiro, os resultados e a loja no iFood. Antes isso estava espalhado
// em Financeiro › iFood, Relatórios › iFood e três janelas do Gestor de Entregas.

const ABAS: AbaIfood[] = ['hoje', 'pedidos', 'itens', 'dinheiro', 'resultados', 'loja', 'conexao'];
/** Período padrão de cada aba (Hoje é sempre hoje; Loja e Conectar não têm período). */
const PERIODO_PADRAO: Partial<Record<AbaIfood, string>> = { pedidos: 'Hoje', itens: '30 dias', dinheiro: 'Este mês', resultados: '30 dias' };

export default function IfoodPage() {
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const tenantId = user?.tenantId ?? '';
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get('aba') as AbaIfood | null;
  const aba: AbaIfood = abaUrl && ABAS.includes(abaUrl) ? abaUrl : 'hoje';
  const [periodos, setPeriodos] = useState<Partial<Record<AbaIfood, string>>>(PERIODO_PADRAO);
  const [loja, setLoja] = useState<string | null>(null);
  const [periodoAberto, setPeriodoAberto] = useState(false);
  const pedidoAberto = params.get('pedido');

  const perfil = user?.perfil ?? '';
  const admin = perfil === 'admin';
  const acesso: AcessoIfood = useMemo(() => {
    const tem = (k: Parameters<typeof hasPermissao>[0]) => admin || hasPermissao(k);
    const fin = tem('fin_ifood');
    const rel = tem('rel_ifood');
    return {
      dinheiro: fin || rel,
      financeiro: fin,
      itens: fin || rel || tem('rel_cmv') || tem('cardapio_editar'),
      ligar: admin || perfil === 'gerente' || perfil === 'financeiro',
      resultados: fin || rel,
      configurar: admin || perfil === 'gerente',
    };
  }, [admin, perfil, hasPermissao]);

  const podeAba = (a: AbaIfood) =>
    a === 'dinheiro' ? acesso.financeiro
      : a === 'itens' ? acesso.itens
      : a === 'resultados' ? acesso.resultados
      : a === 'conexao' ? acesso.configurar
      : true;
  const abaEfetiva: AbaIfood = podeAba(aba) ? aba : 'hoje';

  const periodo = abaEfetiva === 'hoje' || !PERIODO_PADRAO[abaEfetiva] ? 'Hoje' : (periodos[abaEfetiva] ?? PERIODO_PADRAO[abaEfetiva]!);
  const dados = useIfoodDados(tenantId || undefined, periodo);

  // Bolinha da aba "Itens e CMV": itens do iFood vendidos nos últimos 30 dias ainda sem custo de ficha.
  const [vendidos30, setVendidos30] = useState<string[]>([]);
  useEffect(() => {
    if (!tenantId || !acesso.itens) { setVendidos30([]); return; }
    let vivo = true;
    supabase.rpc('fn_ifood_itens_vendidos', { p_tenant: tenantId, p_dias: 30 }).then(({ data }) => {
      if (!vivo) return;
      setVendidos30(((data ?? []) as Array<{ level: string; name: string; vendidos: number }>).filter((r) => r.level === 'item' && Number(r.vendidos) > 0).map((r) => r.name));
    });
    return () => { vivo = false; };
  }, [tenantId, acesso.itens, dados.custos]);
  const nItensSemFicha = useMemo(() => vendidos30.filter((n) => custoDoItem(dados.custos, n)?.custo == null).length, [vendidos30, dados.custos]);

  // Loja escolhida que sumiu da lista (troca de loja do ERPOS): volta para "todas".
  useEffect(() => { if (loja && !dados.lojas.some((l) => l.id === loja)) setLoja(null); }, [dados.lojas, loja]);

  const irPara = (a: AbaIfood, extra?: Record<string, string>) => {
    const p = new URLSearchParams();
    if (a !== 'hoje') p.set('aba', a);
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    setParams(p);
  };
  const abrirPedido = (id: string) => { const p = new URLSearchParams(params); p.set('pedido', id); setParams(p); };
  const fecharPedido = () => { const p = new URLSearchParams(params); p.delete('pedido'); setParams(p, { replace: true }); };

  if (!tenantId) return null;

  const props: AbaProps = { tenantId, loja, lojas: dados.lojas, periodo, acesso, dados, irPara, abrirPedido };
  const temPeriodo = !!PERIODO_PADRAO[abaEfetiva];

  return (
    <div className="flex flex-col h-full">
      <IfoodCabecalho
        aba={abaEfetiva}
        onAba={(a) => irPara(a)}
        podeAba={podeAba}
        lojas={dados.lojas}
        loja={loja}
        onLoja={setLoja}
        rotuloPeriodo={temPeriodo ? periodo : null}
        onAbrirPeriodo={() => setPeriodoAberto(true)}
        configurar={acesso.configurar}
        nItensSemFicha={nItensSemFicha}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto pb-16">
          {abaEfetiva === 'hoje' && <HojeAba {...props} />}
          {abaEfetiva === 'pedidos' && <PedidosAba {...props} />}
          {abaEfetiva === 'itens' && <ItensAba {...props} />}
          {abaEfetiva === 'dinheiro' && <DinheiroAba {...props} />}
          {abaEfetiva === 'resultados' && <ResultadosAba {...props} />}
          {abaEfetiva === 'loja' && <LojaAba {...props} />}
          {abaEfetiva === 'conexao' && <ConexaoAba {...props} />}
        </div>
      </div>
      <PeriodoIfoodFolha
        aberta={periodoAberto}
        onFechar={() => setPeriodoAberto(false)}
        periodo={periodo}
        onEscolher={(p) => { setPeriodos((s) => ({ ...s, [abaEfetiva]: p })); setPeriodoAberto(false); }}
      />
      <PedidoIfoodFolha
        tenantId={tenantId}
        id={pedidoAberto}
        pedidos={dados.pedidos}
        lojas={dados.lojas}
        acesso={acesso}
        custos={dados.custos}
        onFechar={fecharPedido}
        onMudou={() => dados.recarregar()}
      />
    </div>
  );
}
