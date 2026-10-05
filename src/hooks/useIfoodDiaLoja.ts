import { useEffect, useState } from 'react';
import { fetchIfoodVendas } from '@/lib/ifoodVendas';
import { janelaDeBusca, somarNosDias, type JanelaSessao, type SomaDiasLoja } from '@/lib/diaLoja';

// iFood do dia da loja (soma das sessões abertas no dia — src/lib/diaLoja.ts). `dia`/`janelas` vêm do
// fn_get_dashboard_painel (dia atual ou o mesmo dia da semana passada). `corte` (ISO) = só até esta hora.
// `recarregar`: mudar o valor busca de novo. dia null = desligado.
export function useIfoodDiaLoja(
  tenantId: string | null | undefined,
  dia: string | null | undefined,
  janelas: JanelaSessao[] | null | undefined,
  corte?: string | null,
  recarregar = 0,
) {
  const [data, setData] = useState<SomaDiasLoja | null>(null);
  const chaveJanelas = (janelas ?? []).map((j) => `${j.ini}|${j.fim ?? ''}`).join(',');

  useEffect(() => {
    if (!tenantId || !dia || !janelas) { setData(null); return; }
    let vivo = true;
    const fimCorte = corte ? new Date(corte) : null;
    const { from, to } = janelaDeBusca(dia, dia, janelas, fimCorte);
    fetchIfoodVendas(tenantId, from, to).then((r) => {
      if (vivo) setData(somarNosDias(r.lista, janelas, dia, dia, fimCorte));
    });
    return () => { vivo = false; };
  }, [tenantId, dia, chaveJanelas, corte, recarregar]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data };
}
