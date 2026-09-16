// Ação rápida do chat do assistente: emitir NFS-e passo a passo SEM passar pelo modelo (custo zero).
// Parece conversa (balões + botões), mas é um roteiro fixo que chama direto a Edge nfse-write:
// contexto → tomador (recentes ou CPF/CNPJ com prévia da Receita) → serviço → valor → competência
// → confirmação (com/sem dados bancários) → emitir. Nada vai para o histórico do assistente.
import { useEffect, useRef, useState } from 'react';
import { nfseCall, fmtDoc, soDigitos, cnpjValido, cpfValido } from '@/pages/nfse/api';

interface ServicoCtx { id: string; nome: string; codigo: string; valor_padrao: number | null }
interface TomadorCtx { id: string; nome: string; documento: string }
interface EmpresaCtx {
  id: string; nome: string; cnpj: string; ambiente: 'producao' | 'testes'; certificado_ok: boolean; tem_dados_bancarios: boolean;
  servicos: ServicoCtx[]; tomadores_recentes: TomadorCtx[];
}
type Tomador = { id?: string; documento: string; nome: string; novo: boolean };
type Balao = { de: 'bot' | 'eu'; texto: string };
type Passo =
  | 'carregando' | 'sem_empresa' | 'empresa' | 'tomador' | 'tomador_confirma' | 'tomador_nome'
  | 'servico' | 'valor' | 'competencia' | 'competencia_outra' | 'confirmar' | 'emitindo' | 'fim';

const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const lerValor = (t: string) => {
  const limpo = t.replace(/[^\d,.]/g, '');
  // "1.800,50" → 1800.50 ; "1800.5" → 1800.5
  const n = limpo.includes(',') ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export default function AcaoEmitirNfse({ onFechar, onAbrirNotas }: { onFechar: () => void; onAbrirNotas: () => void }) {
  const [baloes, setBaloes] = useState<Balao[]>([]);
  const [passo, setPasso] = useState<Passo>('carregando');
  const [empresas, setEmpresas] = useState<EmpresaCtx[]>([]);
  const [empresa, setEmpresa] = useState<EmpresaCtx | null>(null);
  const [tomador, setTomador] = useState<Tomador | null>(null);
  const [previa, setPrevia] = useState<{ documento: string; nome: string | null; cidade: string | null; tomador_id?: string } | null>(null);
  const [servico, setServico] = useState<ServicoCtx | null>(null);
  const [valor, setValor] = useState<number | null>(null);
  const [competencia, setCompetencia] = useState(hojeISO());
  const [entrada, setEntrada] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; notaId?: string; status?: string } | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  const bot = (texto: string) => setBaloes((b) => [...b, { de: 'bot', texto }]);
  const eu = (texto: string) => setBaloes((b) => [...b, { de: 'eu', texto }]);
  useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }); }, [baloes, passo]);

  // ── início ──
  useEffect(() => {
    (async () => {
      const r = await nfseCall<{ empresas?: EmpresaCtx[] }>('contexto');
      if (!r.success) { bot(`Não consegui abrir as Notas de Serviço: ${r.error ?? 'erro'}`); setPasso('fim'); return; }
      const lista = (r.empresas ?? []).filter((e) => e.certificado_ok);
      if (!lista.length) { bot('Nenhuma empresa com certificado válido para emitir. Cadastre em Notas de Serviço › Empresa.'); setPasso('sem_empresa'); return; }
      setEmpresas(lista);
      if (lista.length === 1) iniciarEmpresa(lista[0]);
      else { bot('Emitir nota de qual empresa?'); setPasso('empresa'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iniciarEmpresa = (e: EmpresaCtx) => {
    setEmpresa(e);
    if (e.ambiente === 'testes') bot(`⚠️ ${e.nome} está no ambiente de TESTES: a nota não terá valor fiscal.`);
    bot('Para quem é a nota? Toque num cliente ou digite o CNPJ/CPF.');
    setPasso('tomador');
  };

  // ── tomador ──
  const escolherTomador = (t: Tomador) => {
    setTomador(t);
    const e = empresa!;
    const ativos = e.servicos;
    if (ativos.length === 1) { escolherServico(ativos[0], true); return; }
    if (!ativos.length) { bot('A empresa não tem serviço cadastrado. Cadastre em Notas de Serviço › Serviços.'); setPasso('fim'); return; }
    bot('Qual serviço?');
    setPasso('servico');
  };

  const enviarTomador = async () => {
    const txt = entrada.trim();
    if (!txt) return;
    const e = empresa!;
    const doc = soDigitos(txt);
    // Nome digitado que bate com um recente
    if (doc.length < 11) {
      const achados = e.tomadores_recentes.filter((t) => t.nome.toLowerCase().includes(txt.toLowerCase()));
      eu(txt);
      setEntrada('');
      if (achados.length === 1) { escolherTomador({ id: achados[0].id, documento: achados[0].documento, nome: achados[0].nome, novo: false }); return; }
      bot(achados.length > 1 ? 'Achei mais de um. Toque no certo ou digite o CNPJ/CPF.' : 'Não achei esse cliente. Digite o CNPJ ou CPF.');
      return;
    }
    if (doc.length === 14 ? !cnpjValido(doc) : doc.length === 11 ? !cpfValido(doc) : true) { bot('CPF/CNPJ inválido. Confere e digita de novo.'); return; }
    eu(fmtDoc(doc));
    setEntrada('');
    setOcupado(true);
    const r = await nfseCall<{ cadastrado?: boolean; tomador_id?: string; nome?: string | null; cidade?: string | null }>('tomador_previa', { empresa_id: e.id, documento: doc });
    setOcupado(false);
    if (!r.success) { bot(r.error ?? 'Não consegui consultar.'); return; }
    if (r.cadastrado && r.tomador_id && r.nome) {
      bot(`${r.nome} (já cadastrado).`);
      escolherTomador({ id: r.tomador_id, documento: doc, nome: r.nome, novo: false });
      return;
    }
    if (!r.nome) {
      setPrevia({ documento: doc, nome: null, cidade: null });
      bot(doc.length === 11 ? 'Pessoa física: qual o nome completo?' : 'Não achei esse CNPJ na Receita. Qual o nome/razão social?');
      setPasso('tomador_nome');
      return;
    }
    setPrevia({ documento: doc, nome: r.nome, cidade: r.cidade ?? null });
    bot(`É ${r.nome}${r.cidade ? ` (${r.cidade})` : ''}? Novo cliente: cadastro automático ao emitir.`);
    setPasso('tomador_confirma');
  };

  // ── serviço / valor / competência ──
  const escolherServico = (s: ServicoCtx, automatico = false) => {
    setServico(s);
    if (!automatico) eu(s.nome);
    bot(s.valor_padrao != null ? `Valor? (padrão ${brl(Number(s.valor_padrao))})` : 'Qual o valor?');
    setEntrada(s.valor_padrao != null ? String(s.valor_padrao).replace('.', ',') : '');
    setPasso('valor');
  };

  const enviarValor = () => {
    const v = lerValor(entrada);
    if (!(v > 0)) { bot('Valor inválido. Ex.: 1800 ou 1.800,00'); return; }
    eu(brl(v));
    setValor(v);
    setEntrada('');
    bot('Competência (data do serviço)?');
    setPasso('competencia');
  };

  const escolherCompetencia = (iso: string) => {
    if (iso > hojeISO()) { bot('A competência não pode ser futura.'); return; }
    setCompetencia(iso);
    eu(dataBR(iso));
    mostrarResumo(iso);
  };

  const mostrarResumo = (comp: string) => {
    const e = empresa!;
    bot([
      `*Confere a nota:*`,
      `Empresa: ${e.nome}${e.ambiente === 'testes' ? ' (TESTES)' : ''}`,
      `Tomador: ${tomador!.nome} · ${fmtDoc(tomador!.documento)}${tomador!.novo ? ' (novo)' : ''}`,
      `Serviço: ${servico!.nome}`,
      `Valor: ${brl(valor ?? lerValor(entrada))}`,
      `Competência: ${dataBR(comp)}`,
    ].join('\n'));
    setPasso('confirmar');
  };

  // ── emitir ──
  const emitir = async (comBanco: boolean) => {
    const e = empresa!;
    eu(comBanco ? 'Emitir com dados bancários' : 'Emitir');
    setPasso('emitindo');
    const r = await nfseCall<{ status?: string; numero_nfse?: string | null; valor?: number; erros?: { codigo: string | null; descricao: string }[] | null; nota_id?: string; rede?: boolean }>('emitir', {
      empresa_id: e.id,
      servico_id: servico!.id,
      valor_servico: valor,
      competencia,
      incluir_dados_bancarios: comBanco,
      resposta_curta: true,
      ...(tomador!.id ? { tomador_id: tomador!.id } : { tomador_documento: tomador!.documento, tomador_nome: tomador!.nome }),
    });
    if (r.success && r.status === 'autorizada') {
      bot(`✅ NFS-e nº ${r.numero_nfse} autorizada · ${brl(Number(r.valor ?? valor))} · ${tomador!.nome}`);
      setResultado({ ok: true, notaId: r.nota_id });
    } else if ((r as { rede?: boolean }).rede || r.status === 'erro') {
      bot('⚠️ Sem resposta da Sefin Nacional. NÃO emita de novo: abra Notas de Serviço e use "Consultar de novo" na nota.');
      setResultado({ ok: false, notaId: r.nota_id, status: 'erro' });
    } else {
      const erros = r.erros?.length ? r.erros.map((x) => `${x.codigo ? `${x.codigo}: ` : ''}${x.descricao}`).join('\n') : (r.error ?? 'Rejeitada');
      bot(`❌ Nota rejeitada:\n${erros}`);
      setResultado({ ok: false, notaId: r.nota_id, status: 'rejeitada' });
    }
    setPasso('fim');
  };

  // ── render ──
  const btn = 'block w-full text-left px-3 py-2 rounded-xl border border-violet-200 bg-white text-sm text-violet-700 font-semibold hover:bg-violet-50 disabled:opacity-50 cursor-pointer';
  const negrito = (t: string) => t.split('\n').map((l, i) => (
    <span key={i} className="block">{l.startsWith('*') && l.endsWith('*') ? <b>{l.slice(1, -1)}</b> : l}</span>
  ));
  const campo = (placeholder: string, onEnviar: () => void, modo: 'text' | 'decimal' = 'text') => (
    <form onSubmit={(ev) => { ev.preventDefault(); onEnviar(); }} className="flex gap-1.5">
      <input autoFocus value={entrada} onChange={(ev) => setEntrada(ev.target.value)} placeholder={placeholder} inputMode={modo}
        className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
      <button type="submit" disabled={ocupado || !entrada.trim()} className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-40 cursor-pointer" aria-label="Enviar">
        {ocupado ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-send-plane-2-fill" />}
      </button>
    </form>
  );

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <span className="w-8 h-8 flex items-center justify-center rounded-xl bg-sky-50 text-sky-600"><i className="ri-file-text-line" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Emitir nota de serviço</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Ação rápida · sem custo de IA</p>
        </div>
        <button onClick={onFechar} disabled={passo === 'emitindo'} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 disabled:opacity-30 cursor-pointer" aria-label="Fechar">
          <i className="ri-close-line text-xl" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {baloes.map((b, i) => (
          <div key={i} className={`flex ${b.de === 'eu' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${b.de === 'eu' ? 'rounded-br-md bg-violet-600 text-white' : 'rounded-bl-md bg-white border border-zinc-200 text-zinc-800'}`}>
              {negrito(b.texto)}
            </div>
          </div>
        ))}
        {(passo === 'carregando' || passo === 'emitindo') && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white border border-zinc-200 flex items-center gap-2 text-xs text-zinc-500">
              <span className="w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              {passo === 'emitindo' ? 'Enviando à Sefin Nacional…' : 'Carregando…'}
            </div>
          </div>
        )}
        <div ref={fimRef} />
      </div>

      {/* Controles do passo atual */}
      <div className="border-t border-zinc-100 bg-white p-2.5 space-y-1.5 flex-shrink-0 max-h-[50%] overflow-y-auto">
        {passo === 'empresa' && empresas.map((e) => (
          <button key={e.id} className={btn} onClick={() => { eu(e.nome); iniciarEmpresa(e); }}>{e.nome}</button>
        ))}

        {passo === 'tomador' && (
          <>
            {empresa!.tomadores_recentes.slice(0, 6).map((t) => (
              <button key={t.id} className={btn} onClick={() => { eu(t.nome); escolherTomador({ id: t.id, documento: t.documento, nome: t.nome, novo: false }); }}>
                {t.nome} <span className="text-xs font-normal text-zinc-400">{fmtDoc(t.documento)}</span>
              </button>
            ))}
            {campo('CNPJ, CPF ou nome do cliente', enviarTomador)}
          </>
        )}

        {passo === 'tomador_confirma' && previa && (
          <>
            <button className={btn} onClick={() => { eu('Sim'); escolherTomador({ documento: previa.documento, nome: previa.nome!, novo: true }); }}>Sim, é esse</button>
            <button className={btn} onClick={() => { eu('Não'); bot('Digite o CNPJ/CPF certo.'); setPasso('tomador'); }}>Não, digitar outro</button>
          </>
        )}

        {passo === 'tomador_nome' && previa && campo('Nome / razão social', () => {
          const nome = entrada.trim();
          if (nome.length < 3) return;
          eu(nome);
          setEntrada('');
          escolherTomador({ documento: previa.documento, nome, novo: true });
        })}

        {passo === 'servico' && empresa!.servicos.map((s) => (
          <button key={s.id} className={btn} onClick={() => escolherServico(s)}>{s.nome} <span className="text-xs font-normal text-zinc-400">{s.codigo}</span></button>
        ))}

        {passo === 'valor' && campo('Valor, ex.: 1.800,00', enviarValor, 'decimal')}

        {passo === 'competencia' && (
          <>
            <button className={btn} onClick={() => escolherCompetencia(hojeISO())}>Hoje ({dataBR(hojeISO())})</button>
            <button className={btn} onClick={() => setPasso('competencia_outra')}>Outra data</button>
          </>
        )}
        {passo === 'competencia_outra' && (
          <form onSubmit={(ev) => { ev.preventDefault(); escolherCompetencia(competencia); }} className="flex gap-1.5">
            <input type="date" max={hojeISO()} value={competencia} onChange={(ev) => setCompetencia(ev.target.value)}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
            <button type="submit" className="px-4 h-10 rounded-xl bg-violet-600 text-white text-sm font-bold cursor-pointer">OK</button>
          </form>
        )}

        {passo === 'confirmar' && (
          <>
            {empresa!.tem_dados_bancarios ? (
              <>
                <button className={btn} onClick={() => emitir(true)}>Emitir com dados bancários</button>
                <button className={btn} onClick={() => emitir(false)}>Emitir sem dados bancários</button>
              </>
            ) : (
              <button className={btn} onClick={() => emitir(false)}>Emitir</button>
            )}
            <button className="block w-full text-left px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-600 font-semibold hover:bg-zinc-50 cursor-pointer" onClick={onFechar}>Não emitir</button>
          </>
        )}

        {(passo === 'fim' || passo === 'sem_empresa') && (
          <>
            {resultado && <button className={btn} onClick={onAbrirNotas}>{resultado.ok ? 'Abrir a nota (PDF)' : 'Abrir Notas de Serviço'}</button>}
            <button className="block w-full text-left px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-600 font-semibold hover:bg-zinc-50 cursor-pointer" onClick={onFechar}>Fechar</button>
          </>
        )}
      </div>
    </div>
  );
}
