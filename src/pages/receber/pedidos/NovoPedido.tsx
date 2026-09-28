// Formulário de pedido de pagamento: reembolso (despesa que não é mercadoria), freelancer e
// fornecedor sem nota. Mercadoria paga do bolso NÃO vem aqui: vai pelo recebimento (entra no CMV).
// Compra online (2026-09-28): a pessoa cola o link do produto; o dono autoriza e compra na conta da loja.
import { useEffect, useMemo, useState } from 'react';
import { brl, dataBR, hojeISO, normalizar, somaDias } from '../api';
import { chamarPedidos, comprovanteParaEnvio, type Categoria, type ContextoPedidos, type Fornecedor, type Freela, type PrintLido, type TipoPedido } from './api';
import { Categorias, Chips, Comprovante, Enviar, Rotulo, Texto, Valor, cls, lerValor } from './ui';
import { lerLinkCompra } from './linkCompra';
import { lerPixCopia } from './pixCopia';

interface Props {
  tipo: TipoPedido;
  tenantId: string;
  contexto: ContextoPedidos;
  onEnviado: () => void;
  onErro: (msg: string | null) => void;
  /** Compra online vinda do "Compartilhar" do celular: o texto já entra no campo do link. */
  linkInicial?: string;
  /** Veio do "Compartilhar" e não é compra: manda o mesmo conteúdo para as Tarefas. */
  onCriarTarefa?: () => void;
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaSemana = (iso: string) => SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const novaRef = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

export default function NovoPedido({ tipo, tenantId, contexto, onEnviado, onErro, linkInicial, onCriarTarefa }: Props) {
  const hoje = hojeISO();
  const [ref] = useState(novaRef);
  const [enviando, setEnviando] = useState(false);
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [freelas, setFreelas] = useState<Freela[] | null>(null);
  const [fornecedores, setFornecedores] = useState<Fornecedor[] | null>(null);

  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [dre, setDre] = useState<string | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [obs, setObs] = useState('');
  // reembolso
  const [dataGasto, setDataGasto] = useState(hoje);
  const [nome, setNome] = useState(tipo === 'reembolso' ? contexto.ultimo_reembolso?.nome ?? contexto.nome : '');
  const [pix, setPix] = useState(tipo === 'reembolso' ? contexto.ultimo_reembolso?.pix_chave ?? '' : '');
  const [doc, setDoc] = useState('');
  // fornecedor
  const [fornecedorId, setFornecedorId] = useState<string | null>(null);
  const [vencimento, setVencimento] = useState(hoje);
  // freelancer
  const [freelaId, setFreelaId] = useState<string | null>(null);
  const [funcao, setFuncao] = useState('');
  const [dias, setDias] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  // Valor de cada dia trabalhado (dono, 2026-09-27): o total é a soma, o sistema calcula
  const [valoresDia, setValoresDia] = useState<Record<string, string>>({});
  // compra online
  const [link, setLink] = useState(linkInicial ?? '');
  // O texto do compartilhamento chega depois de abrir a tela (lido do cache do service worker)
  useEffect(() => { if (linkInicial) setLink((l) => l || linkInicial); }, [linkInicial]);
  const [quantidade, setQuantidade] = useState('1');
  const anuncio = useMemo(() => (tipo === 'compra_online' ? lerLinkCompra(link) : null), [tipo, link]);
  // Nome do produto vem do link; a pessoa pode corrigir (só preenche enquanto o campo não foi mexido)
  const [descricaoMexida, setDescricaoMexida] = useState(false);
  // Print do checkout (2026-09-28): o jeito principal — a IA lê itens, desconto, frete e total
  const [lido, setLido] = useState<PrintLido | null>(null);
  // Pix copia e cola do checkout (2026-09-28): valor exato e quem recebe
  const [pixTexto, setPixTexto] = useState('');
  // Compra que já foi paga (2026-09-28): sem Pix; informa quando e como
  const [jaPago, setJaPago] = useState(false);
  const [pagoEm, setPagoEm] = useState(hoje);
  const [pagoForma, setPagoForma] = useState<'pix' | 'cartao' | 'mercado_pago' | ''>('');
  const pixLido = useMemo(() => (tipo === 'compra_online' && pixTexto.trim() ? lerPixCopia(pixTexto) : null), [tipo, pixTexto]);
  useEffect(() => { if (pixLido?.valor && !jaPago) setValor(pixLido.valor.toFixed(2).replace('.', ',')); }, [pixLido, jaPago]);
  const [lendo, setLendo] = useState(false);
  const [verLink, setVerLink] = useState(!!linkInicial);
  useEffect(() => { if (tipo === 'compra_online' && !descricaoMexida && !lido) setDescricao(anuncio?.titulo ?? ''); }, [tipo, anuncio, descricaoMexida, lido]);
  const lerPrint = async (f: File | null) => {
    setFoto(f);
    if (!f) return;
    setLendo(true); setLido(null); onErro(null);
    try {
      const imagem = await comprovanteParaEnvio(f);
      const { data, erro } = await chamarPedidos<{ lido: PrintLido }>('ler_print', tenantId, { imagem });
      if (erro || !data?.lido) { onErro(`${erro ?? 'Não consegui ler o print'}. Confira e preencha os campos abaixo.`); return; }
      const l = data.lido;
      setLido(l);
      const itens = l.itens ?? [];
      if (!descricaoMexida && itens.length) setDescricao(itens.length === 1 ? itens[0].descricao : `${itens.length} itens: ${itens.map((i) => i.descricao).join('; ')}`.slice(0, 300));
      setQuantidade(String(itens.length === 1 ? itens[0].quantidade : 1).replace('.', ','));
      if (l.total != null && !pixLido?.valor) setValor(l.total.toFixed(2).replace('.', ','));
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  };

  useEffect(() => {
    if (tipo !== 'freelancer' && tipo !== 'compra_online') {
      chamarPedidos<{ categorias: Categoria[] }>('categorias', tenantId).then(({ data, erro }) => { if (erro) onErro(erro); setCategorias(data?.categorias ?? []); });
    }
    if (tipo === 'freelancer') {
      chamarPedidos<{ freelancers: Freela[] }>('freelancers', tenantId).then(({ data, erro }) => { if (erro) onErro(erro); setFreelas(data?.freelancers ?? []); });
    }
    if (tipo === 'fornecedor') {
      chamarPedidos<{ fornecedores: Fornecedor[] }>('fornecedores', tenantId).then(({ data, erro }) => { if (erro) onErro(erro); setFornecedores(data?.fornecedores ?? []); });
    }
  }, [tipo, tenantId, onErro]);

  const freela = freelas?.find((f) => f.id === freelaId) ?? null;
  const fornecedor = fornecedores?.find((f) => f.id === fornecedorId) ?? null;

  // Dia novo já vem com a diária cadastrada do freela (ou o valor do último dia preenchido); dá para mudar
  const diariaTxt = freela?.diaria ? freela.diaria.toFixed(2).replace('.', ',') : '';
  useEffect(() => {
    if (tipo !== 'freelancer') return;
    setValoresDia((vs) => {
      const sugestao = diariaTxt || [...dias].reverse().map((d) => vs[d]).find((x) => x && lerValor(x) > 0) || '';
      const novo: Record<string, string> = {};
      for (const d of dias) novo[d] = vs[d] || sugestao;
      return novo;
    });
  }, [tipo, dias, diariaTxt]);

  const listaBusca = useMemo(() => {
    const q = normalizar(busca);
    const base = tipo === 'freelancer' ? (freelas ?? []) : (fornecedores ?? []);
    // Freela: os cadastrados já aparecem (são poucos); fornecedor só filtrando (são centenas)
    if (!q) return tipo === 'freelancer' ? base.slice(0, 30) : [];
    return base.filter((f) => normalizar(f.nome).includes(q)).slice(0, 8);
  }, [busca, tipo, freelas, fornecedores]);

  const totalDias = Math.round(dias.reduce((s, d) => s + (lerValor(valoresDia[d] ?? '') || 0), 0) * 100) / 100;
  const diaSemValor = dias.find((d) => !(lerValor(valoresDia[d] ?? '') > 0));
  const v = tipo === 'freelancer' ? totalDias : lerValor(valor);
  const precisaPix = tipo === 'compra_online' ? false : tipo === 'reembolso' || (tipo === 'fornecedor' && !fornecedor?.tem_pix) || (tipo === 'freelancer' && !freela?.tem_pix);
  const faltando = (() => {
    if (tipo === 'freelancer' && diaSemValor) return `Informe o valor de ${dataBR(diaSemValor).slice(0, 5)}`;
    if (tipo === 'compra_online') {
      if (lendo) return 'Lendo o print…';
      if (!foto && !anuncio) return 'Mande o print da compra';
      if (jaPago) {
        if (!pagoForma) return 'Como foi pago?';
      } else {
        if (!pixTexto.trim()) return 'Cole o Pix copia e cola';
        if (!pixLido) return 'Pix copia e cola incompleto';
        if (pixLido.dinamico) return 'Pix sem a chave no código';
        if (!pixLido.valor) return 'Esse Pix não tem valor';
      }
      if (link.trim() && !anuncio) return 'Link não reconhecido';
      if (!descricao.trim()) return 'Diga o que é o produto';
      if (!(lerValor(quantidade) > 0)) return 'Informe a quantidade';
    }
    if (!(v > 0)) return tipo === 'compra_online' ? 'Informe o valor total (com frete)' : 'Informe o valor';
    if (tipo === 'reembolso') {
      if (!descricao.trim()) return 'Conte o que foi comprado';
      if (!dre) return 'Escolha a classificação';
      if (!foto) return 'Tire a foto do comprovante';
      if (!nome.trim()) return 'Quem recebe?';
    }
    if (tipo === 'fornecedor') {
      if (!fornecedorId && !nome.trim()) return 'Informe o fornecedor';
      if (!descricao.trim()) return 'Conte o que está sendo pago';
    }
    if (tipo === 'freelancer') {
      if (!freelaId && !nome.trim()) return 'Escolha o freelancer';
      if (!dias.length) return 'Marque os dias trabalhados';
    }
    if (precisaPix && !pix.trim()) return 'Informe a chave Pix';
    return null;
  })();

  const enviar = async () => {
    if (faltando || enviando) return;
    setEnviando(true);
    onErro(null);
    try {
      const comprovante = foto ? await comprovanteParaEnvio(foto) : null;
      const { erro } = await chamarPedidos('criar', tenantId, {
        tipo, ref, valor: v, descricao, obs, dre_category_id: dre, comprovante,
        favorecido_nome: nome, favorecido_doc: doc, pix_chave: pix,
        data_gasto: dataGasto, supplier_id: fornecedorId, vencimento,
        freelancer_id: freelaId, funcao, dias,
        link: tipo === 'compra_online' ? link : undefined, quantidade: tipo === 'compra_online' ? lerValor(quantidade) : undefined,
        lido: tipo === 'compra_online' ? lido : undefined,
        pix_copia_e_cola: tipo === 'compra_online' && !jaPago ? pixLido?.codigo : undefined,
        ...(tipo === 'compra_online' && jaPago ? { ja_pago: true, pago_em: pagoEm, pago_forma: pagoForma } : {}),
        valores_dia: tipo === 'freelancer' ? Object.fromEntries(dias.map((d) => [d, lerValor(valoresDia[d] ?? '')])) : undefined,
      });
      if (erro) { onErro(erro); return; }
      onEnviado();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const ultimos7 = Array.from({ length: 8 }, (_, i) => somaDias(hoje, -i));
  const nomeDia = (d: string) => (d === hoje ? 'Hoje' : d === somaDias(hoje, -1) ? 'Ontem' : dataBR(d).slice(0, 5));
  const alternarDia = (d: string) => setDias((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));

  return (
    <div className="px-4 pt-4 pb-32 space-y-4">
      {tipo === 'reembolso' && (
        <>
          <Texto label="O que você comprou?" valor={descricao} onValor={setDescricao} placeholder="Ex.: produtos de limpeza, lâmpada, gás" />
          <Valor label="Quanto pagou?" valor={valor} onValor={setValor} />
          <div>
            <Rotulo>Quando pagou?</Rotulo>
            <div className="mt-1.5 flex gap-2">
              <Chips opcoes={[{ v: hoje, label: 'Hoje' }, { v: somaDias(hoje, -1), label: 'Ontem' }]} valor={dataGasto} onValor={setDataGasto} />
              <input type="date" max={hoje} min={somaDias(hoje, -90)} value={dataGasto} onChange={(e) => e.target.value && setDataGasto(e.target.value)} className="flex-1 min-w-0 border border-zinc-200 rounded-xl px-3 text-sm bg-white" />
            </div>
          </div>
          <Categorias categorias={categorias} valor={dre} onValor={setDre} />
          <Comprovante arquivo={foto} onArquivo={setFoto} obrigatorio />
          <div className="bg-white rounded-3xl border border-zinc-100 p-4 space-y-3">
            <p className="text-sm font-bold text-zinc-700">Para quem vai o Pix</p>
            <Texto label="Nome" valor={nome} onValor={setNome} placeholder="Quem pagou do bolso" />
            <Texto label="Chave Pix" valor={pix} onValor={setPix} placeholder="CPF, celular, e-mail ou chave aleatória" />
          </div>
        </>
      )}

      {(tipo === 'fornecedor' || tipo === 'freelancer') && (
        <div>
          <Rotulo dica={tipo === 'fornecedor' ? 'Procure o cadastrado ou escreva o nome' : 'Procure quem já trabalhou ou escreva o nome'}>
            {tipo === 'fornecedor' ? 'Fornecedor' : 'Freelancer'}
          </Rotulo>
          {(tipo === 'fornecedor' ? fornecedor : freela) ? (
            <div className="mt-1.5 flex items-center gap-3 bg-amber-50 border-2 border-amber-300 rounded-2xl px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-800 truncate">{(tipo === 'fornecedor' ? fornecedor : freela)!.nome}</p>
                <p className="text-xs text-zinc-500">
                  {tipo === 'freelancer' ? [freela?.funcao, freela?.diaria ? `diária ${brl(freela.diaria)}` : null].filter(Boolean).join(' · ') || 'Freelancer' : fornecedor?.cnpj ?? 'Cadastrado'}
                  {((tipo === 'fornecedor' && fornecedor?.tem_pix) || (tipo === 'freelancer' && freela?.tem_pix)) ? ' · Pix cadastrado' : ''}
                </p>
              </div>
              <button type="button" onClick={() => { setFornecedorId(null); setFreelaId(null); }} className="text-sm font-semibold text-zinc-500 cursor-pointer">Trocar</button>
            </div>
          ) : (
            <>
              <input value={busca || nome} onChange={(e) => { setBusca(e.target.value); setNome(e.target.value); }} placeholder="Nome" className={cls} />
              {listaBusca.length > 0 && (
                <div className="mt-1 bg-white border border-zinc-100 rounded-2xl overflow-hidden">
                  {listaBusca.map((f) => (
                    <button key={f.id} type="button" onClick={() => {
                      if (tipo === 'fornecedor') setFornecedorId(f.id); else { setFreelaId(f.id); setFuncao((f as Freela).funcao ?? ''); }
                      // Pix cadastrado vale sempre; o digitado antes não pode ir junto
                      if ((f as Fornecedor | Freela).tem_pix) setPix('');
                      setNome(f.nome); setBusca('');
                    }} className="w-full text-left px-4 py-3 text-sm border-b border-zinc-50 active:bg-zinc-50 cursor-pointer">
                      <span className="font-semibold text-zinc-800">{f.nome}</span>
                    </button>
                  ))}
                </div>
              )}
              {nome.trim() && !listaBusca.length && (
                <p className="text-xs text-zinc-500 px-1 mt-1">Novo — {tipo === 'freelancer' ? 'o cadastro do freela é criado quando o financeiro aprovar' : 'o fornecedor não é cadastrado por aqui (só o financeiro cadastra)'}.</p>
              )}
            </>
          )}
        </div>
      )}

      {tipo === 'freelancer' && (
        <>
          {!freela && <Texto label="Função (opcional)" valor={funcao} onValor={setFuncao} placeholder="Ex.: garçom, cozinha, entregador" />}
          <div>
            <Rotulo dica="Toque em todos os dias que a pessoa trabalhou">Dias trabalhados</Rotulo>
            <div className="mt-1.5">
              <Chips opcoes={ultimos7.map((d) => ({ v: d, label: nomeDia(d) }))} valor={dias} onValor={alternarDia} />
              {/* Botão de calendário (dono, 2026-09-27): o campo de data vazio não parecia clicável.
                  O input fica invisível por cima do botão, então o toque abre o calendário do celular. */}
              <label className="relative mt-2 flex items-center justify-center gap-2 w-full border-2 border-dashed border-amber-300 rounded-xl px-3 py-3 text-sm font-semibold text-amber-700 bg-amber-50 active:bg-amber-100 cursor-pointer">
                <i className="ri-calendar-line text-lg" />
                Escolher outra data
                <input type="date" max={somaDias(hoje, 7)} min={somaDias(hoje, -90)} aria-label="Escolher outra data"
                  onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* navegador sem showPicker: abre pelo toque */ } }}
                  onChange={(e) => { const d = e.target.value; if (d && !dias.includes(d)) setDias([...dias, d].sort()); e.target.value = ''; }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </label>
            </div>
          </div>
          {dias.length > 0 && (
            <div className="bg-white rounded-3xl border border-zinc-100 p-4">
              <Rotulo dica="Quanto a pessoa recebe por cada dia">Valor de cada dia</Rotulo>
              <div className="mt-2 space-y-2">
                {dias.map((d) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="flex-1 min-w-0 text-sm font-semibold text-zinc-700">{dataBR(d).slice(0, 5)} <span className="font-normal text-zinc-400">{diaSemana(d)}</span></span>
                    <div className="relative w-36">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-semibold">R$</span>
                      <input value={valoresDia[d] ?? ''} inputMode="decimal" placeholder="0,00" aria-label={`Valor de ${dataBR(d).slice(0, 5)}`}
                        onChange={(e) => { const x = e.target.value.replace(/[^\d.,]/g, ''); setValoresDia((vs) => ({ ...vs, [d]: x })); }}
                        className="w-full border border-zinc-200 rounded-xl pl-10 pr-3 py-2.5 text-right font-bold bg-white" />
                    </div>
                    <button type="button" onClick={() => alternarDia(d)} aria-label={`Tirar ${dataBR(d).slice(0, 5)}`} className="w-8 h-8 flex items-center justify-center text-zinc-400 cursor-pointer">
                      <i className="ri-close-line text-lg" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-100 flex items-baseline justify-between">
                <span className="text-sm text-zinc-500">Total · {dias.length} dia{dias.length > 1 ? 's' : ''}</span>
                <span className="text-xl font-black text-zinc-900">{brl(totalDias)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {tipo === 'fornecedor' && (
        <>
          <Texto label="O que está sendo pago?" valor={descricao} onValor={setDescricao} placeholder="Ex.: conserto da coifa, frete, gás" />
          <Valor label="Valor" valor={valor} onValor={setValor} />
          <div>
            <Rotulo>Precisa ser pago quando?</Rotulo>
            <div className="mt-1.5 space-y-2">
              <Chips opcoes={[{ v: hoje, label: 'Hoje' }, { v: somaDias(hoje, 1), label: 'Amanhã' }, { v: somaDias(hoje, 7), label: '7 dias' }]} valor={vencimento} onValor={setVencimento} />
              <input type="date" min={hoje} max={somaDias(hoje, 120)} value={vencimento} onChange={(e) => e.target.value && setVencimento(e.target.value)} className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm bg-white" />
            </div>
          </div>
          <Categorias categorias={categorias} valor={dre} onValor={setDre} dica="Se não souber, deixe em branco: o financeiro escolhe ao aprovar" />
          <Comprovante arquivo={foto} onArquivo={setFoto} />
          <p className="text-xs text-zinc-500 px-1">Mercadoria que chegou sem nota? Use <b>Chegou sem nota</b> no recebimento — assim entra no estoque e no custo.</p>
        </>
      )}

      {tipo === 'compra_online' && (
        <>
          {onCriarTarefa && (
            <button type="button" onClick={onCriarTarefa} className="w-full text-left flex items-center gap-2 bg-white border border-zinc-100 rounded-2xl px-4 py-3 text-sm text-zinc-600 cursor-pointer">
              <i className="ri-task-line text-lg text-zinc-400" />
              <span className="flex-1">Não é para comprar? <b className="text-amber-700">Criar tarefa com isso</b></span>
              <i className="ri-arrow-right-s-line text-zinc-400" />
            </button>
          )}
          <Comprovante arquivo={foto} onArquivo={lerPrint} obrigatorio={!anuncio} titulo="Print da compra"
            dica="Tela de finalizar a compra, com o produto e o total. O sistema lê sozinho." />
          {lendo && <p className="text-sm text-amber-700 px-1 flex items-center gap-2"><i className="ri-loader-4-line animate-spin" /> Lendo o print…</p>}
          {lido && <ResumoLido l={lido} />}
          {!verLink ? (
            <button type="button" onClick={() => setVerLink(true)} className="text-sm font-semibold text-amber-700 px-1 cursor-pointer">+ Tem o link do produto? (opcional)</button>
          ) : (
          <div>
            <Rotulo dica="Opcional. No app do Mercado Livre: Compartilhar › Copiar link.">Link do produto</Rotulo>
            <textarea rows={2} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.mercadolivre.com.br/…" className={cls} />
            {link.trim() && !anuncio && <p className="text-xs text-red-600 px-1 mt-1">Não achei um link aqui. Copie o link do produto e cole de novo.</p>}
            {anuncio && (
              <div className="mt-2 flex items-center gap-3 bg-amber-50 border-2 border-amber-300 rounded-2xl px-4 py-3">
                <i className="ri-shopping-cart-2-line text-2xl text-amber-600" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-zinc-800 truncate">{anuncio.site}</p>
                  <p className="text-xs text-zinc-500 truncate">{anuncio.anuncio_id ?? anuncio.url}</p>
                </div>
                <a href={anuncio.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-amber-700">Abrir</a>
              </div>
            )}
          </div>
          )}
          <Texto label="O que é?" valor={descricao} onValor={(x) => { setDescricaoMexida(true); setDescricao(x); }} placeholder="Ex.: pegador de massa inox 30 cm" />
          <Texto label="Quantidade" valor={quantidade} onValor={(x) => setQuantidade(x.replace(/[^\d.,]/g, ''))} inputMode="decimal" />
          <label className="flex items-center gap-3 bg-white border-2 border-zinc-100 rounded-2xl px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={jaPago} onChange={(e) => setJaPago(e.target.checked)} className="w-5 h-5 accent-amber-500" />
            <span className="flex-1">
              <span className="block text-sm font-bold text-zinc-800">Essa compra já foi paga</span>
              <span className="block text-xs text-zinc-500">Pagaram antes de pedir aqui: sem Pix, só lançar e classificar</span>
            </span>
          </label>
          {jaPago ? (
            <>
              <div>
                <Rotulo>Quando foi pago?</Rotulo>
                <div className="mt-1.5 flex gap-2">
                  <Chips opcoes={[{ v: hoje, label: 'Hoje' }, { v: somaDias(hoje, -1), label: 'Ontem' }]} valor={pagoEm} onValor={setPagoEm} />
                  <input type="date" max={hoje} min={somaDias(hoje, -90)} value={pagoEm} onChange={(e) => e.target.value && setPagoEm(e.target.value)} className="flex-1 min-w-0 border border-zinc-200 rounded-xl px-3 text-sm bg-white" />
                </div>
              </div>
              <div>
                <Rotulo>Como foi pago?</Rotulo>
                <div className="mt-1.5">
                  <Chips opcoes={[{ v: 'pix', label: 'Pix do banco da loja' }, { v: 'cartao', label: 'Cartão' }, { v: 'mercado_pago', label: 'Saldo Mercado Pago' }]} valor={pagoForma} onValor={(x) => setPagoForma(x as 'pix' | 'cartao' | 'mercado_pago')} />
                </div>
              </div>
              <Valor label="Valor pago (com frete)" valor={valor} onValor={setValor} />
              <p className="text-xs text-zinc-500 px-1">Se pagou do próprio bolso, use <b>Reembolso</b>.</p>
            </>
          ) : (
            <>
              <div>
                <Rotulo dica="Na tela de pagamento do site, escolha Pix e toque em Copiar código.">Pix copia e cola</Rotulo>
                <textarea rows={3} value={pixTexto} onChange={(e) => setPixTexto(e.target.value)} placeholder="00020126…" className={`${cls} font-mono text-xs`} />
                {pixTexto.trim() && !pixLido && <p className="text-xs text-red-600 px-1 mt-1">Código incompleto ou alterado. Copie de novo no site e cole inteiro.</p>}
                {pixLido && <ConferePix pix={pixLido} total={lido?.total ?? null} />}
              </div>
              {!pixLido?.valor && <Valor label="Valor total (com frete)" valor={valor} onValor={setValor} />}
              <p className="text-xs text-zinc-500 px-1">Vá até a tela de pagamento, escolha Pix e copie o código. Não pague: o financeiro aprova e paga pelo banco da loja. Se der, use a conta da loja (CNPJ).</p>
            </>
          )}
        </>
      )}

      {tipo !== 'reembolso' && precisaPix && (
        <div className="bg-white rounded-3xl border border-zinc-100 p-4 space-y-3">
          <p className="text-sm font-bold text-zinc-700">Para onde vai o Pix</p>
          <Texto label="Chave Pix" valor={pix} onValor={setPix} placeholder="CPF, CNPJ, celular, e-mail ou chave aleatória" />
          <Texto label={tipo === 'freelancer' ? 'CPF (opcional)' : 'CPF ou CNPJ (opcional)'} valor={doc} onValor={setDoc} inputMode="numeric" />
        </div>
      )}

      <Texto label={tipo === 'compra_online' ? 'Para que é? (opcional)' : 'Observação (opcional)'} valor={obs} onValor={setObs} multilinha placeholder={tipo === 'compra_online' ? 'Ex.: o nosso quebrou; precisa até sexta' : 'Algo que o financeiro precisa saber'} />
      <p className="text-xs text-zinc-500 px-1">{tipo === 'compra_online' ? 'O pedido vai para o financeiro aprovar e pagar o Pix. O Pix do site costuma vencer rápido: peça logo depois de gerar.' : 'O pedido vai para o financeiro aprovar. Só depois vira conta a pagar.'}</p>

      <Enviar onClick={enviar} disabled={!!faltando || enviando}>
        {enviando ? 'Enviando…' : faltando ?? 'Enviar para aprovação'}
      </Enviar>
    </div>
  );
}

/** O que foi lido do print, para a pessoa conferir antes de enviar. */
export function ResumoLido({ l }: { l: PrintLido }) {
  const linhas: [string, number | null][] = [['Produtos', l.subtotal], ['Desconto', l.desconto != null && l.desconto > 0 ? -l.desconto : null], ['Frete', l.frete]];
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 space-y-1.5 text-sm">
      <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Lido do print{l.site ? ` · ${l.site}` : ''}</p>
      {l.itens.map((i, k) => (
        <p key={k} className="flex justify-between gap-3 text-zinc-700">
          <span className="min-w-0">{i.quantidade !== 1 ? `${String(i.quantidade).replace('.', ',')}× ` : ''}{i.descricao}</span>
          {i.valor != null && <span className="whitespace-nowrap">{brl(i.valor)}</span>}
        </p>
      ))}
      <div className="pt-1.5 border-t border-emerald-200 space-y-0.5">
        {linhas.filter(([, v]) => v != null).map(([r, v]) => (
          <p key={r} className="flex justify-between text-zinc-600"><span>{r}</span><span>{v === 0 && r === 'Frete' ? 'Grátis' : brl(v!)}</span></p>
        ))}
        {l.total != null && <p className="flex justify-between font-bold text-zinc-900"><span>Total</span><span>{brl(l.total)}</span></p>}
      </div>
      {l.entrega && <p className="text-xs text-zinc-500 pt-1"><i className="ri-map-pin-line" /> {l.entrega}</p>}
    </div>
  );
}

/** O que o Pix diz (quem recebe e quanto) conferido com o total lido do print. */
export function ConferePix({ pix, total }: { pix: { nome: string | null; chave: string | null; valor: number | null; dinamico: boolean }; total: number | null }) {
  const bate = total != null && pix.valor != null ? Math.abs(total - pix.valor) <= 0.02 : null;
  return (
    <div className={`mt-2 rounded-2xl border p-3 text-sm space-y-1 ${pix.dinamico || bate === false ? 'bg-red-50 border-red-200' : 'bg-white border-zinc-100'}`}>
      <p className="flex justify-between gap-3"><span className="text-zinc-500">Quem recebe</span><span className="font-semibold text-zinc-800 text-right">{pix.nome ?? '—'}</span></p>
      {pix.chave && <p className="flex justify-between gap-3"><span className="text-zinc-500">Chave</span><span className="text-zinc-700 text-right break-all">{pix.chave}</span></p>}
      <p className="flex justify-between gap-3"><span className="text-zinc-500">Valor do Pix</span><span className="font-bold text-zinc-900">{pix.valor != null ? brl(pix.valor) : 'sem valor'}</span></p>
      {pix.dinamico && <p className="text-xs text-red-700">Esse Pix não traz a chave no código (cobrança dinâmica): não dá para conferir quem recebe.</p>}
      {bate === true && <p className="text-xs font-semibold text-emerald-700"><i className="ri-checkbox-circle-line" /> Bate com o total do print</p>}
      {bate === false && <p className="text-xs font-semibold text-red-700"><i className="ri-error-warning-line" /> Diferente do total do print ({brl(total!)}). Confira se é o Pix desta compra.</p>}
    </div>
  );
}
