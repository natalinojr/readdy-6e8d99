// Estúdio de Criação — tipos e peças compartilhadas entre a página e as abas.
// Espelha o contrato da Edge Function `estudio` (ver PLANO-TRAFEGO-PAGO-AGENTES.md § 3.2).
import type { ReactNode } from 'react';

export type TomVoz = 'descontraido' | 'familiar' | 'premium' | 'jovem';

export interface Kit {
  nome_marca: string | null;
  cor_primaria: string;
  cor_secundaria: string;
  cor_fundo: string;
  cor_texto: string;
  fonte: string;
  tom_voz: TomVoz | null;
  usa_emoji: boolean;
  publico: string | null;
  diferenciais: string | null;
  bordoes: string | null;
  cta_padrao: string | null;
  mostrar_preco: boolean;
  estilo_foto: string | null;
  palavras_obrigatorias: string[];
  palavras_proibidas: string[];
  nunca_fazer: string | null;
  logo_path: string | null;
  preenchido_por_ia: boolean;
  updated_at: string | null;
}

export const KIT_VAZIO: Kit = {
  nome_marca: null,
  cor_primaria: '#f59e0b',
  cor_secundaria: '#18181b',
  cor_fundo: '#ffffff',
  cor_texto: '#18181b',
  fonte: 'Inter',
  tom_voz: null,
  usa_emoji: true,
  publico: null,
  diferenciais: null,
  bordoes: null,
  cta_padrao: null,
  mostrar_preco: true,
  estilo_foto: null,
  palavras_obrigatorias: [],
  palavras_proibidas: [],
  nunca_fazer: null,
  logo_path: null,
  preenchido_por_ia: false,
  updated_at: null,
};

export type Formato = 'feed_1x1' | 'feed_4x5' | 'story_9x16' | 'item_1x1';

export interface Template {
  id: string;
  nome: string;
  formato: Formato;
  largura: number;
  altura: number;
  descricao: string;
}

export interface LibItem {
  item_id: string;
  name: string;
  price: number;
  description: string | null;
  photo_url: string | null;
  is_featured: boolean;
  qty_30d: number;
  nota_qualidade: number | null;
  analise: { pontos_fortes?: string[]; problemas?: string[]; serve_para_anuncio?: boolean } | null;
}

export type CreativeStatus = 'rascunho' | 'aprovada' | 'reprovada';

export interface Creative {
  id: string;
  template: string;
  formato: string;
  largura: number;
  altura: number;
  menu_item_id: string | null;
  item_name: string | null;
  textos: Record<string, unknown>;
  status: CreativeStatus;
  origem: string;
  url: string;
  created_at: string;
  created_by_name: string | null;
}

export const STATUS_LABEL: Record<CreativeStatus, string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
};
export const STATUS_CLS: Record<CreativeStatus, string> = {
  rascunho: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  aprovada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  reprovada: 'bg-red-50 text-red-600 border-red-200',
};

export const FORMATO_LABEL: Record<string, string> = {
  feed_1x1: 'Feed 1:1',
  feed_4x5: 'Feed 4:5',
  story_9x16: 'Story 9:16',
  item_1x1: 'Item 1:1',
};

export function NotaBadge({ nota }: { nota: number | null }) {
  if (nota === null || nota === undefined) {
    return <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border bg-zinc-100 text-zinc-400 border-zinc-200">sem nota</span>;
  }
  const cls = nota >= 7
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : nota >= 5
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-600 border-red-200';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>nota {Math.round(nota)}</span>;
}

export function Secao({ titulo, icon: Icon, extra, children }: {
  titulo: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Icon size={15} className="text-fuchsia-500" />
        <p className="text-sm font-bold text-zinc-800">{titulo}</p>
        {extra && <div className="ml-auto">{extra}</div>}
      </div>
      {children}
    </div>
  );
}

export function EstadoVazio({ icon: Icon, titulo, texto, acao }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  titulo: string;
  texto: string;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-zinc-200 rounded-2xl">
      <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-fuchsia-50 border border-fuchsia-100 mb-4">
        <Icon size={26} className="text-fuchsia-400" />
      </div>
      <h3 className="text-base font-black text-zinc-800 mb-1.5">{titulo}</h3>
      <p className="text-sm text-zinc-500 max-w-md mb-4 leading-relaxed">{texto}</p>
      {acao}
    </div>
  );
}

/** Converte um File em base64 puro (sem o prefixo "data:...;base64,"). */
export function fileParaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export const chips = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);
