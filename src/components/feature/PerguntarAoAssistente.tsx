// Botão "perguntar ao assistente" para colocar em linhas de tabela, cards e cabeçalhos
// (2026-09-16). Abre o chat já sabendo de que registro se trata — o dono não precisa digitar
// "a conta da Ambev de 2.800": o item vai junto como contexto (ver src/lib/assistenteFoco.ts).
//
// Só aparece para o dono, igual ao próprio chat. Para todo mundo não renderiza nada.
import { useAuth } from '@/contexts/AuthContext';
import { ASSISTENTE_OWNER_EMAIL } from '@/components/feature/AssistenteChat';
import { perguntarAoAssistente, type FocoAssistente } from '@/lib/assistenteFoco';

interface Props {
  /** O registro em questão. Título é uma linha em português que já se explica. */
  foco: FocoAssistente;
  /** Sugestão que aparece escrita no campo — o dono edita e envia. */
  texto?: string;
  /** Texto do botão. Sem isso vira só o ícone (linha de tabela). */
  label?: string;
  title?: string;
  className?: string;
}

export default function PerguntarAoAssistente({ foco, texto, label, title, className }: Props) {
  const { user } = useAuth();
  if (user?.email?.toLowerCase() !== ASSISTENTE_OWNER_EMAIL) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); perguntarAoAssistente(foco, texto); }}
      title={title ?? `Perguntar ao assistente sobre ${foco.titulo}`}
      aria-label={`Perguntar ao assistente sobre ${foco.titulo}`}
      className={className ?? `flex items-center gap-1 rounded-lg text-violet-600 hover:bg-violet-50 cursor-pointer ${label ? 'px-2 py-1 text-xs font-semibold' : 'w-7 h-7 justify-center'}`}
    >
      <i className="ri-robot-2-line text-xs" />
      {label}
    </button>
  );
}
