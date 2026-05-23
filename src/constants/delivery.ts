export type PlataformaDelivery =
  | 'ifood'
  | 'rappi'
  | 'uber_eats'
  | '99food'
  | 'whatsapp'
  | 'instagram'
  | 'telefone'
  | 'site'
  | 'presencial';

export const PLATAFORMAS_DELIVERY: {
  key: PlataformaDelivery;
  label: string;
  icon: string;
  cor: string;
  externo?: boolean;
}[] = [
  { key: 'ifood',      label: 'iFood',      icon: 'ri-store-2-line',   cor: 'bg-red-100 text-red-700',       externo: true },
  { key: 'rappi',      label: 'Rappi',      icon: 'ri-store-2-line',   cor: 'bg-orange-100 text-orange-700', externo: true },
  { key: 'uber_eats',  label: 'Uber Eats',  icon: 'ri-car-line',       cor: 'bg-zinc-800 text-white',        externo: true },
  { key: '99food',     label: '99Food',     icon: 'ri-store-2-line',   cor: 'bg-yellow-100 text-yellow-700', externo: true },
  { key: 'whatsapp',   label: 'WhatsApp',   icon: 'ri-whatsapp-line',  cor: 'bg-green-100 text-green-700' },
  { key: 'instagram',  label: 'Instagram',  icon: 'ri-instagram-line', cor: 'bg-pink-100 text-pink-700' },
  { key: 'telefone',   label: 'Telefone',   icon: 'ri-phone-line',     cor: 'bg-sky-100 text-sky-700' },
  { key: 'site',       label: 'Site/App',   icon: 'ri-global-line',    cor: 'bg-amber-100 text-amber-700' },
  { key: 'presencial', label: 'Presencial', icon: 'ri-walk-line',      cor: 'bg-zinc-100 text-zinc-700' },
];
