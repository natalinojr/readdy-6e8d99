// Compra à vista, Pessoas, Avulsos e o "Caminho de cada tipo" (2026-10-06).
import { PEDIDO_NOME, type Avulso, type CompraOnline, type Pessoa } from '@/lib/pagamentos';
import type { CompraVista } from './api';
import { AcoesPagar, brl, Cartao, ddmm, diaBR, Pilula, PRINCIPAL, SECUNDARIO, Secao, Vazio } from './comum';

type IrPara = (tenantId: string, rota: string) => void;

// ── Compra à vista (notinha) ──────────────────────────────────────────────────────────────────
export function VistaView({ compras, mostrarLoja, irPara }: { compras: CompraVista[]; mostrarLoja: boolean; irPara: IrPara }) {
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
                <div className="flex-1 min-w-[200px]">
                  <b className="text-sm">{c.fornecedor} · {brl(c.valor)}</b>
                  <p className="text-xs text-zinc-500">{mostrarLoja ? `${c.loja} · ` : ''}{c.forma ?? 'à vista'} · {ddmm(c.data)} · {c.itens_ligados} de {c.itens} itens ligados</p>
                </div>
                <button onClick={() => irPara(c.tenant_id, '/financeiro?tab=itens')} className={PRINCIPAL}><i className="ri-price-tag-3-line" /> Ligar itens</button>
              </div>
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
                  <Pilula tom="green">Paga</Pilula>
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
export function PessoasView({ pessoas, mostrarLoja, dono, financeiro, onMudou, irPara }: {
  pessoas: Pessoa[]; mostrarLoja: boolean; dono: boolean; financeiro: boolean; onMudou: () => void; irPara: IrPara;
}) {
  const aprovar = pessoas.filter((p) => p.tipo === 'aprovar');
  const pagar = pessoas.filter((p) => p.tipo === 'freela' || p.tipo === 'pedido_pagar');
  const folha = pessoas.filter((p) => p.tipo === 'folha');
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-zinc-600 -mt-1">
        Quem trabalha para a loja: freelancers (diárias), pedidos de reembolso, fornecedor sem nota, prestador e benefício, e a folha.
        A pergunta é sempre a mesma: <b>o trabalho foi registrado? já foi pago?</b>
      </p>
      {!pessoas.length && <Vazio texto="Nada pendente de pessoas agora." />}
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
      {pagar.length > 0 && (
        <Secao titulo="A pagar" n={pagar.length} tom="red">
          {pagar.map((p, i) => (
            <Cartao key={`${p.tipo}${p.id ?? p.nome}${i}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom={p.tipo === 'freela' ? 'blue' : 'zinc'}>{p.tipo === 'freela' ? 'Freela' : PEDIDO_NOME[p.pedido ?? ''] ?? 'Pedido'}</Pilula>
                <div className="flex-1 min-w-[200px]">
                  <b className="text-sm">{p.nome} · {brl(p.valor)}</b>
                  <p className="text-xs text-zinc-500">{mostrarLoja ? `${p.loja} · ` : ''}
                    {p.tipo === 'freela' ? `${p.dias ?? 0} ${p.dias === 1 ? 'diária registrada' : 'diárias registradas'}` : p.descricao ?? ''}
                    {p.vence ? ` · vence ${ddmm(p.vence)}` : ''}</p>
                </div>
              </div>
              {p.bill_ids?.length === 1
                ? <div className="mt-2"><AcoesPagar tenantId={p.tenant_id} billId={p.bill_ids[0]} dono={dono} financeiro={financeiro} onMudou={onMudou} /></div>
                : <div className="mt-2"><button onClick={() => irPara(p.tenant_id, '/financeiro?tab=rh')} className={SECUNDARIO}><i className="ri-team-line" /> Abrir no RH</button></div>}
            </Cartao>
          ))}
        </Secao>
      )}
      {folha.length > 0 && (
        <Secao titulo="Folha pendente" n={folha.length}>
          {folha.map((p) => (
            <Cartao key={p.id}>
              <div className="flex flex-wrap items-center gap-3">
                <Pilula tom="zinc">Folha {p.mes ?? ''}</Pilula>
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

// ── Avulsos ────────────────────────────────────────────────────────────────────────────────────
export function AvulsosView({ avulsos, online, mostrarLoja, irPara }: { avulsos: Avulso[]; online: CompraOnline[]; mostrarLoja: boolean; irPara: IrPara }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-zinc-600 -mt-1">
        O que não se encaixa nos outros tipos: dinheiro que <b>saiu do banco sem ninguém dizer o que foi</b>, e compras online.
        Aqui o caminho é curto: dizer o que foi → classificar → fechado. É a despesa mais real: o dinheiro já saiu.
      </p>
      {!avulsos.length && !online.length && <Vazio texto="Nenhuma saída sem explicação nos últimos 60 dias." />}
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
  ['O sistema fica sabendo', ['Início do mês: "espero esta conta" (categoria marcada todo mês)', 'Nota emitida (SEFAZ), sozinho', 'Notinha lida pela loja', 'Folha (PDF), diária registrada, pedido de reembolso, nota do MEI', 'Saída no extrato sem nada ligado']],
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
              {['Etapa', 'Conta fixa', 'Mercadoria a prazo', 'Compra à vista', 'Pessoas', 'Avulsos'].map((h) => <th key={h} className="px-3 py-2 border-b border-zinc-100">{h}</th>)}
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
