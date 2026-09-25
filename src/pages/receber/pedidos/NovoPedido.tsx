// Formulário de pedido de pagamento: reembolso (despesa que não é mercadoria), freelancer e
// fornecedor sem nota. Mercadoria paga do bolso NÃO vem aqui: vai pelo recebimento (entra no CMV).
import { useEffect, useMemo, useState } from 'react';
import { brl, dataBR, hojeISO, normalizar, somaDias } from '../api';
import { chamarPedidos, comprovanteParaEnvio, type Categoria, type ContextoPedidos, type Fornecedor, type Freela, type TipoPedido } from './api';
import { Categorias, Chips, Comprovante, Enviar, Rotulo, Texto, Valor, cls, lerValor } from './ui';

interface Props {
  tipo: TipoPedido;
  tenantId: string;
  contexto: ContextoPedidos;
  onEnviado: () => void;
  onErro: (msg: string | null) => void;
}

const novaRef = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

export default function NovoPedido({ tipo, tenantId, contexto, onEnviado, onErro }: Props) {
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
  const [valorMexido, setValorMexido] = useState(false);

  useEffect(() => {
    if (tipo !== 'freelancer') {
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

  // Freela com diária cadastrada: valor = diária × dias (até a pessoa mexer no valor)
  useEffect(() => {
    if (tipo === 'freelancer' && !valorMexido && freela?.diaria && dias.length) {
      setValor((freela.diaria * dias.length).toFixed(2).replace('.', ','));
    }
  }, [tipo, freela, dias, valorMexido]);

  const listaBusca = useMemo(() => {
    const q = normalizar(busca);
    const base = tipo === 'freelancer' ? (freelas ?? []) : (fornecedores ?? []);
    // Freela: os cadastrados já aparecem (são poucos); fornecedor só filtrando (são centenas)
    if (!q) return tipo === 'freelancer' ? base.slice(0, 30) : [];
    return base.filter((f) => normalizar(f.nome).includes(q)).slice(0, 8);
  }, [busca, tipo, freelas, fornecedores]);

  const v = lerValor(valor);
  const precisaPix = tipo === 'reembolso' || (tipo === 'fornecedor' && !fornecedor?.tem_pix) || (tipo === 'freelancer' && !freela?.tem_pix);
  const faltando = (() => {
    if (!(v > 0)) return 'Informe o valor';
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
              <button type="button" onClick={() => { setFornecedorId(null); setFreelaId(null); setValorMexido(false); }} className="text-sm font-semibold text-zinc-500 cursor-pointer">Trocar</button>
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
              <input type="date" max={somaDias(hoje, 7)} min={somaDias(hoje, -90)} onChange={(e) => { const d = e.target.value; if (d && !dias.includes(d)) setDias([...dias, d].sort()); e.target.value = ''; }}
                className="mt-2 w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm bg-white" aria-label="Outro dia" />
              {dias.length > 0 && <p className="text-xs text-zinc-500 px-1 mt-1.5">{dias.length} dia{dias.length > 1 ? 's' : ''}: {dias.map((d) => dataBR(d).slice(0, 5)).join(', ')}</p>}
            </div>
          </div>
          <Valor label={`Valor total${freela?.diaria && dias.length ? ` (${dias.length} × ${brl(freela.diaria)})` : ''}`} valor={valor} onValor={(x) => { setValor(x); setValorMexido(true); }} />
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

      {tipo !== 'reembolso' && precisaPix && (
        <div className="bg-white rounded-3xl border border-zinc-100 p-4 space-y-3">
          <p className="text-sm font-bold text-zinc-700">Para onde vai o Pix</p>
          <Texto label="Chave Pix" valor={pix} onValor={setPix} placeholder="CPF, CNPJ, celular, e-mail ou chave aleatória" />
          <Texto label={tipo === 'freelancer' ? 'CPF (opcional)' : 'CPF ou CNPJ (opcional)'} valor={doc} onValor={setDoc} inputMode="numeric" />
        </div>
      )}

      <Texto label="Observação (opcional)" valor={obs} onValor={setObs} multilinha placeholder="Algo que o financeiro precisa saber" />
      <p className="text-xs text-zinc-500 px-1">O pedido vai para o financeiro aprovar. Só depois vira conta a pagar.</p>

      <Enviar onClick={enviar} disabled={!!faltando || enviando}>
        {enviando ? 'Enviando…' : faltando ?? 'Enviar para aprovação'}
      </Enviar>
    </div>
  );
}
