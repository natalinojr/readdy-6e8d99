// "Tarefa do dia" e "Pedir produção" (2026-10-03): quem está acima na hierarquia põe uma tarefa do dia
// para quem está abaixo (supervisão → equipe/cozinha/caixa; gerente → também a supervisão). Aparece na
// Hoje de quem faz — no celular da loja também — no dia escolhido (hoje, amanhã ou qualquer data à frente).
// Produção: escolhe a ficha e QUANTAS RECEITAS; o "Produzir" abre o card de registrar produção já com esse
// número; registrou, o item marca automático com quem produziu.
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import Folha from '@/pages/estoque/components/inicio/Folha';
import type { PapelRotina } from '../../../../supabase/functions/_shared/rotina';
import { salvarItem } from './useRotina';
import { rotuloPapel } from './rotulos';

interface Ficha { id: string; name: string; is_active?: boolean }

const somarDias = (hoje: string, n: number) => {
  const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dataCurta = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const numero = (t: string) => { const n = parseFloat(t.replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const receitasTexto = (n: number) => `${String(n).replace('.', ',')} ${n === 1 ? 'receita' : 'receitas'}`;

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
  const [quando, setQuando] = useState<'hoje' | 'amanha' | 'outro'>('hoje');
  const [outroDia, setOutroDia] = useState('');
  const [fichas, setFichas] = useState<Ficha[] | null>(null);
  const [ficha, setFicha] = useState<string>('');
  const [receitas, setReceitas] = useState('1');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberta) return;
    setTipo(tipoInicial); setTitulo(''); setHora(''); setQuando('hoje'); setOutroDia(''); setErro(null); setReceitas('1');
    const pref: PapelRotina = tipoInicial === 'producao' ? 'cozinha' : 'equipe';
    setPapel(papeis.includes(pref) ? pref : papeis[papeis.length - 1] ?? 'equipe');
  }, [aberta, tipoInicial, papeis]);

  // Fichas pela mesma edge do Estoque › Produção (a tabela não tem leitura direta pelo app).
  useEffect(() => {
    if (!aberta || tipo !== 'producao' || fichas) return;
    invokeWithAuth<{ success: boolean; data?: Ficha[]; error?: string }>('production-write', { body: { action: 'list_recipes', tenant_id: tenantId } })
      .then(({ data, error }) => {
        if (error || !data?.success) { setErro(data?.error ?? error?.message ?? 'Não consegui ler as fichas de produção.'); setFichas([]); return; }
        const l = (data.data ?? []).filter((f) => f.is_active !== false).sort((a, b) => a.name.localeCompare(b.name));
        setFichas(l);
        if (l[0]) setFicha((f) => f || l[0].id);
      });
  }, [aberta, tipo, tenantId, fichas]);
  useEffect(() => { setFichas(null); setFicha(''); }, [tenantId]);

  const fichaNome = fichas?.find((f) => f.id === ficha)?.name ?? '';
  const nReceitas = numero(receitas);
  const dia = quando === 'hoje' ? hoje : quando === 'amanha' ? somarDias(hoje, 1) : outroDia;
  const pode = (tipo === 'producao' ? !!ficha && nReceitas > 0 : !!titulo.trim()) && !!dia && dia >= hoje;

  const criar = async () => {
    if (!pode || salvando) return;
    setSalvando(true); setErro(null);
    try {
      await salvarItem({
        tenantId, papel, tipo: tipo === 'producao' ? 'producao' : 'manual',
        titulo: tipo === 'producao' ? `Produzir ${fichaNome} — ${receitasTexto(nReceitas)}` : titulo.trim(),
        hora: hora || null, dia,
        receitaId: tipo === 'producao' ? ficha : null, quantidade: tipo === 'producao' ? String(nReceitas) : null,
      });
      const quandoTxt = dia === hoje ? 'hoje' : dia === somarDias(hoje, 1) ? 'amanhã' : dataCurta(dia);
      onCriou(`${tipo === 'producao' ? 'Produção pedida' : 'Tarefa criada'} para ${quandoTxt} · ${rotuloPapel(papel).toLowerCase()}.`);
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
          {fichas?.length === 0 && !erro && <p className="text-sm text-zinc-500">Esta loja ainda não tem ficha de produção (Estoque › Produção).</p>}
          <div className="flex flex-wrap gap-2">
            {(fichas ?? []).map((f) => <button key={f.id} onClick={() => setFicha(f.id)} className={chip(ficha === f.id)}>{f.name}</button>)}
          </div>
          <p className={rotulo}>Quantas receitas</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setReceitas(String(Math.max(1, Math.round(nReceitas) - 1)))} aria-label="Menos uma receita"
              className="w-11 h-11 rounded-xl border border-zinc-200 bg-white text-xl font-bold text-zinc-600 cursor-pointer">−</button>
            <input value={receitas} onChange={(e) => setReceitas(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" aria-label="Quantas receitas"
              className="w-24 h-11 rounded-xl border border-zinc-200 text-center text-xl font-extrabold" />
            <button onClick={() => setReceitas(String(Math.floor(nReceitas) + 1))} aria-label="Mais uma receita"
              className="w-11 h-11 rounded-xl border border-zinc-200 bg-white text-xl font-bold text-zinc-600 cursor-pointer">+</button>
            <span className="text-[13px] text-zinc-500">{nReceitas === 1 ? 'receita' : 'receitas'} da ficha</span>
          </div>
          <p className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-[12px] leading-relaxed text-violet-800">
            <i className="ri-flashlight-line" /> O “Produzir” abre o card de registrar produção desta ficha (o mesmo do Estoque › Produção) já com {receitasTexto(nReceitas || 1)}. Registrou, o item marca automático com quem produziu.
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
        <button onClick={() => { setQuando('outro'); if (!outroDia) setOutroDia(somarDias(hoje, 2)); }} className={chip(quando === 'outro')}>Outro dia</button>
      </div>
      {quando === 'outro' && (
        <div className="mt-2 flex items-center gap-2">
          <input type="date" value={outroDia} min={hoje} onChange={(e) => setOutroDia(e.target.value)} aria-label="Dia da tarefa"
            className="h-11 rounded-xl border border-zinc-200 px-3 text-base" />
          {outroDia && <span className="text-[13px] text-zinc-500">{dataCurta(outroDia)}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[13px] text-zinc-500">Até que horas <span className="text-zinc-400">(opcional)</span></span>
        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="h-10 rounded-xl border border-zinc-200 px-2 text-base" aria-label="Até que horas (opcional)" />
      </div>
      <p className="mt-3 mb-2 rounded-xl bg-zinc-50 px-3 py-2 text-[12px] leading-relaxed text-zinc-500">
        Aparece no dia escolhido. Não feita no dia, continua como “de ontem” (até 7 dias), até alguém fazer ou você tirar. Os agendados ficam em “Próximos dias”.
      </p>
      {erro && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
    </Folha>
  );
}
