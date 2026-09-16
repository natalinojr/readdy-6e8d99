// Ação rápida: insumos abaixo do mínimo (só leitura). Mesmo critério do painel AlertasReposicao:
// (mínimo > 0 e estoque ≤ mínimo) ou marcado como esgotado; ordena pelo mais crítico.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Fim, type AcaoProps } from '../kit';
import { lerInsumos, rotuloUnidade, qtdBR } from './comum';

export default function EstoqueCritico({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const r = useRoteiro();
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { r.bot('Nenhuma loja ativa.'); setCarregando(false); return; }
      const { insumos, erro } = await lerInsumos(user.tenantId);
      setCarregando(false);
      if (erro) { r.bot(`Não consegui ler o estoque: ${erro}`); return; }
      const lista = insumos
        .filter((i) => (i.minimo > 0 && i.estoque <= i.minimo) || i.esgotado)
        .sort((a, b) => a.estoque / Math.max(a.minimo, 1) - b.estoque / Math.max(b.minimo, 1));
      if (!lista.length) { r.bot(`*${user.loja}*\nNenhum insumo abaixo do mínimo.`); return; }
      const criticos = lista.filter((i) => i.estoque <= 0 || i.esgotado || i.estoque / Math.max(i.minimo, 1) <= 0.5).length;
      const linhas = lista.slice(0, 40).map((i) => {
        const u = rotuloUnidade(i.unidadeDb);
        const sinal = i.estoque <= 0 || i.esgotado ? 'ZERADO' : i.estoque / Math.max(i.minimo, 1) <= 0.5 ? 'crítico' : 'baixo';
        return `• ${i.nome}: ${qtdBR(i.estoque)} / mín ${qtdBR(i.minimo)} ${u} (${i.esgotado && i.estoque > 0 ? 'esgotado' : sinal})`;
      });
      r.bot([
        `*${user.loja}*`,
        `${lista.length} insumo(s) abaixo do mínimo · ${criticos} crítico(s)`,
        ...linhas,
        ...(lista.length > 40 ? [`… e mais ${lista.length - 40}. Veja no Estoque.`] : []),
      ].join('\n'));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Estoque crítico" icone="ri-alarm-warning-line" cor="bg-amber-50 text-amber-600"
      baloes={r.baloes} carregando={carregando} textoCarregando="Lendo o estoque…" onFechar={onFechar}>
      {!carregando && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Estoque', onClick: () => irPara('/estoque') }]} />}
    </Roteiro>
  );
}
