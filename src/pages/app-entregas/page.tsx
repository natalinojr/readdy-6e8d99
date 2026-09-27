import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { entrarNaLoja, guardarLoja, lerLojas, lerPerfil, removerLoja, salvarPerfil, type LojaMotoboy } from '@/lib/motoboyApp';

function edgeUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/motoboy-signal';
}

const ERROS: Record<string, string> = {
  codigo_invalido: 'Código inválido ou vencido. Peça um código novo à loja.',
  bloqueado: 'Seu acesso a esta loja está bloqueado. Fale com a loja.',
  dados_invalidos: 'Confira seu nome e celular.',
};

/**
 * Tela inicial do app "ERPOS Entregas": perfil do motoboy (uma vez) + lojas ligadas por código.
 * Tocar numa loja abre o portal dela (/entregas/<slug>) com a sessão já gravada.
 */
export default function AppEntregasPage() {
  const navigate = useNavigate();
  const [perfil, setPerfil] = useState(lerPerfil);
  const [lojas, setLojas] = useState<LojaMotoboy[]>(lerLojas);
  const [nome, setNome] = useState(perfil?.nome ?? '');
  const [celular, setCelular] = useState(perfil?.celular ?? '');
  const [codigo, setCodigo] = useState('');
  const [adicionando, setAdicionando] = useState(lojas.length === 0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const abrir = (l: LojaMotoboy) => { entrarNaLoja(l); navigate('/entregas/' + l.store_slug); };

  const salvarDados = (e: React.FormEvent) => {
    e.preventDefault();
    const fone = celular.replace(/\D/g, '');
    if (!nome.trim() || fone.length < 10) { setErro('Informe seu nome e o celular com DDD.'); return; }
    const p = { nome: nome.trim(), celular: fone };
    salvarPerfil(p); setPerfil(p); setErro('');
  };

  const vincular = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perfil) return;
    const code = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) { setErro('O código tem 8 letras e números (ex.: ABCD-2345).'); return; }
    setEnviando(true); setErro('');
    try {
      const res = await fetch(edgeUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vincular_codigo', code, name: perfil.nome, phone: perfil.celular }),
      });
      const data = await res.json();
      if (!data.ok) { setErro(ERROS[data.error] ?? 'Não foi possível ligar a loja. Tente de novo.'); return; }
      const loja: LojaMotoboy = { tenant_id: data.tenant_id, driver_id: data.driver.id, name: data.driver.name, store_name: data.store_name, store_slug: data.store_slug };
      setLojas(guardarLoja(loja));
      setCodigo(''); setAdicionando(false);
      abrir(loja);
    } catch {
      setErro('Sem conexão. Tente de novo.');
    } finally { setEnviando(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex justify-center">
      <div className="w-full max-w-md px-4 py-6 space-y-4">
        <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl p-4 text-white">
          <p className="text-xs font-semibold opacity-70 flex items-center gap-1"><i className="ri-e-bike-2-line" /> ERPOS Entregas</p>
          <h1 className="text-xl font-black">{perfil ? `Olá, ${perfil.nome.split(' ')[0]}` : 'Bem-vindo'}</h1>
          <p className="text-[11px] opacity-70 mt-0.5">{perfil ? 'Escolha a loja para ver as entregas.' : 'Primeiro, seus dados — só uma vez neste celular.'}</p>
        </div>

        {!perfil ? (
          <form onSubmit={salvarDados} className="bg-white rounded-2xl border border-zinc-100 p-4 space-y-3">
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-500 uppercase">Seu nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="name" aria-label="Seu nome"
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-zinc-200 outline-none focus:border-amber-400 text-sm" />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-500 uppercase">Celular com DDD</span>
              <input value={celular} onChange={(e) => setCelular(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} aria-label="Celular com DDD"
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-zinc-200 outline-none focus:border-amber-400 text-sm" />
            </label>
            {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
            <button type="submit" className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm">Continuar</button>
          </form>
        ) : (
          <>
            {lojas.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold text-zinc-500 uppercase px-1">Minhas lojas</p>
                {lojas.map((l) => (
                  <div key={l.tenant_id} className="flex items-center gap-2 bg-white rounded-2xl border border-zinc-100 p-2 pl-4">
                    <button type="button" onClick={() => abrir(l)} className="flex-1 min-w-0 text-left py-2">
                      <p className="text-sm font-bold text-zinc-800 truncate">{l.store_name || l.store_slug}</p>
                      <p className="text-[11px] text-zinc-400">Toque para ver as entregas</p>
                    </button>
                    <button type="button" aria-label={`Tirar ${l.store_name} deste celular`} title="Tirar a loja deste celular"
                      onClick={() => { if (window.confirm(`Tirar "${l.store_name}" deste celular? Para voltar, peça um código novo à loja.`)) setLojas(removerLoja(l.tenant_id)); }}
                      className="w-9 h-9 shrink-0 rounded-xl text-zinc-400 hover:bg-zinc-100 flex items-center justify-center"><i className="ri-close-line" /></button>
                    <button type="button" onClick={() => abrir(l)} aria-label={`Abrir ${l.store_name}`}
                      className="w-9 h-9 shrink-0 rounded-xl bg-amber-500 text-white flex items-center justify-center"><i className="ri-arrow-right-line" /></button>
                  </div>
                ))}
              </div>
            )}

            {adicionando ? (
              <form onSubmit={vincular} className="bg-white rounded-2xl border border-violet-200 p-4 space-y-3">
                <div>
                  <p className="text-sm font-bold text-zinc-800">Adicionar loja</p>
                  <p className="text-xs text-zinc-500">Peça o código à loja (Config. do Delivery › Entregadores › Código para o app).</p>
                </div>
                <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase().slice(0, 9))} placeholder="ABCD-2345"
                  autoCapitalize="characters" autoComplete="off" aria-label="Código da loja"
                  className="w-full px-3 py-3 rounded-xl border border-zinc-200 outline-none focus:border-violet-400 text-xl font-black tracking-widest text-center font-mono" />
                {erro ? <p className="text-xs text-red-600">{erro}</p> : null}
                <div className="flex gap-2">
                  {lojas.length > 0 && (
                    <button type="button" onClick={() => { setAdicionando(false); setErro(''); }}
                      className="flex-1 py-3 rounded-2xl bg-zinc-100 text-zinc-600 font-semibold text-sm">Cancelar</button>
                  )}
                  <button type="submit" disabled={enviando}
                    className="flex-1 py-3 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm disabled:opacity-50">
                    {enviando ? 'Ligando…' : 'Ligar loja'}
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setAdicionando(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-violet-300 text-violet-700 font-bold text-sm">
                <i className="ri-add-line" /> Adicionar loja
              </button>
            )}

            <p className="text-center text-[11px] text-zinc-400">
              {perfil.nome} · {perfil.celular}{' '}
              <button type="button" className="underline" onClick={() => { setPerfil(null); setErro(''); }}>alterar</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
