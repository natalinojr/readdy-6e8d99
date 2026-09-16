// Empresa emitente: dados cadastrais e tributários, certificado A1, teste de conexão e membros.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { avisar, confirmar } from '@/pages/contratacao/dialog';
import {
  type Empresa, type Membro, NOME_ARQUIVO_CAMPOS, NOME_ARQUIVO_PADRAO, nomeArquivoNota, buscarCep, cnpjValido, fmtCep, fmtData, fmtDoc, inputCls, labelCls, lerArquivoBase64, nfseCall, soDigitos,
} from '../api';

type Form = {
  cnpj: string; razao_social: string; nome_fantasia: string; inscricao_municipal: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string;
  municipio_nome: string; uf: string; cod_municipio: string; fone: string; email: string;
  op_simp_nac: number; reg_ap_trib_sn: number; reg_esp_trib: number; ambiente: number; serie: number; aliquota_simples: string; nome_arquivo_modelo: string; dados_bancarios: string;
};

const vazio: Form = {
  cnpj: '', razao_social: '', nome_fantasia: '', inscricao_municipal: '', cep: '', logradouro: '', numero: '', complemento: '',
  bairro: '', municipio_nome: '', uf: '', cod_municipio: '', fone: '', email: '',
  op_simp_nac: 3, reg_ap_trib_sn: 1, reg_esp_trib: 0, ambiente: 2, serie: 1, aliquota_simples: '', nome_arquivo_modelo: NOME_ARQUIVO_PADRAO, dados_bancarios: '',
};

const deEmpresa = (e: Empresa): Form => ({
  cnpj: fmtDoc(e.cnpj), razao_social: e.razao_social, nome_fantasia: e.nome_fantasia ?? '', inscricao_municipal: e.inscricao_municipal ?? '',
  cep: fmtCep(e.cep), logradouro: e.logradouro ?? '', numero: e.numero ?? '', complemento: e.complemento ?? '', bairro: e.bairro ?? '',
  municipio_nome: e.municipio_nome ?? '', uf: e.uf ?? '', cod_municipio: e.cod_municipio, fone: e.fone ?? '', email: e.email ?? '',
  op_simp_nac: e.op_simp_nac, reg_ap_trib_sn: e.reg_ap_trib_sn ?? 1, reg_esp_trib: e.reg_esp_trib, ambiente: e.ambiente, serie: e.serie,
  aliquota_simples: e.aliquota_simples != null ? String(e.aliquota_simples) : '',
  nome_arquivo_modelo: e.nome_arquivo_modelo || NOME_ARQUIVO_PADRAO,
  dados_bancarios: e.dados_bancarios ?? '',
});

function Secao({ titulo, desc, children }: { titulo: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-5">
      <h3 className="text-sm font-bold text-zinc-800">{titulo}</h3>
      {desc && <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

interface Props {
  empresa: Empresa | null; // null = cadastro novo
  souAdmin: boolean;
  onSalva: (id: string) => void;
}

export default function EmpresaTab({ empresa, souAdmin, onSalva }: Props) {
  const [f, setF] = useState<Form>(empresa ? deEmpresa(empresa) : vazio);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const editavel = !empresa || souAdmin;

  useEffect(() => { setF(empresa ? deEmpresa(empresa) : vazio); }, [empresa]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const aoCep = async (cep: string) => {
    set('cep', cep);
    if (soDigitos(cep).length !== 8) return;
    setBuscandoCep(true);
    const r = await buscarCep(cep);
    setBuscandoCep(false);
    if (r) setF((p) => ({ ...p, logradouro: r.logradouro || p.logradouro, bairro: r.bairro || p.bairro, municipio_nome: r.municipio_nome, uf: r.uf, cod_municipio: r.cod_municipio }));
  };

  const salvar = async () => {
    const cnpj = soDigitos(f.cnpj);
    if (!cnpjValido(cnpj)) { avisar('CNPJ inválido.'); return; }
    if (!f.razao_social.trim()) { avisar('Informe a razão social.'); return; }
    if (!/^\d{7}$/.test(f.cod_municipio)) { avisar('Preencha o CEP para identificarmos o município (código IBGE).'); return; }
    if (empresa && f.ambiente === 1 && empresa.ambiente === 2) {
      const ok = await confirmar({
        titulo: 'Passar para produção?',
        mensagem: 'A partir de agora as notas emitidas terão valor fiscal e o ISS será devido. Faça isso só depois de testar a emissão no ambiente de testes.',
        confirmarLabel: 'Sim, produção', perigo: true,
      });
      if (!ok) return;
    }
    setSalvando(true);
    const r = await nfseCall<{ data?: { id: string } }>(empresa ? 'salvar_empresa' : 'criar_empresa', {
      empresa_id: empresa?.id, dados: { ...f, cnpj },
    });
    setSalvando(false);
    if (!r.success) { avisar(r.error ?? 'Não foi possível salvar.'); return; }
    onSalva(empresa?.id ?? r.data!.id);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {!empresa && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <p className="font-bold">Antes de começar</p>
          <ul className="list-disc pl-5 mt-1 text-xs space-y-0.5">
            <li>O município da empresa precisa emitir pelo padrão nacional (a maioria já emite desde 2026).</li>
            <li>Você vai precisar do certificado digital <b>A1</b> da empresa (arquivo .pfx ou .p12) e da senha dele.</li>
            <li>A empresa começa no <b>ambiente de testes</b>: as notas não têm valor fiscal até você mudar para produção.</li>
          </ul>
        </div>
      )}

      <Secao titulo="Dados da empresa">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className={labelCls}>CNPJ</label>
            <input className={inputCls} value={f.cnpj} disabled={!editavel} onChange={(e) => set('cnpj', e.target.value)}
              onBlur={(e) => set('cnpj', fmtDoc(e.target.value))} placeholder="00.000.000/0000-00" />
          </div>
          <div className="md:col-span-4">
            <label className={labelCls}>Razão social</label>
            <input className={inputCls} value={f.razao_social} disabled={!editavel} onChange={(e) => set('razao_social', e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>Nome fantasia <span className="font-normal text-zinc-400">opcional</span></label>
            <input className={inputCls} value={f.nome_fantasia} disabled={!editavel} onChange={(e) => set('nome_fantasia', e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>Inscrição municipal <span className="font-normal text-zinc-400">se a prefeitura exigir</span></label>
            <input className={inputCls} value={f.inscricao_municipal} disabled={!editavel} onChange={(e) => set('inscricao_municipal', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>CEP {buscandoCep && <span className="font-normal text-zinc-400">buscando…</span>}</label>
            <input className={inputCls} value={f.cep} disabled={!editavel} onChange={(e) => aoCep(e.target.value)} placeholder="00000-000" />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>Logradouro</label>
            <input className={inputCls} value={f.logradouro} disabled={!editavel} onChange={(e) => set('logradouro', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Número</label>
            <input className={inputCls} value={f.numero} disabled={!editavel} onChange={(e) => set('numero', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Complemento</label>
            <input className={inputCls} value={f.complemento} disabled={!editavel} onChange={(e) => set('complemento', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Bairro</label>
            <input className={inputCls} value={f.bairro} disabled={!editavel} onChange={(e) => set('bairro', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Município</label>
            <input className={inputCls} value={f.municipio_nome ? `${f.municipio_nome} / ${f.uf}` : ''} disabled placeholder="pelo CEP" />
            {f.cod_municipio && <p className="text-[11px] text-zinc-400 mt-0.5">Código IBGE {f.cod_municipio}</p>}
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>E-mail <span className="font-normal text-zinc-400">opcional</span></label>
            <input className={inputCls} value={f.email} disabled={!editavel} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>Telefone <span className="font-normal text-zinc-400">opcional</span></label>
            <input className={inputCls} value={f.fone} disabled={!editavel} onChange={(e) => set('fone', e.target.value)} />
          </div>
        </div>
      </Secao>

      <Secao titulo="Tributação" desc="Confirme com o contador. Se a situação no Simples não bater com a Receita, a nota é rejeitada.">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-3">
            <label className={labelCls}>Situação no Simples Nacional</label>
            <select className={inputCls} value={f.op_simp_nac} disabled={!editavel} onChange={(e) => set('op_simp_nac', Number(e.target.value))}>
              <option value={3}>Optante — Microempresa ou EPP (ME/EPP)</option>
              <option value={2}>Optante — MEI</option>
              <option value={1}>Não optante (Lucro Presumido/Real)</option>
            </select>
          </div>
          {f.op_simp_nac === 3 && (
            <>
              <div className="md:col-span-3">
                <label className={labelCls}>Como apura os tributos</label>
                <select className={inputCls} value={f.reg_ap_trib_sn} disabled={!editavel} onChange={(e) => set('reg_ap_trib_sn', Number(e.target.value))}>
                  <option value={1}>Federais e ISS pelo Simples (mais comum)</option>
                  <option value={2}>Federais pelo Simples e ISS por fora</option>
                  <option value={3}>Federais e ISS por fora do Simples</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Alíquota do Simples (%) <span className="font-normal text-zinc-400">opcional</span></label>
                <input className={inputCls} type="number" step="0.01" min={0} max={99} value={f.aliquota_simples} disabled={!editavel}
                  onChange={(e) => set('aliquota_simples', e.target.value)} placeholder="em branco = não informar" />
                <p className="text-[11px] text-zinc-400 mt-0.5">Só informativo (total aproximado de tributos). Pode deixar em branco.</p>
              </div>
            </>
          )}
          <div className="md:col-span-2">
            <label className={labelCls}>Regime especial</label>
            <select className={inputCls} value={f.reg_esp_trib} disabled={!editavel} onChange={(e) => set('reg_esp_trib', Number(e.target.value))}>
              <option value={0}>Nenhum</option>
              <option value={1}>Ato cooperado</option>
              <option value={2}>Estimativa</option>
              <option value={3}>Microempresa municipal</option>
              <option value={4}>Notário ou registrador</option>
              <option value={5}>Profissional autônomo</option>
              <option value={6}>Sociedade de profissionais</option>
              <option value={9}>Outros</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Série da DPS</label>
            <input className={inputCls} type="number" min={1} max={49999} value={f.serie} disabled={!editavel} onChange={(e) => set('serie', Number(e.target.value))} />
          </div>
        </div>
      </Secao>

      <Secao titulo="Dados bancários" desc="Texto que pode ser incluído nas informações complementares da nota, com um clique na hora de emitir.">
        <textarea className={`${inputCls} h-24 py-2`} maxLength={500} value={f.dados_bancarios} disabled={!editavel}
          onChange={(e) => set('dados_bancarios', e.target.value)}
          placeholder={'ex.: Banco Inter (077) · Ag. 0001 · C/C 12345678-9 · PIX: 19.831.665/0001-75'} />
      </Secao>

      <Secao titulo="Nome dos arquivos" desc="Nome sugerido ao salvar o PDF (DANFSe) e ao baixar o XML de cada nota.">
        <label className={labelCls}>Modelo</label>
        <input className={inputCls} value={f.nome_arquivo_modelo} disabled={!editavel} maxLength={200}
          onChange={(e) => set('nome_arquivo_modelo', e.target.value)} />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {NOME_ARQUIVO_CAMPOS.map((c) => (
            <button key={c.campo} type="button" disabled={!editavel} title={c.desc}
              onClick={() => set('nome_arquivo_modelo', `${f.nome_arquivo_modelo}${f.nome_arquivo_modelo.endsWith(' ') || !f.nome_arquivo_modelo ? '' : ' '}${c.campo}`)}
              className="px-2 h-7 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-[11px] font-mono text-zinc-700 cursor-pointer disabled:cursor-default">
              {c.campo}
            </button>
          ))}
          {f.nome_arquivo_modelo !== NOME_ARQUIVO_PADRAO && editavel && (
            <button type="button" onClick={() => set('nome_arquivo_modelo', NOME_ARQUIVO_PADRAO)} className="px-2 h-7 text-[11px] font-bold text-sky-700 hover:underline cursor-pointer">
              voltar ao padrão
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-3">
          Exemplo: <b className="text-zinc-800">{nomeArquivoNota(
            { razao_social: f.razao_social || 'IDEAR PROJETOS COMPLEMENTARES LTDA', nome_fantasia: f.nome_fantasia || null, nome_arquivo_modelo: f.nome_arquivo_modelo },
            { numero_nfse: '36', numero_dps: 36, tomador: { nome: 'GDS 16 EMPREENDIMENTOS IMOBILIARIOS LTDA', documento: '53729270000102' },
              valor_servico: 12000, desconto_incondicionado: null, dh_processamento: '2026-09-01T18:38:46Z', dh_emissao: '2026-09-01T18:38:46Z', competencia: '2026-09-01' },
          )}.pdf</b>
        </p>
      </Secao>

      <Secao titulo="Ambiente">
        <div className="flex flex-col sm:flex-row gap-2">
          {[{ v: 2, t: 'Testes (produção restrita)', d: 'Sem valor fiscal. Use para conferir tudo antes.' }, { v: 1, t: 'Produção', d: 'Notas reais, com valor fiscal.' }].map((o) => (
            <button key={o.v} type="button" disabled={!editavel} onClick={() => set('ambiente', o.v)}
              className={`flex-1 text-left rounded-xl border px-4 py-3 cursor-pointer disabled:cursor-default ${f.ambiente === o.v ? (o.v === 1 ? 'border-emerald-400 bg-emerald-50' : 'border-sky-400 bg-sky-50') : 'border-zinc-200 bg-white'}`}>
              <p className="text-sm font-bold text-zinc-800">{o.t}</p>
              <p className="text-xs text-zinc-500">{o.d}</p>
            </button>
          ))}
        </div>
      </Secao>

      {editavel && (
        <div className="flex justify-end">
          <button onClick={salvar} disabled={salvando}
            className="px-5 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">
            {salvando ? 'Salvando…' : empresa ? 'Salvar alterações' : 'Cadastrar empresa'}
          </button>
        </div>
      )}

      {empresa && <Certificado empresa={empresa} souAdmin={souAdmin} onSalvo={() => onSalva(empresa.id)} />}
      {empresa && <Membros empresa={empresa} souAdmin={souAdmin} />}
    </div>
  );
}

function Certificado({ empresa, souAdmin, onSalvo }: { empresa: Empresa; souAdmin: boolean; onSalvo: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; msg: string } | null>(null);

  const vencido = empresa.cert_validade ? new Date(empresa.cert_validade).getTime() < Date.now() : false;
  const diasRestantes = empresa.cert_validade ? Math.ceil((new Date(empresa.cert_validade).getTime() - Date.now()) / 86_400_000) : null;

  const enviar = async () => {
    if (!arquivo) { avisar('Escolha o arquivo do certificado (.pfx ou .p12).'); return; }
    setEnviando(true);
    try {
      const pfx = await lerArquivoBase64(arquivo);
      const r = await nfseCall('salvar_certificado', { empresa_id: empresa.id, pfx_b64: pfx, senha });
      if (!r.success) { avisar(r.error ?? 'Não foi possível salvar o certificado.'); return; }
      setArquivo(null);
      setSenha('');
      if (fileRef.current) fileRef.current.value = '';
      onSalvo();
    } finally {
      setEnviando(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    setTeste(null);
    const r = await nfseCall<{ http?: number; data?: unknown; erros?: { descricao: string }[] | null }>('testar_conexao', { empresa_id: empresa.id });
    setTestando(false);
    if (!r.success) { setTeste({ ok: false, msg: r.error ?? 'Falha na conexão' }); return; }
    if (r.http && r.http >= 400) {
      setTeste({ ok: true, msg: `Certificado aceito pela Sefin Nacional. Consulta do município respondeu: ${r.erros?.[0]?.descricao ?? `HTTP ${r.http}`}` });
      return;
    }
    setTeste({ ok: true, msg: 'Certificado aceito e município conveniado ao padrão nacional.' });
  };

  return (
    <Secao titulo="Certificado digital A1"
      desc="Usado para assinar as notas e se identificar na Sefin Nacional. Fica guardado criptografado; ninguém consegue baixar de volta.">
      {empresa.cert_validade ? (
        <div className={`rounded-xl border px-4 py-3 text-sm mb-4 ${vencido ? 'border-red-200 bg-red-50 text-red-800' : diasRestantes != null && diasRestantes <= 30 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          <p className="font-bold">{empresa.cert_titular}{empresa.cert_documento ? ` — ${fmtDoc(empresa.cert_documento)}` : ''}</p>
          <p className="text-xs mt-0.5">
            {vencido ? `Vencido em ${fmtData(empresa.cert_validade)}. Envie o certificado renovado.` : `Válido até ${fmtData(empresa.cert_validade)} (${diasRestantes} dias).`}
          </p>
        </div>
      ) : (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">Nenhum certificado cadastrado. Sem ele não é possível emitir.</p>
      )}

      {souAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-3">
            <label className={labelCls}>{empresa.cert_validade ? 'Trocar certificado' : 'Arquivo do certificado'} (.pfx / .p12)</label>
            <input ref={fileRef} type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-zinc-600 file:mr-3 file:h-10 file:px-4 file:rounded-xl file:border-0 file:bg-zinc-100 file:text-zinc-700 file:font-semibold file:cursor-pointer" />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Senha do certificado</label>
            <input className={inputCls} type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <button onClick={enviar} disabled={enviando || !arquivo}
            className="h-10 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white text-sm font-bold cursor-pointer disabled:opacity-40">
            {enviando ? 'Validando…' : 'Salvar'}
          </button>
        </div>
      )}

      {empresa.cert_validade && (
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={testar} disabled={testando}
            className="px-4 h-9 rounded-xl border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer disabled:opacity-50">
            <i className="ri-wifi-line mr-1" />{testando ? 'Consultando a Sefin Nacional…' : 'Testar conexão'}
          </button>
          {teste && <span className={`text-xs font-medium ${teste.ok ? 'text-emerald-700' : 'text-red-600'}`}>{teste.msg}</span>}
        </div>
      )}
    </Secao>
  );
}

function Membros({ empresa, souAdmin }: { empresa: Empresa; souAdmin: boolean }) {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<'admin' | 'emissor'>('emissor');
  const [busy, setBusy] = useState(false);

  const carregar = async () => {
    const { data } = await supabase.rpc('fn_nfse_membros', { p_empresa: empresa.id });
    setMembros((data ?? []) as Membro[]);
  };
  useEffect(() => { carregar(); }, [empresa.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const adicionar = async () => {
    setBusy(true);
    const r = await nfseCall<{ aviso?: string | null }>('adicionar_membro', { empresa_id: empresa.id, email, papel });
    setBusy(false);
    if (!r.success) { avisar(r.error ?? 'Não foi possível adicionar.'); return; }
    setEmail('');
    if (r.aviso) avisar(r.aviso, 'Adicionado');
    carregar();
  };
  const remover = async (m: Membro) => {
    if (!(await confirmar({ titulo: 'Remover acesso?', mensagem: `${m.nome ?? m.email} deixa de ver e emitir notas desta empresa.`, perigo: true, confirmarLabel: 'Remover' }))) return;
    const r = await nfseCall('remover_membro', { empresa_id: empresa.id, user_id: m.user_id });
    if (!r.success) { avisar(r.error ?? 'Não foi possível remover.'); return; }
    carregar();
  };

  return (
    <Secao titulo="Quem acessa esta empresa" desc="Administrador altera cadastro, certificado e cancela notas. Emissor só emite e consulta.">
      <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-xl">
        {membros.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-800 truncate">{m.nome ?? m.email}{m.eu && <span className="font-normal text-zinc-400"> (você)</span>}</p>
              <p className="text-[11px] text-zinc-400 truncate">{m.email}{!m.tem_modulo && ' · sem o módulo liberado no Admin Master'}</p>
            </div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{m.papel === 'admin' ? 'Administrador' : 'Emissor'}</span>
            {souAdmin && !m.eu && (
              <button onClick={() => remover(m)} className="text-zinc-400 hover:text-red-600 cursor-pointer" title="Remover">
                <i className="ri-close-line text-lg" />
              </button>
            )}
          </div>
        ))}
      </div>
      {souAdmin && (
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <input className={inputCls} placeholder="E-mail de um usuário do ERPOS" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className={`${inputCls} sm:w-40`} value={papel} onChange={(e) => setPapel(e.target.value as 'admin' | 'emissor')}>
            <option value="emissor">Emissor</option>
            <option value="admin">Administrador</option>
          </select>
          <button onClick={adicionar} disabled={busy || !email.includes('@')}
            className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer disabled:opacity-40 whitespace-nowrap">
            Adicionar
          </button>
        </div>
      )}
    </Secao>
  );
}
