// Cartão "Fique de olho" da tela Hoje (2026-10-05): o que a equipe fez de alto valor (cancelamento a partir de
// R$ 100, desconto a partir de R$ 50, sangria a partir de R$ 500), num cartão só por loja e dia. Desenho:
// docs/prototipos/sistema-proposta.html › telas/hoje.js › "Fique de olho".
//
// É CIÊNCIA, não tarefa: fica fora do número vermelho de "Agora" e do "Tudo em dia" (a regra está em
// supabase/functions/_shared/hoje-organizar.ts: AVISO). Por isso a Hoje o mostra numa seção própria em vez de
// dentro de "Pode esperar", que fica recolhido. "Estou ciente" fecha o cartão (fn_pendencia_marcar → resolvida,
// com quem deu ciência); se chegar ocorrência nova no mesmo dia, o cartão volta só com o que é novo.
// Quem vê: Administrador e Supervisor (pendencia-visivel.ts › KINDS_GESTAO). Quem dá ciência: SÓ o Administrador
// (o Supervisor vê o cartão sem o botão; fn_pendencia_marcar também barra, migração 20261005171500). Quem criou: audit-write.
import { useState } from 'react';
import { kindConfig } from '@/contexts/PendenciasContext';
import { itensDoPayload, quemTexto, rotaDoItem, type ItemOlho } from '../../../supabase/functions/_shared/fique-de-olho';
import type { ItemHoje } from './organizar';
import { diasEntre } from './organizar';

const BTN = 'h-10 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold whitespace-nowrap disabled:opacity-50 cursor-pointer transition-colors';
const PRINCIPAL = `${BTN} bg-amber-500 hover:bg-amber-400 text-zinc-900`;
const VER = 'h-9 px-3 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-[12px] font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap';

const ICONE: Record<ItemOlho['regra'], { icone: string; cls: string }> = {
  cancelamento: { icone: 'ri-close-circle-line', cls: 'bg-red-50 text-red-600' },
  desconto: { icone: 'ri-percent-line', cls: 'bg-orange-50 text-orange-600' },
  sangria: { icone: 'ri-hand-coin-line', cls: 'bg-orange-50 text-orange-600' },
};

const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

interface Props {
  itens: ItemHoje[];
  hoje: string;
  mostrarLoja: boolean;
  abrir: (tenantId: string, rota: string) => void;
  marcar: (id: string, acao: 'vista' | 'descartada' | 'resolvida', motivo?: string) => Promise<void>;
  onMudou: () => void;
  /** Quem dá ciência é só o Administrador (e o dono da plataforma) da loja do cartão; o Supervisor só vê. O servidor também barra. */
  podeDarCiencia: (tenantId: string) => boolean;
}

/** A seção inteira: um cartão por loja/dia. Não renderiza nada sem itens. */
export default function FiqueDeOlho({ itens, hoje, mostrarLoja, abrir, marcar, onMudou, podeDarCiencia }: Props) {
  if (!itens.length) return null;
  const total = itens.reduce((s, c) => s + itensDoPayload(c.principal.payload).length, 0);
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2 px-0.5">
        <h2 className="text-[15px] font-extrabold text-zinc-900 whitespace-nowrap">Fique de olho</h2>
        <span className="px-2 rounded-full text-[11px] font-bold leading-5 bg-amber-100 text-amber-800">{total}</span>
        <span className="text-[12px] text-zinc-400 truncate">o que a equipe fez · só para ficar sabendo</span>
      </div>
      <div className="space-y-2.5">
        {itens.map((c) => <CartaoOlho key={c.chave} cartao={c} hoje={hoje} mostrarLoja={mostrarLoja} abrir={abrir} marcar={marcar} onMudou={onMudou} podeDarCiencia={podeDarCiencia} />)}
      </div>
    </section>
  );
}

function CartaoOlho({ cartao, hoje, mostrarLoja, abrir, marcar, onMudou, podeDarCiencia }: Omit<Props, 'itens'> & { cartao: ItemHoje }) {
  const p = cartao.principal;
  const cfg = kindConfig(p.kind);
  const lista = itensDoPayload(p.payload).slice().reverse(); // o mais novo em cima
  const dia = typeof p.payload?.dia === 'string' ? p.payload.dia : p.ref;
  const jaVistos = Number(p.payload?.ja_vistos ?? 0);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const darCiencia = podeDarCiencia(cartao.tenantId);

  const ciente = async () => {
    setOcupado(true); setErro(null);
    try { await marcar(p.id, 'resolvida', 'ciente pela tela Hoje (Fique de olho)'); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setOcupado(false); }
  };

  // Cartão de um dia que passou sem ciência: diz de que dia é (o texto do dia é "hoje" só para hoje).
  const atraso = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? diasEntre(dia, hoje) : 0;
  const quando = atraso <= 0 ? 'hoje' : atraso === 1 ? 'ontem' : ddmm(dia as string);

  return (
    <div className="rounded-2xl border border-zinc-200 border-l-4 border-l-amber-400 bg-white px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl ${cfg.corBg}`}><i className={`${cfg.icone} ${cfg.corTexto} text-lg`} /></span>
        <div className="flex-1 min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold leading-tight">
            {mostrarLoja && cartao.loja && <span className="px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 uppercase tracking-wide text-[10px] font-bold">{cartao.loja}</span>}
            <span className={cfg.corTexto}>{cfg.label}</span>
            {atraso > 0 && <span className="px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 text-[10px] font-bold uppercase tracking-wide">{quando}</span>}
          </p>
          <p className="mt-1 text-[15px] font-bold text-zinc-900 leading-snug">
            {lista.length === 1 ? 'Uma coisa da equipe' : `${lista.length} coisas da equipe`} {quando === 'hoje' ? 'hoje' : quando === 'ontem' ? 'ontem' : `em ${quando}`}
          </p>
          <p className="text-[13px] text-zinc-500 leading-snug mt-0.5">
            {darCiencia
              ? 'Antes só apitava no aparelho do caixa. Confira e dê ciência — não precisa resolver nada.'
              : 'Antes só apitava no aparelho do caixa. Confira — não precisa resolver nada.'}
            {jaVistos > 0 && <> Fora {jaVistos === 1 ? 'a que você já viu' : `as ${jaVistos} que você já viu`}.</>}
          </p>
        </div>
      </div>

      <div className="mt-2.5 sm:pl-12 divide-y divide-zinc-100 rounded-xl border border-zinc-100 bg-zinc-50/50">
        {lista.map((i) => <LinhaOcorrencia key={`${i.id}|${i.ts}`} i={i} onVer={() => abrir(cartao.tenantId, rotaDoItem(i))} />)}
      </div>

      {erro && <p className="mt-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{erro}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-3 sm:pl-12">
        {darCiencia ? (
          <button disabled={ocupado} onClick={ciente} className={PRINCIPAL}>
            <i className="ri-check-line" /> {lista.length > 1 ? `Estou ciente dos ${lista.length}` : 'Estou ciente'}
          </button>
        ) : (
          <p className="text-[12px] font-semibold text-zinc-500"><i className="ri-eye-line" /> Quem dá ciência é o Administrador.</p>
        )}
      </div>
    </div>
  );
}

function LinhaOcorrencia({ i, onVer }: { i: ItemOlho; onVer: () => void }) {
  const ic = ICONE[i.regra] ?? ICONE.desconto;
  // "Caixa" é o login da loja, de várias pessoas: o nome da pessoa só aparece quando o evento tem (quem autorizou).
  const sub = [quemTexto(i), i.hora, i.motivo ? `motivo “${i.motivo}”` : null, i.ritmo].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg ${ic.cls}`}><i className={`${ic.icone} text-base`} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-zinc-900 leading-snug">{i.titulo}</p>
        <p className="text-[12px] text-zinc-500 leading-snug">{sub}{i.generico && !i.autorizou ? ' · login da loja, não diz quem' : ''}</p>
      </div>
      <button onClick={onVer} className={VER}>Ver</button>
    </div>
  );
}
