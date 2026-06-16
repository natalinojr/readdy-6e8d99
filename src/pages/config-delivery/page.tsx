import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getPublicUrl, getAppUrl } from '@/lib/appUrl';
import { supabase } from '@/lib/supabase';
import { Truck } from 'lucide-react';
import MapaPin from '@/components/feature/MapaPin';

interface Neighborhood {
  id: string;
  name: string;
  delivery_fee: number;
  is_active: boolean;
}

/** Faixa de entrega por distância (km) configurável pelo lojista. */
interface FaixaEntrega {
  ate_km: number;        // distância máxima da faixa (km)
  taxa: number;          // taxa de entrega (R$)
  tempo_max_min: number; // tempo máximo de entrega da faixa (min)
}

function getDeliveryWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/delivery-write';
}

export default function ConfigDeliveryPage() {
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId as string | undefined;

  const [city, setCity] = useState('');
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [newBairroNome, setNewBairroNome] = useState('');
  const [newBairroTaxa, setNewBairroTaxa] = useState('0');
  const [pedidoMinimoAtivo, setPedidoMinimoAtivo] = useState(false);
  const [pedidoMinimoValor, setPedidoMinimoValor] = useState('0');
  const [retiradaAtivo, setRetiradaAtivo] = useState(true);
  // ── Entrega por distância (loja + faixas) ──
  const [storeLat, setStoreLat] = useState<number | null>(null);
  const [storeLng, setStoreLng] = useState<number | null>(null);
  const [faixas, setFaixas] = useState<FaixaEntrega[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');

  const METODOS_PREDEFINIDOS = [
    { key: 'dinheiro', label: 'Dinheiro', icon: 'ri-money-dollar-circle-line' },
    { key: 'cartao_credito', label: 'Cartão de Crédito', icon: 'ri-bank-card-line' },
    { key: 'cartao_debito', label: 'Cartão de Débito', icon: 'ri-bank-card-2-line' },
    { key: 'pix', label: 'PIX', icon: 'ri-qr-code-line' },
    { key: 'vale_refeicao', label: 'Vale Refeição', icon: 'ri-coupon-line' },
  ];

  const [formasPagamento, setFormasPagamento] = useState<Record<string, boolean>>({});

  useEffect(function () {
    if (!tenantId) {
      setCarregando(false);
      setDeliveryUrl(getPublicUrl('/delivery'));
      return;
    }

    // Busca slug do tenant para montar o link correto
    const url = getDeliveryWriteUrl();

    // Busca config do delivery + slug do tenant em paralelo
    Promise.all([
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_delivery_config', tenant_id: tenantId }),
      }).then(function (res) { return res.json(); }),
      supabase
        .from('tenants')
        .select('slug')
        .eq('id', tenantId)
        .maybeSingle(),
    ])
      .then(function (results) {
        const data = results[0];
        const slugRes = results[1];

        if (slugRes.data?.slug && !slugRes.error) {
          setTenantSlug(slugRes.data.slug);
          setDeliveryUrl(getPublicUrl('/' + slugRes.data.slug + '-delivery'));
        } else {
          setDeliveryUrl(getPublicUrl('/delivery'));
        }

        if (!data.error) {
          setCity(data.city || '');
          setNeighborhoods(data.neighborhoods || []);
          const dc = data.delivery_config || {};
          setPedidoMinimoAtivo(dc.pedido_minimo_ativo === true);
          setPedidoMinimoValor(dc.pedido_minimo_valor ? String(dc.pedido_minimo_valor) : '0');
          setRetiradaAtivo(dc.retirada_ativo !== false); // default true
          const fp = dc.formas_pagamento;
          if (fp && typeof fp === 'object') {
            setFormasPagamento(fp as Record<string, boolean>);
          }
          // Localização da loja + faixas de distância
          const sl = dc.store_location;
          if (sl && typeof sl === 'object' && typeof sl.lat === 'number' && typeof sl.lng === 'number') {
            setStoreLat(sl.lat);
            setStoreLng(sl.lng);
          }
          const tiers = dc.delivery_fee_tiers;
          if (Array.isArray(tiers)) {
            setFaixas(tiers.map(function (t: any) {
              return {
                ate_km: Number(t.ate_km) || 0,
                taxa: Number(t.taxa) || 0,
                tempo_max_min: Number(t.tempo_max_min) || 0,
              };
            }));
          }
        }
      })
      .catch(function () {})
      .finally(function () {
        setCarregando(false);
      });
  }, [tenantId]);

  function handleAddBairro() {
    const nome = newBairroNome.trim();
    if (!nome) return;
    const taxa = parseFloat(newBairroTaxa.replace(',', '.')) || 0;

    const jaExiste = neighborhoods.some(function (nb) {
      return nb.name.toLowerCase() === nome.toLowerCase();
    });
    if (jaExiste) {
      setMensagem({ tipo: 'erro', texto: 'Este bairro já está na lista.' });
      return;
    }

    setNeighborhoods(function (prev) {
      return prev.concat([{
        id: 'temp-' + Date.now(),
        name: nome,
        delivery_fee: taxa,
        is_active: true,
      }]);
    });
    setNewBairroNome('');
    setNewBairroTaxa('0');
  }

  function handleRemoveBairro(id: string) {
    setNeighborhoods(function (prev) { return prev.filter(function (nb) { return nb.id !== id; }); });
  }

  function handleToggleBairro(id: string) {
    setNeighborhoods(function (prev) {
      return prev.map(function (nb) {
        if (nb.id === id) return { ...nb, is_active: !nb.is_active };
        return nb;
      });
    });
  }

  function handleUpdateTaxa(id: string, taxa: number) {
    setNeighborhoods(function (prev) {
      return prev.map(function (nb) {
        if (nb.id === id) return { ...nb, delivery_fee: Math.max(0, taxa) };
        return nb;
      });
    });
  }

  async function handleSave() {
    if (!tenantId) return;

    setSalvando(true);
    setMensagem(null);

    // Monta o delivery_config (JSON em system_settings) mesclando os campos
    // existentes + os novos (localização da loja e faixas de distância).
    const deliveryConfig = {
      pedido_minimo_ativo: pedidoMinimoAtivo,
      pedido_minimo_valor: pedidoMinimoAtivo ? parseFloat(pedidoMinimoValor.replace(',', '.')) || 0 : 0,
      retirada_ativo: retiradaAtivo,
      formas_pagamento: formasPagamento,
      store_location: (storeLat != null && storeLng != null) ? { lat: storeLat, lng: storeLng } : null,
      delivery_fee_tiers: faixas
        .filter(function (f) { return f.ate_km > 0; })
        .sort(function (a, b) { return a.ate_km - b.ate_km; }),
    };

    // Salva via Edge Function (service role + valida que o usuário é admin DESTA loja).
    // Necessário porque o RLS direto usa auth_tenant_id() = última membership criada,
    // o que faz o save falhar silenciosamente para donos com mais de uma loja.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSalvando(false);
      setMensagem({ tipo: 'erro', texto: 'Sessão expirada. Entre novamente para salvar.' });
      return;
    }

    try {
      const res = await fetch(getDeliveryWriteUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          action: 'save_delivery_settings',
          tenant_id: tenantId,
          delivery_city: city.trim(),
          delivery_config: deliveryConfig,
        }),
      });
      const data = await res.json();
      setSalvando(false);
      if (data.error) {
        setMensagem({ tipo: 'erro', texto: 'Erro ao salvar: ' + (data.message || data.error) });
      } else {
        setMensagem({ tipo: 'sucesso', texto: 'Configurações de delivery salvas com sucesso!' });
      }
    } catch (_e) {
      setSalvando(false);
      setMensagem({ tipo: 'erro', texto: 'Erro de conexão ao salvar.' });
    }
  }

  // ── Funções das faixas de entrega por distância ──
  function handleAddFaixa() {
    setFaixas(function (prev) {
      const ultimoKm = prev.length > 0 ? prev[prev.length - 1].ate_km : 0;
      return prev.concat([{ ate_km: ultimoKm + 2, taxa: 0, tempo_max_min: 40 }]);
    });
  }
  function handleRemoveFaixa(idx: number) {
    setFaixas(function (prev) { return prev.filter(function (_, i) { return i !== idx; }); });
  }
  function handleUpdateFaixa(idx: number, campo: keyof FaixaEntrega, valor: number) {
    setFaixas(function (prev) {
      return prev.map(function (f, i) {
        if (i === idx) return { ...f, [campo]: Math.max(0, valor) };
        return f;
      });
    });
  }

  if (carregando && tenantId) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 bg-white border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg">
              <Truck size={16} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Delivery</h1>
              <p className="text-xs text-zinc-400">Gerencie bairros, taxas e link público de delivery</p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center py-12 flex-1">
          <i className="ri-loader-4-line animate-spin text-zinc-400 text-lg" />
          <span className="ml-2 text-sm text-zinc-500">Carregando...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-zinc-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg">
            <Truck size={16} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-base font-bold text-zinc-900">Delivery</h1>
            <p className="text-xs text-zinc-400">Gerencie bairros, taxas e link público de delivery</p>
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          {/* Mensagem */}
          {mensagem ? (
            <div className={'px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ' +
              (mensagem.tipo === 'sucesso' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100')
            }>
              <i className={mensagem.tipo === 'sucesso' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
              {mensagem.texto}
            </div>
          ) : null}

{/* Link do delivery */}
          <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 flex items-center justify-center bg-amber-500 rounded-lg">
                <i className="ri-links-line text-white text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Link do Delivery</h3>
                <p className="text-xs text-zinc-500">
                  Compartilhe este link com seus clientes
                  {tenantSlug ? <span className="text-amber-600 font-semibold"> — Loja: {tenantSlug}</span> : null}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white rounded-xl border border-amber-200 px-4 py-3">
              <span className="text-sm text-zinc-700 flex-1 truncate font-mono">{deliveryUrl}</span>
              <button
                type="button"
                onClick={function () {
                  navigator.clipboard.writeText(deliveryUrl).then(function () {
                    setMensagem({ tipo: 'sucesso', texto: 'Link copiado!' });
                    setTimeout(function () { setMensagem(null); }, 2000);
                  });
                }}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors flex items-center gap-1"
              >
                <i className="ri-file-copy-line" />
                Copiar
              </button>
            </div>
          </div>

          {/* Cidade */}
          <div className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
                <i className="ri-building-line text-zinc-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Cidade de entrega</h3>
                <p className="text-xs text-zinc-500">Nome da cidade onde o delivery atua</p>
              </div>
            </div>
            <input
              type="text"
              value={city}
              onChange={function (e) { setCity(e.target.value); }}
              placeholder="Ex: São Paulo"
              className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              maxLength={50}
            />
          </div>

          {/* Localização da loja (origem do cálculo de distância) */}
          <div className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
                <i className="ri-map-pin-2-line text-zinc-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Localização da loja</h3>
                <p className="text-xs text-zinc-500">Clique ou arraste o pino até o ponto exato da loja — é a origem das rotas de entrega</p>
              </div>
            </div>
            <MapaPin
              lat={storeLat}
              lng={storeLng}
              onChange={function (lat, lng) { setStoreLat(lat); setStoreLng(lng); }}
              altura="h-72"
            />
            {storeLat != null && storeLng != null ? (
              <p className="text-[11px] text-zinc-500">
                <i className="ri-checkbox-circle-line text-emerald-500 mr-1" />
                Loja marcada em {storeLat.toFixed(5)}, {storeLng.toFixed(5)}
              </p>
            ) : (
              <p className="text-[11px] text-amber-600">
                <i className="ri-error-warning-line mr-1" />
                Marque a loja no mapa para habilitar o cálculo por distância.
              </p>
            )}
          </div>

          {/* Faixas de entrega por distância */}
          <div className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
                <i className="ri-route-line text-zinc-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Entrega por distância</h3>
                <p className="text-xs text-zinc-500">Faixas por km: taxa e tempo máximo. Pedidos além da última faixa são bloqueados.</p>
              </div>
            </div>

            {faixas.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Até (km)</span>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Taxa (R$)</span>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Tempo máx (min)</span>
                  <span />
                </div>
                {faixas.map(function (f, idx) {
                  return (
                    <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <input
                        type="number" min={0} step={0.5} value={f.ate_km}
                        onChange={function (e) { handleUpdateFaixa(idx, 'ate_km', parseFloat(e.target.value) || 0); }}
                        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <input
                        type="number" min={0} step={0.5} value={f.taxa}
                        onChange={function (e) { handleUpdateFaixa(idx, 'taxa', parseFloat(e.target.value) || 0); }}
                        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <input
                        type="number" min={0} step={5} value={f.tempo_max_min}
                        onChange={function (e) { handleUpdateFaixa(idx, 'tempo_max_min', parseInt(e.target.value) || 0); }}
                        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <button
                        onClick={function () { handleRemoveFaixa(idx); }}
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
                        title="Remover faixa"
                      >
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={handleAddFaixa}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border-2 border-dashed border-amber-300 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-add-line" /> Adicionar faixa
            </button>
            <p className="text-[11px] text-zinc-400">
              Ex.: até 2 km → R$ 5,00 / 30 min · até 5 km → R$ 9,00 / 45 min. As faixas são ordenadas por km ao salvar.
            </p>
          </div>

          {/* Pedido Mínimo */}
          <div className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
                <i className="ri-shopping-cart-2-line text-zinc-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Pedido mínimo</h3>
                <p className="text-xs text-zinc-500">Defina um valor mínimo para aceitar pedidos no delivery</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Toggle */}
              <button
                type="button"
                onClick={function () { setPedidoMinimoAtivo(function (v) { return !v; }); }}
                className={'relative w-12 h-7 rounded-full transition-colors cursor-pointer flex-shrink-0 ' +
                  (pedidoMinimoAtivo ? 'bg-amber-500' : 'bg-zinc-200')
                }
              >
                <div className={'absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform shadow ' +
                  (pedidoMinimoAtivo ? 'translate-x-[22px]' : 'translate-x-0.5')
                } />
              </button>
              <span className={'text-sm font-semibold ' + (pedidoMinimoAtivo ? 'text-zinc-800' : 'text-zinc-400')}>
                {pedidoMinimoAtivo ? 'Ativado' : 'Desativado'}
              </span>
            </div>

            {pedidoMinimoAtivo ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-500">Valor mínimo:</span>
                <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                  <span className="text-sm font-semibold text-zinc-500">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pedidoMinimoValor}
                    onChange={function (e) {
                      const v = e.target.value.replace(/[^0-9,.]/g, '');
                      setPedidoMinimoValor(v);
                    }}
                    onBlur={function () {
                      const num = parseFloat(pedidoMinimoValor.replace(',', '.')) || 0;
                      setPedidoMinimoValor(num > 0 ? num.toFixed(2).replace('.', ',') : '0');
                    }}
                    placeholder="0,00"
                    className="w-20 text-center text-sm font-bold text-zinc-800 bg-transparent border-none outline-none"
                  />
                </div>
                <span className="text-xs text-zinc-400">
                  {pedidoMinimoValor && parseFloat(pedidoMinimoValor.replace(',', '.')) > 0
                    ? 'O carrinho precisa atingir este valor (sem contar a taxa de entrega)'
                    : 'Defina um valor acima de R$ 0,00'
                  }
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 rounded-lg border border-zinc-100">
                <i className="ri-information-line text-zinc-400 text-sm" />
                <span className="text-xs text-zinc-400">Nenhum valor mínimo — qualquer pedido será aceito</span>
              </div>
            )}
          </div>

          {/* Retirada na loja */}
          <div className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
                <i className="ri-store-2-line text-zinc-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Retirada na loja</h3>
                <p className="text-xs text-zinc-500">Permite que o cliente escolha retirar o pedido na loja ao invés de receber em casa</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={function () { setRetiradaAtivo(function (v) { return !v; }); }}
                className={'relative w-12 h-7 rounded-full transition-colors cursor-pointer flex-shrink-0 ' +
                  (retiradaAtivo ? 'bg-green-500' : 'bg-zinc-200')
                }
              >
                <div className={'absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform shadow ' +
                  (retiradaAtivo ? 'translate-x-[22px]' : 'translate-x-0.5')
                } />
              </button>
              <span className={'text-sm font-semibold ' + (retiradaAtivo ? 'text-green-700' : 'text-zinc-400')}>
                {retiradaAtivo ? 'Ativado' : 'Desativado'}
              </span>
            </div>

            {retiradaAtivo ? (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-green-50 rounded-lg border border-green-100">
                <i className="ri-information-line text-green-500 text-sm mt-0.5" />
                <div>
                  <span className="text-xs text-green-700 font-semibold">Cliente pode escolher retirada</span>
                  <p className="text-[10px] text-green-600 mt-0.5">
                    Ao selecionar "Retirada na loja", o cliente não informa endereço e não paga taxa de entrega. A cozinha prepara e aguarda a retirada.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 rounded-lg border border-zinc-100">
                <i className="ri-information-line text-zinc-400 text-sm" />
                <span className="text-xs text-zinc-400">Apenas a opção de delivery (entrega) ficará disponível para o cliente</span>
              </div>
            )}
          </div>

          {/* Formas de Pagamento no Delivery */}
          <div className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
                <i className="ri-wallet-3-line text-zinc-600 text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-800">Formas de pagamento no delivery</h3>
                <p className="text-xs text-zinc-500">Escolha como quer receber — o cliente escolhe antes de fechar o pedido</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {METODOS_PREDEFINIDOS.map(function (metodo) {
                const ativo = formasPagamento[metodo.key] === true;
                const temAlgumAtivo = Object.values(formasPagamento).some(function (v) { return v === true; });

                function toggle() {
                  // Se for o último ativo e está tentando desativar, impede
                  if (ativo && temAlgumAtivo) {
                    const outrosAtivos = Object.entries(formasPagamento).filter(function (entry) {
                      return entry[0] !== metodo.key && entry[1] === true;
                    });
                    if (outrosAtivos.length === 0) return; // não deixa desativar todos
                  }
                  setFormasPagamento(function (prev) {
                    const next = { ...prev };
                    next[metodo.key] = !ativo;
                    return next;
                  });
                }

                return (
                  <button
                    key={metodo.key}
                    type="button"
                    onClick={toggle}
                    className={'flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all duration-200 ' +
                      (ativo
                        ? 'bg-amber-50 border-amber-200 text-zinc-800'
                        : 'bg-zinc-50 border-zinc-100 text-zinc-400 hover:border-zinc-200 hover:text-zinc-600')
                    }
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0">
                      <i className={metodo.icon + ' text-lg ' + (ativo ? 'text-amber-600' : 'text-zinc-300')} />
                    </div>
                    <span className={'text-sm font-semibold flex-1 text-left ' + (ativo ? 'text-zinc-800' : 'text-zinc-400')}>
                      {metodo.label}
                    </span>
                    <div className={'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ' +
                      (ativo ? 'bg-amber-500 border-amber-500' : 'border-zinc-200')
                    }>
                      {ativo ? <i className="ri-check-line text-white text-[10px]" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>

            {!Object.values(formasPagamento).some(function (v) { return v === true; }) ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 rounded-lg border border-zinc-100">
                <i className="ri-information-line text-zinc-400 text-sm" />
                <span className="text-xs text-zinc-400">Selecione ao menos uma forma de pagamento</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-lg border border-amber-100">
                <i className="ri-information-line text-amber-500 text-sm" />
                <span className="text-xs text-amber-700">
                  O cliente verá estas opções antes de finalizar o pedido. O motoboy saberá como se preparar!
                </span>
              </div>
            )}
          </div>

          {/* Bairros removidos da config — agora o bairro é texto livre que o cliente digita
              no app de delivery (a taxa vem da distância/pin). */}

          {/* Botão salvar */}
          <div className="pb-8">
            <button
              type="button"
              onClick={handleSave}
              disabled={salvando}
              className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:hover:from-amber-500 disabled:hover:to-orange-500 text-white font-bold py-3 rounded-xl cursor-pointer transition-all whitespace-nowrap text-sm flex items-center justify-center gap-2"
            >
              {salvando ? (
                <>
                  <i className="ri-loader-4-line animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <i className="ri-save-line" />
                  Salvar configurações
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}