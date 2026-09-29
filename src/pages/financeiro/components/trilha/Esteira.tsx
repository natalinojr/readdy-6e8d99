// Esteira: uma coluna por fase (só as que têm caso travado), "No prazo" e "Tudo certo".
// Um caso aparece em TODAS as fases em que está travado.
import { diaBR, ruim, NOMES_ETAPA, type CasoTrilha, type EtapaId } from '@/lib/trilhaDespesas';
import { EST, ETAPAS_ORDEM, ICONE_ETAPA, ROTULO_TIPO, fmtBRL } from './comum';
import { MiniBarra } from './Fases';

const MAX_POR_COLUNA = 60;
const feito = (c: CasoTrilha) => c.etapas.every((e) => e.estado === 'ok' || e.estado === 'na');
const travadas = (c: CasoTrilha) => c.etapas.filter((e) => ruim(e.estado));
const porGravidade = (a: CasoTrilha, b: CasoTrilha) => Number(b.situacao === 'atencao') - Number(a.situacao === 'atencao') || b.valor - a.valor;
const soma = (cs: CasoTrilha[]) => cs.reduce((s, c) => s + c.valor, 0);

function Cabecalho({ icone, titulo, n, valor, cor }: { icone: string; titulo: string; n: number; valor: number; cor: string }) {
  return (
    <div className="px-3 pt-3 pb-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-bold ${cor}`}><i className={`${icone} mr-1`} />{titulo}</span>
        <span className="text-[11px] font-bold text-zinc-500 bg-white rounded-md px-1.5">{n}</span>
      </div>
      <p className="text-[11px] text-zinc-400 tabular-nums">{fmtBRL(valor)}</p>
    </div>
  );
}

function Cartao({ c, aqui, borda, onAbrir, cor }: { c: CasoTrilha; aqui: EtapaId | null; borda: string; onAbrir: () => void; cor?: string }) {
  const tp = ROTULO_TIPO[c.tipo];
  const e = aqui ? c.etapas.find((x) => x.id === aqui) : null;
  const tv = travadas(c);
  const outras = aqui ? tv.filter((x) => x.id !== aqui) : [];
  return (
    <button onClick={onAbrir} className={`w-full text-left rounded-xl border border-zinc-200 border-l-4 ${borda} bg-white p-3 hover:shadow-sm cursor-pointer`}>
      <div className="flex justify-between gap-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tp.cls}`}>{tp.t}</span>
        <span className="text-sm font-bold tabular-nums">{fmtBRL(c.valor)}</span>
      </div>
      <p className="text-[13px] font-semibold mt-1.5 leading-snug break-words">{c.titulo}</p>
      <p className="text-[11px] text-zinc-400 break-words">{diaBR(c.data)} · {c.subtitulo}</p>
      {e && (
        <>
          <p className={`text-[11px] mt-1.5 leading-snug ${cor ?? EST[e.estado].txt}`}><i className={EST[e.estado].ic} /> {e.resumo}</p>
          {e.falta && ruim(e.estado) && <p className={`text-[11px] mt-0.5 font-semibold ${EST[e.estado].txt}`}><i className="ri-arrow-right-line" /> Falta: {e.falta}</p>}
        </>
      )}
      {outras.length > 0 && (
        <div className="mt-2 rounded-lg bg-zinc-50 border border-dashed border-zinc-300 px-2 py-1.5 text-[11px] text-zinc-600">
          <span className="font-bold text-zinc-700"><i className="ri-git-branch-line" /> Travada em {tv.length} fases</span><br />
          também em: {outras.map((x, i) => (
            <span key={x.id}>{i > 0 && ', '}<span className={`font-semibold ${EST[x.estado].txt}`}>{x.nome}</span></span>
          ))}
        </div>
      )}
      <MiniBarra caso={c} />
    </button>
  );
}

export default function Esteira({ casos, onAbrir }: { casos: CasoTrilha[]; onAbrir: (c: CasoTrilha) => void }) {
  const porFase = ETAPAS_ORDEM.map((id) => ({ id, cs: casos.filter((c) => ruim(c.etapas.find((e) => e.id === id)!.estado)).sort(porGravidade) })).filter((f) => f.cs.length);
  const noPrazo = casos.filter((c) => travadas(c).length === 0 && !feito(c)).sort(porGravidade);
  const tudoCerto = casos.filter(feito).sort(porGravidade);
  return (
    <div>
      <p className="text-[11px] text-zinc-400 mb-2"><i className="ri-information-line mr-1" />Cada despesa aparece <strong className="text-zinc-500">em todas as fases em que está travada</strong> — se estiver em duas, aparece nas duas com o aviso "Travada em 2 fases".</p>
      <div className="flex gap-3 overflow-x-auto pb-2 max-w-full">
        {porFase.map(({ id, cs }) => (
          <div key={id} className="shrink-0 w-[260px] flex flex-col rounded-2xl bg-zinc-100/70">
            <Cabecalho icone={ICONE_ETAPA[id]} titulo={`Travadas em ${NOMES_ETAPA[id].toLowerCase()}`} n={cs.length} valor={soma(cs)} cor="text-zinc-700" />
            <div className="px-2 pb-2 space-y-2 max-h-[600px] overflow-y-auto">
              {cs.slice(0, MAX_POR_COLUNA).map((c) => (
                <Cartao key={c.key} c={c} aqui={id} onAbrir={() => onAbrir(c)}
                  borda={c.situacao === 'atencao' ? 'border-l-red-500' : 'border-l-amber-400'} />
              ))}
              {cs.length > MAX_POR_COLUNA && <p className="text-[11px] text-zinc-400 text-center py-2">+ {cs.length - MAX_POR_COLUNA} — use a busca para achar</p>}
            </div>
          </div>
        ))}
        {noPrazo.length > 0 && (
          <div className="shrink-0 w-[260px] flex flex-col rounded-2xl bg-sky-50/50 border border-sky-100">
            <Cabecalho icone="ri-calendar-check-line" titulo="No prazo — nada a fazer agora" n={noPrazo.length} valor={soma(noPrazo)} cor="text-sky-700" />
            <div className="px-2 pb-2 space-y-2 max-h-[600px] overflow-y-auto">
              {noPrazo.slice(0, MAX_POR_COLUNA).map((c) => {
                const e = c.etapas.find((x) => x.estado === 'prazo') ?? c.etapas.find((x) => x.estado === 'espera');
                return <Cartao key={c.key} c={c} aqui={e?.id ?? null} borda="border-l-sky-400" cor="text-sky-700" onAbrir={() => onAbrir(c)} />;
              })}
              {noPrazo.length > MAX_POR_COLUNA && <p className="text-[11px] text-zinc-400 text-center py-2">+ {noPrazo.length - MAX_POR_COLUNA} — use a busca para achar</p>}
            </div>
          </div>
        )}
        <div className="shrink-0 w-[260px] flex flex-col rounded-2xl bg-emerald-50/50 border border-emerald-100">
          <Cabecalho icone="ri-checkbox-circle-line" titulo="Tudo certo" n={tudoCerto.length} valor={soma(tudoCerto)} cor="text-emerald-700" />
          <div className="px-2 pb-2 space-y-2 max-h-[600px] overflow-y-auto">
            {tudoCerto.slice(0, MAX_POR_COLUNA).map((c) => <Cartao key={c.key} c={c} aqui={null} borda="border-l-emerald-500" onAbrir={() => onAbrir(c)} />)}
            {tudoCerto.length === 0 && <p className="text-[11px] text-zinc-400 text-center py-6">nada completo ainda</p>}
            {tudoCerto.length > MAX_POR_COLUNA && <p className="text-[11px] text-zinc-400 text-center py-2">+ {tudoCerto.length - MAX_POR_COLUNA} — use a busca para achar</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
