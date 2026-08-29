import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import MapaPin from '@/components/feature/MapaPin';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import type { DestinoInfo } from '@/contexts/PDVContext';

/**
 * Delivery lançado no caixa: escolhe (ou cadastra) um cliente do MESMO cadastro do
 * link do delivery — `delivery_customers` + `delivery_customer_addresses` — e cota a
 * taxa de entrega pelo backend (`quote_delivery_fee`), com a mesma regra do link:
 * rota real por faixa de distância quando a loja usa pin, senão a taxa do bairro.
 */

interface Endereco {
  id: string | null;
  label: string | null;
  neighborhood_id: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  reference_point: string | null;
  is_default: boolean;
  lat: number | null;
  lng: number | null;
  bairro: string | null;
  neighborhood_fee: number;
}

interface Cliente {
  id: string;
  name: string;
  phone: string;
  last_used_at: string | null;
  addresses: Endereco[];
}

interface Bairro {
  id: string;
  name: string;
  delivery_fee: number;
}

interface Quote {
  mode: 'distancia' | 'bairro' | 'manual';
  fee: number;
  km: number | null;
  route_min: number | null;
  tempo_max_min: number | null;
  dentro_area: boolean;
  needs_pin?: boolean;
}

interface Props {
  tenantId: string;
  current: DestinoInfo | null;
  onConfirm: (info: DestinoInfo) => void;
  onClose: () => void;
}

/** Chave de identidade de um endereco: usa o id; o legado (sem id) cai no texto. */
function chaveEndereco(a: Endereco | null): string {
  if (!a) return '';
  return a.id ?? `legacy:${a.street ?? ''}|${a.number ?? ''}|${a.complement ?? ''}`;
}

export function enderecoEmUmaLinha(a: Endereco | null): string {
  if (!a) return '';
  const rua = [a.street, a.number].filter(Boolean).join(', ');
  return [rua, a.complement, a.bairro].filter(Boolean).join(' — ');
}

/** Mesmos rotulos que o link do delivery grava — mantem o cadastro consistente. */
const ROTULOS_ENDERECO = ['Casa', 'Trabalho', 'Escritório', 'Outro'];

function formatTelefone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export default function DeliveryClienteCaixaModal({ tenantId, current, onConfirm, onClose }: Props) {
  // ── Config da loja ──
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [distanceMode, setDistanceMode] = useState(false);
  const [storeLoc, setStoreLoc] = useState<{ lat: number; lng: number } | null>(null);

  // ── Busca ──
  const [q, setQ] = useState('');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState('');

  // ── Seleção ──
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [endereco, setEndereco] = useState<Endereco | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [cotando, setCotando] = useState(false);
  const [taxaManual, setTaxaManual] = useState('');
  const [obs, setObs] = useState(current?.observacaoPedido ?? '');

  // ── Pagamento previsto na entrega (o cliente paga ao motoboy) ──
  const { formasAtivas } = usePaymentMethods();
  const [formaPagamento, setFormaPagamento] = useState<string>('');
  const [trocoPara, setTrocoPara] = useState('');
  const formaSel = formasAtivas.find((f) => f.id === formaPagamento) ?? null;
  const pedeTroco = formaSel?.tipo === 'dinheiro' || formaSel?.exigeTroco === true;

  // ── Cadastro (cliente novo ou endereço novo) ──
  const [modo, setModo] = useState<'lista' | 'novo_cliente' | 'novo_endereco'>('lista');
  const [fNome, setFNome] = useState('');
  const [fTelefone, setFTelefone] = useState('');
  const [fRua, setFRua] = useState('');
  const [fNumero, setFNumero] = useState('');
  const [fBairroId, setFBairroId] = useState('');
  const [fBairroTexto, setFBairroTexto] = useState('');
  const [fComplemento, setFComplemento] = useState('');
  const [fReferencia, setFReferencia] = useState('');
  const [fRotulo, setFRotulo] = useState('Casa');
  const [fLat, setFLat] = useState<number | null>(null);
  const [fLng, setFLng] = useState<number | null>(null);
  // Confirmacao EXPLICITA do pin. Nao pode ser derivada de fLat/fLng: arrastar o
  // mapa ja grava a coordenada do centro, o que fazia o botao de confirmar sumir.
  const [pinConfirmado, setPinConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  // Quais campos obrigatorios estao faltando — o aviso no topo do form rolado some
  // da vista, entao o erro tambem aparece junto do botao Salvar.
  const [faltando, setFaltando] = useState<{ nome?: boolean; telefone?: boolean }>({});

  const buscaSeq = useRef(0);

  // ── Bootstrap da config de entrega ──
  useEffect(() => {
    let vivo = true;
    invokeWithAuth<{ neighborhoods?: Bairro[]; store_location?: { lat: number; lng: number } | null; distance_mode?: boolean }>(
      'delivery-write',
      { body: { action: 'pdv_delivery_bootstrap', tenant_id: tenantId } },
    ).then(({ data }) => {
      if (!vivo || !data) return;
      setBairros(data.neighborhoods ?? []);
      setDistanceMode(!!data.distance_mode);
      setStoreLoc(data.store_location ?? null);
    });
    return () => { vivo = false; };
  }, [tenantId]);

  // ── Busca de clientes (debounce) ──
  const buscar = useCallback(async (termo: string) => {
    const seq = ++buscaSeq.current;
    setBuscando(true);
    const { data, error } = await invokeWithAuth<{ customers?: Cliente[]; error?: string }>('delivery-write', {
      body: { action: 'search_customers', tenant_id: tenantId, q: termo },
    });
    if (seq !== buscaSeq.current) return; // resposta velha: descarta
    setBuscando(false);
    // Lista vazia por falha de backend é indistinguível de "não achei" — avisa.
    if (error || !data || data.error) {
      setClientes([]);
      setErroBusca('Não consegui buscar os clientes agora. Verifique a conexão e tente de novo.');
      return;
    }
    setErroBusca('');
    setClientes(data.customers ?? []);
  }, [tenantId]);

  useEffect(() => {
    const t = setTimeout(() => { void buscar(q); }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, buscar]);

  // ── Cotação da taxa ──
  const cotar = useCallback(async (addr: Endereco | null) => {
    if (!addr) { setQuote(null); return; }
    setCotando(true);
    const { data } = await invokeWithAuth<Quote>('delivery-write', {
      body: {
        action: 'quote_delivery_fee',
        tenant_id: tenantId,
        lat: addr.lat, lng: addr.lng,
        neighborhood_id: addr.neighborhood_id,
      },
    });
    setCotando(false);
    if (!data) { setQuote(null); return; }
    setQuote(data);
    setTaxaManual(data.dentro_area ? String(data.fee.toFixed(2)) : '');
  }, [tenantId]);

  const selecionarEndereco = useCallback((addr: Endereco) => {
    setEndereco(addr);
    void cotar(addr);
  }, [cotar]);

  const selecionarCliente = useCallback((c: Cliente) => {
    setCliente(c);
    const padrao = c.addresses.find((a) => a.is_default) ?? c.addresses[0] ?? null;
    setEndereco(padrao);
    if (padrao) void cotar(padrao);
    else { setQuote(null); setTaxaManual(''); }
  }, [cotar]);

  // ── Cadastro ──
  const abrirNovoCliente = () => {
    setErro('');
    setModo('novo_cliente');
    setFNome(q.replace(/\d/g, '').trim());
    setFTelefone(formatTelefone(q));
    setFRua(''); setFNumero(''); setFBairroId(''); setFBairroTexto('');
    setFComplemento(''); setFReferencia(''); setFLat(null); setFLng(null); setPinConfirmado(false);
    setFRotulo('Casa');
  };

  const abrirNovoEndereco = () => {
    setErro('');
    setModo('novo_endereco');
    setFRua(''); setFNumero(''); setFBairroId(''); setFBairroTexto('');
    setFComplemento(''); setFReferencia(''); setFLat(null); setFLng(null); setPinConfirmado(false);
    setFRotulo('Casa');
  };

  const salvarCadastro = async () => {
    setErro('');
    const bairroNome = fBairroId ? (bairros.find((b) => b.id === fBairroId)?.name ?? '') : fBairroTexto.trim();

    if (modo === 'novo_cliente') {
      const tel = fTelefone.replace(/\D/g, '');
      const semNome = !fNome.trim();
      const semTel = tel.length < 10;
      setFaltando({ nome: semNome, telefone: semTel });
      if (semNome || semTel) {
        setErro(
          semNome && semTel ? 'Preencha o nome e o celular do cliente.'
            : semNome ? 'Preencha o nome do cliente.'
            : 'Preencha o celular com DDD.',
        );
        return;
      }
      setFaltando({});
      setSalvando(true);
      const { data, error } = await invokeWithAuth<{ customer?: { id: string; name: string; phone: string }; addresses?: Endereco[] }>(
        'delivery-write',
        {
          body: {
            action: 'save_customer', tenant_id: tenantId, phone: tel, name: fNome.trim(),
            label: fRotulo, neighborhood_id: fBairroId || null, street: fRua.trim() || null, number: fNumero.trim() || null,
            complement: fComplemento.trim() || null, reference_point: fReferencia.trim() || null,
            bairro: bairroNome || null,
            address_lat: pinConfirmado ? fLat : null, address_lng: pinConfirmado ? fLng : null,
          },
        },
      );
      setSalvando(false);
      if (error || !data?.customer) { setErro('Não foi possível salvar o cliente. Tente de novo.'); return; }
      const novo: Cliente = {
        id: data.customer.id, name: data.customer.name, phone: data.customer.phone,
        last_used_at: null,
        addresses: (data.addresses ?? []).map((a) => ({
          ...a,
          bairro: a.bairro ?? bairroNome ?? null,
          neighborhood_fee: a.neighborhood_id ? (bairros.find((b) => b.id === a.neighborhood_id)?.delivery_fee ?? 0) : 0,
        })),
      };
      setModo('lista');
      setClientes((prev) => [novo, ...prev.filter((c) => c.id !== novo.id)]);
      selecionarCliente(novo);
      return;
    }

    // novo endereço para um cliente já selecionado
    if (!cliente) return;
    if (!fRua.trim() && !fBairroId && !pinConfirmado) { setErro('Informe ao menos a rua ou o bairro.'); return; }
    setSalvando(true);
    const { data, error } = await invokeWithAuth<{ addresses?: Endereco[]; saved_address_id?: string | null }>('delivery-write', {
      body: {
        action: 'save_customer_address', tenant_id: tenantId, customer_id: cliente.id,
        label: fRotulo, neighborhood_id: fBairroId || null,
        street: fRua.trim() || null, number: fNumero.trim() || null,
        complement: fComplemento.trim() || null, reference_point: fReferencia.trim() || null,
        bairro: bairroNome || null,
            address_lat: pinConfirmado ? fLat : null, address_lng: pinConfirmado ? fLng : null,
      },
    });
    setSalvando(false);
    if (error || !data?.addresses) { setErro('Não foi possível salvar o endereço. Tente de novo.'); return; }
    const addrs: Endereco[] = data.addresses.map((a) => ({
      ...a,
      bairro: a.bairro ?? (a.neighborhood_id ? (bairros.find((b) => b.id === a.neighborhood_id)?.name ?? null) : null),
      neighborhood_fee: a.neighborhood_id ? (bairros.find((b) => b.id === a.neighborhood_id)?.delivery_fee ?? 0) : 0,
    }));
    const atualizado = { ...cliente, addresses: addrs };
    setCliente(atualizado);
    setClientes((prev) => prev.map((c) => (c.id === atualizado.id ? atualizado : c)));
    setModo('lista');
    // Seleciona pelo id que o backend acabou de gravar — procurar por rua+número
    // escolhia o endereço errado quando o cliente tem dois parecidos (mesma rua,
    // complementos diferentes).
    const novoAddr = addrs.find((a) => a.id && a.id === data.saved_address_id) ?? addrs[0];
    if (novoAddr) selecionarEndereco(novoAddr);
  };

  // ── Confirmação ──
  const taxaFinal = Number((taxaManual || '0').replace(',', '.')) || 0;
  // A taxa vem da cotacao do backend e nao se mexe. So vira campo editavel quando
  // nao existe cotacao possivel — endereco fora da area, ou sem pin e sem bairro.
  const taxaEditavel = !quote || quote.mode === 'manual' || !quote.dentro_area;
  const podeConfirmar = !!cliente && !!endereco && !cotando;

  const confirmar = () => {
    if (!cliente || !endereco) return;
    const troco = Number((trocoPara || '0').replace(',', '.')) || 0;
    onConfirm({
      tipo: 'delivery',
      nomeCliente: cliente.name,
      telefone: cliente.phone,
      enderecoEntrega: enderecoEmUmaLinha(endereco),
      taxaEntrega: taxaFinal,
      observacaoPedido: obs.trim() || undefined,
      formaPagamento: formaSel?.nome ?? undefined,
      trocoPara: pedeTroco && troco > 0 ? troco : undefined,
      clienteDeliveryId: cliente.id,
      enderecoId: endereco.id,
      bairroId: endereco.neighborhood_id,
      latEntrega: endereco.lat,
      lngEntrega: endereco.lng,
      distanciaKm: quote?.km ?? null,
      rotaMin: quote?.route_min ?? null,
      slaMin: quote?.tempo_max_min ?? null,
    });
  };

  // ── Formulário de endereço (compartilhado pelos dois cadastros) ──
  const formEndereco = (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-bold text-zinc-600 mb-1.5">Este endereço é</label>
        <div className="flex flex-wrap gap-2">
          {ROTULOS_ENDERECO.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setFRotulo(r)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                fRotulo === r
                  ? 'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="block text-xs font-bold text-zinc-600 mb-1.5">Rua</label>
          <input value={fRua} onChange={(e) => setFRua(e.target.value)} placeholder="Rua / Avenida"
            className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800" />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-600 mb-1.5">Número</label>
          <input value={fNumero} onChange={(e) => setFNumero(e.target.value)} placeholder="123"
            className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-zinc-600 mb-1.5">Bairro</label>
        {bairros.length > 0 && !distanceMode ? (
          <select value={fBairroId} onChange={(e) => setFBairroId(e.target.value)}
            className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800">
            <option value="">Selecione o bairro</option>
            {bairros.map((b) => (
              <option key={b.id} value={b.id}>{b.name} — {formatCurrency(b.delivery_fee)}</option>
            ))}
          </select>
        ) : (
          <input value={fBairroTexto} onChange={(e) => setFBairroTexto(e.target.value)} placeholder="Bairro"
            className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-bold text-zinc-600 mb-1.5">Complemento</label>
          <input value={fComplemento} onChange={(e) => setFComplemento(e.target.value)} placeholder="Apto, bloco..."
            className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800" />
        </div>
        <div>
          <label className="block text-xs font-bold text-zinc-600 mb-1.5">Referência</label>
          <input value={fReferencia} onChange={(e) => setFReferencia(e.target.value)} placeholder="Perto de..."
            className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-zinc-600 mb-1.5">
          Localização no mapa
          <span className="text-zinc-400 font-normal ml-1">
            {distanceMode ? '(a taxa de entrega vem daqui)' : '(opcional — ajuda o motoboy a achar)'}
          </span>
        </label>
        <p className="text-[11px] text-zinc-400 mb-1.5">
          Arraste o mapa até o pin ficar em cima da casa do cliente.
        </p>
        <MapaPin
          lat={fLat} lng={fLng}
          onChange={(la, ln, origem) => {
            setFLat(la); setFLng(ln);
            // So o botao "Confirmar esta localizacao" fecha o pin — arrastar apenas
            // move o ponto, senao o botao some antes do operador confirmar.
            if (origem === 'confirmacao') setPinConfirmado(true);
          }}
          defaultCenter={storeLoc ? [storeLoc.lat, storeLoc.lng] : undefined}
          altura="h-56"
          confirmed={pinConfirmado}
        />
        {distanceMode && !pinConfirmado && (
          <p className="text-[11px] text-amber-700 mt-1.5 flex items-center gap-1">
            <i className="ri-information-line" />
            Sem o pin não dá pra calcular a taxa automaticamente — você digita na mão.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-200">
          <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl">
            <i className="ri-e-bike-line text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-zinc-900 text-sm">Pedido para entrega</p>
            <p className="text-xs text-zinc-400">
              {modo === 'novo_cliente' ? 'Cadastrar cliente novo'
                : modo === 'novo_endereco' ? 'Novo endereço do cliente'
                : 'Selecione o cliente que vai receber'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {erro && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <i className="ri-error-warning-line" />
              <span>{erro}</span>
            </div>
          )}

          {modo === 'lista' && (
            <>
              {/* Busca */}
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nome, telefone ou endereço..."
                  className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800"
                />
              </div>

              {/* Cliente selecionado */}
              {cliente && (
                <div className="border-2 border-amber-400 bg-amber-50 rounded-xl p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-zinc-900 text-sm truncate">{cliente.name}</p>
                      <p className="text-xs text-zinc-500">{formatTelefone(cliente.phone)}</p>
                    </div>
                    <button onClick={() => { setCliente(null); setEndereco(null); setQuote(null); setTaxaManual(''); }}
                      className="text-xs font-semibold text-amber-700 hover:underline cursor-pointer">
                      Trocar
                    </button>
                  </div>

                  {/* Endereços */}
                  <div className="space-y-1.5">
                    {cliente.addresses.length === 0 && (
                      <p className="text-xs text-zinc-500">Este cliente ainda não tem endereço cadastrado.</p>
                    )}
                    {cliente.addresses.map((a, idx) => {
                      const ativo = chaveEndereco(endereco) === chaveEndereco(a);
                      return (
                        <button
                          key={chaveEndereco(a) || `addr-${idx}`}
                          onClick={() => selecionarEndereco(a)}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            ativo ? 'border-amber-500 bg-white' : 'border-zinc-200 bg-white/60 hover:border-zinc-300'
                          }`}
                        >
                          <span className="font-semibold text-zinc-700">{a.label || 'Endereço'}</span>
                          <span className="block text-zinc-500 truncate">{enderecoEmUmaLinha(a) || 'Sem endereço'}</span>
                        </button>
                      );
                    })}
                    <button onClick={abrirNovoEndereco} className="text-xs font-semibold text-amber-700 hover:underline cursor-pointer">
                      + Novo endereço
                    </button>
                  </div>

                  {/* Taxa */}
                  <div className="border-t border-amber-200 pt-3 space-y-2">
                    {cotando ? (
                      <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                        <i className="ri-loader-4-line animate-spin" /> Calculando a taxa de entrega...
                      </p>
                    ) : quote ? (
                      <p className="text-xs text-zinc-600">
                        {quote.mode === 'distancia' && quote.dentro_area && (
                          <>Entrega por distância{quote.km != null ? ` · ~${quote.km.toFixed(1)} km` : ''}{quote.tempo_max_min ? ` · ${quote.tempo_max_min} min` : ''}</>
                        )}
                        {quote.mode === 'distancia' && !quote.dentro_area && (
                          <span className="text-red-600 font-semibold">
                            <i className="ri-error-warning-line mr-1" />
                            Endereço fora da área de entrega{quote.km != null ? ` (~${quote.km.toFixed(1)} km)` : ''} — informe a taxa na mão.
                          </span>
                        )}
                        {quote.mode === 'bairro' && <>Taxa do bairro</>}
                        {quote.mode === 'manual' && (
                          <span className="text-amber-700">
                            {quote.needs_pin
                              ? 'Endereço sem localização no mapa — informe a taxa na mão (ou cadastre o pin).'
                              : 'Sem bairro cadastrado — informe a taxa na mão.'}
                          </span>
                        )}
                      </p>
                    ) : null}

                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold text-zinc-600">Taxa de entrega</label>
                      {taxaEditavel ? (
                        // Sem cotacao possivel (fora de area, sem pin e sem bairro) nao ha
                        // valor a impor — o operador digita. No caso normal a taxa e fixa.
                        <div className="relative flex-1 max-w-[140px]">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">R$</span>
                          <input
                            value={taxaManual}
                            onChange={(e) => setTaxaManual(e.target.value.replace(/[^\d.,]/g, ''))}
                            inputMode="decimal"
                            placeholder="0,00"
                            className="w-full text-sm font-bold bg-white border border-zinc-200 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-amber-400 text-zinc-900"
                          />
                        </div>
                      ) : (
                        <span className="text-sm font-bold text-zinc-900">{formatCurrency(taxaFinal)}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Lista de clientes */}
              {!cliente && (
                <div className="space-y-1.5">
                  {!q && <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Clientes recentes</p>}
                  {buscando && <p className="text-xs text-zinc-400 py-2">Buscando...</p>}
                  {!buscando && erroBusca && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
                      <i className="ri-error-warning-line" />{erroBusca}
                    </p>
                  )}
                  {!buscando && !erroBusca && clientes.length === 0 && (
                    <p className="text-xs text-zinc-400 py-2">Nenhum cliente encontrado.</p>
                  )}
                  {clientes.map((c) => {
                    const padrao = c.addresses.find((a) => a.is_default) ?? c.addresses[0] ?? null;
                    return (
                      <button
                        key={c.id}
                        onClick={() => selecionarCliente(c)}
                        className="w-full text-left px-3 py-2.5 rounded-xl border border-zinc-200 hover:border-amber-400 hover:bg-amber-50/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-zinc-900 truncate flex-1">{c.name}</span>
                          <span className="text-xs text-zinc-500 shrink-0">{formatTelefone(c.phone)}</span>
                        </div>
                        <span className="block text-xs text-zinc-400 truncate">
                          {enderecoEmUmaLinha(padrao) || 'Sem endereço cadastrado'}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    onClick={abrirNovoCliente}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-zinc-300 text-sm font-semibold text-zinc-600 hover:border-amber-400 hover:text-amber-700 cursor-pointer"
                  >
                    <i className="ri-user-add-line" /> Cadastrar cliente novo
                  </button>
                </div>
              )}

              {/* Forma de pagamento combinada com o cliente (cobrada na entrega) */}
              <div>
                <label className="block text-xs font-bold text-zinc-600 mb-1.5">
                  Forma de pagamento
                  <span className="text-zinc-400 font-normal ml-1">(na entrega)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {formasAtivas.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => { setFormaPagamento(f.id === formaPagamento ? '' : f.id); setTrocoPara(''); }}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                        formaPagamento === f.id
                          ? 'border-amber-400 bg-amber-50 text-amber-700'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300'
                      }`}
                    >
                      <i className={`${f.icone} text-sm`} />
                      {f.nome}
                    </button>
                  ))}
                </div>
                {pedeTroco && (
                  <div className="flex items-center gap-2 mt-2">
                    <label className="text-xs font-bold text-zinc-600">Troco para</label>
                    <div className="relative max-w-[140px]">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">R$</span>
                      <input
                        value={trocoPara}
                        onChange={(e) => setTrocoPara(e.target.value.replace(/[^\d.,]/g, ''))}
                        inputMode="decimal"
                        placeholder="0,00"
                        className="w-full text-sm bg-white border border-zinc-200 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-amber-400 text-zinc-900"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Observação do pedido */}
              <div>
                <label className="block text-xs font-bold text-zinc-600 mb-1.5">Observação do pedido</label>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Instruções de entrega, troco, ponto de referência..."
                  className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800 resize-none"
                />
              </div>
            </>
          )}

          {modo === 'novo_cliente' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-zinc-600 mb-1.5">Nome <span className="text-red-500">*</span></label>
                  <input autoFocus value={fNome} onChange={(e) => { setFNome(e.target.value); setFaltando((f) => ({ ...f, nome: false })); }} placeholder="Nome do cliente"
                    className={`w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none text-zinc-800 border ${faltando.nome ? 'bg-red-50 border-red-300 focus:border-red-400' : 'bg-zinc-50 border-zinc-200 focus:border-amber-400'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-600 mb-1.5">Celular <span className="text-red-500">*</span></label>
                  <input value={fTelefone} onChange={(e) => { setFTelefone(formatTelefone(e.target.value)); setFaltando((f) => ({ ...f, telefone: false })); }} inputMode="tel" placeholder="(41) 99999-9999"
                    className={`w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none text-zinc-800 border ${faltando.telefone ? 'bg-red-50 border-red-300 focus:border-red-400' : 'bg-zinc-50 border-zinc-200 focus:border-amber-400'}`} />
                </div>
              </div>
              {formEndereco}
            </div>
          )}

          {modo === 'novo_endereco' && formEndereco}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-zinc-200 bg-zinc-50">
          {modo === 'lista' ? (
            <>
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-600 hover:bg-white cursor-pointer">
                Cancelar
              </button>
              <button
                onClick={confirmar}
                disabled={!podeConfirmar}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {taxaFinal > 0 ? `Confirmar · entrega ${formatCurrency(taxaFinal)}` : 'Confirmar'}
              </button>
            </>
          ) : (
            <div className="flex-1">
              {erro && (
                <p className="text-xs text-red-600 mb-2 flex items-center gap-1.5">
                  <i className="ri-error-warning-line" />{erro}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => { setModo('lista'); setErro(''); setFaltando({}); }} className="flex-1 py-2.5 rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-600 hover:bg-white cursor-pointer">
                  Voltar
                </button>
                <button
                  onClick={() => void salvarCadastro()}
                  disabled={salvando}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50 cursor-pointer"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
