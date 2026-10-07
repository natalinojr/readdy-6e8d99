// Clube de fidelidade dentro de um checkout público (delivery próprio e pedido pela
// mesa/QR). O cliente entra com CPF + 4 últimos números do celular (ou já está com
// o cartão do clube no aparelho), vê os pontos e reserva prêmios para ESTE pedido.
//
// O desconto mostrado aqui é só vitrine: quem calcula de verdade é o servidor
// (delivery-write / mesa-write), com os preços dele. Este componente só avisa o pai
// qual é o cartão e quais reservas ir no pedido (onChange).
import { useEffect, useMemo, useRef, useState } from 'react';
import { cpfValido, descontoDasReservas, formatarCpf, rotuloPremio } from '@/lib/fidelidade';
import { clubeChamar, clubeSalvarToken, clubeTokenSalvo, type ClubeDados, type ClubeReserva, type ClubeResumo } from '@/lib/clubePublico';

export interface ClubeSelecao { token: string | null; holdIds: string[]; desconto: number; nomes: string[] }

// Reservas deste checkout ficam na sessão do navegador: fechar e reabrir o carrinho
// (o componente desmonta) não pode "esquecer" um prêmio que está reservado no banco.
const chaveRes = (tenantId: string) => `clube_reservas:${tenantId}`;
function lerReservas(tenantId: string, token: string): ClubeReserva[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(chaveRes(tenantId)) || 'null');
    return v && v.token === token && Array.isArray(v.reservas) ? v.reservas : [];
  } catch { return []; }
}
function gravarReservas(tenantId: string, token: string | null, reservas: ClubeReserva[]) {
  try {
    if (!token || reservas.length === 0) sessionStorage.removeItem(chaveRes(tenantId));
    else sessionStorage.setItem(chaveRes(tenantId), JSON.stringify({ token, reservas }));
  } catch { /* sem storage */ }
}

/** Pedido enviado: as reservas viraram uso daquele pedido — o próximo carrinho começa limpo. */
export function clubeLimparReservas(tenantId: string | null | undefined) {
  if (tenantId) gravarReservas(tenantId, null, []);
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pts = (n: number) => Math.floor(Number(n) || 0).toLocaleString('pt-BR');

export default function ClubeCheckout({ tenantId, itens, subtotal, onChange, compacto = false }: {
  tenantId: string | null | undefined;
  /** Itens do carrinho com o preço de CARDÁPIO (sem adicionais) — produto grátis vale 1 unidade. */
  itens: { id: string; preco: number; qtd: number }[];
  /** Base do desconto (subtotal já sem cupom). */
  subtotal: number;
  onChange: (sel: ClubeSelecao) => void;
  compacto?: boolean;
}) {
  const [ativo, setAtivo] = useState<boolean | null>(null);
  const [programaNome, setProgramaNome] = useState('Clube');
  const [slug, setSlug] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ClubeResumo | null>(null);
  const [reservas, setReservas] = useState<ClubeReserva[]>([]);
  const [aberto, setAberto] = useState(false);
  const [cpf, setCpf] = useState('');
  const [final, setFinal] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisou = useRef('');

  // Programa da loja + cartão salvo neste aparelho.
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    (async () => {
      const p = await clubeChamar<{ ativo: boolean; loja: { slug: string | null }; programa: { nome: string } | null }>({ action: 'programa', tenant_id: tenantId });
      if (!vivo) return;
      setAtivo(!!p.ativo);
      if (p.programa?.nome) setProgramaNome(p.programa.nome);
      setSlug(p.loja?.slug ?? null);
      if (!p.ativo) return;
      const salvo = clubeTokenSalvo(tenantId);
      if (!salvo) return;
      const eu = await clubeChamar<ClubeDados>({ action: 'eu', token: salvo });
      if (!vivo) return;
      if (eu.error) { clubeSalvarToken(tenantId, null); return; }
      setToken(salvo);
      setResumo(eu.resumo);
      setReservas(lerReservas(tenantId, salvo));
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  const desc = useMemo(() => descontoDasReservas(reservas, itens, subtotal), [reservas, itens, subtotal]);

  useEffect(() => {
    if (tenantId && token) gravarReservas(tenantId, token, reservas);
  }, [tenantId, token, reservas]);

  // Avisa o pai só quando muda de verdade (evita loop de render).
  useEffect(() => {
    const usados = reservas.filter((r) => (desc.porReserva[r.hold_id] ?? 0) > 0);
    const sel: ClubeSelecao = { token, holdIds: usados.map((r) => r.hold_id), desconto: desc.total, nomes: usados.map((r) => r.reward.nome) };
    const chave = JSON.stringify(sel);
    if (chave === avisou.current) return;
    avisou.current = chave;
    onChange(sel);
  }, [token, reservas, desc, onChange]);

  if (!tenantId || !ativo) return null;

  const entrar = async () => {
    setErro('');
    const d = cpf.replace(/\D/g, '');
    if (!cpfValido(d)) { setErro('CPF inválido.'); return; }
    if (final.length !== 4) { setErro('Digite os 4 últimos números do celular.'); return; }
    setOcupado(true);
    const r = await clubeChamar<ClubeDados & { encontrado?: boolean }>({ action: 'entrar', tenant_id: tenantId, cpf: d, celular_final: final });
    setOcupado(false);
    if (r.error) { setErro(r.message || 'Não consegui entrar.'); return; }
    if (!r.encontrado || !r.token) { setErro('CPF não está no clube. Cadastre-se pelo link abaixo.'); return; }
    clubeSalvarToken(tenantId, r.token);
    setToken(r.token);
    setResumo(r.resumo);
  };

  const usar = async (alvo: { recompensa_id?: string; beneficio_id?: string }) => {
    if (!token) return;
    setErro(''); setOcupado(true);
    const r = await clubeChamar<{ reserva?: ClubeReserva; resumo?: ClubeResumo }>({ action: 'reservar', token, ...alvo });
    setOcupado(false);
    if (r.error || !r.reserva) { setErro(r.message || 'Não consegui usar agora.'); return; }
    setReservas((prev) => [...prev, r.reserva!]);
    if (r.resumo) setResumo(r.resumo);
  };

  const remover = async (holdId: string) => {
    if (!token) return;
    setOcupado(true);
    const r = await clubeChamar<{ resumo?: ClubeResumo }>({ action: 'liberar', token, hold_ids: [holdId] });
    setOcupado(false);
    setReservas((prev) => prev.filter((x) => x.hold_id !== holdId));
    if (r.resumo) setResumo(r.resumo);
  };

  const sair = () => {
    if (reservas.length && token) void clubeChamar({ action: 'liberar', token, hold_ids: reservas.map((r) => r.hold_id) });
    if (token) void clubeChamar({ action: 'sair', token });
    clubeSalvarToken(tenantId, null);
    gravarReservas(tenantId, null, []);
    setToken(null); setResumo(null); setReservas([]);
  };

  const usaveis = resumo ? [
    ...resumo.beneficios.map((b) => ({ key: `b_${b.id}`, nome: rotuloPremio(b.reward), detalhe: b.reward.motivo ?? 'Prêmio', alvo: { beneficio_id: b.id } })),
    ...resumo.recompensas.filter((w) => w.nivel_ok && w.falta <= 0).map((w) => ({ key: `r_${w.id}`, nome: rotuloPremio(w), detalhe: `${pts(w.custo_pontos)} pontos`, alvo: { recompensa_id: w.id } })),
  ] : [];

  return (
    <div className={`rounded-xl border ${compacto ? 'border-amber-200 bg-amber-50/60' : 'border-amber-300 bg-gradient-to-r from-amber-50 to-rose-50'} text-zinc-800`}>
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer">
        <span className="text-lg">{resumo?.nivel?.emoji ?? '👑'}</span>
        <span className="flex-1 min-w-0 text-xs">
          {resumo ? (
            <><b>{resumo.primeiro_nome}</b> · {resumo.nivel?.nome ?? programaNome} · <b>{pts(resumo.saldo)} pts</b>{desc.total > 0 ? <span className="text-green-700 font-bold"> · −{brl(desc.total)}</span> : usaveis.length > 0 ? <span className="text-amber-700 font-bold"> · {usaveis.length} prêmio{usaveis.length > 1 ? 's' : ''} para usar</span> : null}</>
          ) : (
            <><b>{programaNome}</b>: entre e ganhe pontos neste pedido</>
          )}
        </span>
        <i className={`ri-arrow-${aberto ? 'up' : 'down'}-s-line text-zinc-500`} />
      </button>

      {aberto && (
        <div className="px-3 pb-3 space-y-2">
          {!resumo ? (
            <>
              <div className="flex gap-2">
                <input value={formatarCpf(cpf)} onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="CPF" className="flex-1 min-w-0 px-3 py-2 text-xs border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400" />
                <input value={final} onChange={(e) => setFinal(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="4 últ. cel." className="w-24 px-2 py-2 text-xs border border-zinc-200 rounded-lg bg-white text-center focus:outline-none focus:border-amber-400" />
              </div>
              <button type="button" onClick={() => { void entrar(); }} disabled={ocupado} className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-black rounded-lg cursor-pointer disabled:opacity-50">
                {ocupado ? 'Entrando…' : 'Entrar no clube'}
              </button>
              {slug && <a href={`/clube/${slug}`} target="_blank" rel="noreferrer" className="block text-center text-[11px] text-amber-700 underline">Ainda não é do clube? Cadastre-se grátis</a>}
            </>
          ) : (
            <>
              {reservas.map((r) => {
                const v = desc.porReserva[r.hold_id] ?? 0;
                return (
                  <div key={r.hold_id} className="flex items-center gap-2 text-xs bg-white rounded-lg px-2.5 py-2 border border-green-200">
                    <span className="flex-1 min-w-0"><b>🎁 {rotuloPremio(r.reward)}</b>{v > 0 ? <span className="text-green-700"> −{brl(v)}</span> : <span className="text-amber-700"> · adicione o item ao carrinho</span>}</span>
                    <button type="button" onClick={() => { void remover(r.hold_id); }} disabled={ocupado} className="text-zinc-400 hover:text-red-600 cursor-pointer"><i className="ri-close-circle-line" /></button>
                  </div>
                );
              })}
              {usaveis.length > 0 ? usaveis.map((u) => (
                <div key={u.key} className="flex items-center gap-2 text-xs bg-white rounded-lg px-2.5 py-2 border border-zinc-200">
                  <span className="flex-1 min-w-0"><b>{u.nome}</b> <span className="text-zinc-500">· {u.detalhe}</span></span>
                  <button type="button" onClick={() => { void usar(u.alvo); }} disabled={ocupado} className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-md cursor-pointer disabled:opacity-50">Usar</button>
                </div>
              )) : reservas.length === 0 && (
                <p className="text-[11px] text-zinc-600">
                  {resumo.recompensas[0] ? `Faltam ${pts(resumo.recompensas[0].falta)} pts para ${resumo.recompensas[0].nome}. ` : ''}Este pedido já soma pontos quando for pago.
                </p>
              )}
              <div className="flex justify-between text-[11px]">
                {slug ? <a href={`/clube/${slug}`} target="_blank" rel="noreferrer" className="text-amber-700 underline">Ver meu clube</a> : <span />}
                <button type="button" onClick={sair} className="text-zinc-400 hover:text-zinc-700 cursor-pointer">Não sou eu</button>
              </div>
            </>
          )}
          {erro && <p className="text-[11px] text-red-600 font-semibold">{erro}</p>}
        </div>
      )}
    </div>
  );
}
