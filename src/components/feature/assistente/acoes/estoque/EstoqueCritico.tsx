// Ação rápida: insumos abaixo do mínimo (só leitura), pela regra única do estoque (fn_estoque_situacao,
// 2026-10-03) — o mesmo número do Início do Estoque, do Dashboard e da pendência. Antes contava também
// esgotado sem mínimo e insumo sem aviso.
// Resposta em PAINEL (2026-09-18): contagem em destaque + lista com zerado (vermelho)/acaba logo (âmbar).
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Fim, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';
import { supabase } from '@/lib/supabase';
import { mapearSituacao } from '@/lib/estoqueRegras';
import { rotuloUnidade, qtdBR } from './comum';

export default function EstoqueCritico({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const r = useRoteiro();
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { r.bot('Nenhuma loja ativa.'); setCarregando(false); return; }
      const { data, error } = await supabase.rpc('fn_estoque_situacao', { p_tenant_id: user.tenantId });
      setCarregando(false);
      if (error) { r.bot(`Não consegui ler o estoque: ${error.message}`); return; }
      const lista = mapearSituacao(data as Record<string, unknown>).insumos
        .filter((i) => i.abaixoMinimo)
        .sort((a, b) => Number(b.esgotado) - Number(a.esgotado) || (a.diasRestantes ?? 1e9) - (b.diasRestantes ?? 1e9));
      if (!lista.length) { r.bot(`*${user.loja}*\nNenhum insumo abaixo do mínimo.`); return; }
      const criticos = lista.filter((i) => i.esgotado).length;
      r.painel(
        <Painel titulo="Abaixo do mínimo" subtitulo={user.loja} rodape={lista.length > 40 ? `… e mais ${lista.length - 40}. Veja no Estoque.` : undefined}>
          <Kpis principal={{ label: 'Abaixo do mínimo', valor: String(lista.length) }} outros={[{ label: 'Zerados', valor: String(criticos) }]} />
          <Linhas itens={lista.slice(0, 40).map((i) => {
            const u = rotuloUnidade(i.unidade);
            const zerado = i.esgotado;
            const critico = !zerado && i.diasRestantes != null && i.diasRestantes <= 3;
            return {
              label: i.nome,
              detalhe: `mín ${qtdBR(i.minimo)} ${u}${i.marcadoEsgotado && i.estoque > 0 ? ' · marcado esgotado' : ''}${critico ? ` · acaba em ~${Math.max(1, Math.round(i.diasRestantes!))}d` : ''}`,
              valor: `${qtdBR(i.estoque)} ${u}`,
              status: zerado ? ('perigo' as const) : critico ? ('alerta' as const) : ('neutro' as const),
            };
          })} />
        </Painel>,
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Estoque crítico" icone="ri-alarm-warning-line" cor="bg-amber-50 text-amber-600"
      baloes={r.baloes} carregando={carregando} textoCarregando="Lendo o estoque…" onFechar={onFechar}>
      {!carregando && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir lista de compras', onClick: () => irPara('/estoque') }]} />}
    </Roteiro>
  );
}
