import { useEffect, useState } from 'react';

/**
 * Seletor de data de nascimento por Dia / Mês / Ano usando <select> nativos.
 *
 * Por quê: em muitos celulares o <input type="date"> não abre o calendário de
 * forma confiável e tentar digitar a data esbarra no teclado virtual (o usuário
 * não vê o que digita). Os <select> abrem um seletor nativo simples, sem teclado,
 * e funcionam em qualquer dispositivo.
 *
 * Formato externo: 'YYYY-MM-DD' (mesmo do <input type="date">). Enquanto a data
 * está incompleta, emite '' (o cadastro de aniversário é opcional).
 */
interface Props {
  value: string;
  onChange: (v: string) => void;
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const COMPLETA = /^\d{4}-\d{2}-\d{2}$/;

export default function SeletorDataNascimento({ value, onChange }: Props) {
  const init = COMPLETA.test(value) ? value.split('-') : ['', '', ''];
  const [dia, setDia] = useState(init[2] ? String(Number(init[2])) : '');
  const [mes, setMes] = useState(init[1] ? String(Number(init[1])) : '');
  const [ano, setAno] = useState(init[0]);

  // Sincroniza só quando o valor externo é uma data COMPLETA (ex.: cliente
  // existente carregado). Valor vazio/parcial não reseta a seleção em andamento.
  useEffect(() => {
    if (!COMPLETA.test(value)) return;
    const [yy, mm, dd] = value.split('-');
    setDia(String(Number(dd)));
    setMes(String(Number(mm)));
    setAno(yy);
  }, [value]);

  const emitir = (d: string, m: string, y: string) => {
    setDia(d); setMes(m); setAno(y);
    if (d && m && y) onChange(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    else onChange('');
  };

  const anoAtual = new Date().getFullYear();
  const anos: number[] = [];
  for (let a = anoAtual; a >= anoAtual - 100; a--) anos.push(a);

  const cls = 'w-full px-2 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent bg-white cursor-pointer';

  return (
    <div className="grid grid-cols-3 gap-2">
      <select aria-label="Dia" value={dia} onChange={(e) => emitir(e.target.value, mes, ano)} className={cls}>
        <option value="">Dia</option>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select aria-label="Mês" value={mes} onChange={(e) => emitir(dia, e.target.value, ano)} className={cls}>
        <option value="">Mês</option>
        {MESES.map((nome, i) => <option key={i} value={i + 1}>{nome}</option>)}
      </select>
      <select aria-label="Ano" value={ano} onChange={(e) => emitir(dia, mes, e.target.value)} className={cls}>
        <option value="">Ano</option>
        {anos.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  );
}
