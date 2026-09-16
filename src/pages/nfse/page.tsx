// Notas de Serviço — emissão de NFS-e pela API gratuita do Emissor Nacional (Sefin Nacional).
// Independente das lojas do ERPOS: acesso por pessoa (módulo 'nfse' em user_module_access) e por
// empresa (nfse_empresa_membros). Assinatura e transmissão: Edge nfse-write → relay Node no Vercel.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { supabase } from '@/lib/supabase';
import { DialogHost } from '@/pages/contratacao/dialog';
import { type Empresa, type Nota, type Servico, type Tomador, EMPRESA_COLS, NOTA_COLS_LISTA, fmtDoc } from './api';
import EmpresaTab from './components/EmpresaTab';
import NotasTab from './components/NotasTab';
import { ServicosTab, TomadoresTab } from './components/CadastrosTab';

type Aba = 'notas' | 'tomadores' | 'servicos' | 'empresa';
const ABAS: { id: Aba; label: string; icon: string }[] = [
  { id: 'notas', label: 'Notas', icon: 'ri-file-list-3-line' },
  { id: 'tomadores', label: 'Tomadores', icon: 'ri-contacts-book-line' },
  { id: 'servicos', label: 'Serviços', icon: 'ri-briefcase-4-line' },
  { id: 'empresa', label: 'Empresa', icon: 'ri-building-line' },
];
const LS_EMPRESA = 'nfse:empresa';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };
const mesAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);

function intervaloMes(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const ini = `${y}-${String(m).padStart(2, '0')}-01`;
  const fim = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { ini, fim };
}

export default function NfsePage() {
  const { user } = useAuth();
  const { hasModule, loading: acessoLoading } = useModuleAccess();
  const [params, setParams] = useSearchParams();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [papeis, setPapeis] = useState<Record<string, string>>({});
  const [empresaId, setEmpresaId] = useState<string | null>(lsGet(LS_EMPRESA));
  const [criando, setCriando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [tomadores, setTomadores] = useState<Tomador[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [mes, setMes] = useState(mesAtual());
  const aba = (params.get('aba') as Aba) || 'notas';
  const setAba = (a: Aba) => setParams((p) => { p.set('aba', a); return p; }, { replace: true });
  const temAcesso = hasModule('nfse');

  const carregarEmpresas = useCallback(async (selecionar?: string) => {
    const [{ data: emps }, { data: memb }] = await Promise.all([
      supabase.from('nfse_empresas').select(EMPRESA_COLS).order('razao_social'),
      supabase.from('nfse_empresa_membros').select('empresa_id, papel, user_id'),
    ]);
    const lista = (emps ?? []) as unknown as Empresa[];
    setEmpresas(lista);
    const uid = (await supabase.auth.getSession()).data.session?.user.id;
    setPapeis(Object.fromEntries(((memb ?? []) as { empresa_id: string; papel: string; user_id: string }[])
      .filter((m) => m.user_id === uid).map((m) => [m.empresa_id, m.papel])));
    setEmpresaId((atual) => {
      const alvo = selecionar ?? atual;
      const id = lista.some((e) => e.id === alvo) ? alvo! : lista[0]?.id ?? null;
      if (id) lsSet(LS_EMPRESA, id);
      return id;
    });
    setCarregando(false);
  }, []);

  useEffect(() => { if (temAcesso) carregarEmpresas(); }, [temAcesso, carregarEmpresas]);

  const empresa = useMemo(() => empresas.find((e) => e.id === empresaId) ?? null, [empresas, empresaId]);
  const souAdmin = empresa ? papeis[empresa.id] === 'admin' : false;

  const carregarNotas = useCallback(async () => {
    if (!empresaId) { setNotas([]); return; }
    const { ini, fim } = intervaloMes(mes);
    const { data } = await supabase.from('nfse_notas').select(NOTA_COLS_LISTA).eq('empresa_id', empresaId)
      .gte('competencia', ini).lt('competencia', fim).order('created_at', { ascending: false }).limit(1000);
    setNotas((data ?? []) as unknown as Nota[]);
  }, [empresaId, mes]);
  const carregarTomadores = useCallback(async () => {
    if (!empresaId) { setTomadores([]); return; }
    const { data } = await supabase.from('nfse_tomadores').select('*').eq('empresa_id', empresaId).order('nome').limit(5000);
    setTomadores((data ?? []) as Tomador[]);
  }, [empresaId]);
  const carregarServicos = useCallback(async () => {
    if (!empresaId) { setServicos([]); return; }
    const { data } = await supabase.from('nfse_servicos').select('*').eq('empresa_id', empresaId).order('nome');
    setServicos((data ?? []) as Servico[]);
  }, [empresaId]);

  useEffect(() => { carregarNotas(); }, [carregarNotas]);
  useEffect(() => { carregarTomadores(); carregarServicos(); }, [carregarTomadores, carregarServicos]);

  if (!acessoLoading && !temAcesso) return <Navigate to="/modulos" replace />;
  void user;

  const semEmpresa = !carregando && empresas.length === 0;
  const mostrarCadastro = criando || semEmpresa;

  return (
    <div className="max-w-6xl mx-auto">
      <DialogHost />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-sky-50 border border-sky-200">
          <i className="ri-file-text-line text-xl text-sky-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-zinc-900">Notas de Serviço</h1>
          <p className="text-xs text-zinc-400">NFS-e pelo Emissor Nacional, sem custo por nota</p>
        </div>
        {empresas.length > 0 && !criando && (
          <>
            <select value={empresaId ?? ''} onChange={(e) => { setEmpresaId(e.target.value); lsSet(LS_EMPRESA, e.target.value); }}
              className="w-full sm:w-auto h-10 px-3 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 cursor-pointer">
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome_fantasia || e.razao_social} · {fmtDoc(e.cnpj)}</option>)}
            </select>
            <button onClick={() => setCriando(true)} className="h-10 px-3 rounded-xl border border-zinc-200 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              + Empresa
            </button>
          </>
        )}
      </div>

      {carregando ? (
        <p className="text-sm text-zinc-400">Carregando…</p>
      ) : mostrarCadastro ? (
        <div>
          {criando && (
            <button onClick={() => setCriando(false)} className="mb-3 text-xs font-bold text-zinc-500 hover:text-zinc-800 cursor-pointer">
              <i className="ri-arrow-left-line mr-1" />Voltar
            </button>
          )}
          <EmpresaTab empresa={null} souAdmin onSalva={async (id) => { setCriando(false); await carregarEmpresas(id); setAba('empresa'); }} />
        </div>
      ) : empresa ? (
        <>
          {empresa.ambiente === 2 && (
            <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-900">
              <b>Ambiente de testes.</b> As notas não têm valor fiscal. Quando tudo estiver certo, mude para produção na aba Empresa.
            </div>
          )}
          <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
            {ABAS.map((t) => (
              <button key={t.id} onClick={() => setAba(t.id)}
                className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
                  aba === t.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
                <i className={t.icon} /> {t.label}
              </button>
            ))}
          </div>

          {aba === 'notas' && (
            <NotasTab empresa={empresa} notas={notas} tomadores={tomadores} servicos={servicos} souAdmin={souAdmin}
              mes={mes} onMes={setMes} onChange={carregarNotas} onTomadores={carregarTomadores} />
          )}
          {aba === 'tomadores' && <TomadoresTab empresa={empresa} tomadores={tomadores} onChange={carregarTomadores} />}
          {aba === 'servicos' && <ServicosTab empresa={empresa} servicos={servicos} souAdmin={souAdmin} onChange={carregarServicos} />}
          {aba === 'empresa' && <EmpresaTab empresa={empresa} souAdmin={souAdmin} onSalva={(id) => carregarEmpresas(id)} />}
        </>
      ) : null}
    </div>
  );
}
