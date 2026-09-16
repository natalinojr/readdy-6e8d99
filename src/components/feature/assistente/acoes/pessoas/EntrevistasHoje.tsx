// Ação rápida: entrevistas de hoje (módulo Contratação) — sem IA.
// Contratação é independente de loja: mesmas leituras/gravações da tela (hiring_interviews,
// hiring_candidates, hiring_companies; RLS pelo acesso ao módulo). "Compareceu"/"Faltou" grava o
// status da entrevista como o registro da aba Entrevistas (realizada | faltou; faltou zera a decisão).
// O questionário/decisão fica na tela ("Abrir registro").
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, horaBR, type AcaoProps } from '../kit';

interface Entrevista {
  id: string; candidate_id: string; company_id: string | null; scheduled_at: string; status: string;
  format: string; location: string | null; interviewer: string | null;
}
type Passo = 'carregando' | 'lista' | 'detalhe' | 'confirmar' | 'gravando' | 'fim';

const STATUS: Record<string, string> = { agendada: 'agendada', realizada: 'compareceu', faltou: 'faltou', cancelada: 'cancelada' };
const FORMATO: Record<string, string> = { presencial: 'presencial', telefone: 'por telefone', video: 'por vídeo' };
const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function EntrevistasHoje({ onFechar, irPara }: AcaoProps) {
  const { hasModule, loading: acessoLoading } = useModuleAccess();
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [lista, setLista] = useState<Entrevista[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [empresas, setEmpresas] = useState<Record<string, string>>({});
  const [selId, setSelId] = useState<string | null>(null);
  const [novo, setNovo] = useState<'realizada' | 'faltou'>('realizada');
  const [comecou, setComecou] = useState(false);

  const carregar = async () => {
    // Mesmo critério de "dia" da tela (data local do aparelho).
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    const fim = new Date(ini); fim.setDate(fim.getDate() + 1);
    const { data, error } = await supabase.from('hiring_interviews').select('id, candidate_id, company_id, scheduled_at, status, format, location, interviewer')
      .gte('scheduled_at', ini.toISOString()).lt('scheduled_at', fim.toISOString()).order('scheduled_at');
    if (error) { bot(`Não consegui carregar as entrevistas: ${error.message}`); setPasso('fim'); return null; }
    const ivs = ((data ?? []) as Entrevista[]).filter((iv) => dia(new Date(iv.scheduled_at)) === dia(new Date()));
    const candIds = [...new Set(ivs.map((iv) => iv.candidate_id))];
    const compIds = [...new Set(ivs.map((iv) => iv.company_id).filter(Boolean))] as string[];
    const [c, e] = await Promise.all([
      candIds.length ? supabase.from('hiring_candidates').select('id, full_name').in('id', candIds) : Promise.resolve({ data: [], error: null }),
      compIds.length ? supabase.from('hiring_companies').select('id, name').in('id', compIds) : Promise.resolve({ data: [], error: null }),
    ]);
    setNomes(Object.fromEntries(((c.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name])));
    setEmpresas(Object.fromEntries(((e.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])));
    setLista(ivs);
    return ivs;
  };

  useEffect(() => {
    if (acessoLoading || comecou) return;
    setComecou(true);
    if (!hasModule('contratacao')) { bot('Você não tem acesso ao módulo Contratação.'); setPasso('fim'); return; }
    (async () => {
      const ivs = await carregar();
      if (!ivs) return;
      if (!ivs.length) { bot('Nenhuma entrevista marcada para hoje.'); setPasso('fim'); return; }
      const pend = ivs.filter((iv) => iv.status === 'agendada').length;
      bot(`*${ivs.length} entrevista(s) hoje*${pend ? ` · ${pend} a registrar` : ''}\nToque numa pessoa.`);
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acessoLoading]);

  const nome = (iv: Entrevista) => nomes[iv.candidate_id] ?? 'Candidato';
  const sel = lista.find((iv) => iv.id === selId) ?? null;

  const abrir = (iv: Entrevista) => {
    setSelId(iv.id);
    eu(`${horaBR(iv.scheduled_at)} ${nome(iv)}`);
    bot([
      `*${nome(iv)}*`,
      `${horaBR(iv.scheduled_at)} · ${FORMATO[iv.format] ?? iv.format}${iv.company_id && empresas[iv.company_id] ? ` · ${empresas[iv.company_id]}` : ''}`,
      ...(iv.location ? [`Local: ${iv.location}`] : []),
      ...(iv.interviewer ? [`Entrevistador: ${iv.interviewer}`] : []),
      `Status: ${STATUS[iv.status] ?? iv.status}`,
    ].join('\n'));
    setPasso('detalhe');
  };

  const pedir = (s: 'realizada' | 'faltou') => {
    setNovo(s);
    eu(s === 'realizada' ? 'Compareceu' : 'Faltou');
    bot(s === 'realizada'
      ? `Marcar que ${nome(sel!).split(' ')[0]} compareceu? O questionário e a decisão você preenche no registro.`
      : `Marcar que ${nome(sel!).split(' ')[0]} faltou?`);
    setPasso('confirmar');
  };

  const gravar = async () => {
    const iv = sel!;
    setPasso('gravando');
    const patch: Record<string, unknown> = { status: novo, updated_at: new Date().toISOString() };
    if (novo !== 'realizada') patch.recommendation = null; // igual à tela: decisão só vale para realizada
    const { error } = await supabase.from('hiring_interviews').update(patch).eq('id', iv.id);
    if (error) { bot(`❌ Não consegui salvar: ${error.message}`); setPasso('detalhe'); return; }
    setLista((l) => l.map((x) => (x.id === iv.id ? { ...x, status: novo } : x)));
    bot(`✅ ${nome(iv)}: ${novo === 'realizada' ? 'compareceu' : 'faltou'}.`);
    setPasso('detalhe');
  };

  return (
    <Roteiro titulo="Entrevistas de hoje" icone="ri-chat-voice-line" cor="bg-violet-50 text-violet-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Salvando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {lista.map((iv) => (
            <Opcao key={iv.id} onClick={() => abrir(iv)} detalhe={STATUS[iv.status] ?? iv.status}>{horaBR(iv.scheduled_at)} · {nome(iv)}</Opcao>
          ))}
          <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Entrevistas', onClick: () => irPara('/contratacao?aba=entrevistas') }]} />
        </>
      )}
      {passo === 'detalhe' && sel && (
        <>
          {sel.status !== 'realizada' && <Opcao onClick={() => pedir('realizada')}>Compareceu</Opcao>}
          {sel.status !== 'faltou' && <Opcao perigo onClick={() => pedir('faltou')}>Faltou</Opcao>}
          <Opcao onClick={() => irPara(`/contratacao?aba=entrevistas&entrevista=${sel.id}`)}>Abrir registro</Opcao>
          <Opcao onClick={() => irPara(`/contratacao?candidato=${sel.candidate_id}`)}>Abrir ficha</Opcao>
          <OpcaoNeutra onClick={() => { setSelId(null); setPasso('lista'); }}>Voltar à lista</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && sel && (
        <>
          <Opcao onClick={gravar}>Sim, salvar</Opcao>
          <OpcaoNeutra onClick={() => { bot('Ok, nada foi salvo.'); setPasso('detalhe'); }}>Não</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Contratação', onClick: () => irPara('/contratacao') }]} />}
    </Roteiro>
  );
}
