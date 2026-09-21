// Seletor de idioma do cardápio do cliente.
//
// Duas variantes:
//   'inline' — delivery e mesa-qr, no cabeçalho do cardápio (celular do cliente).
//   'fixo'   — totem/tablet: barra própria presa no topo da janela, sempre à
//              vista. No tablet ninguém procura menu escondido: a pessoa chega,
//              olha a tela e tem que ver na hora que dá para trocar de idioma.
//
// Só aparece se a loja oferecer mais de um idioma (`disponiveis`).

import { useState, useRef, useEffect } from 'react';
import { IDIOMA_PADRAO, NOME_IDIOMA, normalizarIdioma, type Idioma } from '../i18n';

const BANDEIRA: Record<Idioma, string> = {
  'pt-BR': '🇧🇷',
  en: '🇺🇸',
  es: '🇪🇸',
};

interface Props {
  /** Idiomas que a loja oferece além do português (ex.: ['en','es']). */
  disponiveis: string[];
  idioma: Idioma;
  onTrocar: (idioma: Idioma) => void;
  variante?: 'inline' | 'fixo';
}

export default function SeletorIdioma({ disponiveis, idioma, onTrocar, variante = 'inline' }: Props) {
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  const opcoes: Idioma[] = [
    IDIOMA_PADRAO,
    ...(disponiveis.map((l) => normalizarIdioma(l)).filter((l): l is Idioma => !!l && l !== IDIOMA_PADRAO)),
  ];

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  if (opcoes.length < 2) return null;

  // No tablet não há menu suspenso: as bandeiras ficam todas visíveis e a
  // pessoa toca na que quer. Um toque, sem descobrir nada.
  //
  // Não usa `position: fixed` de propósito. A tela do totem é um
  // `fixed inset-0 flex flex-col` que não rola; como PRIMEIRO filho dessa
  // coluna, esta barra fica presa no topo da janela sem cobrir o cabeçalho do
  // app — que é o que `fixed` faria.
  if (variante === 'fixo') {
    return (
      <div className="w-full shrink-0 z-50 flex items-center justify-center gap-2 bg-zinc-900/95 px-4 py-2 backdrop-blur">
        {opcoes.map((op) => {
          const ativo = op === idioma;
          return (
            <button
              key={op}
              type="button"
              onClick={() => onTrocar(op)}
              aria-pressed={ativo}
              aria-label={NOME_IDIOMA[op]}
              className={
                'flex items-center gap-2 rounded-full px-4 py-2 text-base font-semibold transition-colors ' +
                (ativo ? 'bg-white text-zinc-900' : 'bg-white/10 text-white hover:bg-white/20')
              }
            >
              <span aria-hidden="true">{BANDEIRA[op]}</span>
              <span>{NOME_IDIOMA[op]}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={NOME_IDIOMA[idioma]}
        className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
      >
        <span aria-hidden="true">{BANDEIRA[idioma]}</span>
        <span className="uppercase">{idioma === 'pt-BR' ? 'PT' : idioma.toUpperCase()}</span>
      </button>

      {aberto ? (
        <div role="listbox" className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5">
          {opcoes.map((op) => {
            const ativo = op === idioma;
            return (
              <button
                key={op}
                type="button"
                role="option"
                aria-selected={ativo}
                onClick={() => { onTrocar(op); setAberto(false); }}
                className={
                  'flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors ' +
                  (ativo ? 'bg-amber-50 font-semibold text-amber-700' : 'text-zinc-700 hover:bg-zinc-50')
                }
              >
                <span aria-hidden="true">{BANDEIRA[op]}</span>
                <span>{NOME_IDIOMA[op]}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
