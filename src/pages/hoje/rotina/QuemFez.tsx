// "Quem fez?" (2026-10-03): no login compartilhado (celular da loja) toda marca pergunta quem fez, sem PIN.
// Dá para escolher MAIS DE UMA pessoa (pedido do dono): tarefa do dia, produção, qualquer item.
// Lista = equipe da loja + freelancers (os com turno hoje primeiro), de fn_rotina_pessoas — só id, nome e
// função, nunca CPF/telefone/Pix. Freelancer não tem login: fica só o nome. Um componente só: a proposta do
// "celular da loja" (outra sessão) acrescenta o PIN aqui quando mexer em estoque/dinheiro.
import { useEffect, useState } from 'react';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { pessoasDaLoja, type PessoaDaLoja, type QuemFezEscolha } from './useRotina';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';

const cache = new Map<string, { em: number; lista: PessoaDaLoja[] }>();

export type Escolhida = QuemFezEscolha & { nomeMostrado: string };
const chave = (e: Escolhida) => e.userId ? `u:${e.userId}` : e.freelancerId ? `f:${e.freelancerId}` : `n:${(e.nome ?? '').toLowerCase()}`;

export default function QuemFez({ tenantId, aberta, titulo, pergunta = 'Quem fez?', botao = 'Marcar como feito', eu, inicial, onEscolher, onFechar }: {
  tenantId: string;
  aberta: boolean;
  titulo: string;
  pergunta?: string;
  botao?: string;
  /** login pessoal marcando por alguém: "Eu" aparece primeiro */
  eu?: { id: string; nome: string } | null;
  /** quem já estava marcado (mudar quem fez) */
  inicial?: Escolhida[];
  onEscolher: (lista: Escolhida[]) => void;
  onFechar: () => void;
}) {
  const [lista, setLista] = useState<PessoaDaLoja[] | null>(cache.get(tenantId)?.lista ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [outro, setOutro] = useState('');
  const [sel, setSel] = useState<Escolhida[]>([]);

  useEffect(() => {
    if (!aberta) return;
    setOutro('');
    setSel(inicial ?? []);
    const c = cache.get(tenantId);
    if (c && Date.now() - c.em < 10 * 60_000) { setLista(c.lista); return; }
    let vivo = true;
    pessoasDaLoja(tenantId)
      .then((l) => { cache.set(tenantId, { em: Date.now(), lista: l }); if (vivo) { setLista(l); setErro(null); } })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : String(e)));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, tenantId]);

  const alternar = (e: Escolhida) => setSel((s) => (s.some((x) => chave(x) === chave(e)) ? s.filter((x) => chave(x) !== chave(e)) : [...s, e]));
  const marcada = (e: Escolhida) => sel.some((x) => chave(x) === chave(e));
  const funcao = (p: PessoaDaLoja) => {
    if (p.tipo === 'freelancer') return p.turno_hoje ? 'freelancer · turno hoje' : 'freelancer';
    return perfilConfig[p.funcao as PerfilUsuario]?.label ?? p.funcao ?? '';
  };
  const pessoas = (lista ?? []).filter((p) => !(eu && p.tipo === 'user' && p.id === eu.id));
  // Nomes digitados ("outra pessoa") ficam na grade como os outros, já marcados.
  const digitados = sel.filter((e) => !e.userId && !e.freelancerId);
  const addOutro = () => { const n = outro.trim(); if (!n) return; const e = { nome: n, nomeMostrado: n }; if (!marcada(e)) setSel((s) => [...s, e]); setOutro(''); };

  return (
    <Folha aberta={aberta} titulo={pergunta} subtitulo={`${titulo} · pode marcar mais de uma pessoa`} onFechar={onFechar} fecharNoFundo={false}
      rodape={<button onClick={() => sel.length && onEscolher(sel)} disabled={!sel.length}
        className="flex-1 h-12 rounded-xl bg-amber-500 text-[15px] font-extrabold text-zinc-900 disabled:opacity-40 cursor-pointer">
        {sel.length ? `${botao}${sel.length > 1 ? ` · ${sel.length} pessoas` : ''}` : 'Toque em quem fez'}
      </button>}>
      {erro && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Não consegui ler a equipe: {erro}</p>}
      <div className="grid grid-cols-2 gap-2">
        {eu && (() => { const e = { userId: eu.id, nomeMostrado: eu.nome }; return <BotaoPessoa nome={eu.nome} sub="eu" on={marcada(e)} onClick={() => alternar(e)} />; })()}
        {pessoas.map((p) => {
          const e: Escolhida = p.tipo === 'user' ? { userId: p.id, nomeMostrado: p.nome } : { freelancerId: p.id, nomeMostrado: p.nome };
          return <BotaoPessoa key={`${p.tipo}-${p.id}`} nome={p.nome} sub={funcao(p)} freela={p.tipo === 'freelancer'} on={marcada(e)} onClick={() => alternar(e)} />;
        })}
        {digitados.map((e) => <BotaoPessoa key={chave(e)} nome={e.nomeMostrado} sub="digitado" on onClick={() => alternar(e)} />)}
      </div>
      {!lista && !erro && <div className="mx-auto my-6 w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
      <p className="mt-4 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-zinc-500">Outra pessoa</p>
      <form className="flex gap-2" onSubmit={(ev) => { ev.preventDefault(); addOutro(); }}>
        <input value={outro} onChange={(ev) => setOutro(ev.target.value)} placeholder="Nome" maxLength={80}
          className="flex-1 min-w-0 rounded-xl border border-zinc-200 px-3 py-2.5 text-base" />
        <button type="submit" disabled={!outro.trim()} className="rounded-xl bg-zinc-900 px-4 text-sm font-bold text-white disabled:opacity-40 cursor-pointer">Pôr</button>
      </form>
      <p className="mt-3 mb-2 rounded-xl bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
        Freelancer não precisa de login: só o nome fica guardado, com a hora e o aparelho.
      </p>
    </Folha>
  );
}

function BotaoPessoa({ nome, sub, freela, on, onClick }: { nome: string; sub: string; freela?: boolean; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-left cursor-pointer min-h-[56px] ${on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}>
      <span className={`w-8 h-8 flex-shrink-0 rounded-xl flex items-center justify-center text-[13px] font-extrabold ${on ? 'bg-emerald-600 text-white' : freela ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-700'}`}>
        {on ? <i className="ri-check-line text-base" /> : nome.trim().charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-bold text-zinc-800 truncate">{nome}</span>
        {sub && <span className="block text-[11px] font-semibold text-zinc-400 truncate">{sub}</span>}
      </span>
    </button>
  );
}
