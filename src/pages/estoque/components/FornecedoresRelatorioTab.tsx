import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useSuppliers, type Supplier } from '@/hooks/useSuppliers';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import {
  agruparCompras, pedidoDoInsumo, precisaConferir, fmtQtd, fmtPrecoUnit, rotuloUnidade,
  CHAVE_PRODUZIR, CHAVE_SEM_FORNECEDOR,
  type InsumoSituacao, type PedidoMandado,
} from '@/lib/estoqueRegras';
import { useEstoqueTela } from '../EstoqueTela';
import Folha from './inicio/Folha';
import {
  Faixa, CartaoAcao, CartaoBarra, Chips, Etiqueta, Vazio, Pagina, btn, brl, brlInteiro, semAcento,
  type CorBarra,
} from './ui/EstoqueUi';

// Insumos › Por fornecedor (layout novo, 2026-10-04). Lê a mesma situação do Início (regra única de
// "abaixo do mínimo" e de pedido mandado), então "Pedir N itens" aqui é o mesmo N do Início.

type Ordem = 'pedido' | 'nome' | 'valor' | 'alertas' | 'semzap';

interface Grupo {
  chave: string;
  nome: string;
  /** fornecedor = quem vende; producao = cozinha da loja; sem = insumos sem fornecedor */
  tipo: 'fornecedor' | 'producao' | 'sem';
  /** Só quando o fornecedor está cadastrado (fin_suppliers) */
  supplierId: string | null;
  /** WhatsApp só com dígitos */
  fone: string | null;
  itens: InsumoSituacao[];
  /** R$ em estoque (estoque negativo não soma) */
  valor: number;
  nAbaixo: number;
  /** Na lista de compras e ainda sem pedido mandado (o N do botão Pedir) */
  nPedir: number;
  nMandado: number;
  nSemPreco: number;
  ultimaEntrada: string | null;
  pedido: PedidoMandado | null;
}

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;
const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR');
/** dd/mm no dia de Brasília */
const ddmm = (iso: string) => { const k = dateKeyBrasilia(iso); return `${k.slice(8, 10)}/${k.slice(5, 7)}`; };

/** Situação do insumo em palavras (a mesma regra única do resto do Estoque). */
function situacaoDe(i: InsumoSituacao): { rotulo: string; tom: 'red' | 'amber' | 'green' | 'zinc' } {
  if (i.estoque < 0 || precisaConferir(i)) return { rotulo: 'Conferir', tom: 'red' };
  if (i.esgotado) return { rotulo: 'Esgotado', tom: 'red' };
  if (i.abaixoMinimo) return { rotulo: 'Abaixo do mínimo', tom: 'amber' };
  if (!i.acompanha) return { rotulo: 'Sem aviso', tom: 'zinc' };
  return { rotulo: 'Ok', tom: 'green' };
}

/** Dentro do fornecedor: o que está faltando primeiro, depois por nome. */
const ordenarItens = (itens: InsumoSituacao[]) =>
  [...itens].sort((a, b) => Number(b.abaixoMinimo) - Number(a.abaixoMinimo) || porNome(a, b));

const valorDe = (i: InsumoSituacao) => (i.estoque > 0 && i.preco > 0 ? i.estoque * i.preco : 0);

/** "Sem fornecedor" sempre por último; o resto pela ordem escolhida. */
function ordenar(lista: Grupo[], ordem: Ordem): Grupo[] {
  return [...lista].sort((a, b) => {
    if ((a.tipo === 'sem') !== (b.tipo === 'sem')) return a.tipo === 'sem' ? 1 : -1;
    if (ordem === 'pedido') return Number(b.nPedir > 0) - Number(a.nPedir > 0) || b.nPedir - a.nPedir || porNome(a, b);
    if (ordem === 'valor') return b.valor - a.valor || porNome(a, b);
    if (ordem === 'alertas') return b.nAbaixo - a.nAbaixo || porNome(a, b);
    return porNome(a, b);
  });
}

// ── CSV (Excel brasileiro: ";" e vírgula decimal; aspas dobradas) ─────────────
const campoCsv = (v: string | number) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function baixarCsv(grupos: Grupo[]) {
  const cab = ['Fornecedor', 'Insumo', 'Categoria', 'Unidade', 'Estoque Atual', 'Estoque Mín', 'Preço Unit.', 'Valor Estoque', 'Status'];
  const linhas: Array<Array<string | number>> = [];
  for (const g of grupos) {
    for (const i of ordenarItens(g.itens)) {
      linhas.push([
        g.nome, i.nome, i.categoria ?? '', rotuloUnidade(i.unidade),
        Math.round(i.estoque * 10000) / 10000, Math.round(i.minimo * 10000) / 10000,
        Math.round(i.preco * 1e6) / 1e6, valorDe(i).toFixed(2).replace('.', ','), situacaoDe(i).rotulo,
      ]);
    }
  }
  const csv = [cab, ...linhas].map((l) => l.map(campoCsv).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `insumos_por_fornecedor_${todayBrasilia()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FornecedoresRelatorioTab() {
  const { situacao, recarregarSituacao, irPara, abrirFicha, abrirArrumar, podeConfigurar } = useEstoqueTela();
  const { user } = useAuth();
  const toast = useToast();
  const { suppliers, load: recarregarFornecedores } = useSuppliers();
  const [busca, setBusca] = useState('');
  const [filtroFornecedor, setFiltroFornecedor] = useState<string>('todos');
  const [ordem, setOrdem] = useState<Ordem>('pedido');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  // "Pôr WhatsApp"
  const [foneAlvo, setFoneAlvo] = useState<Grupo | null>(null);
  const [foneTxt, setFoneTxt] = useState('');
  const [foneErro, setFoneErro] = useState<string | null>(null);
  const [foneGravando, setFoneGravando] = useState(false);

  // Só o dono e o Supervisor mudam o WhatsApp (o banco confere de novo).
  const podeFone = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const grupos = useMemo<Grupo[]>(() => {
    if (!situacao) return [];
    return agruparCompras(situacao.insumos).map((g) => {
      const tipo: Grupo['tipo'] = g.chave === CHAVE_PRODUZIR ? 'producao' : g.chave === CHAVE_SEM_FORNECEDOR ? 'sem' : 'fornecedor';
      // Mesma lista do Início: abaixo do mínimo ou posto na lista à mão.
      const lista = g.itens.filter((i) => i.abaixoMinimo || i.naLista);
      const pedidos = lista.map((i) => pedidoDoInsumo(i, situacao.pedidos));
      const mandados = pedidos.filter((p): p is PedidoMandado => !!p);
      const entradas = g.itens.map((i) => i.ultimaEntrada).filter((x): x is string => !!x).sort();
      return {
        chave: g.chave,
        nome: tipo === 'producao' ? 'Produção interna' : tipo === 'sem' ? 'Sem fornecedor' : g.nome,
        tipo,
        supplierId: tipo === 'fornecedor' && !g.chave.startsWith('nome:') ? g.chave : null,
        fone: g.fone,
        itens: g.itens,
        valor: g.itens.reduce((s, i) => s + valorDe(i), 0),
        nAbaixo: g.itens.filter((i) => i.abaixoMinimo).length,
        nPedir: pedidos.filter((p) => !p).length,
        nMandado: mandados.length,
        nSemPreco: g.itens.filter((i) => !i.preco).length,
        ultimaEntrada: entradas.length ? entradas[entradas.length - 1] : null,
        pedido: mandados.sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm))[0] ?? null,
      };
    });
  }, [situacao]);

  const resumo = useMemo(() => {
    const forn = grupos.filter((g) => g.tipo === 'fornecedor');
    return {
      nInsumos: situacao?.insumos.length ?? 0,
      nAbaixo: situacao?.insumos.filter((i) => i.abaixoMinimo).length ?? 0,
      nFornecedores: forn.length,
      nComFone: forn.filter((g) => g.fone).length,
      nSemFornecedor: grupos.find((g) => g.tipo === 'sem')?.itens.length ?? 0,
      valor: grupos.reduce((s, g) => s + g.valor, 0),
    };
  }, [grupos, situacao]);

  const termo = semAcento(busca);
  const visiveis = useMemo(() => {
    let r = grupos;
    if (filtroFornecedor !== 'todos') r = r.filter((g) => g.chave === filtroFornecedor);
    if (termo) r = r.filter((g) => semAcento(g.nome).includes(termo) || g.itens.some((i) => semAcento(i.nome).includes(termo)));
    if (ordem === 'semzap') r = r.filter((g) => g.tipo === 'fornecedor' && !g.fone);
    return ordenar(r, ordem);
  }, [grupos, filtroFornecedor, termo, ordem]);

  const nComPedido = grupos.filter((g) => g.tipo !== 'sem' && g.nPedir > 0).length;
  const nSemZap = grupos.filter((g) => g.tipo === 'fornecedor' && !g.fone).length;
  const temFiltro = filtroFornecedor !== 'todos' || !!termo || ordem === 'semzap';

  const alternar = (chave: string) =>
    setAbertos((prev) => { const s = new Set(prev); if (s.has(chave)) s.delete(chave); else s.add(chave); return s; });

  const abrirFone = (g: Grupo) => { setFoneAlvo(g); setFoneTxt(''); setFoneErro(null); };
  const fecharFone = () => { if (!foneGravando) setFoneAlvo(null); };

  const salvarFone = async () => {
    if (!foneAlvo?.supplierId || !user?.tenantId) return;
    const digitos = foneTxt.replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 13) {
      setFoneErro('Número inválido: use DDD + número (ex.: 41 99999-9999).');
      return;
    }
    setFoneGravando(true);
    setFoneErro(null);
    try {
      const { data, error } = await supabase.rpc('fn_estoque_fornecedor_fone', {
        p_tenant_id: user.tenantId, p_supplier_id: foneAlvo.supplierId, p_fone: digitos,
      });
      // Só dou como salvo quando o banco confirma (antes de recarregar).
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        setFoneErro(error?.message ?? 'Não consegui guardar o número. Tente de novo.');
        return;
      }
      await Promise.all([recarregarSituacao(), recarregarFornecedores()]);
      toast.success('WhatsApp guardado', `${foneAlvo.nome} já pode receber o pedido.`);
      setFoneAlvo(null);
      setFoneTxt('');
    } catch (e) {
      setFoneErro(e instanceof Error ? e.message : 'Não consegui guardar o número. Tente de novo.');
    } finally {
      setFoneGravando(false);
    }
  };

  if (!situacao) {
    return (
      <div className="py-14 text-center">
        <div className="w-6 h-6 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <button type="button" onClick={() => recarregarSituacao()} className="mt-3 text-xs font-bold text-zinc-400 hover:text-amber-700 underline cursor-pointer">
          Demorou? Tentar de novo
        </button>
      </div>
    );
  }

  if (!situacao.insumos.length) {
    return (
      <Pagina>
        <Vazio icone="ri-building-line" titulo="Nenhum insumo cadastrado">
          Quando houver insumos, aqui você vê quem vende cada um e o que falta pedir.
        </Vazio>
      </Pagina>
    );
  }

  const unico = filtroFornecedor !== 'todos' && visiveis.length === 1 ? visiveis[0] : null;

  return (
    <Pagina>
      {/* Números (os de antes + os novos) */}
      <Faixa itens={[
        {
          valor: resumo.nFornecedores, rotulo: 'fornecedores dos insumos',
          ajuda: 'Quem vende pelo menos um insumo seu. A Produção interna é a cozinha da loja e não conta como fornecedor.',
        },
        {
          valor: resumo.nComFone, rotulo: 'com WhatsApp',
          tom: resumo.nFornecedores > 0 && resumo.nComFone < resumo.nFornecedores ? 'amber' : 'green',
          ajuda: 'Fornecedores com número guardado: o pedido sai direto pelo WhatsApp.',
        },
        { valor: resumo.nInsumos, rotulo: 'insumos' },
        { valor: resumo.nAbaixo, rotulo: 'abaixo do mínimo', tom: resumo.nAbaixo ? 'red' : 'neutro' },
        { valor: resumo.nSemFornecedor, rotulo: 'insumos sem fornecedor', tom: resumo.nSemFornecedor ? 'red' : 'neutro' },
        {
          valor: brlInteiro(resumo.valor), rotulo: 'em estoque',
          ajuda: 'Quantidade × preço de cada insumo. Estoque negativo ou sem preço não entra na soma.',
        },
      ]} />

      {resumo.nSemFornecedor > 0 && podeConfigurar && (
        <CartaoAcao
          tom="prop" icone="ri-links-line"
          titulo={`${plural(resumo.nSemFornecedor, 'insumo não tem', 'insumos não têm')} fornecedor`}
          acoes={<button type="button" onClick={() => abrirArrumar({ filtro: 'fornecedor' })} className={btn('p')}>Ligar agora</button>}
        >
          Sem isso eles não entram no pedido certo. Responda "quem vende?" um por um.
        </CartaoAcao>
      )}

      {/* Ordem / filtro */}
      <Chips<Ordem>
        valor={ordem} onChange={setOrdem}
        opcoes={[
          { id: 'pedido', rotulo: 'Com pedido a fazer', n: nComPedido, tom: nComPedido ? 'red' : undefined },
          { id: 'nome', rotulo: 'Nome A–Z' },
          { id: 'valor', rotulo: 'Mais valor' },
          { id: 'alertas', rotulo: 'Mais alertas' },
          { id: 'semzap', rotulo: 'Sem WhatsApp', n: nSemZap, tom: nSemZap ? 'amber' : undefined },
        ]}
      />

      {/* Busca, fornecedor e exportar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <div className="relative flex-1 md:max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar fornecedor ou insumo"
            className="w-full h-10 rounded-xl border border-zinc-200 shadow-sm pl-9 pr-3 text-sm bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
        </div>
        <div className="flex items-center gap-2 md:ml-auto">
          <select
            value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)}
            className="h-10 min-w-0 flex-1 md:flex-none md:w-56 text-xs font-semibold border border-zinc-200 shadow-sm rounded-xl px-3 text-zinc-700 focus:outline-none focus:border-amber-400 bg-white cursor-pointer"
          >
            <option value="todos">Todos os fornecedores</option>
            {ordenar(grupos, 'nome').map((g) => <option key={g.chave} value={g.chave}>{g.nome}</option>)}
          </select>
          <button
            type="button" disabled={!visiveis.length} onClick={() => baixarCsv(visiveis)}
            title="Baixa o que está na tela (respeita a busca e o filtro)"
            className={btn('out')}
          >
            <i className="ri-download-line" /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Um fornecedor escolhido: resumo dele */}
      {unico && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
          <span className="text-xs font-extrabold text-amber-800">{unico.nome}</span>
          <Mini rotulo="Insumos" valor={String(unico.itens.length)} />
          <Mini rotulo="Valor total" valor={brl(unico.valor)} />
          <Mini rotulo="Sem preço" valor={String(unico.nSemPreco)} />
          {unico.nAbaixo > 0 && <Etiqueta tom="amber">{unico.nAbaixo} abaixo do mínimo</Etiqueta>}
        </div>
      )}

      {/* Cartões */}
      {visiveis.length === 0 ? (
        <Vazio
          icone="ri-building-line" titulo="Nenhum fornecedor encontrado"
          acao={temFiltro ? (
            <button type="button" className={btn('out', 'sm')} onClick={() => { setBusca(''); setFiltroFornecedor('todos'); if (ordem === 'semzap') setOrdem('pedido'); }}>
              Tirar os filtros
            </button>
          ) : undefined}
        >
          {temFiltro ? 'Nada bate com a busca ou o filtro de agora.' : undefined}
        </Vazio>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          {visiveis.map((g) => (
            <CartaoGrupo
              key={g.chave} g={g} termo={termo}
              aberto={abertos.has(g.chave)} onAlternar={() => alternar(g.chave)}
              supplier={g.supplierId ? suppliers.find((s) => s.id === g.supplierId) ?? null : null}
              podeConfigurar={podeConfigurar} podeFone={podeFone}
              onPedir={() => irPara('inicio')}
              onProducao={() => irPara('producao')}
              onLigar={() => abrirArrumar({ filtro: 'fornecedor' })}
              onFone={() => abrirFone(g)}
              onFicha={abrirFicha}
            />
          ))}
        </div>
      )}

      {/* Pôr WhatsApp */}
      <Folha
        aberta={!!foneAlvo} fecharNoFundo={!foneGravando}
        titulo={`WhatsApp de ${foneAlvo?.nome ?? ''}`}
        subtitulo="Com ele, o pedido do Início sai direto para o fornecedor."
        onFechar={fecharFone}
        rodape={(
          <>
            <button type="button" disabled={foneGravando} onClick={fecharFone} className={`${btn('out')} flex-1`}>Cancelar</button>
            <button type="button" disabled={foneGravando || !foneTxt.trim()} onClick={salvarFone} className={`${btn('p')} flex-1`}>
              {foneGravando ? <i className="ri-loader-4-line animate-spin" /> : 'Guardar número'}
            </button>
          </>
        )}
      >
        <label className="block text-xs font-bold text-zinc-500 mb-1.5" htmlFor="fone-fornecedor">Número com DDD</label>
        <input
          id="fone-fornecedor" type="tel" inputMode="tel" autoFocus value={foneTxt}
          onChange={(e) => { setFoneTxt(e.target.value); setFoneErro(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') salvarFone(); }}
          placeholder="41 99999-9999"
          className="w-full h-12 rounded-xl border border-zinc-200 px-3 text-base focus:outline-none focus:border-amber-400"
        />
        {foneErro && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{foneErro}</p>}
        <p className="mt-2 mb-3 text-[11.5px] text-zinc-400">Só o Administrador e o Supervisor mudam o número.</p>
      </Folha>
    </Pagina>
  );
}

function Mini({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">{rotulo}</p>
      <p className="text-sm font-extrabold text-amber-900 tabular-nums">{valor}</p>
    </div>
  );
}

// ── Cartão de um fornecedor ───────────────────────────────────────────────────
function CartaoGrupo({ g, termo, aberto, onAlternar, supplier, podeConfigurar, podeFone, onPedir, onProducao, onLigar, onFone, onFicha }: {
  g: Grupo;
  termo: string;
  aberto: boolean;
  onAlternar: () => void;
  supplier: Supplier | null;
  podeConfigurar: boolean;
  podeFone: boolean;
  onPedir: () => void;
  onProducao: () => void;
  onLigar: () => void;
  onFone: () => void;
  onFicha: (id: string) => void;
}) {
  const cor: CorBarra = g.tipo === 'producao' ? 'amber' : g.nPedir > 0 ? 'red' : g.tipo === 'sem' ? 'zinc' : 'green';
  const emDia = g.tipo === 'fornecedor' && g.nAbaixo === 0 && g.nMandado === 0;
  const aceitaPedido = g.tipo === 'fornecedor' && g.nPedir > 0;
  const semZap = g.tipo === 'fornecedor' && !g.fone;

  // Achou o insumo (não o nome do fornecedor): mostra qual.
  const achados = termo && !semAcento(g.nome).includes(termo)
    ? g.itens.filter((i) => semAcento(i.nome).includes(termo)).map((i) => i.nome)
    : [];

  let meta = `${plural(g.itens.length, 'insumo', 'insumos')} · ${brlInteiro(g.valor)} em estoque`;
  if (g.tipo === 'fornecedor') meta += g.ultimaEntrada ? ` · última entrada ${ddmm(g.ultimaEntrada)}` : ' · sem entrada em 30 dias';

  return (
    <CartaoBarra cor={cor} className={aberto ? 'md:col-span-2' : ''}>
      <p className="text-[14.5px] font-extrabold text-zinc-900 leading-snug break-words">{g.nome}</p>
      <div className="flex flex-wrap gap-1 mt-1 empty:hidden">
        {g.tipo === 'producao' && (g.nPedir > 0
          ? <Etiqueta tom="amber">{g.nPedir} para produzir</Etiqueta>
          : <Etiqueta tom="green">em dia</Etiqueta>)}
        {g.tipo !== 'producao' && g.nAbaixo > 0 && <Etiqueta tom="red">{g.nAbaixo} abaixo do mínimo</Etiqueta>}
        {g.tipo !== 'producao' && g.nMandado > 0 && (
          <Etiqueta tom="green">
            {g.nPedir === 0 ? 'pedido mandado' : `${g.nMandado} já ${g.nMandado === 1 ? 'pedido' : 'pedidos'}`}
            {g.pedido?.enviadoEm ? ` ${ddmm(g.pedido.enviadoEm)}` : ''}
          </Etiqueta>
        )}
        {emDia && <Etiqueta tom="green">em dia</Etiqueta>}
        {semZap && g.supplierId && <Etiqueta tom="amber">sem WhatsApp</Etiqueta>}
        {semZap && !g.supplierId && <Etiqueta tom="zinc">sem cadastro</Etiqueta>}
      </div>
      <p className="text-[12.5px] text-zinc-500 mt-1">{meta}</p>
      {g.tipo === 'producao' && (
        <p className="text-[12.5px] text-zinc-500 mt-0.5">
          É a cozinha da loja.{' '}
          {ordenarItens(g.itens).slice(0, 3).map((i) => i.nome).join(', ')}{g.itens.length > 3 ? '…' : ''}
        </p>
      )}
      {g.tipo === 'sem' && <p className="text-[12.5px] text-zinc-500 mt-0.5">Sem fornecedor eles não entram no pedido certo.</p>}
      {achados.length > 0 && (
        <p className="text-xs text-zinc-500 mt-1">
          tem: <b className="text-zinc-700">{achados.slice(0, 3).join(', ')}</b>{achados.length > 3 ? ` e mais ${achados.length - 3}` : ''}
        </p>
      )}

      <div className="flex gap-2 flex-wrap mt-2.5">
        {aceitaPedido && (
          <button type="button" onClick={onPedir} className={btn(g.fone ? 'wa' : 'p', 'sm')} title="O pedido se manda no Início">
            <i className={g.fone ? 'ri-whatsapp-line' : 'ri-share-forward-line'} />
            Pedir {plural(g.nPedir, 'item', 'itens')}
          </button>
        )}
        {g.tipo === 'producao' && (
          <button type="button" onClick={onProducao} className={btn(g.nPedir > 0 ? 'p' : 'out', 'sm')}>Abrir Produção</button>
        )}
        {g.tipo === 'sem' && podeConfigurar && (
          <button type="button" onClick={onLigar} className={btn('p', 'sm')}>Ligar agora</button>
        )}
        {semZap && g.supplierId && podeFone && (
          <button type="button" onClick={onFone} className={btn('out', 'sm')}>
            <i className="ri-whatsapp-line" /> Pôr WhatsApp
          </button>
        )}
        <button type="button" onClick={onAlternar} aria-expanded={aberto} className={btn('out', 'sm')}>
          {aberto ? `Esconder os ${g.itens.length}` : `Ver os ${g.itens.length}`}
          <i className={aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
        </button>
      </div>

      {aberto && <DetalheGrupo g={g} supplier={supplier} termo={termo} onFicha={onFicha} />}
    </CartaoBarra>
  );
}

// ── Os insumos do fornecedor (celular: linhas; computador: tabela) ─────────────
function DetalheGrupo({ g, supplier, termo, onFicha }: { g: Grupo; supplier: Supplier | null; termo: string; onFicha: (id: string) => void }) {
  const itens = ordenarItens(g.itens);
  const casa = (i: InsumoSituacao) => !!termo && semAcento(i.nome).includes(termo);
  const info: Array<[string, string]> = supplier
    ? ([
        ['CNPJ', supplier.cnpj], ['Telefone', supplier.phone], ['Endereço', supplier.address], ['E-mail', supplier.email],
      ] as Array<[string, string | undefined]>).filter((x): x is [string, string] => !!x[1])
    : [];

  return (
    <div className="mt-3 pt-3 border-t border-zinc-100">
      {g.supplierId && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
          <Etiqueta tom="green">Cadastrado</Etiqueta>
          {info.map(([rotulo, valor]) => (
            <div key={rotulo} className="min-w-0">
              <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wide">{rotulo}</p>
              <p className="text-xs text-zinc-700 font-semibold break-words">{valor}</p>
            </div>
          ))}
        </div>
      )}

      {/* Celular */}
      <ul className="md:hidden divide-y divide-zinc-100">
        {itens.map((i) => {
          const st = situacaoDe(i);
          return (
            <li key={i.id}>
              <button type="button" onClick={() => onFicha(i.id)} className={`w-full text-left flex items-start gap-2 py-2.5 cursor-pointer ${casa(i) ? 'bg-amber-50/70' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-bold text-zinc-800 break-words">{i.nome}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fmtQtd(i.estoque, i.unidade)}{i.minimo > 0 ? ` · mín ${fmtQtd(i.minimo, i.unidade)}` : ''} · {fmtPrecoUnit(i.preco, i.unidade)}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <Etiqueta tom={st.tom}>{st.rotulo}</Etiqueta>
                  <p className="text-xs font-bold text-zinc-700 tabular-nums mt-1">{valorDe(i) > 0 ? brl(valorDe(i)) : '—'}</p>
                </div>
              </button>
            </li>
          );
        })}
        <li className="flex items-center justify-between py-2.5 text-xs font-bold text-zinc-500">
          <span>Total — {plural(g.itens.length, 'insumo', 'insumos')}</span>
          <span className="text-zinc-900 tabular-nums">{brl(g.valor)}</span>
        </li>
      </ul>

      {/* Computador */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: '560px' }}>
          <thead className="border-b border-zinc-200">
            <tr>
              <th className="pr-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Insumo</th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Categoria</th>
              <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Estoque</th>
              <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Preço Unit.</th>
              <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Valor</th>
              <th className="pl-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100/80">
            {itens.map((i) => {
              const st = situacaoDe(i);
              return (
                <tr key={i.id} onClick={() => onFicha(i.id)} className={`hover:bg-zinc-50 transition-colors cursor-pointer ${casa(i) ? 'bg-amber-50/70' : ''}`}>
                  <td className="pr-4 py-2.5 font-semibold text-zinc-800"><span className="block truncate max-w-[260px]" title={i.nome}>{i.nome}</span></td>
                  <td className="px-4 py-2.5">
                    {i.categoria ? <Etiqueta>{i.categoria}</Etiqueta> : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-zinc-700">
                    <span className={i.estoque < 0 ? 'text-red-600 font-bold' : ''}>{fmtQtd(i.estoque, i.unidade)}</span>
                    {i.minimo > 0 && <span className="block text-[10px] text-zinc-400">mín: {fmtQtd(i.minimo, i.unidade)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">{fmtPrecoUnit(i.preco, i.unidade)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-700">{valorDe(i) > 0 ? brl(valorDe(i)) : '—'}</td>
                  <td className="pl-4 py-2.5 text-center"><Etiqueta tom={st.tom}>{st.rotulo}</Etiqueta></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-zinc-200">
            <tr>
              <td colSpan={4} className="pr-4 py-2.5 text-xs font-semibold text-zinc-500">Total — {plural(g.itens.length, 'insumo', 'insumos')}</td>
              <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-xs font-bold text-zinc-900">{brl(g.valor)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
