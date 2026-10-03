// "Aprendi com você" na tela Hoje (2026-10-03): o sistema percebeu uma decisão repetida e pergunta se
// pode fazer sempre assim. Só aparece para administrador/gerente e só quando há o que perguntar.
// Regras em aprender.ts; o que foi aceito fica no Piloto automático (/hoje/piloto), com desfazer.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { carregarSugestoes, responderSugestao, type Sugestao } from './aprender';

// versao: muda quando algo foi resolvido na Hoje (ex.: "Não era boleto") — relê as sugestões na hora.
export default function AprendiComVoce({ papeis, mostrarLoja, versao }: { papeis: Map<string, string> | null; mostrarLoja: boolean; versao: number }) {
  const navigate = useNavigate();
  const [lista, setLista] = useState<Sugestao[]>([]);
  const [respostas, setRespostas] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    // Sem sugestão por erro de leitura: não é aviso, só não pergunta nada desta vez.
    carregarSugestoes(papeis).then((s) => { if (vivo) setLista(s); }).catch(() => {});
    return () => { vivo = false; };
  }, [papeis, versao]);

  if (lista.length === 0) return null;

  const responder = async (s: Sugestao, sim: boolean) => {
    setBusy(s.id); setErro(null);
    try {
      await responderSugestao(s, sim);
      setRespostas((r) => ({ ...r, [s.id]: sim }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2 px-0.5">
        <h2 className="text-[15px] font-extrabold text-zinc-900 whitespace-nowrap">Aprendi com você</h2>
        <span className="text-[12px] text-zinc-400 truncate">uma pergunta e eu faço sozinho daqui pra frente</span>
      </div>
      {erro && <p className="mb-2 text-xs text-red-600">Não consegui salvar: {erro}</p>}
      <div className="space-y-2.5">
        {lista.map((s) => {
          const resp = respostas[s.id];
          return (
            <div key={s.id} className="relative overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
              <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-violet-100/70 pointer-events-none" />
              <div className="relative flex items-start gap-3">
                <span className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-violet-600 text-white"><i className="ri-lightbulb-flash-line text-lg" /></span>
                <div className="min-w-0 flex-1">
                  {mostrarLoja && s.loja && <p className="text-[11px] font-bold uppercase tracking-wide text-violet-500">{s.loja}</p>}
                  <p className="text-[15px] font-extrabold text-zinc-900 leading-snug">{s.titulo}</p>
                  {resp === undefined ? (
                    <>
                      <p className="mt-1 text-[13px] text-zinc-600 leading-snug">{s.detalhe}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => responder(s, true)} disabled={busy === s.id}
                          className="h-10 px-4 rounded-xl bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-60 cursor-pointer">
                          {busy === s.id ? 'Salvando…' : s.sim}
                        </button>
                        <button onClick={() => responder(s, false)} disabled={busy === s.id}
                          className="h-10 px-4 rounded-xl border border-zinc-200 bg-white text-zinc-600 text-[13px] font-bold hover:border-zinc-300 disabled:opacity-60 cursor-pointer">
                          {s.nao}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-1 text-[13px] text-zinc-600">
                      {resp ? 'Combinado. ' : 'Tudo bem, fica como está e não pergunto de novo. '}
                      <button onClick={() => navigate('/hoje/piloto')} className="font-bold text-violet-700 underline cursor-pointer">
                        {resp ? 'Dá para desfazer no Piloto automático' : 'Ver o Piloto automático'}
                      </button>
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
