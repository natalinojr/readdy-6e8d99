// Mercadoria a prazo (2026-10-06): cada nota anda em dois trilhos — a mercadoria (chegou? chegou certo? — a
// loja confirma no Receber mercadoria) e o dinheiro (virou compra → conta a pagar → pago). Só fica "pronta
// para pagar" com os dois em dia. Itens no estoque são importantes, mas não travam o pagamento.
// Decisão do dono: não chegou / chegou diferente só AVISA e pede o motivo — quem decide é a pessoa.
import { GRUPO_MERC, grupoMercadoria, trilhos, type AvisoPagar, type GrupoMerc, type Mercadoria, type NotaSemCompra, type Passo } from '@/lib/pagamentos';
import { AcoesPagar, brl, Cartao, ddmm, diaBR, Pilula, PRINCIPAL, SECUNDARIO, Secao, Vazio } from './comum';

interface Props {
  compras: Mercadoria[]; notas: NotaSemCompra[]; avisos: Record<string, AvisoPagar[]>;
  mostrarLoja: boolean; dono: boolean; financeiro: boolean; onMudou: () => void; irPara: (tenantId: string, rota: string) => void;
}

const ORDEM: GrupoMerc[] = ['nao_pague', 'sem_boleto', 'pronta', 'paga'];

export default function MercadoriaView({ compras, notas, avisos, mostrarLoja, dono, financeiro, onMudou, irPara }: Props) {
  const porGrupo = new Map<GrupoMerc, Mercadoria[]>();
  for (const c of compras) { const g = grupoMercadoria(c, avisos); porGrupo.set(g, [...(porGrupo.get(g) ?? []), c]); }
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-zinc-600 -mt-1">
        Toda nota de mercadoria anda em <b>dois trilhos</b>: a <b>mercadoria</b> (chegou? chegou certo? — a loja confirma no Receber mercadoria)
        e o <b>dinheiro</b> (virou compra → conta a pagar → pago). Só fica pronta para pagar com os dois em dia. Ligar os itens ao estoque não trava o pagamento.
      </p>
      {!compras.length && !notas.length && <Vazio texto="Nenhuma compra a prazo em aberto." />}
      {ORDEM.slice(0, 1).map((g) => (porGrupo.get(g)?.length ? (
        <Secao key={g} titulo={GRUPO_MERC[g].titulo} n={porGrupo.get(g)!.length} tom={GRUPO_MERC[g].tom}>
          {porGrupo.get(g)!.map((c) => <CartaoCompra key={c.id} c={c} avisos={avisos} mostrarLoja={mostrarLoja} dono={dono} financeiro={financeiro} onMudou={onMudou} irPara={irPara} />)}
        </Secao>
      ) : null))}
      {notas.length > 0 && (
        <Secao titulo="Falta virar compra" n={notas.length} tom="amber" dica="A nota chegou da SEFAZ, mas ainda não virou compra — sem isso não nasce a conta a pagar. Os itens podem ficar para depois.">
          {notas.map((n) => <CartaoNota key={n.id} n={n} mostrarLoja={mostrarLoja} irPara={irPara} />)}
        </Secao>
      )}
      {ORDEM.slice(1).map((g) => (porGrupo.get(g)?.length ? (
        <Secao key={g} titulo={GRUPO_MERC[g].titulo} n={porGrupo.get(g)!.length} tom={GRUPO_MERC[g].tom}
          dica={g === 'sem_boleto' ? 'Chegou certo, mas o código do boleto ainda não está no sistema. O prazo muda a cada compra, então aqui é só aviso.' : undefined}>
          {porGrupo.get(g)!.map((c) => <CartaoCompra key={c.id} c={c} avisos={avisos} mostrarLoja={mostrarLoja} dono={dono} financeiro={financeiro} onMudou={onMudou} irPara={irPara} />)}
        </Secao>
      ) : null))}
    </div>
  );
}

function Passos({ titulo, quem, nomes, passos, subs }: { titulo: string; quem: string; nomes: string[]; passos: Passo[]; subs: Array<string | null> }) {
  const cor: Record<Passo, string> = { ok: 'bg-emerald-600 text-white', agora: 'bg-amber-500 text-white', problema: 'bg-red-600 text-white', espera: 'bg-white border-2 border-zinc-300' };
  const icone: Record<Passo, string> = { ok: 'ri-check-line', agora: 'ri-error-warning-line', problema: 'ri-close-line', espera: '' };
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2.5">
      <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-400 mb-2 flex justify-between"><span>{titulo}</span><span>{quem}</span></p>
      <div className="flex">
        {passos.map((p, i) => (
          <div key={i} className="flex-1 text-center relative text-[11.5px] text-zinc-600 px-0.5">
            {i > 0 && <span className={`absolute top-[9px] -left-1/2 w-full h-0.5 ${passos[i] === 'ok' ? 'bg-emerald-600' : 'bg-zinc-200'}`} />}
            <span className={`relative z-10 mx-auto mb-1 w-5 h-5 rounded-full grid place-items-center text-[12px] ${cor[p]}`}>{icone[p] && <i className={icone[p]} />}</span>
            {nomes[i]}
            {subs[i] && <small className="block text-[10.5px] text-zinc-400">{subs[i]}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CartaoCompra({ c, avisos, mostrarLoja, dono, financeiro, onMudou, irPara }: {
  c: Mercadoria; avisos: Record<string, AvisoPagar[]>; mostrarLoja: boolean; dono: boolean; financeiro: boolean; onMudou: () => void; irPara: (t: string, r: string) => void;
}) {
  const g = grupoMercadoria(c, avisos);
  const t = trilhos(c);
  const abertas = c.contas.filter((x) => x.status !== 'paid');
  const prox = abertas[0];
  const avisosDaCompra = [...new Map(abertas.flatMap((x) => avisos[x.id] ?? []).map((a) => [a.texto, a])).values()];
  const pill = g === 'nao_pague' ? (!c.chegou_em ? <Pilula tom="amber">Esperando chegar</Pilula> : c.diferente ? <Pilula tom="red">Chegou diferente</Pilula> : <Pilula tom="red">Com aviso</Pilula>)
    : g === 'sem_boleto' ? <Pilula tom="amber">Sem boleto ainda</Pilula> : g === 'pronta' ? <Pilula tom="green">Tudo certo</Pilula> : <Pilula tom="zinc">Paga</Pilula>;
  return (
    <Cartao destaque={g === 'nao_pague' ? (c.chegou_em ? 'red' : 'amber') : undefined}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[200px]">
          <b className="text-[14.5px]">{c.fornecedor}{c.numero ? ` · NF ${c.numero}` : ''}</b>
          <p className="text-xs text-zinc-500">
            {mostrarLoja ? `${c.loja} · ` : ''}{brl(c.valor)}
            {prox ? ` · ${abertas.length > 1 ? `${abertas.length} parcelas, a próxima ` : ''}vence ${ddmm(prox.vence)}` : ` · paga em ${ddmm(c.contas[c.contas.length - 1]?.pago_em)}`}
            {c.bonus ? ' · bonificação' : ''}
          </p>
        </div>
        {pill}
      </div>
      {g !== 'paga' && (
        <div className="grid md:grid-cols-2 gap-2 mt-3">
          <Passos titulo="Mercadoria" quem="loja" nomes={['Nota emitida', 'Chegou', 'Conferida']} passos={t.mercadoria}
            subs={[ddmm(c.emitida), c.chegou_em ? diaBR(c.chegou_em) : 'ninguém confirmou', c.diferente ? 'veio diferente' : null]} />
          <Passos titulo="Dinheiro" quem="financeiro" nomes={['Virou compra', 'Conta a pagar', 'Pago']} passos={t.dinheiro}
            subs={[null, prox ? `vence ${ddmm(prox.vence)}${prox.boleto && !prox.tem_boleto ? ' · sem boleto' : ''}` : null, null]} />
        </div>
      )}
      {g !== 'paga' && (
        <p className="text-xs text-zinc-500 mt-2 pt-2 border-t border-dashed border-zinc-200 flex flex-wrap items-center gap-2">
          <Pilula tom={c.itens_ligados >= c.itens ? 'green' : 'amber'}><i className="ri-archive-line" /> Estoque: {c.itens_ligados} de {c.itens} itens ligados</Pilula>
          {c.itens_ligados < c.itens && <button onClick={() => irPara(c.tenant_id, '/financeiro?tab=itens')} className="text-sky-700 font-semibold cursor-pointer">ligar depois</button>}
          <span>· não trava o pagamento</span>
        </p>
      )}
      {avisosDaCompra.length > 0 && (
        <ul className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-1">
          {avisosDaCompra.map((a) => <li key={a.texto}><i className="ri-error-warning-line" /> {a.texto}</li>)}
          <li className="text-amber-700">Se pagar mesmo assim, o sistema pede o motivo (fica registrado).</li>
        </ul>
      )}
      {g !== 'paga' && (
        <div className="flex flex-wrap gap-2 mt-3">
          {!c.chegou_em && !c.bonus && (
            <button onClick={() => irPara(c.tenant_id, `/receber?abrir=compra:${c.id}`)} className={SECUNDARIO}><i className="ri-truck-line" /> Chegou — conferir</button>
          )}
          {prox && (financeiro || dono) && (
            <AcoesPagar tenantId={c.tenant_id} billId={prox.id} dono={dono} financeiro={financeiro} onMudou={onMudou}
              rotuloPagar={g === 'nao_pague' ? 'Pagar mesmo assim…' : 'Pagar'} />
          )}
        </div>
      )}
    </Cartao>
  );
}

function CartaoNota({ n, mostrarLoja, irPara }: { n: NotaSemCompra; mostrarLoja: boolean; irPara: (t: string, r: string) => void }) {
  const parc = (n.parcelas ?? []).filter((p) => p.vencimento).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  return (
    <Cartao destaque="amber">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <b className="text-[14.5px]">{n.fornecedor}{n.numero ? ` · NF ${n.numero}` : ''}</b>
          <p className="text-xs text-zinc-500">{mostrarLoja ? `${n.loja} · ` : ''}{brl(n.valor)} · emitida {ddmm(n.emitida)}
            {parc.length ? ` · ${parc.length > 1 ? `${parc.length} boletos, o primeiro ` : 'boleto '}vence ${ddmm(parc[0].vencimento)}` : ''}</p>
        </div>
        <button onClick={() => irPara(n.tenant_id, `/financeiro?tab=notas-entrada&nota=${n.id}`)} className={PRINCIPAL}><i className="ri-file-list-3-line" /> Virar compra</button>
      </div>
    </Cartao>
  );
}
