// Clube de fidelidade no PDV Caixa (Pagamento rápido): o operador busca o cliente
// pelo CPF, vê nível/pontos/prêmios e usa prêmio (o cliente diz os 4 últimos
// números do celular). Só identificar já vale: o pedido fica no nome dele e soma
// pontos quando for pago. CPF que não é do clube → cadastro ali mesmo (nome, celular,
// aniversário e o aceite do cliente), pela mesma regra do tablet (clube_cadastrar).
//
// O desconto que a tela mostra vem do SERVIDOR (fidelidade › clube_aplicar_pedido
// com simular=true, pelos itens do pedido). Quem grava é o modal ao confirmar
// (aplicarClubeNoPedido) — antes dos pagamentos.
//
// Sem orderId (PDV Caixa › Finalizar Pedido: o pedido ainda não existe) o cartão só
// identifica: o modal manda o customer_id no create_order (loyalty_customer_id) e os
// prêmios ficam para quando o pedido já estiver lançado.
import { useEffect, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import SeletorDataNascimento from '@/components/base/SeletorDataNascimento';
import { cpfValido, formatarCpf, rotuloPremio, type ClubeResumo, type ClubeReserva } from '@/lib/fidelidade';

export interface ClubeCaixaSel { customerId: string | null; holdIds: string[]; desconto: number; nomes: string[]; cpf: string | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pts = (n: number) => Math.floor(Number(n) || 0).toLocaleString('pt-BR');

type Resp<T> = T & { error?: string; message?: string; ativo?: boolean };

async function chamar<T>(tenantId: string, body: Record<string, unknown>): Promise<Resp<T>> {
  const r = await invokeWithAuth<Resp<T>>('fidelidade', { body: { tenant_id: tenantId, ...body } });
  if (r.error) return { error: 'erro', message: r.error.message } as Resp<T>;
  return (r.data ?? { error: 'erro', message: 'Sem resposta' }) as Resp<T>;
}

/** Grava no pedido (chamado pelo modal ao confirmar, antes dos pagamentos). */
export async function aplicarClubeNoPedido(tenantId: string, orderId: string, sel: ClubeCaixaSel): Promise<{ desconto: number }> {
  const r = await chamar<{ desconto: number }>(tenantId, { action: 'clube_aplicar_pedido', customer_id: sel.customerId, order_id: orderId, hold_ids: sel.holdIds });
  if (r.error) throw new Error(r.message || 'Não consegui aplicar o clube no pedido.');
  return { desconto: Number(r.desconto ?? 0) };
}

export default function ClubeCaixa({ tenantId, orderId, onChange, manterReservas }: {
  tenantId: string | undefined;
  /** null: pedido ainda não lançado — só identifica o cliente (sem usar prêmio). */
  orderId: string | null;
  onChange: (sel: ClubeCaixaSel) => void;
  /** true depois que o pagamento foi confirmado: fechar a tela não devolve os prêmios. */
  manterReservas: boolean;
}) {
  const [ativo, setAtivo] = useState<boolean | null>(null);
  const [aberto, setAberto] = useState(false);
  const [cpf, setCpf] = useState('');
  const [resumo, setResumo] = useState<ClubeResumo | null>(null);
  const [reservas, setReservas] = useState<ClubeReserva[]>([]);
  const [desconto, setDesconto] = useState(0);
  const [digitosPara, setDigitosPara] = useState<{ nome: string; alvo: { recompensa_id?: string; beneficio_id?: string } } | null>(null);
  const [digitos, setDigitos] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // CPF fora do clube: formulário de cadastro. O aceite começa DESMARCADO — o operador
  // marca depois de perguntar ao cliente (LGPD: digitar o CPF não inscreve ninguém).
  const [cadastro, setCadastro] = useState(false);
  const [nome, setNome] = useState('');
  const [celular, setCelular] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [aceita, setAceita] = useState(false);
  const [ofertas, setOfertas] = useState(false);
  const [bonus, setBonus] = useState(0);
  const [novo, setNovo] = useState(false);

  const estado = useRef({ resumo, reservas, manterReservas });
  // CPF que veio do cadastro do clube (não do "CPF na nota" do pedido) não vai para a nota.
  const cpfNaNota = useRef(true);
  estado.current = { resumo, reservas, manterReservas };

  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    void (async () => {
      const st = await chamar<{ ativo: boolean; bonus_cadastro?: number }>(tenantId, { action: 'clube_status' });
      const on = !!st.ativo && !st.error;
      if (!vivo) return;
      setAtivo(on);
      setBonus(Number(st.bonus_cadastro ?? 0));
      if (!on || !orderId) return;
      // CPF que o cliente já deu no pedido (tablet: clube ou CPF na nota) vem preenchido;
      // se ele é do clube, o cartão já aparece.
      const r = await chamar<{ cpf?: string | null; na_nota?: boolean; encontrado?: boolean; resumo?: ClubeResumo }>(tenantId, { action: 'clube_do_pedido', order_id: orderId });
      if (!vivo || r.error || !r.cpf) return;
      setCpf(r.cpf);
      cpfNaNota.current = !!r.na_nota;
      setAberto(true);
      if (r.encontrado && r.resumo) {
        setResumo(r.resumo);
        onChange({ customerId: r.resumo.customer_id, holdIds: [], desconto: 0, nomes: [], cpf: r.na_nota ? r.cpf : null });
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, orderId]);

  // Fechou o pagamento sem confirmar: devolve os prêmios reservados.
  useEffect(() => () => {
    const { resumo: r, reservas: rs, manterReservas: manter } = estado.current;
    if (!manter && r && rs.length > 0 && tenantId) {
      void chamar(tenantId, { action: 'clube_liberar', customer_id: r.customer_id, hold_ids: rs.map((x) => x.hold_id) });
    }
  }, [tenantId]);

  const avisarPai = (r: ClubeResumo | null, rs: ClubeReserva[], d: number) => {
    onChange({ customerId: r?.customer_id ?? null, holdIds: rs.map((x) => x.hold_id), desconto: d, nomes: rs.map((x) => x.reward.nome), cpf: r && cpfNaNota.current ? cpf.replace(/\D/g, '') : null });
  };

  const simular = async (r: ClubeResumo, rs: ClubeReserva[]) => {
    if (!tenantId || !orderId) return;
    if (rs.length === 0) { setDesconto(0); avisarPai(r, rs, 0); return; }
    const s = await chamar<{ desconto: number }>(tenantId, { action: 'clube_aplicar_pedido', simular: true, customer_id: r.customer_id, order_id: orderId, hold_ids: rs.map((x) => x.hold_id) });
    const d = s.error ? 0 : Number(s.desconto ?? 0);
    if (s.error) setErro(s.message || 'Não consegui calcular o desconto.');
    else if (d <= 0) setAviso('O item do prêmio não está neste pedido — lance o item para o prêmio valer.');
    setDesconto(d);
    avisarPai(r, rs, d);
  };

  if (!tenantId || !ativo) return null;

  const buscar = async () => {
    setErro(''); setAviso('');
    cpfNaNota.current = true;
    const d = cpf.replace(/\D/g, '');
    if (!cpfValido(d)) { setErro('CPF inválido.'); return; }
    setOcupado(true);
    const r = await chamar<{ encontrado?: boolean; resumo?: ClubeResumo }>(tenantId, { action: 'clube_buscar', cpf: d });
    setOcupado(false);
    if (r.error) { setErro(r.message || 'Não consegui buscar.'); return; }
    if (!r.encontrado || !r.resumo) { setCadastro(true); return; }
    setResumo(r.resumo);
    setReservas([]);
    setDesconto(0);
    avisarPai(r.resumo, [], 0);
  };

  const cadastrar = async () => {
    setErro('');
    if (nome.trim().length < 2) { setErro('Digite o nome do cliente.'); return; }
    const cel = celular.replace(/\D/g, '');
    if (cel.length < 10 || cel.length > 11) { setErro('Digite o celular com DDD.'); return; }
    if (!aceita) { setErro('Pergunte ao cliente e marque que ele aceita participar do clube.'); return; }
    setOcupado(true);
    const r = await chamar<{ resumo?: ClubeResumo }>(tenantId, {
      action: 'clube_cadastrar', cpf: cpf.replace(/\D/g, ''), nome: nome.trim(), celular: cel,
      nascimento: nascimento || null, aceita_termos: true, aceita_ofertas: ofertas,
    });
    setOcupado(false);
    if (r.error || !r.resumo) { setErro(r.message || 'Não consegui cadastrar.'); return; }
    cpfNaNota.current = true;
    setCadastro(false); setNovo(true);
    setResumo(r.resumo); setReservas([]); setDesconto(0);
    avisarPai(r.resumo, [], 0);
  };

  const confirmarDigitos = async () => {
    if (!digitosPara || !resumo) return;
    setErro(''); setAviso(''); setOcupado(true);
    const r = await chamar<{ reserva?: ClubeReserva; resumo?: ClubeResumo }>(tenantId, {
      action: 'clube_reservar', customer_id: resumo.customer_id, celular_final: digitos, ...digitosPara.alvo,
    });
    setOcupado(false);
    setDigitos('');
    if (r.error || !r.reserva) { setErro(r.message || 'Não consegui usar o prêmio.'); return; }
    const novas = [...reservas, r.reserva];
    const novoResumo = r.resumo ?? resumo;
    setReservas(novas); setResumo(novoResumo); setDigitosPara(null);
    await simular(novoResumo, novas);
  };

  const remover = async (holdId: string) => {
    if (!resumo) return;
    setOcupado(true);
    await chamar(tenantId, { action: 'clube_liberar', customer_id: resumo.customer_id, hold_ids: [holdId] });
    const r = await chamar<{ resumo?: ClubeResumo }>(tenantId, { action: 'clube_resumo', customer_id: resumo.customer_id });
    setOcupado(false);
    const novas = reservas.filter((x) => x.hold_id !== holdId);
    const novoResumo = r.resumo ?? resumo;
    setReservas(novas); setResumo(novoResumo); setAviso('');
    await simular(novoResumo, novas);
  };

  const trocarCliente = async () => {
    if (resumo && reservas.length) await chamar(tenantId, { action: 'clube_liberar', customer_id: resumo.customer_id, hold_ids: reservas.map((x) => x.hold_id) });
    setResumo(null); setReservas([]); setDesconto(0); setCpf(''); setErro(''); setAviso('');
    setCadastro(false); setNovo(false); setNome(''); setCelular(''); setNascimento(''); setAceita(false); setOfertas(false);
    avisarPai(null, [], 0);
  };

  const usaveis = resumo && orderId ? [
    ...resumo.beneficios.map((b) => ({ key: `b_${b.id}`, nome: rotuloPremio(b.reward), detalhe: b.reward.motivo ?? 'Prêmio', alvo: { beneficio_id: b.id } })),
    ...resumo.recompensas.filter((w) => w.nivel_ok && w.falta <= 0).map((w) => ({ key: `r_${w.id}`, nome: rotuloPremio(w), detalhe: `${pts(w.custo_pontos)} pts`, alvo: { recompensa_id: w.id } })),
  ] : [];

  return (
    <div className="border border-amber-200 rounded-xl bg-amber-50/50">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-sm cursor-pointer">
        <span className="font-semibold text-zinc-700">
          {resumo ? <>{resumo.nivel?.emoji ?? '👑'} {resumo.primeiro_nome} · {pts(resumo.saldo)} pts{desconto > 0 && <span className="text-emerald-600"> · −{brl(desconto)}</span>}</> : '👑 Clube de fidelidade (CPF do cliente)'}
        </span>
        <i className={`ri-arrow-${aberto ? 'up' : 'down'}-s-line text-zinc-400`} />
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-2">
          {!resumo && cadastro ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-600">CPF <b className="tabular-nums">{formatarCpf(cpf)}</b> não está no clube. Cadastre agora{bonus > 0 ? <> — ganha <b className="text-amber-700">{pts(bonus)} pts</b> de boas-vindas</> : null}:</p>
              <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="off" placeholder="Nome do cliente"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400" />
              <input value={celular} onChange={(e) => setCelular(e.target.value.replace(/[^\d() -]/g, '').slice(0, 16))} inputMode="numeric" autoComplete="off" placeholder="Celular com DDD"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400" />
              <div>
                <span className="text-[11px] text-zinc-500">Aniversário (opcional)</span>
                <SeletorDataNascimento value={nascimento} onChange={setNascimento}
                  selectClassName="w-full px-2 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400 cursor-pointer" />
              </div>
              <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-500" />
                <span>O cliente <b>aceita participar do clube</b> (CPF e celular usados só para somar pontos e liberar prêmios).</span>
              </label>
              <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={ofertas} onChange={(e) => setOfertas(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-500" />
                <span>Aceita receber novidades e ofertas no WhatsApp.</span>
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setCadastro(false); setErro(''); }} className="px-3 py-2 text-sm text-zinc-500 cursor-pointer">Voltar</button>
                <button type="button" onClick={() => { void cadastrar(); }} disabled={ocupado} className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-sm font-bold rounded-lg cursor-pointer disabled:opacity-50">
                  {ocupado ? 'Cadastrando…' : 'Cadastrar no clube'}
                </button>
              </div>
            </div>
          ) : !resumo ? (
            <div className="flex gap-2">
              <input value={formatarCpf(cpf)} onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="CPF do cliente"
                onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }}
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400" />
              <button type="button" onClick={() => { void buscar(); }} disabled={ocupado} className="px-3 py-2 bg-zinc-800 text-white text-sm font-bold rounded-lg cursor-pointer disabled:opacity-50">Buscar</button>
            </div>
          ) : (
            <>
              {novo && <p className="text-xs font-semibold text-emerald-700">🎉 Cadastrado no clube{bonus > 0 ? ` — ganhou ${pts(bonus)} pts de boas-vindas` : ''}.</p>}
              {cpfValido(cpf) && <p className="text-xs text-zinc-500">CPF <b className="text-zinc-700 tabular-nums">{formatarCpf(cpf)}</b></p>}
              <p className="text-xs text-zinc-600">
                {resumo.nivel ? <><b style={{ color: resumo.nivel.cor }}>{resumo.nivel.emoji} {resumo.nivel.nome}</b> · </> : null}
                {resumo.compras_janela} compras{resumo.proximo ? ` · faltam ${resumo.faltam_compras} ${resumo.faltam_compras === 1 ? 'compra' : 'compras'} para ${resumo.proximo.nome}` : ''}. Este pedido soma pontos quando for pago.
              </p>
              {!orderId && (resumo.beneficios.length > 0 || resumo.recompensas.some((w) => w.nivel_ok && w.falta <= 0)) && (
                <p className="text-[11px] text-amber-700">Tem prêmio para usar: lance o pedido e cobre pelos Pedidos/Pagamento rápido para aplicar.</p>
              )}
              {reservas.map((r) => (
                <div key={r.hold_id} className="flex items-center gap-2 text-xs bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5">
                  <span className="flex-1"><b>🎁 {rotuloPremio(r.reward)}</b></span>
                  <button type="button" onClick={() => { void remover(r.hold_id); }} disabled={ocupado} className="text-zinc-400 hover:text-red-600 cursor-pointer"><i className="ri-close-circle-line" /></button>
                </div>
              ))}
              {usaveis.map((u) => (
                <div key={u.key} className="flex items-center gap-2 text-xs bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5">
                  <span className="flex-1"><b>{u.nome}</b> <span className="text-zinc-500">· {u.detalhe}</span></span>
                  <button type="button" onClick={() => { setDigitosPara({ nome: u.nome, alvo: u.alvo }); setDigitos(''); setErro(''); }} disabled={ocupado} className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-md cursor-pointer">Usar</button>
                </div>
              ))}
              {digitosPara && (
                <div className="bg-white border border-amber-300 rounded-lg p-2.5 space-y-2">
                  <p className="text-xs text-zinc-700">Peça ao cliente os <b>4 últimos números do celular</b> para usar <b>{digitosPara.nome}</b>:</p>
                  <div className="flex gap-2">
                    <input value={digitos} onChange={(e) => setDigitos(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter' && digitos.length === 4) void confirmarDigitos(); }}
                      className="w-24 px-2 py-1.5 text-center text-sm font-bold tracking-widest border border-zinc-200 rounded-lg" />
                    <button type="button" onClick={() => { void confirmarDigitos(); }} disabled={ocupado || digitos.length !== 4} className="px-3 py-1.5 bg-amber-500 text-zinc-950 text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50">Confirmar</button>
                    <button type="button" onClick={() => setDigitosPara(null)} className="px-2 text-xs text-zinc-500 cursor-pointer">Cancelar</button>
                  </div>
                </div>
              )}
              <button type="button" onClick={() => { void trocarCliente(); }} className="text-[11px] text-zinc-400 hover:text-zinc-700 cursor-pointer">Trocar cliente</button>
            </>
          )}
          {aviso && <p className="text-[11px] text-amber-700">{aviso}</p>}
          {erro && <p className="text-[11px] text-red-600 font-semibold">{erro}</p>}
        </div>
      )}
    </div>
  );
}
