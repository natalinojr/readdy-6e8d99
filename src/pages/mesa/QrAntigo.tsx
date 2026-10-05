import AvisoPublico from '@/components/base/AvisoPublico';

// Rota /mesa/:mesaId aposentada (2026-10-05): o QR atual das mesas é /mesa-qr/<token>. A página antiga
// (./page.tsx) continua no repositório, mas não é mais aberta por nenhuma rota.
export default function QrAntigo() {
  return (
    <AvisoPublico icone="ri-qr-code-line" titulo="Este QR Code é antigo">
      Peça ao garçom o QR novo da mesa.
    </AvisoPublico>
  );
}
