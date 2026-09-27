// Página do cliente do clube de fidelidade — /clube/<loja> (pública, sem login no ERPOS).
//
// Sem cartão no aparelho: mostra como o clube funciona + Entrar (CPF + 4 últimos
// números do celular) ou Quero participar (cadastro). Com cartão: nível, pontos,
// progresso, prêmios guardados, catálogo de trocas, roleta, onde usar e extrato.
// O tablet da loja abre esta página já logada por QR (?entrar=<link de uso único>).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import RoletaSvg, { rotacaoParaFatia } from '@/components/fidelidade/RoletaSvg';
import { cpfValido, formatarCpf } from '@/lib/fidelidade';
import {
  clubeChamar, clubeSalvarToken, clubeTokenSalvo,
  type ClubeDados, type ClubeProgramaPublico,
} from '@/lib/clubePublico';

const pts = (n: number) => Math.floor(Number(n) || 0).toLocaleString('pt-BR');
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const INPUT = 'w-full px-4 py-3 rounded-xl border border-zinc-300 bg-white text-base text-zinc-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100';

function Carregando() {
  return <div className="min-h-screen flex items-center justify-center bg-zinc-50"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
}

// ── Como funciona (visto por todos) ─────────────────────────────────────────
function ComoFunciona({ p }: { p: ClubeProgramaPublico }) {
  return (
    <div className="space-y-4">
      {p.pontos && (
        <section className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h3 className="font-black text-zinc-900 mb-2">⭐ Como ganhar pontos</h3>
          <ul className="text-sm text-zinc-600 space-y-1.5">
            <li>Cada <b>R$ 1</b> em pedido pago vale <b>{p.pontos.pontos_por_real} ponto{p.pontos.pontos_por_real === 1 ? '' : 's'}</b>{p.niveis.some((n) => n.multiplicador > 1) ? ' — e mais nos níveis altos' : ''}.</li>
            <li>Vale no {[p.pontos.canais.salao && 'salão (mesa)', p.pontos.canais.balcao && 'balcão', p.pontos.canais.totem && 'tablet de autoatendimento', p.pontos.canais.delivery && 'delivery próprio'].filter(Boolean).join(', ')}. É só se identificar com o CPF.</li>
            {p.pontos.pedido_minimo > 0 && <li>Pedidos a partir de {brl(p.pontos.pedido_minimo)}.</li>}
            {p.pontos.bonus_cadastro > 0 && <li>🎉 <b>{pts(p.pontos.bonus_cadastro)} pontos</b> ao entrar no clube.</li>}
            {p.pontos.bonus_aniversario > 0 && <li>🎂 <b>{pts(p.pontos.bonus_aniversario)} pontos</b> no mês do seu aniversário.</li>}
            {p.pontos.validade_meses > 0 && <li>Os pontos valem {p.pontos.validade_meses} meses.</li>}
          </ul>
        </section>
      )}
      {p.niveis.length > 0 && (
        <section className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h3 className="font-black text-zinc-900 mb-1">🏆 Níveis</h3>
          <p className="text-xs text-zinc-500 mb-3">Pelo número de compras {p.janela_dias > 0 ? `nos últimos ${p.janela_dias >= 365 ? '12 meses' : `${p.janela_dias} dias`}` : 'desde sempre'}.</p>
          <div className="space-y-2">
            {p.niveis.map((n) => (
              <div key={n.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: `${n.cor}14` }}>
                <span className="text-2xl">{n.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold" style={{ color: n.cor }}>{n.nome} <span className="text-xs font-normal text-zinc-500">· {n.min_compras}+ compras{n.multiplicador > 1 ? ` · ${n.multiplicador}× pontos` : ''}</span></p>
                  {n.beneficios && <p className="text-xs text-zinc-600">{n.beneficios}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {p.roleta && (
        <section className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h3 className="font-black text-zinc-900 mb-2">🎡 Roleta de prêmios</h3>
          <p className="text-sm text-zinc-600">
            Ganhe giros {[p.roleta.a_cada_compras > 0 && `a cada ${p.roleta.a_cada_compras} compras`, p.roleta.pedido_acima_de > 0 && `em pedidos acima de ${brl(p.roleta.pedido_acima_de)}`, p.roleta.ao_subir_nivel && 'ao subir de nível', p.roleta.aniversario && 'no seu aniversário'].filter(Boolean).join(', ')}.
            {p.roleta.premios.length > 0 && <> Pode sair: {p.roleta.premios.join(', ')}.</>}
          </p>
        </section>
      )}
    </div>
  );
}

// ── Entrar / cadastrar ──────────────────────────────────────────────────────
function Acesso({ tenantId, programa, onEntrou }: { tenantId: string; programa: ClubeProgramaPublico; onEntrou: (d: ClubeDados) => void }) {
  const [modo, setModo] = useState<'entrar' | 'cadastrar'>('entrar');
  const [cpf, setCpf] = useState('');
  const [final, setFinal] = useState('');
  const [nome, setNome] = useState('');
  const [celular, setCelular] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [aceita, setAceita] = useState(false);
  const [ofertas, setOfertas] = useState(true);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setErro('');
    const d = cpf.replace(/\D/g, '');
    if (!cpfValido(d)) { setErro('CPF inválido. Confira os números.'); return; }
    setEnviando(true);
    const r = modo === 'entrar'
      ? await clubeChamar<ClubeDados & { encontrado?: boolean }>({ action: 'entrar', tenant_id: tenantId, cpf: d, celular_final: final })
      : await clubeChamar<ClubeDados & { encontrado?: boolean }>({ action: 'cadastrar', tenant_id: tenantId, cpf: d, nome, celular, nascimento: nascimento || null, aceita_termos: aceita, aceita_ofertas: ofertas });
    setEnviando(false);
    if (r.error) { setErro(r.message || 'Não consegui agora.'); return; }
    if (modo === 'entrar' && !r.encontrado) { setErro('Não achamos esse CPF no clube. Toque em "Quero participar".'); return; }
    onEntrou(r);
  };

  return (
    <section className="bg-white rounded-2xl border border-zinc-200 p-4">
      <div className="flex bg-zinc-100 rounded-xl p-1 mb-4">
        {(['entrar', 'cadastrar'] as const).map((m) => (
          <button key={m} onClick={() => { setModo(m); setErro(''); }} className={`flex-1 py-2 rounded-lg text-sm font-bold cursor-pointer ${modo === m ? 'bg-white shadow text-zinc-900' : 'text-zinc-500'}`}>
            {m === 'entrar' ? 'Já sou do clube' : 'Quero participar'}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-semibold text-zinc-700">CPF</span>
          <input value={formatarCpf(cpf)} onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" className={INPUT} />
        </label>
        {modo === 'entrar' ? (
          <label className="block">
            <span className="text-sm font-semibold text-zinc-700">4 últimos números do seu celular</span>
            <input value={final} onChange={(e) => setFinal(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" placeholder="0000" className={INPUT + ' tracking-[0.5em] text-center font-bold'} />
          </label>
        ) : (
          <>
            <label className="block"><span className="text-sm font-semibold text-zinc-700">Nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className={INPUT} /></label>
            <label className="block"><span className="text-sm font-semibold text-zinc-700">Celular com DDD</span>
              <input value={celular} onChange={(e) => setCelular(e.target.value.replace(/[^\d() -]/g, '').slice(0, 16))} inputMode="tel" placeholder="(41) 99999-9999" className={INPUT} /></label>
            <label className="block"><span className="text-sm font-semibold text-zinc-700">Aniversário <span className="font-normal text-zinc-400">(opcional — tem presente)</span></span>
              <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className={INPUT} /></label>
            <label className="flex items-start gap-2 text-sm text-zinc-700"><input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} className="mt-0.5 w-5 h-5 accent-amber-500" />
              Quero participar do {programa.nome}. Meu CPF e celular serão usados só para somar pontos e liberar prêmios.</label>
            <label className="flex items-start gap-2 text-sm text-zinc-700"><input type="checkbox" checked={ofertas} onChange={(e) => setOfertas(e.target.checked)} className="mt-0.5 w-5 h-5 accent-amber-500" />
              Quero receber novidades e ofertas no WhatsApp.</label>
          </>
        )}
        {erro && <p className="text-sm font-semibold text-rose-600">{erro}</p>}
        <button onClick={() => { void enviar(); }} disabled={enviando} className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-lg cursor-pointer disabled:opacity-50">
          {enviando ? 'Aguarde…' : modo === 'entrar' ? 'Ver meus pontos' : 'Entrar no clube'}
        </button>
      </div>
    </section>
  );
}

// ── Roleta ──────────────────────────────────────────────────────────────────
function Roleta({ fatias, giros, token, onFim }: { fatias: { id: string; nome: string; cor: string; peso: number }[]; giros: number; token: string; onFim: () => void }) {
  const [rot, setRot] = useState(0);
  const [girando, setGirando] = useState(false);
  const [premio, setPremio] = useState<{ nome: string; tipo: string } | null>(null);
  const [erro, setErro] = useState('');
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const girar = async () => {
    if (girando) return;
    setGirando(true); setPremio(null); setErro('');
    setRot((r) => r + 720);
    const r = await clubeChamar<{ giro?: { indice: number; premio: { nome: string; tipo: string } } }>({ action: 'girar', token });
    if (!vivo.current) return;
    if (r.error || !r.giro || r.giro.indice < 0) { setErro(r.message || 'Não consegui girar.'); setGirando(false); return; }
    setRot((x) => rotacaoParaFatia(fatias, r.giro!.indice, x, 6));
    setTimeout(() => { if (!vivo.current) return; setGirando(false); setPremio(r.giro!.premio); onFim(); }, 3300);
  };
  return (
    <section className="bg-gradient-to-br from-fuchsia-600 to-amber-500 rounded-2xl p-4 text-white text-center">
      <h3 className="font-black text-xl">🎡 Você tem {giros} giro{giros > 1 ? 's' : ''}!</h3>
      <div className="my-3"><RoletaSvg premios={fatias} rotacao={rot} tamanho="w-60 h-60" seta="border-t-white" /></div>
      {premio && <p className="font-black text-lg mb-2">{premio.tipo === 'nada' ? `${premio.nome} 😅` : `🎉 ${premio.nome}!`}</p>}
      {erro && <p className="font-semibold mb-2">{erro}</p>}
      <button onClick={() => { void girar(); }} disabled={girando} className="px-8 py-3 rounded-xl bg-white text-fuchsia-700 font-black text-lg cursor-pointer disabled:opacity-60">
        {girando ? 'Girando…' : 'GIRAR'}
      </button>
    </section>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────
export default function ClubePage() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const [params, setParams] = useSearchParams();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [lojaNome, setLojaNome] = useState('');
  const [programa, setPrograma] = useState<ClubeProgramaPublico | null>(null);
  const [ativo, setAtivo] = useState<boolean | null>(null);
  const [dados, setDados] = useState<ClubeDados | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState('');

  const entrou = useCallback((d: ClubeDados, tid: string) => {
    if (d.token) { clubeSalvarToken(tid, d.token); setToken(d.token); }
    setDados(d);
    if (d.programa) setPrograma(d.programa);
  }, []);

  const recarregar = useCallback(async (tok: string) => {
    const r = await clubeChamar<ClubeDados>({ action: 'eu', token: tok });
    if (r.error) return false;
    setDados(r);
    if (r.programa) setPrograma(r.programa);
    return true;
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const linkQr = params.get('entrar');
      const prog = await clubeChamar<{ ativo: boolean; loja: { nome: string; tenant_id: string }; programa: ClubeProgramaPublico | null }>({ action: 'programa', slug: storeSlug });
      if (!vivo) return;
      if (prog.error || !prog.loja) { setAtivo(false); setCarregando(false); return; }
      setTenantId(prog.loja.tenant_id);
      setLojaNome(prog.loja.nome);
      setPrograma(prog.programa);
      setAtivo(prog.ativo);
      if (!prog.ativo) { setCarregando(false); return; }
      if (linkQr) {
        // QR do tablet: link de uso único vira o cartão deste celular.
        const r = await clubeChamar<ClubeDados>({ action: 'entrar_link', token_link: linkQr });
        const p = new URLSearchParams(params); p.delete('entrar'); setParams(p, { replace: true });
        if (!vivo) return;
        if (!r.error) { entrou(r, prog.loja.tenant_id); setCarregando(false); return; }
        setAviso(r.message || 'Este QR já foi usado. Entre com seu CPF.');
      }
      const salvo = clubeTokenSalvo(prog.loja.tenant_id);
      if (salvo) {
        setToken(salvo);
        const okEu = await recarregar(salvo);
        if (!okEu) { clubeSalvarToken(prog.loja.tenant_id, null); setToken(null); }
      }
      if (vivo) setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug]);

  const sair = async () => {
    if (token) await clubeChamar({ action: 'sair', token });
    if (tenantId) clubeSalvarToken(tenantId, null);
    setToken(null); setDados(null);
  };

  const r = dados?.resumo;
  const cor = r?.nivel?.cor ?? '#f59e0b';
  const progresso = useMemo(() => {
    if (!r?.proximo) return 100;
    const base = r.nivel?.min_compras ?? 0;
    return Math.min(100, Math.max(4, ((r.compras_janela - base) / Math.max(1, r.proximo.min_compras - base)) * 100));
  }, [r]);

  if (carregando) return <Carregando />;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="max-w-lg mx-auto px-4 pb-10">
        <header className="pt-6 pb-4 text-center">
          <p className="text-xs uppercase tracking-widest text-zinc-400 font-bold">{lojaNome}</p>
          <h1 className="text-3xl font-black">👑 {programa?.nome ?? 'Clube de vantagens'}</h1>
        </header>

        {!ativo || !programa ? (
          <p className="text-center text-zinc-500 bg-white rounded-2xl border border-zinc-200 p-6">O clube desta loja ainda não está funcionando.</p>
        ) : !r || !token ? (
          <div className="space-y-4">
            {aviso && <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">{aviso}</p>}
            <Acesso tenantId={tenantId!} programa={programa} onEntrou={(d) => entrou(d, tenantId!)} />
            <ComoFunciona p={programa} />
            {programa.recompensas.length > 0 && (
              <section className="bg-white rounded-2xl border border-zinc-200 p-4">
                <h3 className="font-black mb-3">🎁 Troque seus pontos</h3>
                <div className="grid grid-cols-2 gap-2">
                  {programa.recompensas.map((w) => (
                    <div key={w.id} className="rounded-xl border border-zinc-200 overflow-hidden">
                      {w.foto ? <img src={w.foto} alt="" className="w-full h-24 object-cover" /> : <div className="h-24 flex items-center justify-center text-4xl bg-amber-50">🎁</div>}
                      <div className="p-2"><p className="text-sm font-bold leading-tight">{w.nome}</p><p className="text-xs text-amber-600 font-bold">{pts(w.custo_pontos)} pts</p></div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Cartão */}
            <section className="rounded-3xl p-5 text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${cor}, #18181b)` }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm opacity-90">Olá, <b>{r.primeiro_nome}</b>!</p>
                  <p className="text-2xl font-black mt-0.5">{r.nivel ? `${r.nivel.emoji} ${r.nivel.nome}` : '⭐ Bem-vindo'}</p>
                  {r.nivel?.beneficios && <p className="text-xs opacity-80 mt-0.5">{r.nivel.beneficios}</p>}
                </div>
                <div className="text-right">
                  <p className="text-4xl font-black leading-none tabular-nums">{pts(r.saldo)}</p>
                  <p className="text-xs opacity-80">pontos</p>
                </div>
              </div>
              {r.proximo && (
                <div className="mt-4">
                  <div className="h-2.5 bg-white/25 rounded-full overflow-hidden"><div className="h-full bg-white rounded-full" style={{ width: `${progresso}%` }} /></div>
                  <p className="text-xs mt-1.5 opacity-90">{(r.faltam_compras ?? 0) > 0 ? <>Faltam <b>{r.faltam_compras}</b> compra{r.faltam_compras === 1 ? '' : 's'} para {r.proximo.emoji} <b>{r.proximo.nome}</b></> : <>Na próxima compra você vira {r.proximo.emoji} {r.proximo.nome}</>}</p>
                </div>
              )}
              {r.vence_30d > 0 && <p className="text-xs mt-2 font-semibold">⏳ {pts(r.vence_30d)} pontos vencem nos próximos 30 dias.</p>}
            </section>

            {r.giros > 0 && programa.roleta && programa.roleta.fatias.length >= 2 && (
              <Roleta fatias={programa.roleta.fatias} giros={r.giros} token={token} onFim={() => { void recarregar(token); }} />
            )}

            {(r.beneficios.length > 0 || r.recompensas.some((w) => w.nivel_ok && w.falta <= 0)) && (
              <section className="bg-white rounded-2xl border-2 border-emerald-300 p-4">
                <h3 className="font-black text-emerald-700 mb-2">🎁 Você já pode usar</h3>
                <ul className="space-y-1.5 text-sm">
                  {r.beneficios.map((b) => <li key={b.id} className="flex justify-between gap-2"><span><b>{b.reward.nome}</b> <span className="text-zinc-500">· {b.reward.motivo ?? 'prêmio'}</span></span>{b.expires_at && <span className="text-xs text-zinc-400 whitespace-nowrap">até {dataBR(b.expires_at)}</span>}</li>)}
                  {r.recompensas.filter((w) => w.nivel_ok && w.falta <= 0).map((w) => <li key={w.id} className="flex justify-between gap-2"><b>{w.nome}</b><span className="text-amber-600 font-bold whitespace-nowrap">{pts(w.custo_pontos)} pts</span></li>)}
                </ul>
                <p className="text-xs text-zinc-500 mt-3">Use no próximo pedido: no tablet da loja, pelo QR da mesa, no delivery ou no caixa.</p>
              </section>
            )}

            <section className="bg-white rounded-2xl border border-zinc-200 p-4">
              <h3 className="font-black mb-3">Troque seus pontos</h3>
              <div className="space-y-3">
                {r.recompensas.map((w) => {
                  const foto = programa.recompensas.find((x) => x.id === w.id)?.foto;
                  const pronto = w.nivel_ok && w.falta <= 0;
                  return (
                    <div key={w.id} className="flex items-center gap-3">
                      {foto ? <img src={foto} alt="" className="w-12 h-12 rounded-xl object-cover" /> : <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-xl">🎁</div>}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm">{w.nome}</p>
                        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-1"><div className={`h-full rounded-full ${pronto ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, (r.saldo / Math.max(1, w.custo_pontos)) * 100)}%` }} /></div>
                        <p className="text-xs text-zinc-500 mt-0.5">{!w.nivel_ok && w.nivel_minimo ? `A partir do nível ${w.nivel_minimo}` : pronto ? 'Pronto para usar ✓' : `Faltam ${pts(w.falta)} pts`}</p>
                      </div>
                      <span className="text-sm font-black text-amber-600 whitespace-nowrap">{pts(w.custo_pontos)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-zinc-200 p-4">
              <h3 className="font-black mb-2">Seu extrato</h3>
              {dados!.extrato.length === 0 ? <p className="text-sm text-zinc-500">Ainda sem movimentos.</p> : (
                <ul className="divide-y divide-zinc-100">
                  {dados!.extrato.map((e, i) => {
                    const saida = ['redeemed', 'manual_sub', 'expired'].includes(e.tipo);
                    return (
                      <li key={i} className="py-2 flex justify-between gap-3 text-sm">
                        <div className="min-w-0"><p className="truncate">{e.texto}{e.reservado ? ' (reservado)' : ''}</p><p className="text-xs text-zinc-400">{dataBR(e.data)}{!saida && e.vence ? ` · vence ${dataBR(e.vence)}` : ''}</p></div>
                        <span className={`font-bold tabular-nums whitespace-nowrap ${saida ? 'text-rose-600' : 'text-emerald-600'}`}>{saida ? '−' : '+'}{pts(e.pontos)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <details className="bg-white rounded-2xl border border-zinc-200 p-4">
              <summary className="font-black cursor-pointer">Como funciona o clube</summary>
              <div className="mt-3"><ComoFunciona p={programa} /></div>
            </details>

            {dados?.loja?.slug && (
              <a href={`/${dados.loja.slug}-delivery`} className="block text-center py-3.5 rounded-xl bg-zinc-900 text-white font-bold">Pedir no delivery e ganhar pontos →</a>
            )}
            <button onClick={() => { void sair(); }} className="w-full py-2 text-sm text-zinc-400 cursor-pointer">Sair deste aparelho</button>
          </div>
        )}
      </div>
    </div>
  );
}
