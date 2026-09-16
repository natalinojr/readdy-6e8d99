// Botões de classificação DRE para as ações rápidas: grupo → categoria, com busca quando a lista é grande.
import { useState, type ReactNode } from 'react';
import { Opcao, OpcaoNeutra, Campo } from '../kit';
import type { DreEscolha, DreGrupoOpcoes } from './comum';

const MUITAS = 10;
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export default function EscolhaDre({ grupos, onEscolher, extra }: {
  grupos: DreGrupoOpcoes[];
  onEscolher: (e: DreEscolha) => void;
  /** Botões adicionais no fim (ex.: Pular, Cancelar). */
  extra?: ReactNode;
}) {
  const [grupoKey, setGrupoKey] = useState<string | null>(grupos.length === 1 ? grupos[0].key : null);
  const [busca, setBusca] = useState('');
  const todas = grupos.flatMap((g) => g.opcoes.map((o) => ({ o, grupo: g.label })));

  if (busca) {
    const q = semAcento(busca);
    const achadas = todas.filter((x) => semAcento(x.o.label).includes(q) || semAcento(x.grupo).includes(q)).slice(0, 15);
    return (
      <>
        {achadas.map((x) => (
          <Opcao key={`${x.grupo}|${x.o.label}`} onClick={() => onEscolher(x.o)} detalhe={x.o.tipo === 'grupo' ? '(grupo)' : `(${x.grupo})`}>{x.o.label}</Opcao>
        ))}
        {!achadas.length && <p className="text-xs text-zinc-500 px-1">Nada encontrado com “{busca}”.</p>}
        <OpcaoNeutra onClick={() => setBusca('')}>Limpar busca</OpcaoNeutra>
        {extra}
      </>
    );
  }

  const grupo = grupos.find((g) => g.key === grupoKey);
  if (grupo) {
    return (
      <>
        {grupo.opcoes.length > MUITAS && <Campo placeholder="Buscar categoria" onEnviar={setBusca} />}
        {grupo.opcoes.map((o) => (
          <Opcao key={o.tipo === 'categoria' ? o.id : `g:${o.key}`} onClick={() => onEscolher(o)} detalhe={o.tipo === 'grupo' ? '(o próprio grupo)' : undefined}>{o.label}</Opcao>
        ))}
        {grupos.length > 1 && <OpcaoNeutra onClick={() => setGrupoKey(null)}>Voltar aos grupos</OpcaoNeutra>}
        {extra}
      </>
    );
  }

  return (
    <>
      {todas.length > MUITAS && <Campo placeholder="Buscar categoria" onEnviar={setBusca} />}
      {grupos.map((g) => (
        <Opcao key={g.key} onClick={() => setGrupoKey(g.key)} detalhe={`(${g.opcoes.length})`}>{g.label}</Opcao>
      ))}
      {extra}
    </>
  );
}
