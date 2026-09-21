// Bolhas de conversa do WhatsApp (wa_log) + histórico do entrevistador (fora do wa_log). Extraído de
// AgendamentosPainel.tsx (T04) para ser usado ali e também na aba Conversa da ficha do candidato (T06).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Modelos do WhatsApp (mesmo texto de supabase/functions/_shared/wa.ts › TEMPLATES). Registros antigos
// guardavam só "[modelo nome] a | b | c"; aqui viram o texto que o candidato leu.
const MODELOS: Record<string, string> = {
  convite_entrevista: 'Olá, {{1}}! Aqui é da {{2}}. Recebemos seu currículo para a vaga de {{3}} e queremos marcar uma entrevista com você. Posso te mandar os horários disponíveis? Responda esta mensagem para continuar.',
  lembrete_entrevista: 'Olá, {{1}}! Lembrete da sua entrevista na {{2}}: {{3}}. Local: {{4}}. Você confirma presença? Responda sim ou não.',
  aviso_equipe_entrevista: 'Atualização do agendamento de entrevistas da vaga {{1}}: {{2}}. Responda por aqui se precisar.',
};
function textoModelo(t: string): string {
  const m = t.match(/^\[modelo ([a-z_]+)\] ?(.*)$/s);
  if (!m || !MODELOS[m[1]]) return t;
  const params = m[2].split(' | ');
  return MODELOS[m[1]].replace(/\{\{(\d+)\}\}/g, (_x, n) => params[Number(n) - 1] ?? '');
}
// Mesma chave do banco (wa_phone_key): DDD + 8 dígitos, sem 55 e sem o 9 do celular.
const phoneKey = (p: string) => {
  let d = p.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d;
};
const ORIGEM: Record<string, string> = { candidatura: 'link de candidatura', agendamento: 'agendamento', manual: 'enviada pela equipe' };
export interface Hist { at: string; de: string; texto: string }
type WaLog = { id: number; direction: 'in' | 'out'; origin: string | null; kind: string | null; text: string | null; at: string };
// Duplicado de AgendamentosPainel.tsx (pré-Fase 2): usado também fora das bolhas, no render de
// passos(s).map(...) — não pode sair de lá, só ser copiado aqui.
const quando = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

interface Props {
  phone: string | null; // número já resolvido por quem chama; a phoneKey é calculada aqui dentro
  history?: Hist[];      // respostas do entrevistador fora do wa_log (AgendamentosPainel passa `s.history`; a ficha não passa nada)
  refreshKey?: string | number; // muda a cada `carregar()` do painel para reconsultar o wa_log com o accordion aberto; a ficha não passa (busca só uma vez)
}

export default function ConversaWhatsApp({ phone, history = [], refreshKey }: Props) {
  const [logs, setLogs] = useState<WaLog[] | null>(null);
  useEffect(() => {
    if (!phone) { setLogs([]); return; }
    let vivo = true;
    supabase.from('wa_log').select('id, direction, origin, kind, text, at').eq('phone_key', phoneKey(phone)).order('at').order('id').limit(500)
      .then(({ data }) => { if (vivo) setLogs((data ?? []) as WaLog[]); });
    return () => { vivo = false; };
  }, [phone, refreshKey]);

  return (
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
      {(() => {
        // Com registro completo: tudo do número + respostas do entrevistador (vêm de outro número).
        // Enquanto o wa_log ainda não chegou (logs === null), mostra o que já há em history (como
        // antes deste componente existir) em vez de um texto de carregamento.
        const lg = logs;
        const itens: { at: string; de: string; texto: string; origem: string | null }[] = lg && lg.length
          ? [...lg.map((l) => ({ at: l.at, de: l.direction === 'in' ? 'candidato' : 'assistente', texto: l.text ?? '', origem: l.origin })),
            ...(history ?? []).filter((h) => h.de === 'gestor').map((h) => ({ ...h, origem: null }))]
            .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          : (history ?? []).map((h) => ({ ...h, origem: null }));
        if (!itens.length) return <p className="text-xs text-zinc-400">Sem mensagens registradas.</p>;
        return itens.map((h, i) => {
          const meu = h.de === 'assistente';
          const tag = h.origem ? ORIGEM[h.origem] : null;
          return (
            <div key={i} className={`flex ${meu ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-2.5 py-1.5 text-xs whitespace-pre-wrap ${meu ? (h.origem === 'candidatura' ? 'bg-sky-100 text-sky-950' : 'bg-emerald-100 text-emerald-950') : h.de === 'gestor' ? 'bg-amber-100 text-amber-950' : 'bg-white border border-zinc-200 text-zinc-800'}`}>
                <p className="text-[9px] font-bold uppercase tracking-wider opacity-60 mb-0.5">
                  {meu ? 'Assistente' : h.de === 'gestor' ? 'Entrevistador' : 'Candidato'} · {quando(h.at)}{tag ? ` · ${tag}` : ''}
                </p>
                {textoModelo(h.texto)}
              </div>
            </div>
          );
        });
      })()}
    </div>
  );
}
