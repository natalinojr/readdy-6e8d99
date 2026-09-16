// Cadastros do módulo NFS-e: tomadores (clientes da nota) e serviços prestados.
// Gravação direta nas tabelas (RLS: membro da empresa; serviço só admin).
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { avisar, confirmar } from '@/pages/contratacao/dialog';
import {
  type Empresa, type Servico, type Tomador, buscarCep, buscarCnpj, cnpjValido, cpfValido, fmtBRL, fmtCep, fmtDoc, inputCls, labelCls, nfseCall, soDigitos,
} from '../api';

function Modal({ titulo, onClose, children, rodape }: { titulo: string; onClose: () => void; children: React.ReactNode; rodape: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-zinc-100 flex-shrink-0">
          <h3 className="text-base font-bold text-zinc-900">{titulo}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 cursor-pointer"><i className="ri-close-line text-xl" /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end gap-2 flex-shrink-0">{rodape}</div>
      </div>
    </div>
  );
}
export { Modal };

// ─── Tomadores ───────────────────────────────────────────────────────────────
type TomadorForm = Omit<Tomador, 'id' | 'empresa_id'> & { id?: string };
const tomadorVazio: TomadorForm = {
  documento: '', nome: '', inscricao_municipal: '', email: '', fone: '', cep: '', cod_municipio: '', municipio_nome: '', uf: '',
  logradouro: '', numero: '', complemento: '', bairro: '',
};

export function TomadorModal({ empresa, inicial, documentoInicial, onClose, onSalvo }: {
  empresa: Empresa; inicial: Tomador | null; documentoInicial?: string; onClose: () => void; onSalvo: (t: Tomador) => void;
}) {
  const [f, setF] = useState<TomadorForm>(inicial
    ? { ...inicial, documento: fmtDoc(inicial.documento), cep: fmtCep(inicial.cep) }
    : { ...tomadorVazio, documento: fmtDoc(documentoInicial ?? '') });
  const [salvando, setSalvando] = useState(false);
  const [consultaCnpj, setConsultaCnpj] = useState<string | null>(null);
  const set = <K extends keyof TomadorForm>(k: K, v: TomadorForm[K]) => setF((p) => ({ ...p, [k]: v }));

  // CNPJ válido digitado → preenche com os dados públicos da Receita (só os campos vazios; não apaga o que foi digitado).
  const consultarCnpj = async (doc: string) => {
    const d = soDigitos(doc);
    if (d.length !== 14 || !cnpjValido(d)) { setConsultaCnpj(null); return; }
    setConsultaCnpj('Buscando dados do CNPJ…');
    const r = await buscarCnpj(d);
    if (!r) { setConsultaCnpj('Não achei os dados deste CNPJ. Preencha à mão.'); return; }
    const vazio = (v: string | null | undefined) => !v || !String(v).trim();
    setF((p) => ({
      ...p,
      nome: vazio(p.nome) ? r.nome : p.nome,
      email: vazio(p.email) ? r.email ?? '' : p.email,
      fone: vazio(p.fone) ? r.fone ?? '' : p.fone,
      ...(vazio(p.cep) && r.cep ? {
        cep: fmtCep(r.cep), logradouro: r.logradouro, numero: r.numero, complemento: r.complemento, bairro: r.bairro,
        municipio_nome: r.municipio_nome, uf: r.uf, cod_municipio: r.cod_municipio ?? '',
      } : {}),
    }));
    setConsultaCnpj('Dados preenchidos pela Receita. Confira antes de salvar.');
  };
  useEffect(() => { if (!inicial && documentoInicial) consultarCnpj(documentoInicial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const aoCep = async (cep: string) => {
    set('cep', cep);
    const r = await buscarCep(cep);
    if (r) setF((p) => ({ ...p, logradouro: r.logradouro || p.logradouro, bairro: r.bairro || p.bairro, municipio_nome: r.municipio_nome, uf: r.uf, cod_municipio: r.cod_municipio }));
  };

  const salvar = async () => {
    const doc = soDigitos(f.documento);
    if (doc.length === 14 ? !cnpjValido(doc) : doc.length === 11 ? !cpfValido(doc) : true) { avisar('CPF ou CNPJ inválido.'); return; }
    if (!f.nome.trim()) { avisar('Informe o nome ou razão social.'); return; }
    const cep = soDigitos(f.cep);
    const row = {
      empresa_id: empresa.id,
      documento: doc,
      nome: f.nome.trim(),
      inscricao_municipal: f.inscricao_municipal?.trim() || null,
      email: f.email?.trim() || null,
      fone: soDigitos(f.fone) || null,
      cep: cep || null,
      cod_municipio: cep ? (f.cod_municipio || null) : null,
      municipio_nome: cep ? (f.municipio_nome || null) : null,
      uf: cep ? (f.uf || null) : null,
      logradouro: f.logradouro?.trim() || null,
      numero: f.numero?.trim() || null,
      complemento: f.complemento?.trim() || null,
      bairro: f.bairro?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    setSalvando(true);
    const q = inicial
      ? supabase.from('nfse_tomadores').update(row).eq('id', inicial.id).select('*').single()
      : supabase.from('nfse_tomadores').insert(row).select('*').single();
    const { data, error } = await q;
    setSalvando(false);
    if (error) { avisar(error.code === '23505' ? 'Já existe um tomador com este CPF/CNPJ.' : error.message); return; }
    onSalvo(data as Tomador);
  };

  return (
    <Modal titulo={inicial ? 'Editar tomador' : 'Novo tomador'} onClose={onClose}
      rodape={<>
        <button onClick={onClose} className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">Cancelar</button>
        <button onClick={salvar} disabled={salvando} className="px-5 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div className="md:col-span-2">
          <label className={labelCls}>CPF ou CNPJ</label>
          <input className={inputCls} value={f.documento}
            onChange={(e) => { set('documento', e.target.value); if (soDigitos(e.target.value).length === 14) consultarCnpj(e.target.value); }}
            onBlur={(e) => { set('documento', fmtDoc(e.target.value)); if (!f.nome.trim()) consultarCnpj(e.target.value); }} />
          {consultaCnpj && <p className="text-[11px] text-zinc-400 mt-0.5">{consultaCnpj}</p>}
        </div>
        <div className="md:col-span-4">
          <label className={labelCls}>Nome / razão social</label>
          <input className={inputCls} value={f.nome} onChange={(e) => set('nome', e.target.value)} />
        </div>
        <div className="md:col-span-3">
          <label className={labelCls}>E-mail <span className="font-normal text-zinc-400">opcional</span></label>
          <input className={inputCls} value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div className="md:col-span-3">
          <label className={labelCls}>Telefone <span className="font-normal text-zinc-400">opcional</span></label>
          <input className={inputCls} value={f.fone ?? ''} onChange={(e) => set('fone', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Inscrição municipal <span className="font-normal text-zinc-400">opcional</span></label>
          <input className={inputCls} value={f.inscricao_municipal ?? ''} onChange={(e) => set('inscricao_municipal', e.target.value)} />
        </div>
        <div className="md:col-span-4 pt-2">
          <p className="text-xs text-zinc-400">Endereço é opcional, mas alguns serviços exigem (o imposto vai para a cidade do tomador).</p>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>CEP</label>
          <input className={inputCls} value={f.cep ?? ''} onChange={(e) => aoCep(e.target.value)} />
        </div>
        <div className="md:col-span-3">
          <label className={labelCls}>Logradouro</label>
          <input className={inputCls} value={f.logradouro ?? ''} onChange={(e) => set('logradouro', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Número</label>
          <input className={inputCls} value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Complemento</label>
          <input className={inputCls} value={f.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Bairro</label>
          <input className={inputCls} value={f.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Município</label>
          <input className={inputCls} disabled value={f.municipio_nome ? `${f.municipio_nome} / ${f.uf}` : ''} placeholder="pelo CEP" />
        </div>
      </div>
    </Modal>
  );
}

export function TomadoresTab({ empresa, tomadores, onChange }: { empresa: Empresa; tomadores: Tomador[]; onChange: () => void }) {
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<Tomador | 'novo' | null>(null);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = soDigitos(q);
    return tomadores.filter((t) => !q || t.nome.toLowerCase().includes(q) || (qd && t.documento.includes(qd)));
  }, [tomadores, busca]);

  const excluir = async (t: Tomador) => {
    if (!(await confirmar({ titulo: 'Excluir tomador?', mensagem: `${t.nome} sai da lista. As notas já emitidas não mudam.`, perigo: true, confirmarLabel: 'Excluir' }))) return;
    const { error } = await supabase.from('nfse_tomadores').delete().eq('id', t.id);
    if (error) { avisar(error.message); return; }
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <input className={inputCls} placeholder="Buscar por nome ou CPF/CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button onClick={() => setEditando('novo')} className="px-4 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold cursor-pointer whitespace-nowrap">
          <i className="ri-add-line mr-1" />Novo tomador
        </button>
      </div>
      <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
        {lista.length === 0 && <p className="text-sm text-zinc-400 px-4 py-6 text-center">Nenhum tomador cadastrado.</p>}
        {lista.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-800 truncate">{t.nome}</p>
              <p className="text-xs text-zinc-400 truncate">{fmtDoc(t.documento)}{t.municipio_nome ? ` · ${t.municipio_nome}/${t.uf}` : ''}{t.email ? ` · ${t.email}` : ''}</p>
            </div>
            <button onClick={() => setEditando(t)} className="text-zinc-400 hover:text-sky-600 cursor-pointer" title="Editar"><i className="ri-pencil-line text-lg" /></button>
            <button onClick={() => excluir(t)} className="text-zinc-400 hover:text-red-600 cursor-pointer" title="Excluir"><i className="ri-delete-bin-line text-lg" /></button>
          </div>
        ))}
      </div>
      {editando && (
        <TomadorModal empresa={empresa} inicial={editando === 'novo' ? null : editando} onClose={() => setEditando(null)}
          onSalvo={() => { setEditando(null); onChange(); }} />
      )}
    </div>
  );
}

// ─── Serviços ────────────────────────────────────────────────────────────────
type ItemLista = [string, string, string]; // código, subitem LC 116, descrição
type ItemNbs = [string, string];

export function useListasOficiais() {
  const [servicos, setServicos] = useState<ItemLista[]>([]);
  const [nbs, setNbs] = useState<ItemNbs[]>([]);
  useEffect(() => {
    import('../listaServicos.json').then((m) => setServicos(m.default as ItemLista[]));
    import('../listaNbs.json').then((m) => setNbs(m.default as ItemNbs[]));
  }, []);
  return { servicos, nbs };
}

function BuscaCodigo<T extends string[]>({ label, valor, itens, onEscolher, render, placeholder }: {
  label: string; valor: string; itens: T[]; onEscolher: (item: T) => void; render: (item: T) => string; placeholder: string;
}) {
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const atual = itens.find((i) => i[0] === valor);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return itens.slice(0, 40);
    const d = soDigitos(t);
    return itens.filter((i) => (d && i[0].includes(d)) || render(i).toLowerCase().includes(t)).slice(0, 40);
  }, [q, itens, render]);
  return (
    <div className="relative">
      <label className={labelCls}>{label}</label>
      <input className={inputCls} placeholder={placeholder} value={aberto ? q : atual ? render(atual) : valor}
        onFocus={() => { setAberto(true); setQ(''); }} onBlur={() => setTimeout(() => setAberto(false), 150)} onChange={(e) => setQ(e.target.value)} />
      {aberto && (
        <div className="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-zinc-200 rounded-xl shadow-lg">
          {filtrados.map((i) => (
            <button key={i[0]} type="button" onMouseDown={() => { onEscolher(i); setAberto(false); }}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-sky-50 cursor-pointer">
              {render(i)}
            </button>
          ))}
          {filtrados.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">Nada encontrado.</p>}
        </div>
      )}
    </div>
  );
}

type ServicoForm = { nome: string; c_trib_nac: string; c_trib_mun: string; c_nbs: string; descricao: string; aliquota_iss: string; valor_padrao: string; ativo: boolean };

export function ServicoModal({ empresa, inicial, onClose, onSalvo }: { empresa: Empresa; inicial: Servico | null; onClose: () => void; onSalvo: () => void }) {
  const { servicos, nbs } = useListasOficiais();
  const [f, setF] = useState<ServicoForm>(inicial ? {
    nome: inicial.nome, c_trib_nac: inicial.c_trib_nac, c_trib_mun: inicial.c_trib_mun ?? '', c_nbs: inicial.c_nbs ?? '', descricao: inicial.descricao,
    aliquota_iss: inicial.aliquota_iss != null ? String(inicial.aliquota_iss) : '', valor_padrao: inicial.valor_padrao != null ? String(inicial.valor_padrao) : '', ativo: inicial.ativo,
  } : { nome: '', c_trib_nac: '', c_trib_mun: '', c_nbs: '', descricao: '', aliquota_iss: '', valor_padrao: '', ativo: true });
  const [salvando, setSalvando] = useState(false);
  const [consulta, setConsulta] = useState<string | null>(null);
  const set = <K extends keyof ServicoForm>(k: K, v: ServicoForm[K]) => setF((p) => ({ ...p, [k]: v }));

  const consultarMunicipio = async () => {
    if (!/^\d{6}$/.test(f.c_trib_nac)) { avisar('Escolha primeiro o código de tributação nacional.'); return; }
    setConsulta('Consultando a prefeitura na Sefin Nacional…');
    const r = await nfseCall<{ http?: number; data?: unknown; erros?: { descricao: string }[] | null }>('parametros_servico', { empresa_id: empresa.id, c_trib_nac: f.c_trib_nac });
    if (!r.success) { setConsulta(r.error ?? 'Falha na consulta'); return; }
    if (r.erros?.length) { setConsulta(r.erros[0].descricao); return; }
    const d = r.data as Record<string, unknown> | null;
    const txt = JSON.stringify(d ?? {});
    const aliq = txt.match(/"aliq[^"]*"\s*:\s*([\d.]+)/i)?.[1];
    setConsulta(aliq ? `Alíquota do município para este serviço: ${aliq}%` : `Resposta do município: ${txt.slice(0, 400)}`);
    if (aliq && !f.aliquota_iss) set('aliquota_iss', aliq);
  };

  const salvar = async () => {
    if (!f.nome.trim()) { avisar('Dê um nome curto para o serviço (ex.: Projeto elétrico).'); return; }
    if (!/^\d{6}$/.test(f.c_trib_nac)) { avisar('Escolha o código de tributação nacional.'); return; }
    if (f.c_trib_mun && !/^\d{3}$/.test(f.c_trib_mun)) { avisar('Código municipal deve ter 3 dígitos.'); return; }
    if (!f.descricao.trim()) { avisar('Escreva a descrição que vai na nota.'); return; }
    const row = {
      empresa_id: empresa.id, nome: f.nome.trim(), c_trib_nac: f.c_trib_nac, c_trib_mun: f.c_trib_mun || null, c_nbs: f.c_nbs || null,
      descricao: f.descricao.trim(), aliquota_iss: f.aliquota_iss === '' ? null : Number(f.aliquota_iss),
      valor_padrao: f.valor_padrao === '' ? null : Number(f.valor_padrao), ativo: f.ativo, updated_at: new Date().toISOString(),
    };
    setSalvando(true);
    const { error } = inicial
      ? await supabase.from('nfse_servicos').update(row).eq('id', inicial.id)
      : await supabase.from('nfse_servicos').insert(row);
    setSalvando(false);
    if (error) { avisar(error.message); return; }
    onSalvo();
  };

  return (
    <Modal titulo={inicial ? 'Editar serviço' : 'Novo serviço'} onClose={onClose}
      rodape={<>
        <button onClick={onClose} className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">Cancelar</button>
        <button onClick={salvar} disabled={salvando} className="px-5 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div className="md:col-span-6">
          <label className={labelCls}>Nome (para você achar na hora de emitir)</label>
          <input className={inputCls} value={f.nome} onChange={(e) => set('nome', e.target.value)} placeholder="ex.: Projeto elétrico residencial" />
        </div>
        <div className="md:col-span-6">
          <BuscaCodigo label="Código de tributação nacional (lista de serviços)" valor={f.c_trib_nac} itens={servicos}
            render={(i) => `${i[0]} · ${i[1]} ${i[2]}`} placeholder="Digite parte da descrição ou o código"
            onEscolher={(i) => { set('c_trib_nac', i[0]); if (!f.descricao) set('descricao', i[2]); }} />
        </div>
        <div className="md:col-span-4">
          <BuscaCodigo label="Código NBS (opcional)" valor={f.c_nbs} itens={nbs} render={(i) => `${i[0]} · ${i[1]}`}
            placeholder="Nomenclatura Brasileira de Serviços" onEscolher={(i) => set('c_nbs', i[0])} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Código municipal <span className="font-normal text-zinc-400">opcional</span></label>
          <input className={inputCls} value={f.c_trib_mun} maxLength={3} onChange={(e) => set('c_trib_mun', soDigitos(e.target.value))} placeholder="3 dígitos" />
        </div>
        <div className="md:col-span-6">
          <label className={labelCls}>Descrição que vai na nota</label>
          <textarea className={`${inputCls} h-24 py-2`} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} maxLength={2000} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Alíquota ISS (%) <span className="font-normal text-zinc-400">opcional</span></label>
          <input className={inputCls} type="number" step="0.01" min={0} max={5} value={f.aliquota_iss} onChange={(e) => set('aliquota_iss', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Valor padrão <span className="font-normal text-zinc-400">opcional</span></label>
          <input className={inputCls} type="number" step="0.01" min={0} value={f.valor_padrao} onChange={(e) => set('valor_padrao', e.target.value)} />
        </div>
        <div className="md:col-span-2 flex items-end">
          <label className="flex items-center gap-2 text-sm text-zinc-700 h-10 cursor-pointer">
            <input type="checkbox" checked={f.ativo} onChange={(e) => set('ativo', e.target.checked)} /> Ativo
          </label>
        </div>
        <div className="md:col-span-6">
          <button type="button" onClick={consultarMunicipio} disabled={!empresa.cert_validade}
            className="text-xs font-bold text-sky-700 hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline">
            <i className="ri-government-line mr-1" />Consultar a regra do município para este código
          </button>
          {consulta && <p className="text-xs text-zinc-500 mt-1 break-words">{consulta}</p>}
          <p className="text-[11px] text-zinc-400 mt-1">Empresa do Simples que apura o ISS pelo Simples normalmente deixa a alíquota em branco. Na dúvida, pergunte ao contador.</p>
        </div>
      </div>
    </Modal>
  );
}

export function ServicosTab({ empresa, servicos, souAdmin, onChange }: { empresa: Empresa; servicos: Servico[]; souAdmin: boolean; onChange: () => void }) {
  const [editando, setEditando] = useState<Servico | 'novo' | null>(null);
  const excluir = async (s: Servico) => {
    if (!(await confirmar({ titulo: 'Excluir serviço?', mensagem: `"${s.nome}" sai da lista. As notas já emitidas não mudam.`, perigo: true, confirmarLabel: 'Excluir' }))) return;
    const { error } = await supabase.from('nfse_servicos').delete().eq('id', s.id);
    if (error) { avisar(error.message); return; }
    onChange();
  };
  return (
    <div className="space-y-3">
      {souAdmin && (
        <div className="flex justify-end">
          <button onClick={() => setEditando('novo')} className="px-4 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold cursor-pointer">
            <i className="ri-add-line mr-1" />Novo serviço
          </button>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
        {servicos.length === 0 && <p className="text-sm text-zinc-400 px-4 py-6 text-center">Cadastre os serviços que a empresa costuma prestar.</p>}
        {servicos.map((s) => (
          <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.ativo ? '' : 'opacity-50'}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-800 truncate">{s.nome}{!s.ativo && ' (inativo)'}</p>
              <p className="text-xs text-zinc-400 truncate">
                Código {s.c_trib_nac}{s.aliquota_iss != null ? ` · ISS ${s.aliquota_iss}%` : ''}{s.valor_padrao != null ? ` · ${fmtBRL(s.valor_padrao)}` : ''}
              </p>
            </div>
            {souAdmin && (
              <>
                <button onClick={() => setEditando(s)} className="text-zinc-400 hover:text-sky-600 cursor-pointer" title="Editar"><i className="ri-pencil-line text-lg" /></button>
                <button onClick={() => excluir(s)} className="text-zinc-400 hover:text-red-600 cursor-pointer" title="Excluir"><i className="ri-delete-bin-line text-lg" /></button>
              </>
            )}
          </div>
        ))}
      </div>
      {editando && (
        <ServicoModal empresa={empresa} inicial={editando === 'novo' ? null : editando} onClose={() => setEditando(null)}
          onSalvo={() => { setEditando(null); onChange(); }} />
      )}
    </div>
  );
}
