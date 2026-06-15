import { useState } from 'react';
import MapaPin from '@/components/feature/MapaPin';
import type { DeliveryQuote } from '../useDeliveryData';

interface Props {
  phone: string;
  nome: string;
  onNomeChange: (v: string) => void;
  rua: string;
  onRuaChange: (v: string) => void;
  numero: string;
  onNumeroChange: (v: string) => void;
  complemento: string;
  onComplementoChange: (v: string) => void;
  referencia: string;
  onReferenciaChange: (v: string) => void;
  storeLat: number | null;
  storeLng: number | null;
  addressLat: number | null;
  addressLng: number | null;
  onPinChange: (lat: number, lng: number) => void;
  deliveryQuote: DeliveryQuote | null;
  foraDeArea: boolean;
  isExistingCustomer: boolean;
  onSalvar: (nome: string, bairroId: string, rua: string, num: string, comp: string, ref: string) => void;
  onVoltar: () => void;
  enviando: boolean;
  error: string;
  city?: string;
}

export default function EnderecoPinDelivery(props: Props) {
  const {
    phone, nome, onNomeChange, rua, onRuaChange, numero, onNumeroChange,
    complemento, onComplementoChange, referencia, onReferenciaChange,
    storeLat, storeLng, addressLat, addressLng, onPinChange,
    deliveryQuote, foraDeArea, isExistingCustomer,
    onSalvar, onVoltar, enviando, error, city,
  } = props;

  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const temPin = addressLat != null && addressLng != null;
  const nomeOk = isExistingCustomer || nome.trim().length > 0;
  const ruaOk = rua.trim().length > 0;
  const numeroOk = numero.trim().length > 0;
  const podeAvancar = temPin && nomeOk && ruaOk && numeroOk && !foraDeArea;

  const defaultCenter: [number, number] | undefined =
    (storeLat != null && storeLng != null) ? [storeLat, storeLng] : undefined;

  function usarMinhaLocalizacao() {
    if (!('geolocation' in navigator)) {
      setGeoError('Seu navegador não suporta localização.');
      return;
    }
    setGeoError('');
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        setGeoLoading(false);
        onPinChange(pos.coords.latitude, pos.coords.longitude);
      },
      function (err) {
        setGeoLoading(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada. Toque no mapa para marcar manualmente.'
            : 'Não foi possível obter sua localização. Toque no mapa para marcar.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  function handleSalvar() {
    setShowErrors(true);
    if (!podeAvancar) return;
    onSalvar(nome.trim() || 'Cliente', '', rua, numero, complemento, referencia);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 px-4 pt-6 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onVoltar}
            className="w-9 h-9 flex items-center justify-center bg-white/20 rounded-xl text-white hover:bg-white/30 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-left-line" />
          </button>
          <div>
            <h1 className="text-white text-lg font-black leading-tight">Onde você está?</h1>
            <p className="text-white/80 text-xs">{city || 'Marque sua casa no mapa'}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-5">
        {/* Mapa + pin */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold text-zinc-600">
              Sua localização <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={usarMinhaLocalizacao}
              disabled={geoLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {geoLoading ? (
                <><i className="ri-loader-4-line animate-spin text-xs" />Localizando...</>
              ) : (
                <><i className="ri-focus-3-line text-xs" />Usar minha localização</>
              )}
            </button>
          </div>

          <MapaPin
            lat={addressLat}
            lng={addressLng}
            onChange={onPinChange}
            defaultCenter={defaultCenter}
            altura="h-64"
          />

          <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1">
            <i className="ri-information-line text-zinc-400 text-xs" />
            Toque no mapa (ou arraste o pino) para marcar exatamente onde fica sua casa.
          </p>

          {geoError ? (
            <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
              <i className="ri-error-warning-line text-xs" />
              {geoError}
            </p>
          ) : null}

          {showErrors && !temPin ? (
            <p className="text-[10px] text-red-500 mt-1 font-medium">Marque sua localização no mapa.</p>
          ) : null}
        </div>

        {/* Estimativa de taxa/tempo (ou fora de área) */}
        {temPin ? (
          deliveryQuote && deliveryQuote.dentroArea ? (
            <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl text-white">
                    <i className="ri-motorbike-line text-sm" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-800">Taxa de entrega estimada</p>
                    <p className="text-[10px] text-zinc-500">
                      ~{deliveryQuote.km.toFixed(1)} km
                      {deliveryQuote.tempoMax > 0 ? ' • até ' + deliveryQuote.tempoMax + ' min' : ''}
                    </p>
                  </div>
                </div>
                <span className="text-base font-black text-amber-600">
                  {deliveryQuote.taxa > 0 ? 'R$ ' + deliveryQuote.taxa.toFixed(2) : 'Grátis'}
                </span>
              </div>
              <p className="text-[10px] text-zinc-400 mt-2">
                Valor final confirmado pela rota no momento do pedido.
              </p>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 flex items-center justify-center bg-red-500 rounded-xl text-white shrink-0">
                <i className="ri-map-pin-off-line text-sm" />
              </div>
              <div>
                <p className="text-xs font-bold text-red-700">Fora da área de entrega</p>
                <p className="text-[11px] text-red-600 mt-0.5">
                  {deliveryQuote ? '~' + deliveryQuote.km.toFixed(1) + ' km — ' : ''}
                  Este endereço está além da distância máxima atendida por esta loja.
                </p>
              </div>
            </div>
          )
        ) : null}

        {/* Celular (somente leitura) */}
        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Celular</label>
          <input
            type="tel"
            value={phone}
            readOnly
            className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-600"
          />
        </div>

        {/* Nome (apenas novo cliente) */}
        {!isExistingCustomer ? (
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Seu nome <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={nome}
              onChange={function (e) { onNomeChange(e.target.value); }}
              placeholder="Ex: João Silva"
              className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                (showErrors && !nomeOk ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
              }
              maxLength={60}
            />
          </div>
        ) : null}

        {/* Endereço em texto (para o motoboy) */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Rua <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={rua}
              onChange={function (e) { onRuaChange(e.target.value); }}
              placeholder="Ex: Rua das Flores"
              className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                (showErrors && !ruaOk ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
              }
              maxLength={100}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Número <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={numero}
              onChange={function (e) { onNumeroChange(e.target.value); }}
              placeholder="123"
              className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                (showErrors && !numeroOk ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
              }
              maxLength={10}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Complemento</label>
          <input
            type="text"
            value={complemento}
            onChange={function (e) { onComplementoChange(e.target.value); }}
            placeholder="Ex: Apto 42, Bloco B"
            className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
            maxLength={60}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
            Ponto de referência
            <span className="text-zinc-400 font-normal"> — ajuda o motoboy a chegar</span>
          </label>
          <input
            type="text"
            value={referencia}
            onChange={function (e) { onReferenciaChange(e.target.value); }}
            placeholder="Ex: Casa azul, em frente ao mercado"
            className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
            maxLength={100}
          />
        </div>

        {error ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
            <i className="ri-error-warning-line text-red-500 text-sm" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        ) : null}

        <div className="pt-2 pb-8 space-y-2">
          <button
            type="button"
            onClick={handleSalvar}
            disabled={enviando || (showErrors && !podeAvancar)}
            className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:hover:from-amber-500 disabled:hover:to-orange-500 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
          >
            {enviando ? (
              <><i className="ri-loader-4-line animate-spin" />Salvando...</>
            ) : (
              <><i className="ri-arrow-right-line text-sm" />Salvar e ver cardápio</>
            )}
          </button>
          {showErrors && !podeAvancar && !enviando ? (
            <p className="text-center text-[11px] text-red-500 font-medium">
              {foraDeArea
                ? 'Endereço fora da área de entrega.'
                : 'Marque o local no mapa e preencha nome, rua e número.'}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onVoltar}
            className="w-full text-sm text-zinc-500 font-bold py-3 cursor-pointer hover:text-zinc-700 transition-colors bg-zinc-100 rounded-xl hover:bg-zinc-200"
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
