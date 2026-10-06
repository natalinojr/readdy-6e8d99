// Dia de pagar e o pacote da semana (2026-10-06). Em vez de pagar conta por conta ao longo da semana, num
// dia só: o que tem boleto/Pix guardado e nenhum aviso vai junto, com um PIN. O que tem aviso (não chegou,
// valor fora…) fica separado para olhar uma por uma. Regra: _shared/pacote-semana.ts (a mesma do cartão da Hoje).
import { useMemo, useState } from 'react';
import { assistente } from '../trilha/api';
import { caixaDaLoja, DIAS_SEMANA, pacoteDaSemana, type AvisoPagar, type CaixaLoja } from '@/lib/pagamentos';
import { AcoesPagar, brl, Cartao, ddmm, Pilula, PRINCIPAL, Secao, Vazio } from './comum';

interface PagamentoInter { id: string; status: string; status_label?: string; error?: string | null; amount?: number }
type Resultado = { id: string; nome: string; ok: boolean; texto: string };

interface Props {
  caixa: CaixaLoja[]; avisos: Record<string, AvisoPagar[]>; hoje: string; mostrarLoja: boolean;
  dono: boolean; financeiro: boolean; diaDePagar: number | null; onDia: (d: number | null) => Promise<void>; onMudou: () => void;
}

export default function PacoteView({ caixa, avisos, hoje, mostrarLoja, dono, financeiro, diaDePagar, onDia, onMudou }: Props) {
  const dia = diaDePagar ?? new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const p = useMemo(() => pacoteDaSemana(caixa, avisos, hoje, dia), [caixa, avisos, hoje, dia]);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const escolhidas = p.prontas.filter((x) => !fora.has(x.id));
  const total = escolhidas.reduce((s, x) => s + x.valor, 0);
  const [pin, setPin] = useState('');
  const [pagando, setPagando] = useState(false);
  const [res, setRes] = useState<Resultado[]>([]);
  const [salvandoDia, setSalvandoDia] = useState(false);

  const pagarTodas = async () => {
    if (!/^\d{4,8}$/.test(pin) || pagando) return;
    setPagando(true); setRes([]);
    const out: Resultado[] = [];
    const cancelar = (id: string) => assistente('pay', { id, op: 'no' }).catch(() => null);
    for (const x of escolhidas) {
      let prepId: string | null = null;
      try {
        const prep = await assistente<{ payment: PagamentoInter }>('conta_pagar', { bill_id: x.id });
        prepId = prep.payment.id;
        if (!['draft', 'awaiting_pin'].includes(prep.payment.status)) throw new Error(prep.payment.error ?? prep.payment.status_label ?? 'o Inter não deixou preparar');
        // O Inter recalcula boleto vencido (multa e juros): se o valor não é o que a lista mostrou, não paga
        // no escuro — cancela este e deixa para conferir um por um.
        if (Math.abs(Number(prep.payment.amount ?? 0) - x.valor) > 0.01) {
          await cancelar(prep.payment.id);
          out.push({ id: x.id, nome: x.nome, ok: false, texto: `o Inter calculou ${brl(Number(prep.payment.amount ?? 0))} (multa/juros?) — pague esta pela conta, conferindo` });
          setRes([...out]);
          continue;
        }
        const pg = await assistente<{ payment: PagamentoInter }>('pay', { id: prep.payment.id, op: 'ok', pin, lote: true });
        const falhou = ['rejected', 'failed', 'expired'].includes(pg.payment.status);
        out.push({ id: x.id, nome: x.nome, ok: !falhou, texto: falhou ? (pg.payment.error ?? 'não foi pago') : pg.payment.status === 'paid' ? 'pago' : 'enviado — falta aprovar no app do Inter' });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        out.push({ id: x.id, nome: x.nome, ok: false, texto: m });
        setRes([...out]);
        const pinErrado = /PIN errado|PIN bloqueado|Bloqueado/i.test(m);
        // Rascunho que ficou aberto (PIN errado, aviso novo): cancela para não travar a conta por 30 min
        if (prepId) await cancelar(prepId);
        if (pinErrado) break; // para tudo, sem bloquear o PIN tentando de novo
        continue;
      }
      setRes([...out]);
    }
    setPin(''); setPagando(false); onMudou();
  };

  return (
    <div className="flex flex-col gap-5">
      <Cartao>
        <div className="flex flex-wrap items-center gap-3">
          <i className="ri-calendar-check-line text-xl text-emerald-600" />
          <div className="flex-1 min-w-[220px]">
            <b className="text-sm">Dia de pagar</b>
            <p className="text-xs text-zinc-500">
              {diaDePagar == null ? 'Sem dia escolhido — abaixo, o que vence nos próximos 7 dias.' : `Toda ${DIAS_SEMANA[diaDePagar]}, a Hoje mostra o pacote da semana. Um PIN paga todas.`}
            </p>
          </div>
          {dono && (
            <select value={diaDePagar ?? ''} disabled={salvandoDia} onChange={async (e) => {
              setSalvandoDia(true);
              try { await onDia(e.target.value === '' ? null : Number(e.target.value)); } finally { setSalvandoDia(false); }
            }} className="h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm">
              <option value="">Sem dia de pagar</option>
              {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
        </div>
      </Cartao>

      {/* Dinheiro × o que vence (régua do aviso "Caixa da semana") */}
      <div className="grid gap-2 md:grid-cols-2">
        {caixa.map((c) => {
          const cx = caixaDaLoja(c, hoje);
          if (!cx) return <Cartao key={c.tenant_id}><p className="text-xs text-zinc-500">{c.loja}: sem conta bancária cadastrada.</p></Cartao>;
          return (
            <Cartao key={c.tenant_id} destaque={cx.cobre ? undefined : 'red'}>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400">{mostrarLoja ? c.loja : 'Dinheiro × o que vence'}</p>
              <p className="text-sm mt-1">
                Vencidas + próximos 7 dias: <b>{brl(cx.precisa)}</b> · no banco: <b>{brl(cx.noBanco)}</b>
              </p>
              <p className={`text-sm font-bold ${cx.cobre ? 'text-emerald-700' : 'text-red-600'}`}>
                {cx.cobre ? 'O dinheiro cobre.' : `Faltam ${brl(cx.falta)}${cx.faltaEm ? ` a partir de ${ddmm(cx.faltaEm)}` : ''} — decida o que pagar primeiro.`}
              </p>
            </Cartao>
          );
        })}
      </div>

      <Secao titulo={`Pacote: pronto para pagar (até ${ddmm(p.ate)})`} n={p.prontas.length} tom="green"
        dica="Tem boleto ou Pix guardado e nenhum aviso. Tire o que não quer pagar agora.">
        {!p.prontas.length ? <Vazio texto="Nada pronto para pagar no pacote." /> : (
          <Cartao>
            <div className="divide-y divide-zinc-100">
              {p.prontas.map((x) => (
                <label key={x.id} className="py-2 flex items-center gap-3 text-sm cursor-pointer">
                  <input type="checkbox" checked={!fora.has(x.id)} disabled={pagando} onChange={(e) => setFora((s) => { const n = new Set(s); if (e.target.checked) n.delete(x.id); else n.add(x.id); return n; })} />
                  <Pilula tom={x.vencimento < hoje ? 'red' : x.vencimento === hoje ? 'amber' : 'zinc'}>{x.vencimento < hoje ? `venceu ${ddmm(x.vencimento)}` : `vence ${ddmm(x.vencimento)}`}</Pilula>
                  <span className="flex-1 min-w-0 truncate"><b>{x.nome}</b>{mostrarLoja ? <span className="text-zinc-500"> · {x.loja}</span> : null}</span>
                  <span className="tabular-nums font-semibold">{brl(x.valor)}</span>
                  {res.find((r) => r.id === x.id) && (
                    <span className={`text-xs ${res.find((r) => r.id === x.id)!.ok ? 'text-emerald-700' : 'text-red-600'}`}>{res.find((r) => r.id === x.id)!.texto}</span>
                  )}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-zinc-100">
              <b className="text-sm flex-1">{escolhidas.length} {escolhidas.length === 1 ? 'conta' : 'contas'} · {brl(total)}</b>
              {dono ? (
                <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void pagarTodas(); }}>
                  <input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={pin} disabled={pagando}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="PIN"
                    className="w-24 h-9 text-center tracking-[0.3em] font-bold border-2 border-zinc-200 focus:border-emerald-400 rounded-xl outline-none" />
                  <button type="submit" disabled={pagando || pin.length < 4 || !escolhidas.length} className={PRINCIPAL}>
                    <i className="ri-lock-2-line" /> {pagando ? 'Pagando…' : `Pagar as ${escolhidas.length}`}
                  </button>
                </form>
              ) : <span className="text-xs text-zinc-500">Quem paga pelo Inter é o dono; dê baixa uma por uma do que já foi pago.</span>}
            </div>
            {res.length > 0 && !pagando && (
              <p className="text-xs text-zinc-600 mt-2">{res.filter((r) => r.ok).length} de {res.length} enviados ao Inter. Os enviados precisam da sua aprovação no app do Inter; a baixa sai sozinha pelo extrato.</p>
            )}
          </Cartao>
        )}
      </Secao>

      {p.comAviso.length > 0 && (
        <Secao titulo="Com aviso — olhe uma por uma" n={p.comAviso.length} tom="red">
          {p.comAviso.map((x) => (
            <Cartao key={x.id} destaque="amber">
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom={x.vencimento < hoje ? 'red' : 'zinc'}>{x.vencimento < hoje ? `venceu ${ddmm(x.vencimento)}` : `vence ${ddmm(x.vencimento)}`}</Pilula>
                <span className="flex-1 min-w-[200px] text-sm"><b>{x.nome}</b> · {brl(x.valor)}{mostrarLoja ? <span className="text-zinc-500"> · {x.loja}</span> : null}</span>
              </div>
              <ul className="mt-2 text-xs text-amber-900 space-y-0.5">{x.avisos.map((a) => <li key={a.texto}><i className="ri-error-warning-line" /> {a.texto}</li>)}</ul>
              <div className="mt-2"><AcoesPagar tenantId={x.tenant_id} billId={x.id} dono={dono} financeiro={financeiro} onMudou={onMudou} rotuloPagar="Pagar mesmo assim…" /></div>
            </Cartao>
          ))}
        </Secao>
      )}

      {p.semJeito.length > 0 && (
        <Secao titulo="Sem boleto nem Pix guardado" n={p.semJeito.length} tom="amber" dica="Falta o jeito de pagar: guarde o boleto (foto/código) ou pague pela chave Pix do fornecedor.">
          {p.semJeito.map((x) => (
            <Cartao key={x.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom={x.vencimento < hoje ? 'red' : 'zinc'}>{x.vencimento < hoje ? `venceu ${ddmm(x.vencimento)}` : `vence ${ddmm(x.vencimento)}`}</Pilula>
                <span className="flex-1 min-w-[200px] text-sm"><b>{x.nome}</b> · {brl(x.valor)}{mostrarLoja ? <span className="text-zinc-500"> · {x.loja}</span> : null}</span>
              </div>
              <div className="mt-2"><AcoesPagar tenantId={x.tenant_id} billId={x.id} dono={dono} financeiro={financeiro} onMudou={onMudou} /></div>
            </Cartao>
          ))}
        </Secao>
      )}
      {!dono && <p className="text-xs text-zinc-400"><i className="ri-information-line" /> O dia de pagar é escolhido pelo dono.</p>}
    </div>
  );
}
