import { useEffect, useState } from 'react';
import { useDeliveryTela } from '../DeliveryTela';
import { btn, Cartao, Colunas, Folha, fmtTelefone, Manchete, Nota, PaginaDelivery, SecaoTitulo, waNumero } from '../ui';

// WhatsApp › Mensagens prontas (protótipo docs/prototipos/delivery-proposta.html, T.mensagens).
// Cada fase do pedido mostra a mensagem que sai quando a equipe toca no WhatsApp do cliente no Gestor:
// a da loja (cfg.mensagens[fase], pode ter várias — a pessoa escolhe) ou a PADRÃO do sistema (a mesma
// frase que o Gestor monta quando a fase não tem mensagem). Também mora aqui o botão "Falar com a loja"
// do cardápio do cliente (cfg.whatsappLoja). Nada grava aqui: a barra "Salvar" da página grava.

const FASES = [
  { chave: 'novo', rotulo: 'Recebido', icone: 'ri-inbox-line', padrao: 'recebido' },
  { chave: 'preparo', rotulo: 'Em preparo', icone: 'ri-restaurant-2-line', padrao: 'em preparo' },
  { chave: 'pronto', rotulo: 'Pronto', icone: 'ri-shopping-bag-3-line', padrao: 'pronto e saindo para entrega' },
  { chave: 'em_rota', rotulo: 'Em rota', icone: 'ri-e-bike-2-line', padrao: 'a caminho' },
  { chave: 'entregue', rotulo: 'Entregue', icone: 'ri-checkbox-circle-line', padrao: 'entregue' },
];

/** Igual ao texto que o Gestor de pedidos usa quando a fase não tem mensagem da loja. */
const mensagemPadrao = (estado: string) => `Olá {nome}! Seu pedido #{numero} está ${estado}! 🏍️`;

const VARIAVEIS = ['{nome}', '{numero}', '{total}', '{taxa}'];
const EXEMPLO = 'Ex.: Olá {nome}! Seu pedido #{numero} está a caminho 🏍️';

export default function MensagensAba() {
  const { cfg, mudar } = useDeliveryTela();

  // ── editar a lista de uma fase (rascunho local; "Pronto" passa para o rascunho da tela) ──
  const [editando, setEditando] = useState<string | null>(null);
  const [lista, setLista] = useState<string[]>([]);
  const [focar, setFocar] = useState<number | null>(null);
  const fase = FASES.find((f) => f.chave === editando) ?? null;

  const abrir = (chave: string) => {
    const atual = (cfg.mensagens[chave] ?? []).filter((s) => s.trim());
    setLista(atual); setFocar(null); setEditando(chave);
  };
  const fechar = () => { setEditando(null); setLista([]); setFocar(null); };
  const adicionar = () => { setFocar(lista.length); setLista((l) => [...l, '']); };
  const confirmar = () => {
    if (!fase) return;
    const limpa = lista.map((s) => s.trim()).filter(Boolean);
    mudar((c) => {
      const mensagens = { ...c.mensagens };
      if (limpa.length) mensagens[fase.chave] = limpa; else delete mensagens[fase.chave];
      return { mensagens };
    });
    fechar();
  };

  // ── botão "Falar com a loja" ──
  const digitos = cfg.whatsappLoja;
  const [texto, setTexto] = useState(fmtTelefone(digitos));
  const [digitando, setDigitando] = useState(false);
  useEffect(() => { if (!digitando) setTexto(fmtTelefone(digitos)); }, [digitos, digitando]);
  const curto = !digitando && digitos.length > 0 && digitos.length < 10;

  return (
    <PaginaDelivery>
      <Manchete titulo="Mensagens prontas">
        Quando a equipe toca no WhatsApp do cliente no Gestor, a mensagem da fase já vem escrita. Se tiver mais de uma, a pessoa escolhe.
      </Manchete>

      <Colunas>
        <div className="min-w-0">
          <div className="space-y-2">
            {FASES.map((f) => {
              const suas = (cfg.mensagens[f.chave] ?? []).filter((s) => s.trim());
              return (
                <button key={f.chave} type="button" onClick={() => abrir(f.chave)}
                  className="w-full flex items-center gap-3 text-left bg-white border border-zinc-200 hover:border-amber-300 rounded-2xl px-3.5 py-3 cursor-pointer">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${suas.length ? 'bg-amber-50 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>
                    <i className={`${f.icone} text-lg`} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-extrabold text-zinc-900 leading-snug">{f.rotulo}</span>
                    <span className="line-clamp-2 text-xs text-zinc-500 mt-0.5 leading-snug break-words">
                      {suas.length > 0 ? (
                        <>
                          <b className="text-amber-700">{suas.length > 1 ? `Suas (${suas.length}): ` : 'Sua: '}</b>“{suas[0]}”
                        </>
                      ) : (
                        <><b className="text-zinc-400">Padrão: </b>“{mensagemPadrao(f.padrao)}”</>
                      )}
                    </span>
                  </span>
                  <span className="w-[34px] h-[34px] rounded-xl border border-zinc-200 bg-white text-zinc-600 flex items-center justify-center flex-shrink-0">
                    <i className={suas.length ? 'ri-edit-line' : 'ri-add-line'} />
                  </span>
                </button>
              );
            })}
          </div>
          <Nota className="mt-2.5">
            Dá para usar {VARIAVEIS.map((v, i) => <span key={v}>{i > 0 ? (i === VARIAVEIS.length - 1 ? ' e ' : ', ') : ''}<code>{v}</code></span>)} na mensagem. Fase sem mensagem sua usa a padrão do sistema.
          </Nota>
        </div>

        <div className="min-w-0">
          <SecaoTitulo titulo={'Botão "Falar com a loja"'} />
          <Cartao>
            <p className="text-[13px] text-zinc-600 leading-snug mb-2.5">Aparece no topo do delivery. Em branco, o botão some.</p>
            <input
              type="tel" inputMode="tel" autoComplete="off" aria-label="WhatsApp da loja"
              placeholder="(41) 99999-9999"
              value={texto}
              onFocus={() => setDigitando(true)}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, '').slice(0, 13);
                setTexto(e.target.value);
                mudar({ whatsappLoja: d });
              }}
              onBlur={() => { setDigitando(false); setTexto(fmtTelefone(digitos)); }}
              className={`w-full h-10 px-3 rounded-xl border bg-white text-[13.5px] font-semibold text-zinc-900 outline-none focus:border-amber-400 ${curto ? 'border-amber-400' : 'border-zinc-200'}`}
            />
            {curto && (
              <p className="mt-2 text-xs text-amber-700 leading-snug">
                <i className="ri-error-warning-line mr-1" />Faltam números: com o DDD são 10 ou 11 dígitos. Enquanto estiver assim, o botão não aparece para o cliente.
              </p>
            )}
            {digitos.length >= 10 && (
              <a href={`https://wa.me/${waNumero(digitos)}`} target="_blank" rel="noreferrer" className={`${btn('ghost', 'sm')} mt-2 -ml-1`}>
                <i className="ri-whatsapp-line" />Testar esse número
              </a>
            )}
          </Cartao>
        </div>
      </Colunas>

      <Folha
        aberta={editando != null}
        titulo={fase ? `Mensagens: ${fase.rotulo}` : 'Mensagens'}
        subtitulo="Quando a equipe toca no WhatsApp do cliente nesta fase"
        onFechar={fechar}
        rodape={(
          <>
            <button type="button" className={`${btn('out')} flex-1`} onClick={fechar}>Cancelar</button>
            <button type="button" className={`${btn('p')} flex-1`} onClick={confirmar}>Pronto</button>
          </>
        )}
      >
        {fase && (
          <div className="space-y-3 pb-2">
            {lista.length === 0 ? (
              <div className="bg-zinc-50 border border-zinc-100 rounded-2xl px-3.5 py-3">
                <p className="text-[11px] font-bold text-zinc-400 mb-1">Hoje sai a mensagem padrão</p>
                <p className="text-[13px] text-zinc-700 leading-snug">“{mensagemPadrao(fase.padrao)}”</p>
              </div>
            ) : (
              <div className="space-y-2">
                {lista.map((m, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <textarea
                      value={m} rows={3} autoFocus={focar === i} aria-label={`Mensagem ${i + 1}`}
                      onChange={(e) => setLista((l) => l.map((x, k) => (k === i ? e.target.value : x)))}
                      placeholder={EXEMPLO}
                      className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-zinc-200 focus:border-amber-400 outline-none text-[13.5px] leading-snug resize-none"
                    />
                    <button type="button" aria-label={`Tirar a mensagem ${i + 1}`} title="Tirar"
                      onClick={() => setLista((l) => l.filter((_, k) => k !== i))}
                      className="w-9 h-9 flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400 hover:text-red-500 cursor-pointer flex-shrink-0">
                      <i className="ri-delete-bin-line" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className={btn('out', 'sm')} onClick={adicionar}>
              <i className="ri-add-line" />{lista.length === 0 ? 'Escrever a minha' : 'Adicionar outra mensagem'}
            </button>

            <p className="text-[11px] text-zinc-400 leading-snug">
              {lista.length > 1 ? 'Com mais de uma, a pessoa escolhe qual mandar. ' : ''}
              Dá para usar {VARIAVEIS.join(' ')}. Deixar tudo vazio volta para a mensagem padrão.
            </p>
          </div>
        )}
      </Folha>
    </PaginaDelivery>
  );
}
