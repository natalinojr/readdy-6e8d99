// Ação rápida: enviar voucher para um cliente (sem IA).
// Mesmo caminho do perfil do cliente (Clientes › Enviar Voucher, EnviarVoucherModal):
// lista fn_get_customers_list → voucher-write issue_voucher com link de ativação → wa.me com a mensagem.
// Validade: fim do dia no fuso local (T23:59:59), como a tela (AI_SYSTEM_MAP 2026-07-03).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import type { Voucher } from '@/types/vouchers';
import {
  Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, brl, dataBR, hojeISO, somaDias, lerNumero, type AcaoProps,
  invokeUmaVez,
} from '../kit';

export interface ClienteVoucher { id: string; nome: string; celular: string; totalVisitas: number }
type Cliente = ClienteVoucher;
type Tipo = 'discount_percent' | 'discount_fixed' | 'gift_card';
type Passo = 'carregando' | 'cliente' | 'tipo' | 'valor' | 'validade' | 'validade_outra' | 'minimo' | 'minimo_valor' | 'confirmar' | 'gravando' | 'enviar' | 'fim';

const TIPOS: { id: Tipo; label: string; detalhe: string }[] = [
  { id: 'discount_percent', label: 'Desconto %', detalhe: 'ex.: 15% no pedido' },
  { id: 'discount_fixed', label: 'Desconto R$', detalhe: 'ex.: R$ 20 de desconto' },
  { id: 'gift_card', label: 'Vale-presente', detalhe: 'crédito em R$' },
];

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const soDigitos = (s: string) => s.replace(/\D/g, '');

export default function EnviarVoucher({ onFechar, irPara, clienteInicial, aoCriar }: AcaoProps & {
  /** Cliente já escolhido (ex.: "Clientes que sumiram"): pula a busca. */
  clienteInicial?: ClienteVoucher;
  /** Depois de criar o voucher (o funil registra a abordagem para o cooldown). */
  aoCriar?: (voucherId: string, mensagem: string) => void;
}) {
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [achados, setAchados] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [tipo, setTipo] = useState<Tipo>('discount_percent');
  const [valor, setValor] = useState(0);
  const [fim, setFim] = useState('');
  const [minimo, setMinimo] = useState(0);
  const [criado, setCriado] = useState<Voucher | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { bot('Escolha uma loja no app antes.'); setPasso('fim'); return; }
      if (clienteInicial) { escolherCliente(clienteInicial); return; }
      const { data, error } = await supabase.rpc('fn_get_customers_list', { p_tenant_id: user.tenantId });
      if (error) { bot(`Não consegui carregar os clientes: ${error.message}`); setPasso('fim'); return; }
      const lista = ((data as Record<string, unknown>[]) ?? []).map((c) => ({
        id: String(c.id), nome: String(c.nome ?? ''), celular: String(c.celular ?? ''), totalVisitas: Number(c.totalVisitas ?? 0),
      }));
      setClientes(lista);
      bot(`Loja: *${user.loja}*\nPara qual cliente? Digite o nome ou o telefone.`);
      setPasso('cliente');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscar = (t: string) => {
    eu(t);
    const dig = soDigitos(t);
    const q = norm(t);
    const r = clientes.filter((c) => (dig.length >= 4 && soDigitos(c.celular).includes(dig)) || (dig.length < 4 && norm(c.nome).includes(q)));
    if (!r.length) { setAchados([]); bot('Não achei. Tente outro nome ou telefone.'); return; }
    if (r.length === 1) { escolherCliente(r[0]); return; }
    setAchados(r.slice(0, 8));
    bot(r.length > 8 ? `Achei ${r.length}. Mostrando 8 — refine a busca se não estiver aqui.` : 'Qual deles?');
  };

  const escolherCliente = (c: Cliente) => {
    setCliente(c);
    setAchados([]);
    bot(`${c.nome}${c.celular ? ` · ${c.celular}` : ' · sem telefone'}\nO que você quer oferecer?`);
    setPasso('tipo');
  };

  const escolherTipo = (t: Tipo) => {
    setTipo(t);
    eu(TIPOS.find((x) => x.id === t)!.label);
    bot(t === 'discount_percent' ? 'Quantos %?' : 'Qual o valor em R$?');
    setPasso('valor');
  };

  const enviarValor = (t: string) => {
    const v = lerNumero(t);
    if (!(v > 0)) { bot('Valor inválido.'); return; }
    if (tipo === 'discount_percent' && v > 100) { bot('Percentual deve ser entre 1 e 100.'); return; }
    const arred = Math.round(v * 100) / 100;
    setValor(arred);
    eu(tipo === 'discount_percent' ? `${arred}%` : brl(arred));
    bot('Válido até quando?');
    setPasso('validade');
  };

  const escolherFim = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < hojeISO()) { bot('A validade não pode ser antes de hoje.'); return; }
    setFim(iso);
    eu(dataBR(iso));
    bot('Pedido mínimo?');
    setPasso('minimo');
  };

  const descricao = (v = valor) => (tipo === 'discount_percent' ? `${v}% de desconto`
    : tipo === 'discount_fixed' ? `${brl(v)} de desconto` : `vale-presente de ${brl(v)}`);

  const resumo = (min: number) => {
    bot([
      '*Confere o voucher:*',
      `Loja: ${user?.loja ?? '—'}`,
      `Cliente: ${cliente!.nome}`,
      `Oferta: ${descricao()}`,
      `Válido: hoje até ${dataBR(fim)}`,
      `Pedido mínimo: ${min > 0 ? brl(min) : 'sem mínimo'}`,
      'Uso único · com link de ativação',
    ].join('\n'));
    setPasso('confirmar');
  };

  const escolherMinimo = (m: number) => {
    setMinimo(m);
    eu(m > 0 ? brl(m) : 'Sem mínimo');
    resumo(m);
  };

  const criar = async () => {
    eu('Criar voucher');
    setPasso('gravando');
    const payload: Record<string, unknown> = {
      action: 'issue_voucher',
      active_tenant_id: user?.tenantId,
      voucher_type: tipo === 'gift_card' ? 'gift_card' : 'discount',
      original_amount: valor,
      valid_from: null,
      expires_at: new Date(`${fim}T23:59:59`).toISOString(),
      max_uses: 1,
      min_order_amount: minimo > 0 ? minimo : null,
      generate_claim_link: true,
      customer_id: cliente!.id,
      customer_name: cliente!.nome,
      notes: null,
    };
    if (tipo !== 'gift_card') {
      payload.discount_type = tipo === 'discount_percent' ? 'percent' : 'fixed';
      payload.discount_value = valor;
    }
    try {
      const { data, error } = await invokeUmaVez('voucher-write', { body: payload });
      if (error) throw error;
      const v = (data as { data?: Voucher; error?: string })?.data;
      if (!v) throw new Error((data as { error?: string })?.error ?? 'Falha ao criar voucher');
      setCriado(v);
      aoCriar?.(v.id, montarMensagem(v));
      registrarEvento({
        tipo: 'voucher_emitido',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? '—',
        descricao: `Voucher ${v.code} (${descricao()}) enviado para ${cliente!.nome} via link de ativação`,
        entidade: 'Voucher',
        entidadeId: v.code,
      });
      bot(`✅ Voucher *${v.code}* criado.\n${cliente!.celular ? 'Toque em "Enviar no WhatsApp" para mandar a mensagem.' : 'Cliente sem telefone: copie a mensagem e envie por outro canal.'}`);
      setPasso('enviar');
    } catch (err) {
      const msg = err instanceof Error ? err.message
        : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as { message: unknown }).message) : String(err);
      bot(`❌ Não consegui criar o voucher: ${msg}\nNada foi enviado. Confira em Vouchers antes de tentar de novo.`);
      setPasso('fim');
    }
  };

  function montarMensagem(v: Voucher) {
    const link = v.claim_token ? `${window.location.origin}/voucher/${v.claim_token}` : '';
    return `\u{1F381} Olá, ${cliente!.nome.split(' ')[0]}! Você ganhou ${descricao()} na ${user?.loja || 'nossa loja'}${minimo > 0 ? ` em pedidos a partir de ${brl(minimo)}` : ''}!\n\nToque no link para ativar seu voucher:\n${link}\n\nVálido até ${dataBR(fim)}. Esperamos você! \u{1F60A}`;
  }
  const mensagem = criado ? montarMensagem(criado) : '';

  const abrirWhats = () => {
    const numero = soDigitos(cliente?.celular ?? '');
    if (!numero) return;
    window.open(`https://wa.me/55${numero}?text=${encodeURIComponent(mensagem)}`, '_blank');
  };
  const copiar = () => {
    navigator.clipboard.writeText(mensagem).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); });
  };

  return (
    <Roteiro titulo="Enviar voucher" icone="ri-coupon-3-line" cor="bg-amber-50 text-amber-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Criando voucher…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'cliente' && (
        <>
          {achados.map((c) => (
            <Opcao key={c.id} onClick={() => { eu(c.nome); escolherCliente(c); }} detalhe={c.celular || 'sem telefone'}>{c.nome}</Opcao>
          ))}
          <Campo placeholder="Nome ou telefone do cliente" onEnviar={buscar} />
        </>
      )}
      {passo === 'tipo' && TIPOS.map((t) => <Opcao key={t.id} onClick={() => escolherTipo(t.id)} detalhe={t.detalhe}>{t.label}</Opcao>)}
      {passo === 'valor' && <Campo placeholder={tipo === 'discount_percent' ? 'Ex.: 15' : 'Ex.: 20,00'} modo="decimal" onEnviar={enviarValor} />}
      {passo === 'validade' && (
        <>
          {[7, 15, 30].map((d) => (
            <Opcao key={d} onClick={() => escolherFim(somaDias(hojeISO(), d))} detalhe={`(até ${dataBR(somaDias(hojeISO(), d))})`}>{d} dias</Opcao>
          ))}
          <Opcao onClick={() => setPasso('validade_outra')}>Outra data</Opcao>
        </>
      )}
      {passo === 'validade_outra' && <Campo placeholder="Válido até" tipo="date" onEnviar={escolherFim} />}
      {passo === 'minimo' && (
        <>
          <Opcao onClick={() => escolherMinimo(0)}>Sem mínimo</Opcao>
          <Opcao onClick={() => { bot('Qual o pedido mínimo em R$?'); setPasso('minimo_valor'); }}>Definir valor mínimo</Opcao>
        </>
      )}
      {passo === 'minimo_valor' && (
        <Campo placeholder="Ex.: 50,00" modo="decimal" onEnviar={(t) => {
          const m = lerNumero(t);
          if (!(m > 0)) { bot('Valor inválido.'); return; }
          escolherMinimo(Math.round(m * 100) / 100);
        }} />
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={criar}>Criar voucher</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'enviar' && (
        <>
          {cliente?.celular && <Opcao onClick={abrirWhats}>Enviar no WhatsApp</Opcao>}
          <Opcao onClick={copiar}>{copiado ? 'Mensagem copiada' : 'Copiar mensagem'}</Opcao>
          <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Clientes', onClick: () => irPara('/clientes') }]} />
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Vouchers', onClick: () => irPara('/vouchers') }]} />}
    </Roteiro>
  );
}
