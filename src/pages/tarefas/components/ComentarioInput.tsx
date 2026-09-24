import { useState, useRef, useMemo } from 'react';
import { Send } from 'lucide-react';
import type { UsuarioOption } from '../lib/agrupamento';

interface ComentarioInputProps {
  usuarios: UsuarioOption[];
  onEnviar: (body: string, mentions: string[]) => Promise<void>;
  /** Já abre com o cursor no campo (ex.: comentar pela coluna da Lista). */
  autoFocus?: boolean;
}

/**
 * Campo de comentário com menção por "@". As menções viram uma lista de ids
 * enviada ao backend, que dispara a notificação para cada mencionado.
 */
export default function ComentarioInput({ usuarios, onEnviar, autoFocus }: ComentarioInputProps) {
  const [texto, setTexto] = useState('');
  const [buscaMencao, setBuscaMencao] = useState<string | null>(null);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sugestoes = useMemo(() => {
    if (buscaMencao === null) return [];
    const termo = buscaMencao.toLowerCase();
    return usuarios.filter((u) => u.nome.toLowerCase().includes(termo)).slice(0, 5);
  }, [buscaMencao, usuarios]);

  /** Detecta se o cursor está logo depois de um "@palavra" sem espaço. */
  const atualizarBusca = (valor: string, cursor: number) => {
    const antes = valor.slice(0, cursor);
    const match = antes.match(/@([\p{L}\p{N}\s]{0,20})$/u);
    if (!match) {
      setBuscaMencao(null);
      return;
    }
    setBuscaMencao(match[1]);
    setIndiceAtivo(0);
  };

  const aplicarMencao = (usuario: UsuarioOption) => {
    const cursor = inputRef.current?.selectionStart ?? texto.length;
    const antes = texto.slice(0, cursor);
    const depois = texto.slice(cursor);
    const substituido = antes.replace(/@([\p{L}\p{N}\s]{0,20})$/u, `@${usuario.nome} `);
    setTexto(substituido + depois);
    setBuscaMencao(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const pos = substituido.length;
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  /** Resolve os nomes escritos com @ de volta para ids de usuário. */
  const extrairMencoes = (corpo: string): string[] => {
    const encontrados = new Set<string>();
    for (const u of usuarios) {
      if (corpo.includes(`@${u.nome}`)) encontrados.add(u.id);
    }
    return [...encontrados];
  };

  const enviar = async () => {
    const corpo = texto.trim();
    if (!corpo || enviando) return;
    setEnviando(true);
    await onEnviar(corpo, extrairMencoes(corpo));
    setTexto('');
    if (inputRef.current) inputRef.current.style.height = '';
    setBuscaMencao(null);
    setEnviando(false);
  };

  return (
    <div className="relative mt-2">
      {sugestoes.length > 0 && (
        <div className="absolute bottom-full mb-1 left-0 right-0 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden z-10">
          {sugestoes.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // não perde o foco do input
                aplicarMencao(u);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition ${
                i === indiceAtivo ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              @{u.nome}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
        className="flex items-end gap-2"
        autoComplete="off"
      >
        {/* textarea, não input: o Chrome oferecia cartão de crédito salvo no <input>. */}
        <textarea
          ref={inputRef}
          rows={1}
          autoFocus={autoFocus}
          autoComplete="off"
          name="comentario-tarefa"
          value={texto}
          onChange={(e) => {
            // Cresce com o texto (até max-h-32).
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
            setTexto(e.target.value);
            atualizarBusca(e.target.value, e.target.selectionStart ?? 0);
          }}
          onKeyDown={(e) => {
            if (sugestoes.length === 0) {
              // Enter envia (como antes); Shift+Enter quebra linha.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                enviar();
              }
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndiceAtivo((i) => (i + 1) % sugestoes.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndiceAtivo((i) => (i - 1 + sugestoes.length) % sugestoes.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              aplicarMencao(sugestoes[indiceAtivo]);
            } else if (e.key === 'Escape') {
              setBuscaMencao(null);
            }
          }}
          placeholder="Comentar… use @ para mencionar"
          className="flex-1 text-sm max-md:text-base border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 resize-none max-h-32 leading-5"
        />
        <button
          type="submit"
          disabled={!texto.trim() || enviando}
          className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
