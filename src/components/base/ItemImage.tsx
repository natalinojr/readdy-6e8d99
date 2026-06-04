import { useMemo } from 'react';

// Paleta de gradientes por inicial do nome (mesma do PDV Caixa)
const GRADIENTS = [
  'from-orange-400 to-rose-500',
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-teal-500',
  'from-violet-400 to-purple-500',
  'from-sky-400 to-blue-500',
  'from-pink-400 to-rose-500',
  'from-lime-400 to-green-500',
  'from-red-400 to-orange-500',
  'from-cyan-400 to-sky-500',
  'from-fuchsia-400 to-pink-500',
];

function getGradient(nome: string): string {
  const code = nome.charCodeAt(0) || 0;
  return GRADIENTS[code % GRADIENTS.length];
}

function getInitials(nome: string): string {
  const words = nome.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface NoPhotoPlaceholderProps {
  nome: string;
  esgotado?: boolean;
  className?: string;
}

export function NoPhotoPlaceholder({ nome, esgotado, className = '' }: NoPhotoPlaceholderProps) {
  const gradient = getGradient(nome);
  const initials = getInitials(nome);
  
  return (
    <div 
      className={`w-full h-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center relative overflow-hidden ${esgotado ? 'grayscale' : ''} ${className}`}
    >
      {/* Círculos decorativos de fundo */}
      <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
      <div className="absolute -top-3 -left-3 w-14 h-14 bg-white/10 rounded-full" />
      {/* Iniciais */}
      <span className="text-white font-black text-2xl tracking-tight drop-shadow z-10 select-none">
        {initials}
      </span>
      {/* Ícone de prato pequeno embaixo */}
      <div className="w-4 h-4 flex items-center justify-center mt-1 z-10">
        <i className="ri-restaurant-line text-white/60 text-xs" />
      </div>
    </div>
  );
}

interface ItemImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  imgClassName?: string;
  esgotado?: boolean;
  placeholderClassName?: string;
}

export default function ItemImage({ 
  src, 
  alt, 
  className = '', 
  imgClassName = '',
  esgotado = false,
  placeholderClassName = ''
}: ItemImageProps) {
  const hasImage = useMemo(() => !!src && src.trim() !== '', [src]);

  if (!hasImage) {
    return (
      <div className={`overflow-hidden ${className}`}>
        <NoPhotoPlaceholder nome={alt} esgotado={esgotado} className={placeholderClassName} />
      </div>
    );
  }

  return (
    <div className={`overflow-hidden ${className}`}>
      <img
        src={src!}
        alt={alt}
        className={`w-full h-full ${esgotado ? 'grayscale' : ''} ${imgClassName || 'object-cover object-top'}`}
      />
    </div>
  );
}