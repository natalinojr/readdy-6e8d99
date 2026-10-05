/**
 * Vazamentos do mês (2026-10-05, ideia aprovada pelo dono — protótipo docs/prototipos/sistema-proposta.html, tela "vazamentos").
 * Cartão do Painel do Financeiro: soma, em reais, o que escapou no mês e onde. Só entra linha que tem regra no
 * sistema e cada linha diz de onde vem (regras em src/lib/vazamentos.ts; a conta de cada linha, na RPC
 * fn_vazamentos_mes). Ficam FORA da soma: prato acima da meta (o custo já contém a alta dos insumos), Pix do delivery
 * não pago e diferença de caixa ("a conferir") e conta vencida. Não mexe na Trilha: só lê os juros
 * que ela também lê (conta "Juros e multas" ligada pelo extrato).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { todayBrasilia } from '@/lib/dateUtils';
import { useVazamentos, useVazamentosLojas } from '@/hooks/useVazamentos';
import {
  brl, ddmm, janelaDoMes, manchete, nomeDoMes, resumirVazamentos, type QualMes, type VazLinha, type VazLojaDados, type VazTipo,
} from '@/lib/vazamentos';
import Folha from '@/pages/estoque/components/inicio/Folha';

const COR: Record<VazTipo, { ponto: string; barra: string; icone: string; fonte: string }> = {
  juros: { ponto: 'bg-amber-600', barra: '#D97706', icone: 'ri-percent-line', fonte: 'ri-route-line' },
  insumos: { ponto: 'bg-amber-500', barra: '#F59E0B', icone: 'ri-price-tag-3-line', fonte: 'ri-history-line' },
  pratos: { ponto: 'bg-amber-300', barra: '#FCD34D', icone: 'ri-restaurant-line', fonte: 'ri-file-list-3-line' },
  perdas: { ponto: 'bg-stone-300', barra: '#D6D3D1', icone: 'ri-delete-bin-line', fonte: 'ri-archive-2-line' },
  pix: { ponto: 'bg-orange-600', barra: '#EA580C', icone: 'ri-qr-code-line', fonte: 'ri-close-circle-line' },
};

type FolhaAberta = { tipo: VazTipo | 'caixa' | 'suspeitas'; tenantId: string } | null;

const Chip = ({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick}
    className={`flex-none min-h-9 px-3 rounded-full text-xs font-bold border cursor-pointer whitespace-nowrap flex items-center gap-1 ${ativo ? 'bg-amber-50 border-amber-400 text-amber-800' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
    {ativo && <i className="ri-check-line" />}{children}
  </button>
);

function ItemLista({ icone, titulo, sub, valor, sub2 }: { icone: string; titulo: string; sub: ReactNode; valor?: string; sub2?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-zinc-100 first:border-t-0">
      <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><i className={icone} /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-bold text-zinc-800 leading-snug">{titulo}</p>
        <p className="text-xs text-zinc-500 leading-snug">{sub}</p>
      </div>
      {valor && <div className="text-right flex-shrink-0"><p className="text-sm font-extrabold tabular-nums text-zinc-900">{valor}</p>{sub2 && <p className="text-[10.5px] text-zinc-400">{sub2}</p>}</div>}
    </div>
  );
}
const Total = ({ valor, rotulo = 'Total que bate com o cartão' }: { valor: string; rotulo?: string }) => (
  <div className="flex items-center justify-between pt-3 mt-1 border-t border-zinc-200 text-sm"><span className="text-zinc-500">{rotulo}</span><b className="tabular-nums">{valor}</b></div>
);
const Fonte = ({ children }: { children: ReactNode }) => <p className="text-[11.5px] text-zinc-500 leading-relaxed mt-3">{children}</p>;
const Aviso = ({ children, tom = 'amber' }: { children: ReactNode; tom?: 'amber' | 'zinc' }) => (
  <div className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed mt-3 ${tom === 'amber' ? 'bg-amber-50 text-amber-900' : 'bg-zinc-100 text-zinc-700'}`}>{children}</div>
);

export default function VazamentosCard({ onIrAba, versao }: { onIrAba: (aba: string) => void; versao: number }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { lojas, erro: erroLojas } = useVazamentosLojas();
  const [escolha, setEscolha] = useState<string | 'todas' | null>(null);
  const [qual, setQual] = useState<QualMes>('atual');
  const [aberta, setAberta] = useState<FolhaAberta>(null);
  const [regras, setRegras] = useState(false);

  const hoje = todayBrasilia();
  const janela = useMemo(() => janelaDoMes(hoje, qual), [hoje, qual]);

  // Lojas mostradas: as que a pessoa não escondeu no Comparar lojas (a loja atual fica sempre).
  const visiveis = useMemo(() => (lojas ?? []).filter((l) => !l.oculta || l.tenantId === user?.tenantId), [lojas, user?.tenantId]);
  const varias = visiveis.length > 1;
  const sel = escolha ?? (visiveis.find((l) => l.tenantId === user?.tenantId)?.tenantId ?? visiveis[0]?.tenantId ?? null);
  const somando = varias && sel === 'todas';
  const ids = useMemo(() => (somando ? visiveis.map((l) => l.tenantId) : sel && sel !== 'todas' ? [sel] : []), [somando, visiveis, sel]);

  const { dados, carregando, falhas } = useVazamentos(ids, janela.de, janela.ate, versao);
  const resumo = useMemo(() => resumirVazamentos(dados), [dados]);
  const nomeDe = (id: string) => (lojas ?? []).find((l) => l.tenantId === id)?.nome ?? 'Loja';

  // Sem nenhuma loja do Financeiro (ou falha ao listar): o cartão não aparece, o Painel segue como era.
  if (erroLojas || (lojas && visiveis.length === 0)) return null;

  const m = manchete(resumo.total, qual, janela.mes, somando);
  const daLoja = aberta ? dados.find((d) => d.tenant_id === aberta.tenantId) ?? null : null;
  const ehMinha = (tenantId: string) => tenantId === user?.tenantId;
  const irEstoque = (tab: string) => navigate(`/estoque?tab=${tab}`);

  function botoes(li: VazLinha) {
    const b: ReactNode[] = [];
    const btn = 'text-xs font-bold px-3 py-1.5 rounded-lg border cursor-pointer';
    b.push(<button key="ver" type="button" className={`${btn} border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`} onClick={() => setAberta({ tipo: li.tipo, tenantId: li.tenantId })}>Ver os {li.n}</button>);
    return b;
  }

  return (
    <section className="bg-white rounded-2xl border border-zinc-200" aria-label="Vazamentos do mês">
      <div className="px-5 pt-4 flex flex-wrap items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><i className="ri-drop-line text-sm" /></span>
        <h3 className="text-sm font-bold text-zinc-800">Vazamentos do mês</h3>
        <div className="ml-auto flex gap-1.5">
          <Chip ativo={qual === 'atual'} onClick={() => setQual('atual')}>Este mês</Chip>
          <Chip ativo={qual === 'anterior'} onClick={() => setQual('anterior')}>Mês passado</Chip>
        </div>
      </div>

      {varias && (
        <div className="px-5 pt-3 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {visiveis.map((l) => <Chip key={l.tenantId} ativo={sel === l.tenantId} onClick={() => setEscolha(l.tenantId)}>{l.nome}</Chip>)}
          <Chip ativo={sel === 'todas'} onClick={() => setEscolha('todas')}>Somar as lojas</Chip>
        </div>
      )}

      <div className="px-5 py-4">
        {!lojas || carregando ? (
          <div className="h-28 rounded-xl bg-zinc-100 animate-pulse" />
        ) : (
          <>
            <p className="text-[10.5px] font-extrabold tracking-wider uppercase text-amber-700">
              {somando ? 'Todas as lojas' : nomeDe(ids[0] ?? '')} · {nomeDoMes(janela.mes)}{qual === 'atual' ? ' até hoje' : ''}
            </p>
            <p className="text-2xl font-extrabold leading-tight tracking-tight text-zinc-900 mt-1">
              {m.antes}{m.valor && <span className="text-amber-700">{m.valor}</span>}{m.depois}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Só soma o que tem regra no sistema — cada linha diz de onde vem.</p>
            {somando && <p className="text-[11px] text-zinc-400 mt-0.5">Todas as lojas na mesma janela: {ddmm(janela.de)} a {ddmm(janela.ate)}.</p>}

            {resumo.linhas.length > 0 && (
              <div className="flex h-2.5 gap-0.5 mt-4" aria-hidden>
                {resumo.linhas.map((li) => <i key={li.chave} className="block h-full rounded min-w-1.5" style={{ flex: li.valor, background: COR[li.tipo].barra }} title={li.titulo} />)}
              </div>
            )}

            <div className="mt-1">
              {resumo.linhas.map((li) => (
                <div key={li.chave} className="flex gap-3 py-3.5 border-t border-zinc-100 first:border-t-0">
                  <span className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${COR[li.tipo].ponto}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-800 leading-snug">
                      {li.titulo}
                      {somando && <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">{li.loja}</span>}
                    </p>
                    <p className="flex gap-1.5 items-start text-[11.5px] text-zinc-400 mt-0.5 leading-snug"><i className={`${COR[li.tipo].fonte} text-[13px] leading-none mt-px`} /><span>{li.fonte}</span></p>
                    <div className="flex flex-wrap gap-1.5 mt-2">{botoes(li)}</div>
                  </div>
                  <p className="text-[17px] font-extrabold tabular-nums whitespace-nowrap text-right text-zinc-900">{brl(li.valor)}</p>
                </div>
              ))}

              {resumo.risco.map((r) => (
                <div key={`risco|${r.tenantId}`} className="flex gap-3 py-3.5 border-t border-zinc-100">
                  <span className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 border-2 border-stone-300" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-800 leading-snug">
                      {r.n === 1 ? '1 conta vencida' : `${r.n} contas vencidas`}: juros correndo
                      {somando && <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">{r.loja}</span>}
                      <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">não soma</span>
                    </p>
                    <p className="flex gap-1.5 items-start text-[11.5px] text-zinc-400 mt-0.5 leading-snug"><i className="ri-bill-line text-[13px] leading-none mt-px" /><span>Contas a pagar vencidas e ainda abertas · o juros só vira perda quando a conta é paga, por isso não soma</span></p>
                    {ehMinha(r.tenantId) && <div className="mt-2"><button type="button" className="text-xs font-bold px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 cursor-pointer" onClick={() => onIrAba('pagar')}>Ver as contas</button></div>}
                  </div>
                  <p className="text-[17px] font-extrabold tabular-nums whitespace-nowrap text-right text-zinc-400">{brl(r.valor)}<span className="block text-[10.5px] font-bold">vencidos</span></p>
                </div>
              ))}

              {resumo.pratos.map((li) => (
                <div key={li.chave} className="flex gap-3 py-3.5 border-t border-zinc-100">
                  <span className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 border-2 border-amber-300" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-800 leading-snug">
                      {li.titulo}
                      {somando && <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">{li.loja}</span>}
                      <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">não soma</span>
                    </p>
                    <p className="flex gap-1.5 items-start text-[11.5px] text-zinc-400 mt-0.5 leading-snug"><i className={`${COR.pratos.fonte} text-[13px] leading-none mt-px`} /><span>{li.fonte}</span></p>
                    <div className="flex flex-wrap gap-1.5 mt-2">{botoes(li)}</div>
                  </div>
                  <p className="text-[17px] font-extrabold tabular-nums whitespace-nowrap text-right text-zinc-400">{brl(li.valor)}<span className="block text-[10.5px] font-bold">acima da meta</span></p>
                </div>
              ))}
            </div>

            {resumo.linhas.length === 0 && resumo.risco.length === 0 && resumo.pratos.length === 0 && (
              <p className="text-sm text-zinc-500 py-2">Nenhuma linha com dado neste período.</p>
            )}

            {resumo.fichaSuspeita.map((f) => (
              <Aviso key={`fs|${f.tenantId}`}>
                <b>Conferir a ficha{somando ? ` (${f.loja})` : ''}:</b> {f.itens.map((i) => `${i.nome} (custo ${brl(i.custo / Math.max(i.qtd, 1))} para vender a ${brl(i.receita / Math.max(i.qtd, 1))})`).join('; ')}.
                Custo maior que o preço é quase sempre ficha com erro, por isso não entra na soma.{' '}
                <button type="button" className="font-bold underline cursor-pointer" onClick={() => setAberta({ tipo: 'suspeitas', tenantId: f.tenantId })}>Ver</button>
              </Aviso>
            ))}

            {resumo.semFicha.map((s) => (
              <Aviso key={`sf|${s.tenantId}`} tom="zinc">
                <b>O que não dá para medir{somando ? ` (${nomeDe(s.tenantId)})` : ''}.</b> Nenhum prato vendido tem ficha técnica, então não dá para medir custo do prato.
              </Aviso>
            ))}

            {falhas.length > 0 && (
              <Aviso>
                <b>Não deu para ler {falhas.map(nomeDe).join(', ')} agora.</b> {somando ? 'A soma acima não inclui essa loja.' : 'Tente atualizar.'}
              </Aviso>
            )}

            {resumo.pixConferir.map((li) => (
              <div key={li.chave} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 mt-3">
                <div className="flex items-center gap-2">
                  <i className={`${COR.pix.icone} text-zinc-500`} />
                  <b className="text-[13px] text-zinc-800">A conferir <span className="font-semibold text-zinc-400">· não é perda certa</span></b>
                  <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">não soma</span>
                </div>
                <p className="text-[13px] text-zinc-800 mt-1.5 font-semibold">
                  {li.titulo} · {brl(li.valor)}
                  {somando && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">{li.loja}</span>}
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed mt-1">
                  São pedidos com Pix gerado que ninguém pagou, cancelados quando o caixa fechou. O cliente pode ter feito outro pedido logo depois, por isso fica fora da soma.
                </p>
                <button type="button" className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 cursor-pointer" onClick={() => setAberta({ tipo: 'pix', tenantId: li.tenantId })}>Ver os {li.n}</button>
              </div>
            ))}

            {resumo.conferir.map((c) => (
              <div key={`cx|${c.tenantId}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 mt-3">
                <div className="flex items-center gap-2">
                  <i className="ri-scales-3-line text-zinc-500" />
                  <b className="text-[13px] text-zinc-800">A conferir <span className="font-semibold text-zinc-400">· não é perda certa</span></b>
                  <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">não soma</span>
                </div>
                <p className="text-[13px] text-zinc-800 mt-1.5 font-semibold">
                  Diferença de caixa em {c.comDiferenca} de {c.fechamentos} fechamentos
                  {somando && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">{c.loja}</span>}
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed mt-1">
                  Isto não aponta culpado: o login do caixa é usado por várias pessoas. As causas mais comuns são fundo de caixa, troco, sangria sem lançar e contagem apressada. Por isso fica fora da soma.
                </p>
                <button type="button" className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 cursor-pointer" onClick={() => setAberta({ tipo: 'caixa', tenantId: c.tenantId })}>Ver os fechamentos</button>
              </div>
            ))}

            <button type="button" onClick={() => setRegras((v) => !v)} className="mt-4 text-xs font-semibold text-zinc-500 hover:text-zinc-800 flex items-center gap-1 cursor-pointer">
              Como lemos este número <i className={regras ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </button>
            {regras && (
              <ul className="mt-2 pl-5 list-disc text-xs text-zinc-600 leading-relaxed space-y-1">
                <li><b>Entra</b> só o que já é medido por uma regra do sistema e tinha como evitar.</li>
                <li><b>Cada linha</b> diz de onde vem e abre a lista que a explica.</li>
                <li><b>Não é a DRE.</b> A DRE continua sendo o resultado oficial; aqui é só o que escapou.</li>
                <li><b>Fica de fora:</b> prato acima da meta de CMV (o custo da ficha já usa o preço novo do insumo, que a linha de insumos mede — somar seria contar o mesmo real duas vezes), Pix do delivery não pago (o cliente pode ter pedido de novo), diferença de caixa (não prova culpa), conta vencida (o juros só vira perda quando é paga) e preço de loja contra loja.</li>
                <li><b>Linha sem dado não aparece.</b> Loja sem ficha técnica não tem a linha de pratos; sem estoque, não tem a de perdas.</li>
                <li>Uma janela só para todas as linhas e lojas: {ddmm(janela.de)} a {ddmm(janela.ate)}. Pedido de treino fica fora.</li>
              </ul>
            )}
          </>
        )}
      </div>

      <FolhaDetalhe aberta={aberta} loja={daLoja} minha={aberta ? ehMinha(aberta.tenantId) : false} onFechar={() => setAberta(null)}
        onIrAba={(a) => { setAberta(null); onIrAba(a); }} onEstoque={(t) => { setAberta(null); irEstoque(t); }} />
    </section>
  );
}

function FolhaDetalhe({ aberta, loja, minha, onFechar, onIrAba, onEstoque }: {
  aberta: FolhaAberta; loja: VazLojaDados | null; minha: boolean; onFechar: () => void; onIrAba: (aba: string) => void; onEstoque: (tab: string) => void;
}) {
  const btn = 'flex-1 text-sm font-bold px-4 py-2.5 rounded-xl cursor-pointer';
  const sec = `${btn} bg-zinc-100 text-zinc-700 hover:bg-zinc-200`;
  const pri = `${btn} bg-amber-500 text-white hover:bg-amber-600`;
  const fechar = <button type="button" className={sec} onClick={onFechar}>Fechar</button>;
  if (!aberta || !loja) return <Folha aberta={false} titulo="" onFechar={onFechar}>{null}</Folha>;
  const de = loja.de, ate = loja.ate;
  const periodo = `${loja.nome} · ${ddmm(de)} a ${ddmm(ate)}`;

  switch (aberta.tipo) {
    case 'juros': {
      const c = loja.juros;
      return (
        <Folha aberta titulo={`Juros e multa em ${c.n} ${c.n === 1 ? 'conta' : 'contas'}`} subtitulo={`${periodo} · pagas depois do vencimento`} onFechar={onFechar}
          rodape={<>{fechar}{minha && <button type="button" className={pri} onClick={() => onIrAba('pagar')}>Abrir em Contas a pagar</button>}</>}>
          {c.itens.map((i) => (
            <ItemLista key={i.id} icone="ri-bill-line" titulo={i.fornecedor}
              sub={i.venceu_em ? <>venceu {ddmm(i.venceu_em)} · pago {ddmm(i.pago_em)}{i.dias_atraso ? <> · <em className="not-italic font-semibold text-orange-600">{i.dias_atraso} {i.dias_atraso === 1 ? 'dia' : 'dias'} de atraso</em></> : null}</> : <>pago {ddmm(i.pago_em)}</>}
              valor={brl(i.valor)} sub2="juros e multa" />
          ))}
          <Total valor={brl(c.total)} />
          <Fonte><b>De onde vem:</b> da Trilha, só leitura. Cada linha é a conta de juros e multa que a conciliação lançou ao pagar uma conta acima do valor, ligada à conta original pelo extrato. A Trilha continua igual.</Fonte>
        </Folha>
      );
    }
    case 'insumos': {
      const c = loja.insumos;
      return (
        <Folha aberta titulo={`${c.n} ${c.n === 1 ? 'insumo mais caro' : 'insumos mais caros'}`} subtitulo={`${periodo} · contra ${nomeDoMes(loja.mes_anterior.de.slice(0, 7))}`} onFechar={onFechar}
          rodape={<>{fechar}{minha && <button type="button" className={pri} onClick={() => onEstoque('insumos')}>Abrir no Estoque</button>}</>}>
          {c.itens.map((i) => (
            <ItemLista key={i.nome} icone="ri-arrow-up-line" titulo={i.nome}
              sub={<>{brl(i.preco_ant)} → {brl(i.preco_atual)} por {i.unidade} · <em className="not-italic font-semibold text-orange-600">+{(((i.preco_atual - i.preco_ant) / i.preco_ant) * 100).toFixed(0)}%</em></>}
              valor={brl(i.valor)} sub2="a mais no período" />
          ))}
          <Total valor={brl(c.total)} />
          <Fonte><b>A conta:</b> (preço médio do período − preço médio de {nomeDoMes(loja.mes_anterior.de.slice(0, 7))}) × o que já comprou no período. Só entra insumo comprado nos dois meses e com alta de pelo menos 1%. É o mesmo histórico de preço que aparece na ficha de cada insumo.</Fonte>
        </Folha>
      );
    }
    case 'pratos': {
      const c = loja.pratos;
      return (
        <Folha aberta titulo={`${c.n} ${c.n === 1 ? 'prato acima' : 'pratos acima'} da meta de CMV`} subtitulo={`${periodo} · meta ${c.meta}%`} onFechar={onFechar}
          rodape={<>{fechar}{minha && <button type="button" className={pri} onClick={() => onEstoque('cmv')}>Abrir CMV e fichas</button>}</>}>
          {c.itens.map((i) => (
            <ItemLista key={i.nome} icone="ri-restaurant-line" titulo={i.nome}
              sub={<>vendeu {i.qtd} · preço médio {brl(i.receita / Math.max(i.qtd, 1))} · custo da ficha {brl(i.custo / Math.max(i.qtd, 1))} · <em className="not-italic font-semibold text-red-600">CMV {i.cmv_pct.toFixed(0)}%</em></>}
              valor={brl(i.a_mais)} sub2="a mais no período" />
          ))}
          <Total valor={brl(c.total)} rotulo="Total (fora da soma)" />
          <Fonte><b>A conta:</b> acima da meta, o custo a mais é o custo da ficha menos {c.meta}% do que vendeu. Se a ficha estiver errada, vale conferir antes de mexer no preço.</Fonte>
          <Fonte><b>Por que não soma:</b> o custo da ficha usa o preço atual do insumo; a alta do insumo já aparece na linha de insumos mais caros. Somar as duas contaria o mesmo real duas vezes.</Fonte>
          <Fonte><b>Não entram aqui:</b> {c.pratos_sem_ficha} {c.pratos_sem_ficha === 1 ? 'prato vendido sem ficha' : 'pratos vendidos sem ficha'}. Sem custo não dá para medir.</Fonte>
        </Folha>
      );
    }
    case 'perdas': {
      const c = loja.perdas;
      return (
        <Folha aberta titulo="Perdas registradas no estoque" subtitulo={periodo} onFechar={onFechar}
          rodape={<>{fechar}{minha && <button type="button" className={pri} onClick={() => onEstoque('movimentacoes')}>Abrir no Estoque</button>}</>}>
          {c.itens.map((i, k) => (
            <ItemLista key={`${i.nome}|${i.dia}|${k}`} icone="ri-delete-bin-line" titulo={i.nome}
              sub={`${i.qtd} ${i.unidade}${i.motivo ? ` · ${i.motivo}` : ''} · ${ddmm(i.dia)}`} valor={brl(i.valor)} />
          ))}
          <Total valor={brl(c.total)} />
          <Fonte><b>De onde vem:</b> só o que a loja registrou como perda no Estoque, pelo preço atual do insumo. Perda que ninguém registrou não aparece aqui.</Fonte>
        </Folha>
      );
    }
    case 'pix': {
      const c = loja.pix;
      return (
        <Folha aberta titulo="Pix do delivery não pago" subtitulo={`${periodo} · ${c.n} ${c.n === 1 ? 'pedido não pago' : 'pedidos não pagos'}`} onFechar={onFechar} rodape={fechar}>
          {c.itens.map((i) => (
            <ItemLista key={i.numero} icone="ri-qr-code-line" titulo={`Pedido ${i.numero} · ${ddmm(i.dia)}`} sub="Pix gerado e não pago · cancelado quando o caixa fechou" valor={brl(i.valor)} />
          ))}
          <Total valor={brl(c.total)} rotulo="Total (a conferir, fora da soma)" />
          <Fonte><b>De onde vem:</b> pedidos de delivery cancelados com o motivo “Pix pelo app não pago até o fechamento do caixa”. Hoje ninguém é avisado quando o Pix vence.</Fonte>
          <Aviso tom="zinc"><b>A conferir, não soma.</b> O cliente pode ter pedido de novo (outro Pix ou outra forma de pagar), então nem todo pedido aqui é venda perdida.</Aviso>
        </Folha>
      );
    }
    case 'suspeitas':
      return (
        <Folha aberta titulo="Conferir a ficha técnica" subtitulo={`${periodo} · custo igual ou maior que o preço`} onFechar={onFechar}
          rodape={<>{fechar}{minha && <button type="button" className={pri} onClick={() => onEstoque('cmv')}>Abrir CMV e fichas</button>}</>}>
          {loja.pratos.ficha_suspeita.map((i) => (
            <ItemLista key={i.nome} icone="ri-error-warning-line" titulo={i.nome}
              sub={<>vendeu {i.qtd} · preço médio {brl(i.receita / Math.max(i.qtd, 1))} · custo da ficha {brl(i.custo / Math.max(i.qtd, 1))} · <em className="not-italic font-semibold text-red-600">CMV {i.cmv_pct.toFixed(0)}%</em></>} />
          ))}
          <Fonte>Estes pratos <b>não entram na soma</b>: custo maior que o preço quase sempre é ficha com quantidade ou unidade errada, não prato que vaza.</Fonte>
        </Folha>
      );
    case 'caixa': {
      const c = loja.caixa;
      return (
        <Folha aberta titulo="Fechamentos com diferença" subtitulo={`${periodo} · ${c.com_diferenca} de ${c.fechamentos} fechamentos`} onFechar={onFechar} rodape={fechar}>
          {c.itens.map((i, k) => (
            <ItemLista key={`${i.dia}|${k}`} icone="ri-scales-3-line" titulo={ddmm(i.dia)} sub={i.motivo ? `motivo registrado: ${i.motivo}` : 'sem motivo registrado'}
              valor={`${i.diferenca > 0 ? '+' : '−'}${brl(Math.abs(i.diferenca))}`} />
          ))}
          <Aviso><b>Não aponta culpado.</b> O login do caixa é usado por várias pessoas. Por isso esta linha fica fora da soma de vazamentos.</Aviso>
        </Folha>
      );
    }
  }
}
