// Empresa emitente: dados cadastrais e tributários, certificado A1, teste de conexão e membros.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { avisar, confirmar } from '@/pages/contratacao/dialog';
import { Modal } from './CadastrosTab';
import {
  type Empresa, type Membro, type Permissoes, NOME_ARQUIVO_CAMPOS, PERMISSOES, PRESET_ADMIN, PRESET_EMISSOR, permissoesDe, NOME_ARQUIVO_PADRAO, nomeArquivoNota, buscarCep, cnpjValido, fmtCep, fmtData, fmtDoc, inputCls, labelCls, lerArquivoBase64, nfseCall, soDigitos,
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
  pode: Permissoes;
  onSalva: (id: string) => void;
}

export default function EmpresaTab({ empresa, pode, onSalva }: Props) {
  const [f, setF] = useState<Form>(empresa ? deEmpresa(empresa) : vazio);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const editavel = !empresa || pode.empresa;

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

      {empresa && <Certificado empresa={empresa} souAdmin={pode.empresa} onSalvo={() => onSalva(empresa.id)} />}
      {empresa && <Membros empresa={empresa} podeAdministrar={pode.usuarios} />}
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

function EscolherPermissoes({ valor, onChange }: { valor: Permissoes; onChange: (p: Permissoes) => void }) {
  const igual = (a: Permissoes) => PERMISSOES.every((p) => a[p.id] === valor[p.id]);
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {([['Administrador', PRESET_ADMIN], ['Emissor', PRESET_EMISSOR]] as const).map(([rotulo, preset]) => (
          <button key={rotulo} type="button" onClick={() => onChange({ ...preset })}
            className={`px-3 h-8 rounded-full text-xs font-bold border cursor-pointer ${igual(preset) ? 'bg-sky-600 border-sky-600 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
            {rotulo}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {PERMISSOES.map((p) => (
          <label key={p.id} className="flex items-start gap-2 rounded-xl border border-zinc-100 px-3 py-2 cursor-pointer hover:bg-zinc-50">
            <input type="checkbox" className="mt-0.5 accent-sky-600" checked={valor[p.id]} onChange={(e) => onChange({ ...valor, [p.id]: e.target.checked })} />
            <span>
              <span className="block text-sm font-semibold text-zinc-800">{p.label}</span>
              <span className="block text-[11px] text-zinc-400">{p.desc}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-zinc-400 mt-2">Ver as notas da empresa vale para todos.</p>
    </div>
  );
}

function LinkConvite({ link, nome, email, onClose }: { link: string; nome: string; email: string | null; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Olá${nome ? `, ${nome.split(' ')[0]}` : ''}! Este é o seu acesso às Notas de Serviço no ERPOS. Abra o link para criar sua senha: ${link}`;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(link); setCopiado(true); } catch { avisar('Não foi possível copiar. Selecione o link e copie.'); }
  };
  return (
    <Modal titulo="Link de acesso" onClose={onClose}
      rodape={<button onClick={onClose} className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">Fechar</button>}>
      <p className="text-sm text-zinc-600 mb-3">Mande este link para {nome || 'a pessoa'}. Ao abrir, ela cria a senha e já entra nas Notas de Serviço. O link vale por pouco tempo e uma vez só; se vencer, gere outro pelo botão <i className="ri-link" /> ao lado do nome dela.</p>
      <input readOnly value={link} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-xs`} />
      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <button onClick={copiar} className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">
          <i className="ri-file-copy-line mr-1" />{copiado ? 'Copiado' : 'Copiar link'}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer"
          className="px-4 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center justify-center">
          <i className="ri-whatsapp-line mr-1" />Mandar no WhatsApp
        </a>
        {email && (
          <a href={`mailto:${email}?subject=${encodeURIComponent('Seu acesso às Notas de Serviço (ERPOS)')}&body=${encodeURIComponent(texto)}`}
            className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center justify-center">
            <i className="ri-mail-line mr-1" />Mandar por e-mail
          </a>
        )}
      </div>
    </Modal>
  );
}

function Membros({ empresa, podeAdministrar }: { empresa: Empresa; podeAdministrar: boolean }) {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [incluindo, setIncluindo] = useState(false);
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [perms, setPerms] = useState<Permissoes>({ ...PRESET_EMISSOR });
  const [editando, setEditando] = useState<{ m: Membro; perms: Permissoes } | null>(null);
  const [link, setLink] = useState<{ link: string; nome: string; email: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = async () => {
    const { data } = await supabase.rpc('fn_nfse_membros', { p_empresa: empresa.id });
    setMembros((data ?? []) as Membro[]);
  };
  useEffect(() => { carregar(); }, [empresa.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fecharInclusao = () => { setIncluindo(false); setEmail(''); setNome(''); setPerms({ ...PRESET_EMISSOR }); };
  const adicionar = async () => {
    if (!PERMISSOES.some((p) => perms[p.id])) { avisar('Marque pelo menos uma coisa que a pessoa pode fazer.'); return; }
    setBusy(true);
    const r = await nfseCall<{ convite?: { enviado: boolean; link: string | null } | null }>('adicionar_membro',
      { empresa_id: empresa.id, email, nome: nome.trim() || null, permissoes: perms });
    setBusy(false);
    if (!r.success) { avisar(r.error ?? 'Não foi possível incluir.'); return; }
    const quem = nome.trim();
    const para = email.trim();
    fecharInclusao();
    carregar();
    if (r.convite?.link) setLink({ link: r.convite.link, nome: quem, email: para });
    else if (r.convite) avisar('A pessoa foi incluída, mas o link de acesso não saiu. Use o botão de link ao lado do nome dela.');
  };
  const salvarEdicao = async () => {
    if (!editando) return;
    setBusy(true);
    const r = await nfseCall('atualizar_membro', { empresa_id: empresa.id, user_id: editando.m.user_id, permissoes: editando.perms });
    setBusy(false);
    if (!r.success) { avisar(r.error ?? 'Não foi possível salvar.'); return; }
    setEditando(null);
    carregar();
  };
  const remover = async (m: Membro) => {
    if (!(await confirmar({ titulo: 'Tirar o acesso?', mensagem: `${m.nome ?? m.email} deixa de ver e emitir notas desta empresa.`, perigo: true, confirmarLabel: 'Tirar acesso' }))) return;
    const r = await nfseCall('remover_membro', { empresa_id: empresa.id, user_id: m.user_id });
    if (!r.success) { avisar(r.error ?? 'Não foi possível remover.'); return; }
    setEditando(null);
    carregar();
  };
  const gerarLink = async (m: Membro) => {
    const r = await nfseCall<{ link?: string }>('link_acesso', { empresa_id: empresa.id, user_id: m.user_id });
    if (!r.success || !r.link) { avisar(r.error ?? 'Não foi possível gerar o link.'); return; }
    setLink({ link: r.link, nome: m.nome ?? '', email: m.email });
  };

  return (
    <Secao titulo="Quem acessa esta empresa" desc="Cada pessoa vê as notas desta empresa e faz só o que estiver marcado para ela.">
      <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-xl">
        {membros.map((m) => {
          const p = permissoesDe(m);
          const admin = PERMISSOES.every((x) => p[x.id]);
          return (
            <div key={m.user_id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-800 truncate">
                  {m.nome ?? m.email}{m.eu && <span className="font-normal text-zinc-400"> (você)</span>}
                  {m.pendente && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">convite pendente</span>}
                </p>
                <p className="text-[11px] text-zinc-400 truncate">{m.email}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {admin
                    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700">Tudo</span>
                    : PERMISSOES.filter((x) => p[x.id]).map((x) => (
                      <span key={x.id} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{x.label}</span>
                    ))}
                  {!admin && !PERMISSOES.some((x) => p[x.id]) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">Só vê as notas</span>}
                </div>
              </div>
              {podeAdministrar && !m.eu && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {m.pendente && (
                    <button onClick={() => gerarLink(m)} className="text-zinc-400 hover:text-emerald-600 cursor-pointer" title="Gerar link de acesso">
                      <i className="ri-link text-lg" />
                    </button>
                  )}
                  <button onClick={() => setEditando({ m, perms: p })} className="text-zinc-400 hover:text-sky-600 cursor-pointer" title="Editar o que faz">
                    <i className="ri-pencil-line text-lg" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {podeAdministrar && !incluindo && (
        <button onClick={() => setIncluindo(true)} className="mt-3 px-4 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">
          <i className="ri-user-add-line mr-1" />Incluir pessoa
        </button>
      )}
      {podeAdministrar && incluindo && (
        <div className="mt-3 rounded-xl border border-zinc-200 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>E-mail</label>
              <input className={inputCls} type="email" placeholder="pessoa@empresa.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Nome (se ainda não tem conta no ERPOS)</label>
              <input className={inputCls} placeholder="Nome e sobrenome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>O que pode fazer</label>
            <EscolherPermissoes valor={perms} onChange={setPerms} />
          </div>
          <p className="text-[11px] text-zinc-400">Quem ainda não tem conta no ERPOS ganha um link para criar a senha; você manda por WhatsApp ou e-mail. Você só pode dar o que também pode fazer.</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-end">
            <button onClick={fecharInclusao} className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer">Cancelar</button>
            <button onClick={adicionar} disabled={busy || !email.includes('@')}
              className="px-4 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold cursor-pointer disabled:opacity-40">
              {busy ? 'Incluindo…' : 'Incluir'}
            </button>
          </div>
        </div>
      )}

      {editando && (
        <Modal titulo={`O que ${editando.m.nome ?? editando.m.email} pode fazer`} onClose={() => setEditando(null)}
          rodape={(
            <>
              <button onClick={() => remover(editando.m)} className="mr-auto px-3 h-10 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 cursor-pointer">Tirar acesso</button>
              <button onClick={() => setEditando(null)} className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer">Cancelar</button>
              <button onClick={salvarEdicao} disabled={busy} className="px-4 h-10 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold cursor-pointer disabled:opacity-40">Salvar</button>
            </>
          )}>
          <EscolherPermissoes valor={editando.perms} onChange={(perms) => setEditando({ ...editando, perms })} />
        </Modal>
      )}
      {link && <LinkConvite link={link.link} nome={link.nome} email={link.email} onClose={() => setLink(null)} />}
    </Secao>
  );
}
