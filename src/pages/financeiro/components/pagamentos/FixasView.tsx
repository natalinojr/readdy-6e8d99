// Contas fixas do mês (2026-10-06). Regra do dono: conta fixa = categoria (ou subcategoria) do DRE
// marcada "todo mês"; o sistema espera uma conta por fornecedor que já apareceu nela. Dados: fn_contas_fixas.
import { useEffect, useMemo, useState } from 'react';
import { pedirAoChat } from '@/lib/assistenteFoco';
import {
  ESTADO_FIXA, grupoDaCategoria, ordemFixa, resumoFixas, textoEsperando, type ContaFixa,
} from '@/lib/pagamentos';
import { categoriasDaLoja, marcarFixa, marcarTodoMes, type AcaoFixa, type CategoriaDre } from './api';
import { AcoesPagar, brl, Cartao, ddmm, LINK, Pilula, PRINCIPAL, SECUNDARIO, Secao, Vazio } from './comum';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
const somarMes = (mes: string, n: number) => {
  const d = new Date(`${mes.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

interface Props {
  itens: ContaFixa[]; carregando: boolean; tenantUnico: string | null; mostrarLoja: boolean;
  mes: string; mesAtual: string; onMes: (m: string) => void; dono: boolean; financeiro: boolean; onMudou: () => void;
}

export default function FixasView({ itens, carregando, tenantUnico, mostrarLoja, mes, mesAtual, onMes, dono, financeiro, onMudou }: Props) {
  const r = resumoFixas(itens);
  const aConfirmar = itens.filter((f) => f.confirmar);
  const lista = itens.filter((f) => !f.confirmar);
  const grupos = useMemo(() => {
    const m = new Map<string, ContaFixa[]>();
    for (const f of [...lista].sort((a, b) => ordemFixa(a.estado) - ordemFixa(b.estado) || a.categoria.localeCompare(b.categoria))) {
      const g = `${mostrarLoja ? `${f.loja} · ` : ''}${grupoDaCategoria(f.categoria)}`;
      m.set(g, [...(m.get(g) ?? []), f]);
    }
    return [...m.entries()].sort((a, b) => Math.min(...a[1].map((f) => ordemFixa(f.estado))) - Math.min(...b[1].map((f) => ordemFixa(f.estado))));
  }, [lista, mostrarLoja]);

  const pct = (n: number) => (r.total ? `${Math.round((n / r.total) * 100)}%` : '0%');

  return (
    <div className="flex flex-col gap-4">
      {tenantUnico && financeiro && <Categorias tenantId={tenantUnico} onMudou={onMudou} />}
      {!tenantUnico && <p className="text-xs text-zinc-500 bg-white border border-zinc-200 rounded-xl px-3 py-2">Para marcar quais categorias acontecem todo mês, escolha uma loja só (no topo).</p>}

      <Cartao>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => onMes(somarMes(mes, -1))} className="w-8 h-8 rounded-lg hover:bg-zinc-100 cursor-pointer" aria-label="Mês anterior"><i className="ri-arrow-left-s-line" /></button>
            <b className="text-[15px] capitalize min-w-[130px] text-center">{nomeMes(mes)}</b>
            <button onClick={() => onMes(somarMes(mes, 1))} disabled={mes >= mesAtual} className="w-8 h-8 rounded-lg hover:bg-zinc-100 cursor-pointer disabled:opacity-30" aria-label="Próximo mês"><i className="ri-arrow-right-s-line" /></button>
          </div>
          <div className="flex-1 min-w-[160px] h-2.5 rounded-full bg-zinc-100 overflow-hidden flex">
            <i className="block h-full bg-emerald-500" style={{ width: pct(r.pagas) }} />
            <i className="block h-full bg-red-500" style={{ width: pct(r.urgentes) }} />
            <i className="block h-full bg-sky-300" style={{ width: pct(r.aPagar) }} />
            <i className="block h-full bg-amber-300" style={{ width: pct(r.naoChegaram) }} />
          </div>
          <span className="text-[12.5px] text-zinc-600">
            {r.pagas} de {r.total} {r.pagas === 1 ? 'paga' : 'pagas'}
            {r.urgentes ? ` · ${r.urgentes} vencendo/vencida${r.urgentes > 1 ? 's' : ''}` : ''}
            {r.aPagar ? ` · ${r.aPagar} a pagar` : ''}
            {r.naoChegaram ? ` · ${r.naoChegaram} não ${r.naoChegaram === 1 ? 'chegou' : 'chegaram'}` : ''}
            {r.esperando ? ` · ${r.esperando} esperando` : ''}
          </span>
        </div>
      </Cartao>

      {carregando && !itens.length ? <Vazio texto="Carregando…" /> : null}
      {!carregando && !itens.length && (
        <Vazio texto="Nenhuma conta fixa ainda. Marque acima as categorias que acontecem todo mês (aluguel, luz, internet…)." />
      )}

      {aConfirmar.length > 0 && (
        <Secao titulo="É fixa todo mês?" n={aConfirmar.length} tom="amber"
          dica="Apareceram numa categoria fixa, mas só 1 vez até agora. Confirme para o sistema esperar todo mês.">
          {aConfirmar.map((f) => <LinhaConfirmar key={`${f.tenant_id}${f.categoria_id}${f.chave}`} f={f} mostrarLoja={mostrarLoja} financeiro={financeiro} onMudou={onMudou} />)}
        </Secao>
      )}

      {grupos.map(([g, fs]) => (
        <Cartao key={g}>
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 mb-1">{g} <span className="ml-1 px-2 rounded-full bg-zinc-100 text-zinc-600 tracking-normal">{fs.length}</span></h3>
          <div className="divide-y divide-zinc-100">
            {fs.map((f) => <LinhaFixa key={`${f.tenant_id}${f.categoria_id}${f.chave}`} f={f} dono={dono} financeiro={financeiro} onMudou={onMudou} />)}
          </div>
        </Cartao>
      ))}
    </div>
  );
}

// ── Categorias "todo mês" ─────────────────────────────────────────────────────────────────────
function Categorias({ tenantId, onMudou }: { tenantId: string; onMudou: () => void }) {
  const [cats, setCats] = useState<CategoriaDre[] | null>(null);
  const [todas, setTodas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    categoriasDaLoja(tenantId).then((c) => { if (vivo) setCats(c); }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [tenantId]);
  if (!cats) return erro ? <p className="text-xs text-red-600">{erro}</p> : null;
  const nome = (c: CategoriaDre) => { const pai = cats.find((x) => x.id === c.parent_id); return pai ? `${pai.nome} › ${c.nome}` : c.nome; };
  const paiMarcado = (c: CategoriaDre) => !!cats.find((x) => x.id === c.parent_id)?.todo_mes;
  const ordenadas = [...cats].sort((a, b) => Number(b.todo_mes) - Number(a.todo_mes) || nome(a).localeCompare(nome(b)));
  const marcadas = ordenadas.filter((c) => c.todo_mes || paiMarcado(c));
  const visiveis = todas ? ordenadas : marcadas;
  const alternar = async (c: CategoriaDre) => {
    setSalvando(c.id); setErro(null);
    try {
      await marcarTodoMes(tenantId, c.id, !c.todo_mes);
      setCats((l) => l?.map((x) => (x.id === c.id ? { ...x, todo_mes: !x.todo_mes } : x)) ?? l);
      onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setSalvando(null); }
  };
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
      <p className="text-[13px] text-sky-900">
        <b><i className="ri-price-tag-3-line" /> Categorias que acontecem todo mês.</b> Tudo que for classificado nelas, o sistema
        passa a esperar todo mês — uma conta por fornecedor que já apareceu ali.
      </p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {visiveis.map((c) => {
          const herdada = !c.todo_mes && paiMarcado(c);
          return (
            <button key={c.id} disabled={salvando === c.id || herdada} onClick={() => alternar(c)}
              title={herdada ? 'Marcada pela categoria de cima' : undefined}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer disabled:cursor-default ${c.todo_mes || herdada ? 'bg-sky-800 text-white border-sky-800' : 'bg-white text-sky-900 border-sky-200 hover:border-sky-400'} ${herdada ? 'opacity-70' : ''}`}>
              {c.todo_mes || herdada ? '✓ ' : ''}{nome(c)}
            </button>
          );
        })}
        <button onClick={() => setTodas((v) => !v)} className="px-2.5 py-1 rounded-full text-xs font-bold text-sky-800 underline cursor-pointer">
          {todas ? 'Mostrar só as marcadas' : marcadas.length ? `+ marcar outra (${cats.length} categorias)` : `Escolher entre as ${cats.length} categorias`}
        </button>
      </div>
      {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
    </div>
  );
}

// ── Uma conta fixa ───────────────────────────────────────────────────────────────────────────
function LinhaConfirmar({ f, mostrarLoja, financeiro, onMudou }: { f: ContaFixa; mostrarLoja: boolean; financeiro: boolean; onMudou: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const agir = async (a: AcaoFixa) => {
    setOcupado(true); setErro(null);
    try { await marcarFixa(f, a); onMudou(); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(false); }
  };
  const ult = f.historico[f.historico.length - 1];
  return (
    <Cartao>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <b className="text-sm">{f.nome}</b>
          <p className="text-xs text-zinc-500">{mostrarLoja ? `${f.loja} · ` : ''}{f.categoria}{ult ? ` · ${brl(ult.valor)} em ${ddmm(ult.vence)}` : f.valor_mes ? ` · ${brl(f.valor_mes)} neste mês` : ''}</p>
        </div>
        {financeiro && <>
          <button disabled={ocupado} onClick={() => agir('confirmar')} className={PRINCIPAL}><i className="ri-repeat-line" /> É fixa todo mês</button>
          <button disabled={ocupado} onClick={() => agir('nao_e_fixa')} className={SECUNDARIO}>Não é fixa</button>
        </>}
      </div>
      {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
    </Cartao>
  );
}

function LinhaFixa({ f, dono, financeiro, onMudou }: { f: ContaFixa; dono: boolean; financeiro: boolean; onMudou: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const e = ESTADO_FIXA[f.estado];
  const abertas = f.contas.filter((c) => c.status !== 'paid');
  const agir = async (a: AcaoFixa, dados: Record<string, unknown> = {}) => {
    setOcupado(true); setErro(null);
    try { await marcarFixa(f, a, dados); onMudou(); } catch (err) { setErro(err instanceof Error ? err.message : String(err)); } finally { setOcupado(false); }
  };
  const valor = f.valor_mes ?? f.valor_fixo ?? f.media;
  const sub = f.categoria.includes(' › ') ? f.categoria.split(' › ')[1] : null;
  const detalhe = (() => {
    if (f.estado === 'paga') return `Paga em ${ddmm(f.pago_em)}${f.contas.some((c) => c.origem === 'conciliacao_extrato') ? ' · ligada ao extrato' : ''}`;
    if (f.estado === 'a_pagar' || f.estado === 'vence_hoje' || f.estado === 'vencida') {
      const semBoleto = abertas.some((c) => !c.tem_boleto);
      return `Chegou ${ddmm(f.chegou_em)} · vence ${ddmm(f.vence_em)}${semBoleto ? ' · sem boleto guardado' : ''}`;
    }
    if (f.estado === 'nao_vem') return 'Marcada: não vem este mês.';
    if (f.estado === 'nao_chegou') return 'O mês passou e a conta não chegou nem foi paga.';
    return textoEsperando(f);
  })();
  return (
    <div className="py-2.5">
      <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1.5fr_0.9fr_1.6fr_auto] gap-x-3 gap-y-1 items-center cursor-pointer" onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button, input, label, form')) setAberto((v) => !v); }}>
        <div className="min-w-0">
          <b className="text-sm block truncate">{f.nome}</b>
          <span className="text-xs text-zinc-400">{sub ? `${sub} · ` : ''}{f.dia_vence ? `vence dia ${f.dia_vence}` : 'sem dia certo'}{f.sem_documento ? ' · sem documento' : ''}</span>
          <div className="flex gap-0.5 mt-1">
            {f.historico.slice(-4).map((h) => <i key={h.mes} title={`${ddmm(h.mes).slice(3)}: ${brl(h.valor)}`} className={`block w-3.5 h-1.5 rounded-sm ${h.pago ? 'bg-emerald-500' : 'bg-amber-400'}`} />)}
          </div>
        </div>
        <div className="hidden md:block text-sm tabular-nums">
          {valor != null ? `${f.valor_mes == null ? '~' : ''}${brl(valor)}` : '—'}
          {f.ultimo_valor != null && <small className="block text-[11px] text-zinc-400">antes: {brl(f.ultimo_valor)}</small>}
        </div>
        <div className="col-span-2 md:col-span-1 order-3 md:order-none min-w-0">
          <Pilula tom={e.tom}>{e.rotulo}</Pilula>
          {f.fora_pct != null && <span className="ml-1"><Pilula tom="red"><i className="ri-line-chart-line" /> {Math.abs(f.fora_pct)}% {f.fora_pct > 0 ? 'acima' : 'abaixo'} da média</Pilula></span>}
          <p className="text-xs text-zinc-500 mt-0.5">{detalhe}</p>
        </div>
        <div className="flex justify-end">
          <i className={`ri-arrow-${aberto ? 'up' : 'down'}-s-line text-zinc-400 text-lg`} />
        </div>
      </div>

      {(abertas.length > 0) && (
        <div className="mt-2">
          {abertas.map((c) => (
            <div key={c.id} className="mb-1.5">
              {abertas.length > 1 && <p className="text-xs text-zinc-500 mb-1">{brl(c.valor - c.pago)} · vence {ddmm(c.vence)}</p>}
              <AcoesPagar tenantId={f.tenant_id} billId={c.id} dono={dono} financeiro={financeiro} onMudou={onMudou} />
            </div>
          ))}
        </div>
      )}
      {(f.estado === 'atrasada_chegar' || f.estado === 'esperando') && financeiro && (
        <div className="flex flex-wrap gap-2 mt-2">
          {dono && f.estado === 'atrasada_chegar' && (
            <button onClick={() => pedirAoChat({ tipo: 'pedir', texto: `Pedir a conta de ${f.nome} (${f.categoria}${f.loja ? `, ${f.loja}` : ''}) — costuma vencer dia ${f.dia_vence ?? '?'}: ` })} className={SECUNDARIO}>
              <i className="ri-mail-send-line" /> Pedir a conta
            </button>
          )}
          <button disabled={ocupado} onClick={() => agir('nao_vem_mes', { mes: f.mes })} className={SECUNDARIO}><i className="ri-calendar-close-line" /> Não vem este mês</button>
        </div>
      )}
      {f.estado === 'nao_vem' && financeiro && (
        <div className="mt-2"><button disabled={ocupado} onClick={() => agir('vem_mes', { mes: f.mes })} className={LINK}>Vem sim — desfazer</button></div>
      )}

      {aberto && (
        <div className="mt-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600 flex flex-col gap-2">
          <div>
            <b className="text-zinc-700">Últimos meses:</b>{' '}
            {f.historico.length ? f.historico.map((h) => `${ddmm(h.vence)} ${brl(h.valor)}${h.pago ? '' : ' (em aberto)'}`).join(' · ') : 'sem histórico'}
            {f.media != null && <> · média {brl(f.media)}</>}
          </div>
          {f.so_extrato && !f.sem_documento && (
            <p className="text-amber-800"><i className="ri-information-line" /> Sempre foi paga sem conta lançada antes (só apareceu pelo extrato). Se não vem boleto, marque "sem documento" e o sistema lança a conta sozinho todo mês.</p>
          )}
          {financeiro && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setConfig((v) => !v)} className={SECUNDARIO}><i className="ri-settings-3-line" /> {config ? 'Fechar' : f.sem_documento ? 'Ajustar sem documento' : 'Não tem boleto (sem documento)'}</button>
              <button disabled={ocupado} onClick={() => agir('encerrar', { motivo: 'não vem mais' })} className={LINK}>Não vem mais</button>
              {f.situacao === 'confirmada' && <button disabled={ocupado} onClick={() => agir('nao_e_fixa')} className={LINK}>Não é fixa</button>}
            </div>
          )}
          {config && <ConfigSemDocumento f={f} ocupado={ocupado} onSalvar={(d) => agir('configurar', d).then(() => setConfig(false))} />}
        </div>
      )}
      {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
    </div>
  );
}

function ConfigSemDocumento({ f, ocupado, onSalvar }: { f: ContaFixa; ocupado: boolean; onSalvar: (d: Record<string, unknown>) => void }) {
  const [sem, setSem] = useState(true);
  const [dia, setDia] = useState(String(f.dia_vence ?? ''));
  const [valor, setValor] = useState(f.valor_fixo != null ? String(f.valor_fixo).replace('.', ',') : '');
  const [antes, setAntes] = useState(String(f.criar_dias_antes ?? 5));
  const campo = 'h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm w-full focus:outline-none focus:border-amber-400';
  return (
    <form className="rounded-xl bg-white border border-zinc-200 p-3 flex flex-col gap-2" onSubmit={(e) => {
      e.preventDefault();
      const v = valor.trim() ? Number(valor.replace(/\./g, '').replace(',', '.')) : null;
      onSalvar({ sem_documento: sem, dia_vence: dia ? Number(dia) : null, valor: v, criar_dias_antes: Number(antes) || 5 });
    }}>
      <label className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
        <input type="checkbox" checked={sem} onChange={(e) => setSem(e.target.checked)} /> Não vem boleto: o sistema lança a conta sozinho todo mês
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[11px] text-zinc-500">Dia de vencer<input className={campo} inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="10" /></label>
        <label className="text-[11px] text-zinc-500">Valor (vazio = o último){f.ultimo_valor != null && <span className="block text-zinc-400">último: {brl(f.ultimo_valor)}</span>}<input className={campo} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={f.ultimo_valor != null ? String(f.ultimo_valor).replace('.', ',') : '0,00'} /></label>
        <label className="text-[11px] text-zinc-500">Lançar quantos dias antes<input className={campo} inputMode="numeric" value={antes} onChange={(e) => setAntes(e.target.value.replace(/\D/g, '').slice(0, 2))} /></label>
      </div>
      <div><button type="submit" disabled={ocupado || (sem && !dia)} className={PRINCIPAL}><i className="ri-check-line" /> Salvar</button></div>
    </form>
  );
}
