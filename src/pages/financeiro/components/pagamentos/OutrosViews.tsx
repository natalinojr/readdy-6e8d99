// Compra à vista, Pessoas, Avulsos e o "Caminho de cada tipo" (2026-10-06).
import { PEDIDO_NOME, type AvisoPagar, type Avulso, type CompraOnline, type ContaAberta, type Pessoa, type Servico } from '@/lib/pagamentos';
import { useState } from 'react';
import type { CompraVista } from './api';
import LigarItensCompra from './LigarItensCompra';
import { AcoesPagar, brl, Cartao, ddmm, diaBR, Pilula, PRINCIPAL, SECUNDARIO, Secao, Vazio } from './comum';

type IrPara = (tenantId: string, rota: string) => void;

// ── Compra à vista (notinha) ──────────────────────────────────────────────────────────────────
export function VistaView({ compras, mostrarLoja, irPara, tenantAtual, onMudou }: { compras: CompraVista[]; mostrarLoja: boolean; irPara: IrPara; tenantAtual: string | null; onMudou: () => void }) {
  // Ligar os itens aqui mesmo (2026-10-06): abre embaixo do cartão, sem sair da tela.
  const [aberta, setAberta] = useState<string | null>(null);
  const faltam = compras.filter((c) => c.itens_ligados < c.itens);
  const ok = compras.filter((c) => c.itens_ligados >= c.itens);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-zinc-600 -mt-1">
        Compra feita na hora (dinheiro do caixa ou Pix): a loja manda a notinha, o sistema lê e <b>já nasce paga</b> — não tem conta a pagar.
        O que pode faltar é só ligar item novo ao insumo, e isso não trava nada. Últimos 30 dias.
      </p>
      {!compras.length && <Vazio texto="Nenhuma compra à vista nos últimos 30 dias." />}
      {faltam.length > 0 && (
        <Secao titulo="Itens para ligar" n={faltam.length} tom="amber">
          {faltam.map((c) => (
            <Cartao key={c.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="amber">{c.itens - c.itens_ligados} {c.itens - c.itens_ligados === 1 ? 'item novo' : 'itens novos'}</Pilula>
                {c.esperando_extrato && <Pilula tom="zinc">paga na entrega · esperando o extrato</Pilula>}
                <div className="flex-1 min-w-[200px]">
                  <b className="text-sm">{c.fornecedor} · {brl(c.valor)}</b>
                  <p className="text-xs text-zinc-500">{mostrarLoja ? `${c.loja} · ` : ''}{c.forma ?? 'à vista'} · {ddmm(c.data)} · {c.itens_ligados} de {c.itens} itens ligados</p>
                </div>
                <button onClick={() => setAberta((a) => (a === c.id ? null : c.id))} className={aberta === c.id ? SECUNDARIO : PRINCIPAL}>
                  <i className={aberta === c.id ? 'ri-arrow-up-s-line' : 'ri-price-tag-3-line'} /> {aberta === c.id ? 'Fechar' : 'Ligar itens'}
                </button>
              </div>
              {aberta === c.id && <LigarItensCompra tenantId={c.tenant_id} purchaseId={c.id} podeCriar={c.tenant_id === tenantAtual} onMudou={onMudou} />}
            </Cartao>
          ))}
        </Secao>
      )}
      {ok.length > 0 && (
        <Secao titulo="Tudo certo" n={ok.length} tom="green">
          <Cartao>
            <div className="divide-y divide-zinc-100">
              {ok.map((c) => (
                <div key={c.id} className="py-2 flex items-center gap-3 text-sm">
                  <Pilula tom={c.esperando_extrato ? 'zinc' : 'green'}>{c.esperando_extrato ? 'Paga na entrega' : 'Paga'}</Pilula>
                  <span className="flex-1 min-w-0 truncate"><b>{c.fornecedor}</b> <span className="text-zinc-500">· {c.forma ?? 'à vista'} · {ddmm(c.data)}{mostrarLoja ? ` · ${c.loja}` : ''}</span></span>
                  <span className="tabular-nums font-semibold">{brl(c.valor)}</span>
                </div>
              ))}
            </div>
          </Cartao>
        </Secao>
      )}
    </div>
  );
}

// ── Pessoas ────────────────────────────────────────────────────────────────────────────────────
const ORIGEM_PESSOA: Record<string, string> = {
  freelancer: 'Freela', hr_payroll: 'Folha / encargo', hr_beneficio: 'Benefício', pedido_pagamento: 'Pedido',
  delivery_driver_settlement: 'Entregador', purchase: 'Reembolso',
};
function Prazo({ venc, hoje }: { venc: string; hoje: string }) {
  return <Pilula tom={venc < hoje ? 'red' : venc === hoje ? 'amber' : 'zinc'}>{venc < hoje ? `venceu ${ddmm(venc)}` : venc === hoje ? 'vence hoje' : `vence ${ddmm(venc)}`}</Pilula>;
}
const jeitoDePagar = (c: ContaAberta) => (c.cartao ? 'no cartão de crédito' : c.tem_boleto ? '' : c.boleto_pedido_em ? `boleto pedido em ${ddmm(c.boleto_pedido_em.slice(0, 10))}` : 'sem boleto nem Pix guardado');

export function PessoasView({ pessoas, contas, hoje, mostrarLoja, dono, financeiro, onMudou, irPara }: {
  pessoas: Pessoa[]; contas: ContaAberta[]; hoje: string; mostrarLoja: boolean; dono: boolean; financeiro: boolean; onMudou: () => void; irPara: IrPara;
}) {
  const aprovar = pessoas.filter((p) => p.tipo === 'aprovar');
  const folha = pessoas.filter((p) => p.tipo === 'folha');
  // Diárias de freela: um cartão por pessoa (várias diárias = várias contas)
  const freelas = new Map<string, ContaAberta[]>();
  for (const c of contas.filter((x) => x.origem === 'freelancer')) {
    const k = `${c.tenant_id}|${c.nome}`;
    freelas.set(k, [...(freelas.get(k) ?? []), c]);
  }
  const outras = contas.filter((c) => c.origem !== 'freelancer');
  const vazio = !aprovar.length && !folha.length && !contas.length;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-zinc-600 -mt-1">
        Quem trabalha para a loja: freelancers (diárias), salários e encargos da folha, benefícios, reembolsos, acerto de entregadores e
        pedidos de pagamento. A pergunta é sempre a mesma: <b>o trabalho foi registrado? já foi pago?</b>
      </p>
      {vazio && <Vazio texto="Nada pendente de pessoas agora." />}
      {aprovar.length > 0 && (
        <Secao titulo="Esperando aprovação" n={aprovar.length} tom="amber" dica="Pedido feito pela equipe. Aprovado, vira conta a pagar.">
          {aprovar.map((p) => (
            <Cartao key={p.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="amber">{PEDIDO_NOME[p.pedido ?? ''] ?? 'Pedido'}</Pilula>
                <div className="flex-1 min-w-[200px]">
                  <b className="text-sm">{p.nome} · {brl(p.valor)}</b>
                  <p className="text-xs text-zinc-500">{mostrarLoja ? `${p.loja} · ` : ''}{p.descricao ?? ''}{p.pedido_por ? ` · pedido por ${p.pedido_por}` : ''}</p>
                </div>
                <button onClick={() => irPara(p.tenant_id, '/receber?aprovar=1')} className={PRINCIPAL}><i className="ri-checkbox-circle-line" /> Decidir</button>
              </div>
            </Cartao>
          ))}
        </Secao>
      )}
      {(freelas.size > 0 || outras.length > 0) && (
        <Secao titulo="A pagar" n={freelas.size + outras.length} tom="red">
          {[...freelas.values()].map((cs) => {
            const c0 = cs[0];
            const venc = cs.map((c) => c.vencimento).sort()[0];
            return (
              <Cartao key={`f${c0.tenant_id}${c0.nome}`} destaque={venc < hoje ? 'red' : undefined}>
                <div className="flex flex-wrap items-center gap-3">
                  <Pilula tom="blue">Freela</Pilula>
                  <Prazo venc={venc} hoje={hoje} />
                  <span className="flex-1 min-w-[200px] text-sm"><b>{c0.nome} · {brl(cs.reduce((x, c) => x + Number(c.valor), 0))}</b>
                    <span className="block text-xs text-zinc-500">{mostrarLoja ? `${c0.loja} · ` : ''}{cs.length} {cs.length === 1 ? 'diária' : 'diárias'} a pagar</span></span>
                  <button onClick={() => irPara(c0.tenant_id, '/financeiro?tab=rh')} className={SECUNDARIO}><i className="ri-team-line" /> Pagar pelo RH</button>
                </div>
              </Cartao>
            );
          })}
          {outras.map((c) => (
            <Cartao key={c.id} destaque={c.vencimento < hoje ? 'red' : undefined}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="zinc">{ORIGEM_PESSOA[c.origem ?? ''] ?? 'Pessoa'}</Pilula>
                <Prazo venc={c.vencimento} hoje={hoje} />
                <div className="flex-1 min-w-[200px]">
                  <b className="text-sm">{c.nome} · {brl(c.valor)}</b>
                  <p className="text-xs text-zinc-500">{mostrarLoja ? `${c.loja} · ` : ''}{c.descricao ?? ''}{jeitoDePagar(c) ? ` · ${jeitoDePagar(c)}` : ''}</p>
                </div>
              </div>
              <div className="mt-2">
                {c.origem === 'hr_payroll' && !c.tem_boleto
                  ? <button onClick={() => irPara(c.tenant_id, '/financeiro?tab=rh')} className={SECUNDARIO}><i className="ri-team-line" /> Abrir a folha</button>
                  : <AcoesPagar tenantId={c.tenant_id} billId={c.id} dono={dono} financeiro={financeiro} onMudou={onMudou} />}
              </div>
            </Cartao>
          ))}
        </Secao>
      )}
      {folha.length > 0 && (
        <Secao titulo="Folha lançada e ainda não paga" n={folha.length} tom="amber">
          {folha.map((p) => (
            <Cartao key={p.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="amber">Folha {p.mes ?? ''}</Pilula>
                <span className="flex-1 min-w-[180px] text-sm"><b>{p.nome}</b> <span className="text-zinc-500">{mostrarLoja ? `· ${p.loja}` : ''}</span></span>
                <span className="tabular-nums font-semibold text-sm">{brl(p.valor)}</span>
                <button onClick={() => irPara(p.tenant_id, '/financeiro?tab=rh')} className={SECUNDARIO}>Abrir a folha</button>
              </div>
            </Cartao>
          ))}
        </Secao>
      )}
    </div>
  );
}

// ── Avulsos e outras contas ────────────────────────────────────────────────────────────────────
const ORIGEM_OUTRA: Record<string, string> = {
  manual: 'Lançada à mão', nfe_entrada: 'Nota de despesa', conciliacao_juros: 'Juros/multa', conciliacao_extrato: 'Do extrato', recurring: 'Automática',
};
export function AvulsosView({ avulsos, online, servicos, outras, avisos, hoje, mostrarLoja, dono, financeiro, onMudou, irPara }: {
  avulsos: Avulso[]; online: CompraOnline[]; servicos: Servico[]; outras: ContaAberta[]; avisos: Record<string, AvisoPagar[]>; hoje: string;
  mostrarLoja: boolean; dono: boolean; financeiro: boolean; onMudou: () => void; irPara: IrPara;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-zinc-600 -mt-1">
        O que não é conta fixa, mercadoria nem pessoa: dinheiro que <b>saiu do banco sem ninguém dizer o que foi</b>, notas de serviço
        que ainda não viraram conta, contas lançadas à mão ou por nota de despesa, e compras online.
      </p>
      {!avulsos.length && !online.length && !servicos.length && !outras.length && <Vazio texto="Nada aqui agora." />}
      {avulsos.length > 0 && (
        <Secao titulo="Saiu do banco, falta dizer o que foi" n={avulsos.length} tom="red">
          {avulsos.map((a) => (
            <Cartao key={a.id} destaque="red">
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="red">{ddmm(a.data)}</Pilula>
                <div className="flex-1 min-w-[200px]">
                  <b className="text-sm">{brl(a.valor)} → {a.para}</b>
                  <p className="text-xs text-zinc-500">{mostrarLoja ? `${a.loja} · ` : ''}{a.descricao && a.descricao !== a.para ? a.descricao : ''}{a.sugestao ? ' · tem uma sugestão na Conciliação' : ''}</p>
                </div>
                <button onClick={() => irPara(a.tenant_id, '/financeiro?tab=conciliacao&abrir=pendentes')} className={PRINCIPAL}><i className="ri-question-answer-line" /> Dizer o que foi</button>
              </div>
            </Cartao>
          ))}
        </Secao>
      )}
      {outras.length > 0 && (
        <Secao titulo="Outras contas em aberto" n={outras.length} tom={outras.some((c) => c.vencimento <= hoje) ? 'red' : 'zinc'}
          dica="Contas que não são fixas, de mercadoria nem de pessoas: lançadas à mão, por nota de despesa, juros, automáticas.">
          {outras.map((c) => {
            const av = (avisos[c.id] ?? []).filter((x) => x.tipo !== 'no_inter');
            return (
              <Cartao key={c.id} destaque={c.vencimento < hoje ? 'red' : undefined}>
                <div className="flex flex-wrap items-center gap-3">
                  <Pilula tom="zinc">{ORIGEM_OUTRA[c.origem ?? ''] ?? 'Conta'}</Pilula>
                  <Prazo venc={c.vencimento} hoje={hoje} />
                  <div className="flex-1 min-w-[200px]">
                    <b className="text-sm">{c.nome} · {brl(c.valor)}</b>
                    <p className="text-xs text-zinc-500">{mostrarLoja ? `${c.loja} · ` : ''}{c.descricao && c.descricao !== c.nome ? c.descricao : ''}{jeitoDePagar(c) ? ` · ${jeitoDePagar(c)}` : ''}{c.no_inter ? ' · enviado ao Inter, falta aprovar' : ''}</p>
                  </div>
                </div>
                {av.length > 0 && <ul className="mt-2 text-xs text-amber-900 space-y-0.5">{av.map((a) => <li key={a.texto}><i className="ri-error-warning-line" /> {a.texto}</li>)}</ul>}
                {!c.no_inter && <div className="mt-2"><AcoesPagar tenantId={c.tenant_id} billId={c.id} dono={dono} financeiro={financeiro} onMudou={onMudou} /></div>}
              </Cartao>
            );
          })}
        </Secao>
      )}
      {servicos.length > 0 && (
        <Secao titulo="Notas de serviço sem lançar" n={servicos.length} tom="amber"
          dica="Chegaram (NFS-e), mas ainda não viraram conta a pagar. Fornecedor pré-pago (Facebook) e iFood ficam de fora — são acertados de outro jeito.">
          {servicos.map((n) => (
            <Cartao key={n.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="amber">{ddmm(n.emitida)}</Pilula>
                <span className="flex-1 min-w-[200px] text-sm"><b>{n.fornecedor} · {brl(n.valor)}</b>
                  <span className="block text-xs text-zinc-500">{mostrarLoja ? `${n.loja} · ` : ''}{n.numero ? `NFS-e ${n.numero}` : 'Nota de serviço'}</span></span>
                <button onClick={() => irPara(n.tenant_id, `/financeiro?tab=notas-entrada&nota=${n.id}`)} className={PRINCIPAL}><i className="ri-file-list-3-line" /> Lançar</button>
              </div>
            </Cartao>
          ))}
        </Secao>
      )}
      {online.length > 0 && (
        <Secao titulo="Compra online esperando a nota" n={online.length} tom="amber" dica="Já paga e classificada. Fecha o caminho quando a nota do vendedor chegar pela SEFAZ — não trava nada.">
          {online.map((o) => (
            <Cartao key={o.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="amber">{diaBR(o.comprado_em)}</Pilula>
                <span className="flex-1 min-w-[200px] text-sm"><b>{o.descricao ?? 'Compra online'}</b> <span className="text-zinc-500">{mostrarLoja ? `· ${o.loja}` : ''}</span></span>
                <span className="tabular-nums font-semibold text-sm">{brl(o.valor)}</span>
              </div>
            </Cartao>
          ))}
        </Secao>
      )}
    </div>
  );
}

// ── Caminho de cada tipo ───────────────────────────────────────────────────────────────────────
const AVISA = <Pilula tom="amber">avisa e pede o motivo</Pilula>;
const NAO_TRAVA = <Pilula tom="zinc">não trava</Pilula>;
const PRECISA = <Pilula tom="red">precisa</Pilula>;
const LINHAS: Array<[string, React.ReactNode[]]> = [
  ['O sistema fica sabendo', ['Início do mês: "espero esta conta" (categoria marcada todo mês) — inclui guia DAS/FGTS e VR', 'Nota emitida (SEFAZ), sozinho', 'Notinha lida pela loja', 'Folha (PDF), diária registrada, benefício, acerto de entregador, pedido de reembolso', 'Saída no extrato sem nada ligado; nota de serviço (NFS-e); conta lançada à mão']],
  ['O que aconteceu de verdade', ['A conta chegou (boleto, guia, conta de luz)', 'Chegou na loja e chegou certo — a loja confirma no Receber mercadoria', 'Já aconteceu (comprou na hora)', 'O trabalho foi feito', 'Alguém diz o que foi']],
  ['Antes de pagar', [<>{PRECISA} ter a conta (ou "sem documento": o sistema lança)</>, <>{AVISA} se não chegou ou chegou diferente — você decide</>, '—', <><Pilula tom="amber">reembolso: você aprova</Pilula></>, '—']],
  ['Vira registro', ['Já sabe a categoria', 'Virou compra → conta a pagar (sem compra não nasce a conta)', 'Compra paga', 'Conta a pagar da pessoa', 'Despesa ou compra, com categoria']],
  ['Itens no estoque', ['—', NAO_TRAVA, NAO_TRAVA, '—', <>{NAO_TRAVA} se for mercadoria</>]],
  ['Pago', ['fim', 'fim', 'nasce pago', 'fim', 'já pago']],
  ['Ligado ao extrato / caixa', ['fecha sozinho pela Conciliação', 'fecha sozinho', 'sangria ou saída do banco', 'fecha sozinho', 'fecha sozinho']],
];
export function CaminhoView() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-zinc-600 -mt-1">
        O caminho de cada tipo, escrito uma vez. <Pilula tom="amber">avisa</Pilula> = o sistema avisa e pede o motivo, mas quem decide é você.{' '}
        <Pilula tom="zinc">não trava</Pilula> = importante, aparece como pendência, mas o pagamento segue.
      </p>
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[860px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
              {['Etapa', 'Conta fixa', 'Mercadoria a prazo', 'Compra à vista', 'Pessoas', 'Avulsos e outras'].map((h) => <th key={h} className="px-3 py-2 border-b border-zinc-100">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {LINHAS.map(([etapa, cels]) => (
              <tr key={etapa} className="align-top border-b border-zinc-100 last:border-0">
                <td className="px-3 py-2.5 font-bold text-zinc-800">{etapa}</td>
                {cels.map((c, i) => <td key={i} className="px-3 py-2.5 text-zinc-600">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
