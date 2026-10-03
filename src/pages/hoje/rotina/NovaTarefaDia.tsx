// "Tarefa de hoje" e "Pedir produção" (2026-10-03): quem está acima na hierarquia põe uma tarefa do dia
// para quem está abaixo (supervisão → equipe/cozinha/caixa; gerente → também a supervisão). Aparece na
// Hoje de quem faz — no celular da loja também. Produção: "Produzir" abre o card de registrar produção
// daquela ficha; registrou, o item marca automático com quem produziu.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Folha from '@/pages/estoque/components/inicio/Folha';
import type { PapelRotina } from '../../../../supabase/functions/_shared/rotina';
import { salvarItem } from './useRotina';
import { rotuloPapel } from './rotulos';

interface Ficha { id: string; name: string; unit: string | null }

const amanha = (hoje: string) => {
  const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export default function NovaTarefaDia({ aberta, tipoInicial, tenantId, loja, hoje, papeis, onFechar, onCriou }: {
  aberta: boolean;
  tipoInicial: 'tarefa' | 'producao';
  tenantId: string;
  loja: string;
  hoje: string;
  /** para quem a pessoa pode criar (abaixo dela) */
  papeis: PapelRotina[];
  onFechar: () => void;
  onCriou: (msg: string) => void;
}) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [titulo, setTitulo] = useState('');
  const [papel, setPapel] = useState<PapelRotina>('equipe');
  const [hora, setHora] = useState('');
  const [quando, setQuando] = useState<'hoje' | 'amanha'>('hoje');
  const [fichas, setFichas] = useState<Ficha[] | null>(null);
  const [ficha, setFicha] = useState<string>('');
  const [qtd, setQtd] = useState('1 receita');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberta) return;
    setTipo(tipoInicial); setTitulo(''); setHora(''); setQuando('hoje'); setErro(null); setQtd('1 receita');
    const pref: PapelRotina = tipoInicial === 'producao' ? 'cozinha' : 'equipe';
    setPapel(papeis.includes(pref) ? pref : papeis[papeis.length - 1] ?? 'equipe');
  }, [aberta, tipoInicial, papeis]);

  useEffect(() => {
    if (!aberta || tipo !== 'producao' || fichas) return;
    supabase.from('production_recipes').select('id, name, unit').eq('tenant_id', tenantId).eq('is_active', true).order('name')
      .then(({ data, error }) => {
        if (error) { setErro(error.message); setFichas([]); return; }
        const l = (data ?? []) as Ficha[];
        setFichas(l);
        if (l[0]) setFicha((f) => f || l[0].id);
      });
  }, [aberta, tipo, tenantId, fichas]);
  useEffect(() => { setFichas(null); setFicha(''); }, [tenantId]);

  const fichaNome = fichas?.find((f) => f.id === ficha)?.name ?? '';
  const pode = tipo === 'producao' ? !!ficha && !!qtd.trim() : !!titulo.trim();

  const criar = async () => {
    if (!pode || salvando) return;
    setSalvando(true); setErro(null);
    try {
      await salvarItem({
        tenantId, papel, tipo: tipo === 'producao' ? 'producao' : 'manual',
        titulo: tipo === 'producao' ? `Produzir ${fichaNome} — ${qtd.trim()}` : titulo.trim(),
        hora: hora || null, dia: quando === 'hoje' ? hoje : amanha(hoje),
        receitaId: tipo === 'producao' ? ficha : null, quantidade: tipo === 'producao' ? qtd.trim() : null,
      });
      onCriou(tipo === 'producao' ? `Produção pedida. ${quando === 'hoje' ? 'Já aparece' : 'Aparece amanhã'} para ${rotuloPapel(papel).toLowerCase()}.` : `${quando === 'hoje' ? 'Na lista de hoje' : 'Na lista de amanhã'} de ${rotuloPapel(papel).toLowerCase()}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  };

  const chip = (on: boolean) => `h-10 px-3.5 rounded-full border text-[13px] font-bold cursor-pointer ${on ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`;
  const rotulo = 'mt-4 mb-1.5 text-[12px] font-extrabold uppercase tracking-wide text-zinc-500';

  return (
    <Folha aberta={aberta} titulo={tipo === 'producao' ? 'Pedir produção' : 'Tarefa do dia'} subtitulo={`${loja} · aparece para quem faz, no celular da loja também`}
      onFechar={onFechar} fecharNoFundo={false}
      rodape={<button onClick={criar} disabled={!pode || salvando}
        className="flex-1 h-12 rounded-xl bg-amber-500 text-[15px] font-extrabold text-zinc-900 disabled:opacity-40 cursor-pointer">
        {salvando ? 'Salvando…' : tipo === 'producao' ? 'Pedir a produção' : 'Pôr na lista'}
      </button>}>
      <div className="flex rounded-xl bg-zinc-100 p-1 mt-1">
        {(['tarefa', 'producao'] as const).map((t) => (
          <button key={t} onClick={() => setTipo(t)}
            className={`flex-1 h-9 rounded-lg text-[13px] font-bold cursor-pointer ${tipo === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>
            {t === 'tarefa' ? 'Tarefa' : 'Produção'}
          </button>
        ))}
      </div>

      {tipo === 'producao' ? (
        <>
          <p className={rotulo}>O que produzir <span className="normal-case font-semibold text-zinc-400">(fichas de produção)</span></p>
          {fichas === null && <div className="my-3 w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
          {fichas?.length === 0 && <p className="text-sm text-zinc-500">Esta loja ainda não tem ficha de produção (Estoque › Produção).</p>}
          <div className="flex flex-wrap gap-2">
            {(fichas ?? []).map((f) => <button key={f.id} onClick={() => setFicha(f.id)} className={chip(ficha === f.id)}>{f.name}</button>)}
          </div>
          <p className={rotulo}>Quanto</p>
          <div className="flex flex-wrap gap-2">
            {['1 receita', '2 receitas', '3 receitas'].map((q) => <button key={q} onClick={() => setQtd(q)} className={chip(qtd === q)}>{q}</button>)}
          </div>
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} maxLength={60} placeholder="Ex.: 2 kg"
            className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-base" />
          <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-[12px] leading-relaxed text-violet-800">
            <i className="ri-flashlight-line" /> O “Produzir” abre o card de registrar produção desta ficha (o mesmo do Estoque › Produção). Registrou, o item marca automático com quem produziu.
          </p>
        </>
      ) : (
        <>
          <p className={rotulo}>O que fazer</p>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} placeholder="Ex.: Lavar as caixas de hortifrúti"
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-base" autoFocus />
        </>
      )}

      <p className={rotulo}>Quem faz</p>
      <div className="flex flex-wrap gap-2">
        {papeis.map((p) => <button key={p} onClick={() => setPapel(p)} className={chip(papel === p)}>{rotuloPapel(p)}</button>)}
      </div>
      <p className={rotulo}>Para quando</p>
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => setQuando('hoje')} className={chip(quando === 'hoje')}>Hoje</button>
        <button onClick={() => setQuando('amanha')} className={chip(quando === 'amanha')}>Amanhã</button>
        <span className="text-[12px] text-zinc-400 ml-1">até</span>
        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="h-10 rounded-xl border border-zinc-200 px-2 text-base" aria-label="Até que horas (opcional)" />
      </div>
      <p className="mt-3 mb-2 rounded-xl bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
        Não feita no dia, ela continua aparecendo como “de ontem” (até 7 dias), até alguém fazer ou você tirar.
      </p>
      {erro && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
    </Folha>
  );
}
