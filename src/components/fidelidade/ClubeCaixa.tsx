// Clube de fidelidade no PDV Caixa (Pagamento rápido): o operador busca o cliente
// pelo CPF, vê nível/pontos/prêmios e usa prêmio (o cliente diz os 4 últimos
// números do celular). Só identificar já vale: o pedido fica no nome dele e soma
// pontos quando for pago.
//
// O desconto que a tela mostra vem do SERVIDOR (fidelidade › clube_aplicar_pedido
// com simular=true, pelos itens do pedido). Quem grava é o modal ao confirmar
// (aplicarClubeNoPedido) — antes dos pagamentos.
import { useEffect, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { cpfValido, formatarCpf, type ClubeResumo, type ClubeReserva } from '@/lib/fidelidade';

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
  orderId: string;
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

  const estado = useRef({ resumo, reservas, manterReservas });
  estado.current = { resumo, reservas, manterReservas };

  useEffect(() => {
    if (!tenantId) return;
    void chamar<{ ativo: boolean }>(tenantId, { action: 'clube_status' }).then((r) => setAtivo(!!r.ativo && !r.error));
  }, [tenantId]);

  // Fechou o pagamento sem confirmar: devolve os prêmios reservados.
  useEffect(() => () => {
    const { resumo: r, reservas: rs, manterReservas: manter } = estado.current;
    if (!manter && r && rs.length > 0 && tenantId) {
      void chamar(tenantId, { action: 'clube_liberar', customer_id: r.customer_id, hold_ids: rs.map((x) => x.hold_id) });
    }
  }, [tenantId]);

  const avisarPai = (r: ClubeResumo | null, rs: ClubeReserva[], d: number) => {
    onChange({ customerId: r?.customer_id ?? null, holdIds: rs.map((x) => x.hold_id), desconto: d, nomes: rs.map((x) => x.reward.nome), cpf: r ? cpf.replace(/\D/g, '') : null });
  };

  const simular = async (r: ClubeResumo, rs: ClubeReserva[]) => {
    if (!tenantId) return;
    if (rs.length === 0) { setDesconto(0); avisarPai(r, rs, 0); return; }
    const s = await chamar<{ desconto: number }>(tenantId, { action: 'clube_aplicar_pedido', simular: true, customer_id: r.customer_id, order_id: orderId, hold_ids: rs.map((x) => x.hold_id) });
    const d = s.error ? 0 : Number(s.desconto ?? 0);
    if (s.error) setErro(s.message || 'Não consegui calcular o desconto.');
    else if (d <= 0) setAviso('O item do prêmio não está neste pedido — lance o item para ele sair de graça.');
    setDesconto(d);
    avisarPai(r, rs, d);
  };

  if (!tenantId || !ativo) return null;

  const buscar = async () => {
    setErro(''); setAviso('');
    const d = cpf.replace(/\D/g, '');
    if (!cpfValido(d)) { setErro('CPF inválido.'); return; }
    setOcupado(true);
    const r = await chamar<{ encontrado?: boolean; resumo?: ClubeResumo }>(tenantId, { action: 'clube_buscar', cpf: d });
    setOcupado(false);
    if (r.error) { setErro(r.message || 'Não consegui buscar.'); return; }
    if (!r.encontrado || !r.resumo) { setErro('CPF não está no clube. O cliente pode entrar pelo tablet ou pelo QR do clube.'); return; }
    setResumo(r.resumo);
    setReservas([]);
    setDesconto(0);
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
    avisarPai(null, [], 0);
  };

  const usaveis = resumo ? [
    ...resumo.beneficios.map((b) => ({ key: `b_${b.id}`, nome: b.reward.nome, detalhe: b.reward.motivo ?? 'Prêmio', alvo: { beneficio_id: b.id } })),
    ...resumo.recompensas.filter((w) => w.nivel_ok && w.falta <= 0).map((w) => ({ key: `r_${w.id}`, nome: w.nome, detalhe: `${pts(w.custo_pontos)} pts`, alvo: { recompensa_id: w.id } })),
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
          {!resumo ? (
            <div className="flex gap-2">
              <input value={formatarCpf(cpf)} onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="CPF do cliente"
                onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }}
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400" />
              <button type="button" onClick={() => { void buscar(); }} disabled={ocupado} className="px-3 py-2 bg-zinc-800 text-white text-sm font-bold rounded-lg cursor-pointer disabled:opacity-50">Buscar</button>
            </div>
          ) : (
            <>
              <p className="text-xs text-zinc-600">
                {resumo.nivel ? <><b style={{ color: resumo.nivel.cor }}>{resumo.nivel.emoji} {resumo.nivel.nome}</b> · </> : null}
                {resumo.compras_janela} compras{resumo.proximo ? ` · faltam ${resumo.faltam_compras} ${resumo.faltam_compras === 1 ? 'compra' : 'compras'} para ${resumo.proximo.nome}` : ''}. Este pedido soma pontos quando for pago.
              </p>
              {reservas.map((r) => (
                <div key={r.hold_id} className="flex items-center gap-2 text-xs bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5">
                  <span className="flex-1"><b>🎁 {r.reward.nome}</b></span>
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
