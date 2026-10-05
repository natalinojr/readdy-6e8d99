// Tela de aviso em português para "não achei", "não é do seu perfil" e afins (2026-10-05).
// Mesmo desenho do Estoque: cartão branco, ícone, texto curto e UM botão que leva ao começo da pessoa.
import { useNavigate } from 'react-router-dom';
import { btn } from '@/pages/estoque/components/ui/EstoqueUi';

export default function TelaAviso({ icone, titulo, children, cheia = false }: {
  icone: string; titulo: string; children?: React.ReactNode;
  /** true = ocupa a janela inteira (fora do layout do sistema, ex.: endereço que não existe). */
  cheia?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className={`flex items-center justify-center px-4 py-10 ${cheia ? 'min-h-screen bg-[#FAF7F2]' : 'h-full min-h-[60vh]'}`}>
      <div className="bg-white border border-zinc-200 rounded-2xl px-6 py-8 text-center w-full max-w-sm">
        <span className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 inline-flex items-center justify-center mb-3">
          <i className={`${icone} text-2xl`} />
        </span>
        <h1 className="text-base font-extrabold text-zinc-800">{titulo}</h1>
        {children && <div className="text-sm text-zinc-500 mt-1.5 leading-relaxed">{children}</div>}
        <button type="button" onClick={() => navigate('/')} className={`${btn('p')} mt-5 w-full`}>
          Ir para o meu começo
        </button>
      </div>
    </div>
  );
}
