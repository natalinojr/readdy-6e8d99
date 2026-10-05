// Estado da folha "Trocar de loja" (casca nova / Módulos nova): aberta e a troca em andamento. Fica fora do
// componente para abrir de qualquer lugar e sobreviver à remontagem da tela durante a troca.
import { useSyncExternalStore } from 'react';

export interface EstadoTroca { aberta: boolean; trocando: { tenantId: string; nome: string } | null }

let estado: EstadoTroca = { aberta: false, trocando: null };
const ouvintes = new Set<() => void>();
const inscrever = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };

export function mudarTroca(p: Partial<EstadoTroca>) { estado = { ...estado, ...p }; ouvintes.forEach((f) => f()); }

/** Abre a folha de trocar de loja. */
export function abrirTrocarLoja() { mudarTroca({ aberta: true }); }

/** `trocando` = a casca esconde a tela da loja anterior até a nova entrar. */
export function useTrocaLoja(): EstadoTroca { return useSyncExternalStore(inscrever, () => estado); }
