// Clientes & Marketing › Clube › App do cliente: liga o app instalável do clube desta
// loja e mostra como ele fica no celular (nome, ícone e cor). Os ícones são gerados
// aqui (canvas) a partir da logo e gravados pela Edge Function `clube-app`.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { contrasteComBranco, corAutomatica, gerarIcones, iniciais, nomeCurto, type CaraDoApp } from '@/lib/clubeAppIcones';

interface AppConfig { ativo: boolean; nome_curto: string | null; cor: string | null; cor_destaque: string | null; icones: Record<string, string>; versao: number }
interface Resposta { editavel?: boolean; app?: AppConfig | null; loja?: { nome: string; slug: string; logo: string | null; cor: string | null }; error?: string; message?: string }

const INPUT = 'w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-amber-400 disabled:bg-zinc-50';

export default function ClubeAppSecao() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [r, setR] = useState<Resposta | null>(null);
  const [auto, setAuto] = useState<CaraDoApp | null>(null);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState('');
  const [destaque, setDestaque] = useState('');
  const [ativo, setAtivo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setR(null); setAuto(null); setErro(''); setMsg('');
    void invokeWithAuth<Resposta>('clube-app', { body: { action: 'admin_get', tenant_id: tenantId } }).then(async ({ data, error }) => {
      if (!vivo) return;
      if (error || !data?.loja) { setErro(data?.message || error?.message || 'Não consegui carregar.'); return; }
      setR(data);
      const a = await corAutomatica(data.loja.cor, data.loja.logo);
      if (!vivo) return;
      setAuto(a);
      setNome(data.app?.nome_curto || nomeCurto(data.loja.nome));
      setCor(data.app?.cor || a.cor);
      setDestaque(data.app?.cor_destaque || a.corDestaque || '');
      setAtivo(!!data.app?.ativo);
    });
    return () => { vivo = false; };
  }, [tenantId]);

  if (erro && !r?.loja) return <p className="text-sm text-rose-600 bg-white border border-zinc-200 rounded-xl p-4">{erro}</p>;
  if (!r?.loja || !auto) return <p className="text-sm text-zinc-400 bg-white border border-zinc-200 rounded-xl p-6 text-center">Carregando…</p>;
  const loja = r.loja;
  const ro = !r.editavel;
  const link = `${window.location.origin}/clube/${loja.slug}`;
  const corOk = /^#[0-9a-f]{6}$/i.test(cor);
  const fundo = corOk ? cor : '#C2410C';
  const origem = cor.toUpperCase() === auto.cor.toUpperCase()
    ? { loja: 'Cor da loja (Configurações › Loja)', logo: 'Tirada da logo', padrao: 'Padrão do sistema (a loja não tem cor nem logo)' }[auto.origemCor]
    : 'Escolhida aqui';

  const salvar = async (ligar: boolean) => {
    if (!tenantId || salvando) return;
    setErro(''); setMsg('');
    if (!nome.trim() || nome.trim().length > 12) { setErro('O nome embaixo do ícone precisa ter de 1 a 12 letras.'); return; }
    if (!corOk) { setErro('Escolha uma cor.'); return; }
    setSalvando(true);
    try {
      const icones = await gerarIcones(loja.logo, cor, loja.nome);
      const { data, error } = await invokeWithAuth<{ app?: AppConfig; error?: string; message?: string }>('clube-app', {
        body: { action: 'admin_salvar', tenant_id: tenantId, ativo: ligar, nome_curto: nome.trim(), cor, cor_destaque: destaque || null, icones },
      });
      if (error || !data?.app) { setErro(data?.message || error?.message || 'Não consegui salvar.'); return; }
      setR((x) => (x ? { ...x, app: data.app } : x));
      setAtivo(data.app.ativo);
      setMsg(data.app.ativo ? 'App ligado. Os clientes já podem instalar.' : 'Salvo. O app está desligado.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gerar os ícones.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <section className="bg-white rounded-xl border border-zinc-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-zinc-900">App do clube no celular do cliente</h3>
              <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">O cliente abre o clube e toca em <b>Instalar</b>: o app fica na tela do celular com o nome, o ícone e a cor da loja. Entra com CPF e celular, pode usar a digital e recebe aviso quando ganha pontos. Não passa por loja de apps.</p>
            </div>
            <span className={`shrink-0 text-xs font-bold rounded-full px-2.5 py-1 ${ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>{ativo ? 'Ligado' : 'Desligado'}</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <label className="block">
              <span className="block text-xs font-semibold text-zinc-600 mb-1">Nome embaixo do ícone <span className="font-normal text-zinc-400">· {nome.length}/12</span></span>
              <input value={nome} maxLength={12} disabled={ro} onChange={(e) => setNome(e.target.value)} className={INPUT} />
              <span className="block text-[11px] text-zinc-400 mt-1">O celular corta nomes longos.</span>
            </label>
            <div>
              <span className="block text-xs font-semibold text-zinc-600 mb-1">Cor</span>
              <div className="flex items-center gap-2">
                <label className="w-9 h-9 rounded-lg border border-zinc-200 relative overflow-hidden cursor-pointer shrink-0" style={{ background: fundo }} title="Escolher outra cor">
                  <input type="color" value={fundo} disabled={ro} onChange={(e) => setCor(e.target.value.toUpperCase())} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Escolher a cor do app" />
                </label>
                <div className="min-w-0 text-xs text-zinc-600 leading-tight">
                  <b className="text-zinc-800">{origem}</b>
                  {cor.toUpperCase() !== auto.cor.toUpperCase() && !ro && <button onClick={() => setCor(auto.cor)} className="block text-amber-700 underline cursor-pointer mt-0.5">Voltar para a automática</button>}
                </div>
              </div>
              {corOk && contrasteComBranco(cor) < 4.5 && <p className="text-[11px] text-amber-700 mt-1">Cor clara: o texto branco fica difícil de ler. Prefira um tom mais escuro.</p>}
            </div>
            <div>
              <span className="block text-xs font-semibold text-zinc-600 mb-1">Cor de destaque <span className="font-normal text-zinc-400">(números e detalhes)</span></span>
              <div className="flex items-center gap-2">
                <label className="w-9 h-9 rounded-lg border border-zinc-200 relative overflow-hidden cursor-pointer shrink-0" style={{ background: destaque || '#FFFFFF' }}>
                  <input type="color" value={destaque || '#FFFFFF'} disabled={ro} onChange={(e) => setDestaque(e.target.value.toUpperCase())} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Escolher a cor de destaque" />
                </label>
                <span className="text-xs text-zinc-500">{destaque ? (destaque === auto.corDestaque ? 'Tirada da logo' : 'Escolhida aqui') : 'Um tom claro da cor do app'}</span>
                {destaque && !ro && <button onClick={() => setDestaque('')} className="text-xs text-zinc-400 underline cursor-pointer">limpar</button>}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-zinc-50 border border-zinc-100 p-3 text-xs text-zinc-600 leading-relaxed">
            <b className="text-zinc-800">Como a cor é escolhida (qualquer loja):</b> 1) a cor da loja em Configurações › Loja, a mesma do delivery; 2) sem cor, a cor principal da logo, escurecida se o texto branco não ficar legível; 3) sem logo e sem cor, o laranja padrão do sistema, com as iniciais da loja no ícone.
          </div>

          {erro && <p className="text-sm text-rose-600 font-semibold mt-3">{erro}</p>}
          {msg && <p className="text-sm text-emerald-700 font-semibold mt-3">{msg}</p>}
          {!ro && (
            <div className="flex flex-wrap gap-2 mt-4">
              {ativo ? (
                <>
                  <button onClick={() => { void salvar(true); }} disabled={salvando} className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar mudanças'}</button>
                  <button onClick={() => { void salvar(false); }} disabled={salvando} className="px-4 py-2 text-sm font-semibold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-lg cursor-pointer disabled:opacity-50">Desligar o app</button>
                </>
              ) : (
                <button onClick={() => { void salvar(true); }} disabled={salvando} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-50">{salvando ? 'Ligando…' : 'Ligar o app'}</button>
              )}
            </div>
          )}
          {ro && <p className="text-xs text-zinc-400 mt-3">Seu perfil só pode ver. Quem cuida do clube pode ligar e mudar o app.</p>}
        </section>

        <section className="bg-white rounded-xl border border-zinc-200 p-4">
          <h3 className="text-sm font-bold text-zinc-900">Link do clube</h3>
          <p className="text-xs text-zinc-500 mt-0.5">É por aqui que o cliente entra e instala. O QR do tablet também leva para cá.</p>
          <div className="flex gap-2 mt-3">
            <input readOnly value={link} className={INPUT + ' font-mono text-xs'} onFocus={(e) => e.target.select()} />
            <button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sem clipboard */ } }}
              className="px-3 text-sm font-semibold border border-zinc-200 rounded-lg cursor-pointer whitespace-nowrap">{copiado ? 'Copiado ✓' : 'Copiar'}</button>
            <a href={link} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-sm font-semibold border border-zinc-200 rounded-lg whitespace-nowrap">Abrir</a>
          </div>
        </section>
      </div>

      {/* Prévia */}
      <div className="lg:col-span-2">
        <div className="rounded-2xl p-5 text-white sticky top-4" style={{ background: 'linear-gradient(180deg,#2b2440 0%,#1d1a2b 100%)' }}>
          <p className="text-xs opacity-60 text-center mb-4">Como fica no celular</p>
          <div className="grid grid-cols-4 gap-4 justify-items-center">
            {['#34C759', '#FF9500', '#5AC8FA'].map((c) => <div key={c} className="w-14 h-14 rounded-2xl opacity-40" style={{ background: c }} />)}
            <div className="flex flex-col items-center gap-1.5">
              {loja.logo
                ? <div className="w-14 h-14 rounded-2xl bg-center bg-cover shadow-lg ring-2 ring-amber-300/60" style={{ backgroundImage: `url(${loja.logo})`, backgroundColor: fundo }} />
                : <div className="w-14 h-14 rounded-2xl shadow-lg ring-2 ring-amber-300/60 flex items-center justify-center font-extrabold text-lg" style={{ background: fundo }}>{iniciais(loja.nome)}</div>}
              <span className="text-[11px] font-semibold max-w-[72px] truncate">{nome || '—'}</span>
            </div>
          </div>
          <div className="mt-6 rounded-2xl p-4" style={{ background: `radial-gradient(130% 90% at 100% 0%, ${fundo} 0%, ${fundo} 50%, #00000055 100%)` }}>
            <p className="text-[11px] font-extrabold tracking-[.14em] uppercase" style={{ color: destaque || '#FFFFFFCC' }}>Clube</p>
            <p className="text-sm opacity-90 mt-2">Olá, cliente</p>
            <p className="text-4xl font-extrabold" style={{ color: destaque || '#FFFFFF' }}>156 <span className="text-sm text-white/90 font-bold">pontos</span></p>
          </div>
          <p className="text-[11px] opacity-60 text-center mt-4">O nome ERPOS só aparece em “Sobre o app”.</p>
        </div>
      </div>
    </div>
  );
}
