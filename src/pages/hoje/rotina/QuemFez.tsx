// "Quem fez?" (2026-10-03): no login compartilhado (celular da loja) toda marca pergunta quem fez, sem PIN.
// Lista = equipe da loja + freelancers (os com turno hoje primeiro), de fn_rotina_pessoas — só id, nome e
// função, nunca CPF/telefone/Pix. Freelancer não tem login: fica só o nome. Um componente só: a proposta do
// "celular da loja" (outra sessão) acrescenta o PIN aqui quando mexer em estoque/dinheiro.
import { useEffect, useState } from 'react';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { pessoasDaLoja, type PessoaDaLoja, type QuemFezEscolha } from './useRotina';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';

const cache = new Map<string, { em: number; lista: PessoaDaLoja[] }>();

export default function QuemFez({ tenantId, aberta, titulo, pergunta = 'Quem fez?', eu, onEscolher, onFechar }: {
  tenantId: string;
  aberta: boolean;
  titulo: string;
  pergunta?: string;
  /** login pessoal marcando por alguém: "Eu" aparece primeiro */
  eu?: { id: string; nome: string } | null;
  onEscolher: (q: QuemFezEscolha & { nomeMostrado: string }) => void;
  onFechar: () => void;
}) {
  const [lista, setLista] = useState<PessoaDaLoja[] | null>(cache.get(tenantId)?.lista ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [outro, setOutro] = useState('');

  useEffect(() => {
    if (!aberta) return;
    setOutro('');
    const c = cache.get(tenantId);
    if (c && Date.now() - c.em < 10 * 60_000) { setLista(c.lista); return; }
    let vivo = true;
    pessoasDaLoja(tenantId)
      .then((l) => { cache.set(tenantId, { em: Date.now(), lista: l }); if (vivo) { setLista(l); setErro(null); } })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : String(e)));
    return () => { vivo = false; };
  }, [aberta, tenantId]);

  const funcao = (p: PessoaDaLoja) => {
    if (p.tipo === 'freelancer') return p.turno_hoje ? 'freelancer · turno hoje' : 'freelancer';
    return perfilConfig[p.funcao as PerfilUsuario]?.label ?? p.funcao ?? '';
  };
  const pessoas = (lista ?? []).filter((p) => !(eu && p.tipo === 'user' && p.id === eu.id));

  return (
    <Folha aberta={aberta} titulo={pergunta} subtitulo={titulo} onFechar={onFechar}>
      {erro && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Não consegui ler a equipe: {erro}</p>}
      <div className="grid grid-cols-2 gap-2">
        {eu && (
          <BotaoPessoa nome={eu.nome} sub="eu" onClick={() => onEscolher({ userId: eu.id, nomeMostrado: eu.nome })} />
        )}
        {pessoas.map((p) => (
          <BotaoPessoa key={`${p.tipo}-${p.id}`} nome={p.nome} sub={funcao(p)} freela={p.tipo === 'freelancer'}
            onClick={() => onEscolher(p.tipo === 'user' ? { userId: p.id, nomeMostrado: p.nome } : { freelancerId: p.id, nomeMostrado: p.nome })} />
        ))}
      </div>
      {!lista && !erro && <div className="mx-auto my-6 w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
      <p className="mt-4 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-zinc-500">Outra pessoa</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = outro.trim(); if (n) onEscolher({ nome: n, nomeMostrado: n }); }}>
        <input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Nome" maxLength={80}
          className="flex-1 min-w-0 rounded-xl border border-zinc-200 px-3 py-2.5 text-base" />
        <button type="submit" disabled={!outro.trim()} className="rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white disabled:opacity-40 cursor-pointer">Ok</button>
      </form>
      <p className="mt-3 mb-2 rounded-xl bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
        Freelancer não precisa de login: só o nome fica guardado, com a hora e o aparelho.
      </p>
    </Folha>
  );
}

function BotaoPessoa({ nome, sub, freela, onClick }: { nome: string; sub: string; freela?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left hover:border-zinc-300 cursor-pointer min-h-[56px]">
      <span className={`w-8 h-8 flex-shrink-0 rounded-xl flex items-center justify-center text-[13px] font-extrabold ${freela ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-700'}`}>
        {nome.trim().charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-bold text-zinc-800 truncate">{nome}</span>
        {sub && <span className="block text-[11px] font-semibold text-zinc-400 truncate">{sub}</span>}
      </span>
    </button>
  );
}
