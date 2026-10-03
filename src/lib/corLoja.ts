// Cor da loja nas telas do cliente (delivery, QR da mesa / QR universal).
//
// As telas usam variáveis CSS em vez de classes fixas de cor, para cada loja
// poder ter a sua: `--cor-loja` (botões, destaques), `--cor-loja-forte`
// (hover/pressionado) e `--cor-loja-suave` (fundos claros de ícone e selo).
// O padrão é um laranja queimado que passa no contraste com texto branco.
import type { CSSProperties } from 'react';

export const COR_LOJA_PADRAO = '#C2410C';

function hexValido(cor: string | null | undefined): string | null {
  const c = (cor || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
}

function misturar(hex: string, alvo: number, peso: number): string {
  const n = parseInt(hex.slice(1), 16);
  const canal = function (v: number) { return Math.round(v * (1 - peso) + alvo * peso); };
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
}

/** Estilo para o elemento raiz da tela do cliente. Cor inválida cai no padrão. */
export function corLojaVars(cor?: string | null): CSSProperties {
  const base = hexValido(cor) || COR_LOJA_PADRAO;
  return {
    ['--cor-loja' as string]: base,
    ['--cor-loja-forte' as string]: misturar(base, 0, 0.15),
    ['--cor-loja-suave' as string]: misturar(base, 255, 0.9),
  } as CSSProperties;
}
