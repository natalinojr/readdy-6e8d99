import { useState, useRef, useEffect } from 'react';
import type { FocusEvent } from 'react';
import MapaPin from '@/components/feature/MapaPin';
import SeletorDataNascimento from '@/components/base/SeletorDataNascimento';
import { scrollFocusedFieldIntoView } from '@/lib/scrollFocusIntoView';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import type { DeliveryQuote, SavedAddress } from '../useDeliveryData';

interface Props {
  phone: string;
  nome: string;
  onNomeChange: (v: string) => void;
  nascimento: string;
  onNascimentoChange: (v: string) => void;
  genero: string;
  onGeneroChange: (v: string) => void;
  rua: string;
  onRuaChange: (v: string) => void;
  numero: string;
  onNumeroChange: (v: string) => void;
  bairro: string;
  onBairroChange: (v: string) => void;
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
  savedAddresses: SavedAddress[];
  selectedAddressId: string | null;
  onSalvar: (nome: string, bairroId: string, rua: string, num: string, comp: string, ref: string) => void;
  onSelecionarEndereco: (addressId: string) => void;
  onSalvarNovoEndereco: (label: string, bairroId: string, rua: string, num: string, comp: string, ref: string, editAddressId?: string | null, lat?: number | null, lng?: number | null) => Promise<void>;
  onDeletarEndereco: (addressId: string) => void;
  onSetDefaultAddress: (addressId: string) => void;
  onIrParaCardapio: () => void;
  onVoltar: () => void;
  enviando: boolean;
  error: string;
  city?: string;
}

type AddressType = { id: string; label: string; icon: string };

const ADDRESS_TYPES: AddressType[] = [
  { id: 'casa', label: 'Casa', icon: 'ri-home-4-line' },
  { id: 'trabalho', label: 'Trabalho', icon: 'ri-briefcase-line' },
  { id: 'escritorio', label: 'Escritório', icon: 'ri-building-line' },
  { id: 'faculdade', label: 'Faculdade', icon: 'ri-graduation-cap-line' },
  { id: 'pais', label: 'Casa dos pais', icon: 'ri-heart-line' },
  { id: 'outro', label: 'Outro', icon: 'ri-more-line' },
];

function getAddressTypeByLabel(label: string): AddressType {
  const normalized = (label || '').trim().toLowerCase();
  for (const t of ADDRESS_TYPES) {
    if (t.label.toLowerCase() === normalized && t.id !== 'outro') return t;
  }
  return ADDRESS_TYPES[ADDRESS_TYPES.length - 1];
}

type FormMode = 'list' | 'add' | 'edit';

export default function EnderecoPinDelivery(props: Props) {
  const {
    phone, nome, onNomeChange, nascimento, onNascimentoChange, genero, onGeneroChange,
    rua, onRuaChange, numero, onNumeroChange,
    bairro, onBairroChange,
    complemento, onComplementoChange, referencia, onReferenciaChange,
    storeLat, storeLng, addressLat, addressLng, onPinChange,
    deliveryQuote, foraDeArea, isExistingCustomer,
    savedAddresses, selectedAddressId,
    onSalvar, onSelecionarEndereco, onSalvarNovoEndereco, onDeletarEndereco, onSetDefaultAddress,
    onIrParaCardapio, onVoltar, enviando, error, city,
  } = props;

  const temListaSalva = isExistingCustomer && savedAddresses.length > 0;

  const [formMode, setFormMode] = useState<FormMode>(temListaSalva ? 'list' : 'add');
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [autoEndereco, setAutoEndereco] = useState(false);
  // Posição travada pelo cliente: só vira `true` quando ele toca "Salvar posição" no
  // mapa. O GPS marca o pin sozinho ao abrir, mas NÃO trava — assim a frase "Localização
  // marcada" não aparece antes de o cliente confirmar de propósito.
  const [posLocked, setPosLocked] = useState(false);
  const geoReqRef = useRef(0);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kbInset = useKeyboardInset();

  // Há um campo de texto focado? Usado só como FALLBACK quando o teclado não é
  // detectado pela visualViewport (WebView do Instagram/Facebook não encolhe a tela):
  // nesse caso adicionamos um respiro no rodapé pra os últimos campos conseguirem
  // subir acima do teclado ao rolar. Em navegadores normais o kbInset cuida disso.
  const [campoFocado, setCampoFocado] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleFormFocus(e: FocusEvent<HTMLElement>) {
    scrollFocusedFieldIntoView(e);
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      setCampoFocado(true);
    }
  }

  function handleFormBlur() {
    // Pequeno atraso: ao pular de um campo pro outro, o blur vem antes do próximo
    // focus — não removemos o respiro nesse intervalo pra não dar "pulo" na tela.
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(function () {
      const ae = document.activeElement;
      const t = ae ? ae.tagName : '';
      if (t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') setCampoFocado(false);
    }, 80);
  }

  // Respiro inferior: usa o teclado medido (kbInset) quando disponível; senão, quando
  // há campo focado, cai num valor fixo grande o bastante pra criar área de rolagem.
  const respiroInferior = kbInset ? kbInset + 24 : (campoFocado ? '50vh' : undefined);

  // Altura da área REALMENTE visível (acima do teclado). Em navegadores sem suporte
  // a `dvh` (ex.: WebView embutida do WhatsApp), fixamos a altura da tela à
  // `visualViewport` para o conteúdo rolar corretamente acima do teclado.
  const [viewportH, setViewportH] = useState<number | null>(null);
  useEffect(function () {
    const vv = window.visualViewport;
    if (!vv) return;
    function update() { setViewportH(vv!.height); }
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return function () {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Geocodificação reversa (coordenada → endereço) via Nominatim/OSM — preenche rua/número/bairro.
  // O pin/taxa atualiza na hora (onPinChange); a busca do endereço é DEBOUNCED, porque
  // com o pin seguindo o centro do mapa o onChange dispara a cada arraste e o Nominatim
  // público limita ~1 req/s.
  function aplicarPin(lat: number, lng: number) {
    onPinChange(lat, lng);
    setPosLocked(false); // mudou o ponto → precisa salvar a posição de novo
    setGeoError(''); // já tem um ponto — some o aviso de "localização desativada"
    const reqId = ++geoReqRef.current;
    setAutoEndereco(true);
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(function () {
      fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=' + lat + '&lon=' + lng)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (geoReqRef.current !== reqId) return; // o pino mudou de novo — ignora resposta antiga
          setAutoEndereco(false);
          const a = data && data.address ? data.address : null;
          if (!a) return;
          const road = a.road || a.pedestrian || a.residential || a.footway || a.path || a.cycleway || '';
          const num = String(a.house_number || '').replace(/\D/g, ''); // campo de número só aceita dígitos
          const bairroGeo = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || '';
          if (road) onRuaChange(road);
          if (num) onNumeroChange(num);
          if (bairroGeo) onBairroChange(bairroGeo);
        })
        .catch(function () { if (geoReqRef.current === reqId) setAutoEndereco(false); });
    }, 500);
  }

  // Estado do formulário (add/edit) — o "tipo" e o id em edição
  const [formAddressType, setFormAddressType] = useState('casa');
  const [formCustomLabel, setFormCustomLabel] = useState('');
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);

  const temPin = addressLat != null && addressLng != null;
  const posOk = temPin && posLocked; // ponto marcado E salvo (travado) pelo cliente
  const nomeOk = isExistingCustomer || nome.trim().length > 0;
  const ruaOk = rua.trim().length > 0;
  const numeroOk = numero.trim().length > 0;
  const podeAvancar = posOk && nomeOk && ruaOk && numeroOk && !foraDeArea;

  const defaultCenter: [number, number] | undefined =
    (storeLat != null && storeLng != null) ? [storeLat, storeLng] : undefined;

  function getEffectiveLabel(): string {
    if (formAddressType === 'outro') return formCustomLabel.trim();
    const t = ADDRESS_TYPES.find(function (x) { return x.id === formAddressType; });
    return t ? t.label : 'Casa';
  }

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
        aplicarPin(pos.coords.latitude, pos.coords.longitude);
      },
      function (err) {
        setGeoLoading(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Localização desativada. Arraste o mapa até a sua casa e toque em "Confirmar esta localização".'
            : 'Não conseguimos te localizar. Arraste o mapa até a sua casa e toque em "Confirmar esta localização".',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  // Ao ABRIR o formulário de adicionar endereço, tenta começar o pin na LOCALIZAÇÃO
  // ATUAL do usuário — MAS só se ainda não houver um pin (ex.: pin restaurado deste
  // aparelho). Sem isso, a tentativa automática falhava e deixava um aviso "fantasma"
  // mesmo já tendo um ponto. Se a pessoa negar a permissão, fica no padrão e ajusta
  // arrastando o mapa. (No modo 'edit' mantém o pin do endereço salvo.)
  useEffect(function () {
    if (formMode === 'add' && !temPin) usarMinhaLocalizacao();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formMode]);

  function abrirNovo() {
    setEditingAddressId(null);
    setFormAddressType('casa');
    setFormCustomLabel('');
    onRuaChange(''); onNumeroChange(''); onBairroChange(''); onComplementoChange(''); onReferenciaChange('');
    setShowErrors(false);
    setGeoError('');
    setPosLocked(false);
    setFormMode('add');
  }

  function abrirEdicao(addr: SavedAddress) {
    const t = getAddressTypeByLabel(addr.label);
    setEditingAddressId(addr.id);
    setFormAddressType(t.id);
    setFormCustomLabel(t.id === 'outro' ? (addr.label || '') : '');
    onRuaChange(addr.street || '');
    onNumeroChange(addr.number || '');
    onBairroChange(addr.bairro || '');
    onComplementoChange(addr.complement || '');
    onReferenciaChange(addr.reference_point || '');
    const temPosSalva = typeof addr.lat === 'number' && typeof addr.lng === 'number';
    if (temPosSalva) {
      onPinChange(addr.lat as number, addr.lng as number);
    }
    setShowErrors(false);
    setGeoError('');
    setPosLocked(temPosSalva); // endereço já tinha posição → entra travado (toca "Editar" pra mexer)
    setFormMode('edit');
  }

  function cancelarForm() {
    setShowErrors(false);
    if (temListaSalva) setFormMode('list');
    else onVoltar();
  }

  // Novo cliente (sem cadastro) — salva via save_customer e vai pro cardápio.
  // `podeAvancar` já exige o nome preenchido (nomeOk), então enviamos o que o cliente
  // digitou, sem nenhum nome assumido pelo sistema.
  function salvarNovoCliente() {
    setShowErrors(true);
    if (!podeAvancar) return;
    onSalvar(nome.trim(), '', rua, numero, complemento, referencia);
  }

  // Cliente existente — adiciona/edita endereço na lista
  async function salvarEndereco() {
    setShowErrors(true);
    const labelEfetivo = getEffectiveLabel();
    if (!posOk || !ruaOk || !numeroOk || foraDeArea || !labelEfetivo) return;
    try {
      await onSalvarNovoEndereco(labelEfetivo, '', rua, numero, complemento, referencia, editingAddressId, addressLat, addressLng);
      setFormMode('list');
      setShowErrors(false);
    } catch (_e) { /* erro tratado no hook */ }
  }

  function formatAddressLine(addr: SavedAddress): string {
    const parts: string[] = [];
    if (addr.street) parts.push(addr.street);
    if (addr.number) parts.push(addr.number);
    if (addr.complement) parts.push('(' + addr.complement + ')');
    return parts.join(', ') || 'Endereço incompleto';
  }

  // ── Render: bloco do mapa + estimativa (compartilhado add/edit/novo cliente) ──
  function renderMapaEEstimativa() {
    return (
      <>
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
            onChange={aplicarPin}
            defaultCenter={defaultCenter}
            altura="h-60"
            confirmed={temPin}
            locked={posLocked}
            onToggleLock={function (n) { setPosLocked(n); }}
          />
          {autoEndereco ? (
            <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1 font-medium">
              <i className="ri-loader-4-line animate-spin text-xs" />
              Buscando o endereço deste ponto...
            </p>
          ) : !temPin ? (
            <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1">
              <i className="ri-information-line text-zinc-400 text-xs" />
              Arraste o mapa até a sua casa e toque em <span className="font-semibold text-amber-600">Confirmar esta localização</span>.
            </p>
          ) : posLocked ? (
            <p className="text-[11px] text-green-600 mt-2 flex items-center gap-1 font-medium">
              <i className="ri-check-line text-xs" />
              Localização salva. Confira o endereço preenchido abaixo.
            </p>
          ) : (
            <p className="text-[11px] text-zinc-500 mt-2 flex items-center gap-1">
              <i className="ri-information-line text-zinc-400 text-xs" />
              Confira o endereço e toque em <span className="font-semibold text-green-600">Salvar posição</span> no mapa.
            </p>
          )}
          {geoError ? (
            <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
              <i className="ri-error-warning-line text-xs" />{geoError}
            </p>
          ) : null}
          {showErrors && !temPin ? (
            <p className="text-[10px] text-red-500 mt-1 font-medium">Marque sua localização no mapa.</p>
          ) : showErrors && !posLocked ? (
            <p className="text-[10px] text-red-500 mt-1 font-medium">Toque em "Salvar posição" no mapa.</p>
          ) : null}
        </div>

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
                      ~{deliveryQuote.km.toFixed(1)} km{deliveryQuote.tempoMax > 0 ? ' • até ' + deliveryQuote.tempoMax + ' min' : ''}
                    </p>
                  </div>
                </div>
                <span className="text-base font-black text-amber-600">
                  {deliveryQuote.taxa > 0 ? 'R$ ' + deliveryQuote.taxa.toFixed(2) : 'Grátis'}
                </span>
              </div>
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
                  Este endereço está além da distância máxima atendida.
                </p>
              </div>
            </div>
          )
        ) : null}
      </>
    );
  }

  // Dados pessoais (só novo cliente): nome, nascimento, gênero — ficam ANTES do mapa.
  function renderCamposPessoais() {
    return (
      <>
        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
            Seu nome <span className="text-red-500">*</span>
          </label>
          <input
            type="text" value={nome} onChange={function (e) { onNomeChange(e.target.value); }}
            placeholder="Ex: João Silva" maxLength={60}
            className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
              (showErrors && !nomeOk ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')}
          />
        </div>

        <div className="space-y-3">
          {/* Data ocupa a linha inteira — em meia largura o ano ficava cortado. */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nascimento</label>
            <SeletorDataNascimento value={nascimento} onChange={onNascimentoChange} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Gênero</label>
            <select
              value={genero} onChange={function (e) { onGeneroChange(e.target.value); }}
              className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-white"
            >
              <option value="">Prefiro não dizer</option>
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
            </select>
          </div>
        </div>
      </>
    );
  }

  // Endereço em texto: rua/número, bairro, complemento, referência — ficam LOGO ABAIXO do mapa.
  function renderCamposEndereco() {
    return (
      <>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Rua <span className="text-red-500">*</span></label>
            <input
              type="text" value={rua} onChange={function (e) { onRuaChange(e.target.value); }}
              placeholder="Ex: Rua das Flores" maxLength={100}
              className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                (showErrors && !ruaOk ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Número <span className="text-red-500">*</span></label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              value={numero} onChange={function (e) { onNumeroChange(e.target.value.replace(/\D/g, '')); }}
              placeholder="123" maxLength={10}
              className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                (showErrors && !numeroOk ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Bairro</label>
          <input
            type="text" value={bairro} onChange={function (e) { onBairroChange(e.target.value); }}
            placeholder="Ex: Centro" maxLength={60}
            className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Complemento</label>
          <input
            type="text" value={complemento} onChange={function (e) { onComplementoChange(e.target.value); }}
            placeholder="Ex: Apto 42, Bloco B" maxLength={60}
            className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
            Ponto de referência <span className="text-zinc-400 font-normal">— ajuda o motoboy</span>
          </label>
          <input
            type="text" value={referencia} onChange={function (e) { onReferenciaChange(e.target.value); }}
            placeholder="Ex: Casa azul, em frente ao mercado" maxLength={100}
            className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
          />
        </div>
      </>
    );
  }

  const headerTitulo = formMode === 'list' ? 'Seus endereços' : formMode === 'edit' ? 'Editar endereço' : 'Onde você está?';

  return (
    // Altura = viewport dinâmico (100dvh encolhe quando o teclado abre); h-screen é
    // fallback. O conteúdo rola internamente (min-h-0 + overflow-y-auto) para o campo
    // focado conseguir subir acima do teclado virtual.
    <div className="h-screen flex flex-col bg-white" style={{ height: viewportH ? `${viewportH}px` : '100dvh' }}>
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 px-4 pt-6 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={function () { if (formMode !== 'list' && temListaSalva) cancelarForm(); else onVoltar(); }}
            className="w-9 h-9 flex items-center justify-center bg-white/20 rounded-xl text-white hover:bg-white/30 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-left-line" />
          </button>
          <div>
            <h1 className="text-white text-lg font-black leading-tight">{headerTitulo}</h1>
            <p className="text-white/80 text-xs">{city || 'Marque sua casa no mapa'}</p>
          </div>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-5 max-w-lg mx-auto w-full space-y-5"
        onFocus={handleFormFocus}
        onBlur={handleFormBlur}
        style={{ paddingBottom: respiroInferior }}
      >
        {/* ── LISTA de endereços salvos (cliente existente) ── */}
        {formMode === 'list' && temListaSalva ? (
          <>
            <div className="space-y-3">
              {savedAddresses.map(function (addr) {
                const isSelected = addr.id === selectedAddressId;
                const showDel = deleteConfirmId === addr.id;
                const t = getAddressTypeByLabel(addr.label);
                const temPinAddr = typeof addr.lat === 'number' && typeof addr.lng === 'number';
                return (
                  <div key={addr.id}>
                    <div
                      onClick={function () { onSelecionarEndereco(addr.id); }}
                      className={'relative bg-white rounded-xl border-2 cursor-pointer transition-all p-4 ' +
                        (isSelected ? 'border-amber-400 bg-amber-50/50 ring-2 ring-amber-200/50' : 'border-zinc-100 hover:border-amber-200/60')}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ' +
                            (isSelected ? 'bg-amber-500 border-amber-500' : 'border-zinc-300')}>
                            {isSelected ? <i className="ri-check-line text-white text-[10px]" /> : null}
                          </div>
                          <div className="w-6 h-6 flex items-center justify-center bg-zinc-100 rounded-lg">
                            <i className={t.icon + ' text-zinc-500 text-xs'} />
                          </div>
                          <span className="text-sm font-bold text-zinc-800">{addr.label}</span>
                          {addr.is_default ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full">
                              <i className="ri-star-fill text-[9px]" />Principal
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={function (e) { e.stopPropagation(); onSetDefaultAddress(addr.id); }}
                              disabled={enviando}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 hover:bg-amber-100 text-zinc-400 hover:text-amber-600 text-[10px] font-bold rounded-full border border-zinc-200 cursor-pointer transition-all whitespace-nowrap"
                            >
                              <i className="ri-star-line text-[9px]" />Principal
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={function (e) { e.stopPropagation(); abrirEdicao(addr); }}
                            className="w-7 h-7 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
                          >
                            <i className="ri-pencil-line text-xs" />
                          </button>
                          {savedAddresses.length > 1 ? (
                            <button
                              type="button"
                              onClick={function (e) {
                                e.stopPropagation();
                                if (showDel) { onDeletarEndereco(addr.id); setDeleteConfirmId(null); }
                                else setDeleteConfirmId(addr.id);
                              }}
                              className={'w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-colors ' +
                                (showDel ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-zinc-100 hover:bg-red-100 text-zinc-400 hover:text-red-500')}
                            >
                              <i className={(showDel ? 'ri-check-line' : 'ri-delete-bin-line') + ' text-xs'} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="ml-7 space-y-1">
                        <p className="text-sm text-zinc-700">
                          <i className="ri-road-map-line text-zinc-400 text-xs mr-1.5" />{formatAddressLine(addr)}
                        </p>
                        <p className={'text-[11px] font-medium flex items-center gap-1 ' + (temPinAddr ? 'text-green-600' : 'text-amber-600')}>
                          <i className={(temPinAddr ? 'ri-map-pin-fill' : 'ri-error-warning-line') + ' text-[10px]'} />
                          {temPinAddr ? 'Localização no mapa salva' : 'Sem localização — toque em editar para marcar'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={abrirNovo}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 border-2 border-dashed border-amber-300 rounded-xl text-amber-600 hover:border-amber-400 hover:bg-amber-50/50 text-sm font-bold cursor-pointer transition-all whitespace-nowrap"
            >
              <i className="ri-add-line text-lg" />Adicionar novo endereço
            </button>

            {error ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                <i className="ri-error-warning-line text-red-500 text-sm" /><p className="text-xs text-red-600">{error}</p>
              </div>
            ) : null}

            <div className="pt-2 pb-8">
              <button
                type="button"
                onClick={onIrParaCardapio}
                disabled={!selectedAddressId || enviando || foraDeArea}
                className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
              >
                <i className="ri-arrow-right-line text-sm" />Usar este endereço e ver cardápio
              </button>
              {foraDeArea ? (
                <p className="text-center text-[11px] text-red-500 font-medium mt-2">O endereço selecionado está fora da área de entrega.</p>
              ) : null}
            </div>
          </>
        ) : (
          /* ── FORM (novo cliente / add / edit) ── */
          <>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Celular</label>
              <input type="tel" value={phone} readOnly className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-600" />
            </div>

            {/* Dados pessoais (novo cliente) — antes do mapa */}
            {!isExistingCustomer ? renderCamposPessoais() : null}

            {/* Tipo de endereço (só para clientes existentes na lista) */}
            {temListaSalva || formMode === 'edit' ? (
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-2">Tipo de endereço</label>
                <div className="grid grid-cols-3 gap-2">
                  {ADDRESS_TYPES.map(function (type) {
                    const sel = formAddressType === type.id;
                    return (
                      <button
                        key={type.id} type="button"
                        onClick={function () { setFormAddressType(type.id); }}
                        className={'flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all ' +
                          (sel ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200/50' : 'border-zinc-100 hover:border-amber-200/60 bg-white')}
                      >
                        <div className={'w-8 h-8 flex items-center justify-center rounded-lg ' + (sel ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-400')}>
                          <i className={type.icon + ' text-sm'} />
                        </div>
                        <span className={'text-[11px] font-bold whitespace-nowrap ' + (sel ? 'text-amber-700' : 'text-zinc-600')}>{type.label}</span>
                      </button>
                    );
                  })}
                </div>
                {formAddressType === 'outro' ? (
                  <input
                    type="text" value={formCustomLabel} onChange={function (e) { setFormCustomLabel(e.target.value); }}
                    placeholder="Digite um nome para este endereço" maxLength={40}
                    className="mt-2 w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
                  />
                ) : null}
              </div>
            ) : null}

            {/* Mapa + taxa estimada — entre os dados pessoais e o endereço */}
            {renderMapaEEstimativa()}

            {/* Endereço (rua, número, bairro, complemento, referência) — logo abaixo do mapa */}
            {renderCamposEndereco()}

            {error ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                <i className="ri-error-warning-line text-red-500 text-sm" /><p className="text-xs text-red-600">{error}</p>
              </div>
            ) : null}

            <div className="pt-2 pb-8 space-y-2">
              <button
                type="button"
                onClick={isExistingCustomer ? salvarEndereco : salvarNovoCliente}
                disabled={enviando || (showErrors && !podeAvancar)}
                className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <><i className="ri-loader-4-line animate-spin" />Salvando...</>
                ) : (
                  <><i className="ri-arrow-right-line text-sm" />{isExistingCustomer ? 'Salvar endereço' : 'Salvar e ver cardápio'}</>
                )}
              </button>
              {showErrors && !podeAvancar && !enviando ? (
                <p className="text-center text-[11px] text-red-500 font-medium">
                  {foraDeArea
                    ? 'Endereço fora da área de entrega.'
                    : !posOk
                    ? 'Marque o local no mapa e toque em "Salvar posição".'
                    : 'Preencha nome, rua e número.'}
                </p>
              ) : null}
              <button
                type="button"
                onClick={cancelarForm}
                className="w-full text-sm text-zinc-500 font-bold py-3 cursor-pointer hover:text-zinc-700 transition-colors bg-zinc-100 rounded-xl hover:bg-zinc-200"
              >
                {temListaSalva ? 'Cancelar' : 'Voltar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
