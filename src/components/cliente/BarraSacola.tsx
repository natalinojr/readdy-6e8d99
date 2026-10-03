// Barra fixa no rodapé das telas do cliente: "Ver sacola · R$ X".
interface Props {
  quantidade: number;
  total: string;
  texto: string;
  onClick: () => void;
  /** Loja fechada: a barra fica escura e diz quando dá para enviar. */
  apagada?: boolean;
  /** Texto pequeno embaixo da barra. */
  dica?: string | null;
}

export default function BarraSacola(props: Props) {
  return (
    <div className="shrink-0 bg-[#FBF8F4] border-t border-stone-200/70 px-4 pt-2.5 pb-4 z-30">
      <button
        type="button"
        onClick={props.onClick}
        className={'w-full h-14 rounded-2xl text-white flex items-center justify-between px-4 text-base font-bold cursor-pointer transition-colors ' +
          (props.apagada ? 'bg-stone-700 hover:bg-stone-800' : 'bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)]')}
      >
        <span className="flex items-center gap-2.5">
          <span className="min-w-[28px] h-7 px-1.5 rounded-lg bg-white/20 inline-flex items-center justify-center text-sm">
            {props.quantidade}
          </span>
          {props.texto}
        </span>
        <span>{props.total}</span>
      </button>
      {props.dica ? (
        <p className="text-center text-[11px] text-stone-500 mt-1.5">{props.dica}</p>
      ) : null}
    </div>
  );
}
