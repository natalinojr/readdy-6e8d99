// Ação rápida: mover candidato de fase no kanban da Contratação — sem IA.
// Mesma gravação da tela (updateCandidate em contratacao/page.tsx): hiring_candidates.stage_id.
// Ficha incompleta não sai de "Novo" (exceto para Descartado): a tela pergunta antes e, se o dono
// confirmar, grava required_waived_at junto. O gatilho hiring_candidates_stage_guard também trava no
// banco — o erro dele é mostrado e só com novo toque em "Mover mesmo assim" grava com a dispensa.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import {
  mergeSettings, faltasFicha, stageOf, norm, onlyDigits,
  type Stage, type Settings, type Candidate,
} from '@/pages/contratacao/shared';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, type AcaoProps } from '../kit';

type Leve = Pick<Candidate, 'id' | 'full_name' | 'stage_id' | 'phone'>;
type Passo = 'carregando' | 'busca' | 'fase' | 'confirmar' | 'incompleta' | 'gravando' | 'fim';

export default function MoverCandidato({ onFechar, irPara }: AcaoProps) {
  const { hasModule, loading: acessoLoading } = useModuleAccess();
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [comecou, setComecou] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [todos, setTodos] = useState<Leve[]>([]);
  const [achados, setAchados] = useState<Leve[]>([]);
  const [cand, setCand] = useState<Candidate | null>(null);
  const [para, setPara] = useState<Stage | null>(null);

  useEffect(() => {
    if (acessoLoading || comecou) return;
    setComecou(true);
    if (!hasModule('contratacao')) { bot('Você não tem acesso ao módulo Contratação.'); setPasso('fim'); return; }
    (async () => {
      const [stg, set, cs] = await Promise.all([
        supabase.from('hiring_stages').select('*').order('sort_order'),
        supabase.from('hiring_settings').select('data').eq('id', 1).maybeSingle(),
        supabase.from('hiring_candidates').select('id, full_name, stage_id, phone').order('created_at', { ascending: false }).limit(2000),
      ]);
      const erro = stg.error ?? set.error ?? cs.error;
      if (erro) { bot(`Não consegui carregar a Contratação: ${erro.message}`); setPasso('fim'); return; }
      setStages((stg.data ?? []) as Stage[]);
      setSettings(mergeSettings(set.data?.data));
      setTodos((cs.data ?? []) as Leve[]);
      bot('Qual candidato? Digite o nome (ou telefone).');
      setPasso('busca');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acessoLoading]);

  const buscar = (t: string) => {
    eu(t);
    const dig = onlyDigits(t);
    const q = norm(t);
    const r = todos.filter((c) => (dig.length >= 4 ? onlyDigits(c.phone).includes(dig) : norm(c.full_name).includes(q)));
    if (!r.length) { setAchados([]); bot('Não achei. Tente outro nome.'); return; }
    if (r.length === 1) { escolher(r[0]); return; }
    setAchados(r.slice(0, 8));
    bot(r.length > 8 ? `Achei ${r.length}. Mostrando 8 — digite mais do nome se não estiver aqui.` : 'Qual deles?');
  };

  const escolher = async (l: Leve) => {
    setAchados([]);
    setPasso('carregando');
    const { data, error } = await supabase.from('hiring_candidates').select('*').eq('id', l.id).maybeSingle();
    if (error || !data) { bot(`Não consegui abrir a ficha: ${error?.message ?? 'não encontrado'}`); setPasso('busca'); return; }
    const c = data as Candidate;
    setCand(c);
    bot(`*${c.full_name}*\nFase atual: ${stageOf(stages, c.stage_id)?.name ?? '—'}\nMover para qual fase?`);
    setPasso('fase');
  };

  const escolherFase = (s: Stage) => {
    const c = cand!;
    setPara(s);
    eu(s.name);
    const de = stageOf(stages, c.stage_id);
    if (de?.native_kind === 'novo' && s.native_kind !== 'novo' && s.native_kind !== 'descartado' && settings) {
      const faltam = faltasFicha({ ...c, stage_id: s.id }, settings);
      if (faltam.length) {
        bot(`⚠️ Ficha incompleta. Faltam: ${faltam.map((f) => f.label.toLowerCase()).join(', ')}.\nO ideal é completar a ficha antes de tirar ${c.full_name.split(' ')[0]} de "${de.name}".`);
        setPasso('incompleta');
        return;
      }
    }
    bot(`Mover ${c.full_name.split(' ')[0]} de "${de?.name ?? '—'}" para "${s.name}"?`);
    setPasso('confirmar');
  };

  const gravar = async (dispensar: boolean) => {
    const c = cand!;
    const s = para!;
    eu(dispensar ? 'Mover mesmo assim' : 'Mover');
    setPasso('gravando');
    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = { stage_id: s.id, updated_at: agora };
    if (dispensar) patch.required_waived_at = agora;
    const { error } = await supabase.from('hiring_candidates').update(patch).eq('id', c.id);
    if (error) {
      if (!dispensar) {
        bot(`⚠️ O sistema travou a mudança: ${error.message}\nSe quiser, mova mesmo assim (fica registrado que a ficha estava incompleta).`);
        setPasso('incompleta');
      } else {
        bot(`❌ Não foi possível mover: ${error.message}`);
        setPasso('fim');
      }
      return;
    }
    setCand({ ...c, stage_id: s.id });
    bot(`✅ ${c.full_name} agora está em "${s.name}".`);
    setPasso('fim');
  };

  const atual = cand ? stageOf(stages, cand.stage_id) : null;

  return (
    <Roteiro titulo="Mover candidato" icone="ri-layout-column-line" cor="bg-violet-50 text-violet-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Salvando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'busca' && (
        <>
          {achados.map((c) => (
            <Opcao key={c.id} onClick={() => { eu(c.full_name); escolher(c); }} detalhe={stageOf(stages, c.stage_id)?.name}>{c.full_name}</Opcao>
          ))}
          <Campo placeholder="Nome do candidato" onEnviar={buscar} />
        </>
      )}
      {passo === 'fase' && cand && (
        <>
          {stages.filter((s) => s.id !== atual?.id).map((s) => <Opcao key={s.id} onClick={() => escolherFase(s)}>{s.name}</Opcao>)}
          <OpcaoNeutra onClick={() => { setCand(null); bot('Qual candidato?'); setPasso('busca'); }}>Outro candidato</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={() => gravar(false)}>Sim, mover</Opcao>
          <OpcaoNeutra onClick={() => { bot('Ok, nada mudou. Escolha outra fase ou feche.'); setPasso('fase'); }}>Não</OpcaoNeutra>
        </>
      )}
      {passo === 'incompleta' && cand && (
        <>
          <Opcao onClick={() => irPara(`/contratacao?candidato=${cand.id}`)}>Abrir ficha para completar</Opcao>
          <Opcao perigo onClick={() => gravar(true)}>Mover mesmo assim</Opcao>
          <OpcaoNeutra onClick={() => { bot('Ok, nada mudou.'); setPasso('fase'); }}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={cand
          ? [{ label: 'Abrir ficha', onClick: () => irPara(`/contratacao?candidato=${cand.id}`) }]
          : [{ label: 'Abrir Contratação', onClick: () => irPara('/contratacao?aba=kanban') }]} />
      )}
    </Roteiro>
  );
}
