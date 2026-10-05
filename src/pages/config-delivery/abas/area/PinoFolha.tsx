import { useState } from 'react';
import MapaPin from '@/components/feature/MapaPin';
import { btn, Folha, Nota } from '../../ui';

interface Ponto { lat: number; lng: number }

function Aberta({ lat, lng, onUsar, onFechar }: {
  lat: number | null; lng: number | null; onUsar: (lat: number, lng: number) => void; onFechar: () => void;
}) {
  const jaTem = lat != null && lng != null;
  const [ponto, setPonto] = useState<Ponto | null>(jaTem ? { lat: lat as number, lng: lng as number } : null);
  // Sem pino ainda: o ponto só vale depois de "Confirmar esta localização" (o pino fica cinza até lá).
  const [confirmado, setConfirmado] = useState(jaTem);
  const pronto = ponto != null && confirmado;

  return (
    <Folha
      aberta
      titulo="Onde fica a loja"
      subtitulo="Arraste o mapa até o pino ficar na porta da loja"
      onFechar={onFechar}
      rodape={(
        <>
          <button type="button" className={`${btn('out')} flex-1`} onClick={onFechar}>Cancelar</button>
          <button type="button" className={`${btn('p')} flex-1`} disabled={!pronto}
            onClick={() => { if (ponto) onUsar(Math.round(ponto.lat * 1e6) / 1e6, Math.round(ponto.lng * 1e6) / 1e6); }}>
            Usar este ponto
          </button>
        </>
      )}
    >
      <div className="space-y-3 pb-1">
        <MapaPin
          lat={ponto?.lat ?? null}
          lng={ponto?.lng ?? null}
          altura="h-72"
          confirmed={confirmado}
          onChange={(la, ln, origem) => {
            setPonto({ lat: la, lng: ln });
            if (origem === 'confirmacao') setConfirmado(true);
          }}
        />
        <Nota>
          É o ponto de onde sai o caminho de cada entrega. Mudar o pino muda a taxa e o prazo dos próximos pedidos;
          os que já foram feitos não mudam.
        </Nota>
      </div>
    </Folha>
  );
}

/** Folha com o mapa para mover o pino da loja. Só monta aberta, para o mapa já nascer no ponto certo. */
export default function PinoFolha({ aberta, lat, lng, onUsar, onFechar }: {
  aberta: boolean; lat: number | null; lng: number | null; onUsar: (lat: number, lng: number) => void; onFechar: () => void;
}) {
  if (!aberta) return null;
  return <Aberta lat={lat} lng={lng} onUsar={onUsar} onFechar={onFechar} />;
}
