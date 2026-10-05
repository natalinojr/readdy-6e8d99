// Usuários › Acesso (2026-10-03): "o que essa pessoa faz?" em cada loja, em vez do cargo + grade de
// 81 permissões. O cargo é só o ponto de partida; o que a pessoa faz a mais ou a menos vira o ajuste
// dela naquela loja (user_permissions). Protótipo aprovado: docs/prototipos/acesso-por-pessoa-proposta.html.
// Lê e grava pela Edge acesso-pessoa, que confere de novo quem pode dar o quê (_shared/acesso-pessoa.ts).
import { useEffect, useMemo, useState } from 'react';
import { confirmar } from '@/components/base/Dialogos';
import { invokeWithAuth } from '@/lib/supabase';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';
import { PERMISSOES_CATALOGO } from '@/constants/permissoesCatalogo';
import { TRABALHOS, GRUPOS_TRABALHO, estadoTrabalho, alternarTrabalho, ajustesDaPessoa, trabalhoDoCargo, trabalhoFixoNoCargo, chaveForaDoCargo, PAPEIS_PRESOS, type Trabalho } from '@/constants/trabalhos';

interface LojaAcesso {
  tenant_id: string;
  loja: string;
  papel: string;
  keys: string[];
  ajustes: number;
  padrao: string[];
  editor: string;
  keysDoEditor: string[];
  cargos: string[];
  padroes: Record<string, string[]>;
  podeEditar: boolean;
  motivo: string | null;
}
interface Leitura { pessoa: { id: string; nome: string; email: string }; lojas: LojaAcesso[]; soDono: string[] }
interface Rascunho { papel: string; keys: Set<string> }

const nomeCargo = (p: string) => perfilConfig[p as PerfilUsuario]?.label ?? p;
const descCargo: Record<string, string> = {
  gerente: 'abaixo do Administrador', supervisao: 'fica na loja', caixa: 'vende no balcão', garcom: 'atende mesas', cozinha: 'prepara os pedidos',
  gestor_entregas: 'só as entregas', financeiro: 'só o financeiro', contabilidade: 'contador(a)', tarefas: 'só Tarefas',
};

export default function AcessoPessoa({ userId, nome, onClose, onSalvo }: { userId: string; nome: string; onClose: () => void; onSalvo?: (msg: string) => void }) {
  const [dados, setDados] = useState<Leitura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lojaId, setLojaId] = useState('');
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const [trocaPara, setTrocaPara] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  /** Relê do servidor. `so` = recomeça o rascunho só desta loja (acabou de salvar) — o das outras fica. */
  const carregar = async (so?: string) => {
    setErro(null);
    const { data, error } = await invokeWithAuth<Leitura & { error?: string }>('acesso-pessoa', { body: { action: 'ler', user_id: userId } });
    const falha = data?.error ?? error?.message;
    if (falha || !data) { setErro(falha ?? 'Não consegui ler o acesso.'); return; }
    setDados(data);
    setRascunhos((antes) => Object.fromEntries(data.lojas.map((l) => [
      l.tenant_id,
      so && so !== l.tenant_id && antes[l.tenant_id] ? antes[l.tenant_id] : { papel: l.papel, keys: new Set(l.keys) },
    ])));
    setLojaId((atual) => (data.lojas.some((l) => l.tenant_id === atual) ? atual : data.lojas[0]?.tenant_id ?? ''));
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const loja = dados?.lojas.find((l) => l.tenant_id === lojaId) ?? null;
  const r = loja ? rascunhos[loja.tenant_id] : null;
  const primeiro = (nome || dados?.pessoa.nome || 'a pessoa').split(' ')[0];

  const padrao = useMemo(() => new Set(loja && r ? loja.padroes[r.papel] ?? (r.papel === loja.papel ? loja.padrao : []) : []), [loja, r]);
  const atuais = useMemo(() => new Set(loja?.keys ?? []), [loja]);
  const doEditor = useMemo(() => new Set(loja?.keysDoEditor ?? []), [loja]);
  const soDono = useMemo(() => new Set(dados?.soDono ?? []), [dados]);
  const dono = loja?.editor === 'admin';

  /** Liga só o que vem do cargo, ou o que funciona para esse cargo (chaveForaDoCargo) e — se quem edita é o
   *  supervisor — o que a pessoa já tinha ou o que ele mesmo tem (nunca dinheiro). Mesma regra do servidor. */
  const podeDar = (k: string) => padrao.has(k)
    || (!chaveForaDoCargo(r?.papel ?? '', k) && (dono || atuais.has(k) || (doEditor.has(k) && !soDono.has(k))));
  const mudou = (id: string) => {
    const l = dados?.lojas.find((x) => x.tenant_id === id); const d = rascunhos[id];
    if (!l || !d) return false;
    return d.papel !== l.papel || d.keys.size !== l.keys.length || l.keys.some((k) => !d.keys.has(k));
  };

  const set = (fn: (d: Rascunho) => Rascunho) => {
    if (!loja || !r) return;
    setRascunhos((all) => ({ ...all, [loja.tenant_id]: fn(all[loja.tenant_id]) }));
  };
  const escolherCargo = (p: string, confirmado = false) => {
    if (!loja || !r || p === r.papel) return;
    const temAjuste = ajustesDaPessoa(padrao, r.keys).length > 0;
    if (temAjuste && !confirmado) { setTrocaPara(p); return; }
    setTrocaPara(null);
    set(() => ({ papel: p, keys: new Set(loja.padroes[p] ?? []) }));
  };
  const alternar = (t: Trabalho) => {
    if (!r) return;
    const ligar = estadoTrabalho(t, r.keys) !== 'on';
    set((d) => ({ ...d, keys: alternarTrabalho(t, d.keys, ligar) }));
  };
  const alternarKey = (k: string) => set((d) => { const n = new Set(d.keys); if (n.has(k)) n.delete(k); else n.add(k); return { ...d, keys: n }; });

  const salvar = async () => {
    if (!loja || !r) return;
    setSalvando(true); setErro(null);
    const { data, error } = await invokeWithAuth<{ ok?: boolean; error?: string; ajustes?: number }>('acesso-pessoa', {
      body: { action: 'salvar', user_id: userId, tenant_id: loja.tenant_id, papel: r.papel, keys: [...r.keys] },
    });
    setSalvando(false);
    const falha = data?.error ?? error?.message;
    if (falha) { setErro(falha); return; }
    const n = data?.ajustes ?? 0;
    onSalvo?.(`Acesso de ${primeiro} em ${loja.loja} salvo${n ? ` — ${n} ajuste${n > 1 ? 's' : ''} só para essa pessoa` : ' — igual ao padrão do cargo'}.`);
    await carregar(loja.tenant_id);
  };

  const ajustes = loja && r ? ajustesDaPessoa(padrao, r.keys) : [];
  /** Fechar com mudança não salva pergunta antes (a bolinha da loja promete guardar). */
  const fechar = async () => {
    const pendentes = (dados?.lojas ?? []).filter((l) => mudou(l.tenant_id)).map((l) => l.loja);
    if (pendentes.length && !(await confirmar({
      titulo: 'Sair sem salvar?',
      mensagem: `Você mudou e não salvou o acesso em: ${pendentes.join(', ')}. Se sair, as mudanças se perdem.`,
      confirmarLabel: 'Sair sem salvar', cancelarLabel: 'Continuar editando', perigo: true,
    }))) return;
    onClose();
  };
  const mais = ajustes.filter((a) => a.allowed).length;
  const menos = ajustes.length - mais;
  const editavel = !!loja?.podeEditar;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={fechar}>
      <div className="w-full md:max-w-2xl max-h-[94vh] md:max-h-[90vh] bg-[#FAF7F2] rounded-t-3xl md:rounded-3xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Topo */}
        <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-zinc-200/70 bg-white/60">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Acesso</p>
            <h2 className="text-lg font-extrabold text-zinc-900 truncate">O que {primeiro} faz?</h2>
          </div>
          <button onClick={fechar} aria-label="Fechar" className="w-9 h-9 rounded-xl border border-zinc-200 bg-white flex items-center justify-center text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {erro && <p className="mt-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">{erro}</p>}
          {!dados && !erro && <div className="mx-auto my-12 w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}

          {dados && loja && r && (
            <>
              {/* Lojas: cada uma tem a sua configuração */}
              {dados.lojas.length > 1 && (
                <div className="mt-4">
                  <p className="text-[12px] font-bold text-zinc-500 mb-1.5">Cada loja tem a sua configuração</p>
                  <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {dados.lojas.map((l) => (
                      <button key={l.tenant_id} onClick={() => { setLojaId(l.tenant_id); setTrocaPara(null); }}
                        className={`flex-shrink-0 h-9 px-3 rounded-full border text-[13px] font-bold cursor-pointer inline-flex items-center gap-1.5 ${l.tenant_id === loja.tenant_id ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600'}`}>
                        {l.loja}{mudou(l.tenant_id) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Mudou e não salvou" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!editavel && (
                <p className="mt-4 rounded-xl bg-zinc-100 border border-zinc-200 px-3 py-2.5 text-[13px] text-zinc-600"><i className="ri-lock-2-line" /> {loja.motivo}</p>
              )}

              {/* Cargo = ponto de partida */}
              {editavel && (
                <section className="mt-4">
                  <div className="flex items-baseline gap-2 mb-2"><h3 className="text-[15px] font-extrabold text-zinc-900">Começar pelo cargo</h3><span className="text-[12px] text-zinc-400">marca o que é comum</span></div>
                  <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {loja.cargos.map((c) => (
                      <button key={c} onClick={() => escolherCargo(c)}
                        className={`flex-shrink-0 min-w-[104px] text-left rounded-2xl border px-3 py-2 cursor-pointer ${r.papel === c ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-800'}`}>
                        <span className="block text-[13px] font-bold">{nomeCargo(c)}</span>
                        <span className={`block text-[11px] ${r.papel === c ? 'text-zinc-300' : 'text-zinc-400'}`}>{descCargo[c] ?? ''}</span>
                      </button>
                    ))}
                  </div>
                  {trocaPara && (
                    <div className="mt-2 rounded-2xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[13px] text-amber-900">
                      Voltar para o padrão de <b>{nomeCargo(trocaPara)}</b>? {ajustes.length === 1 ? 'O ajuste' : `Os ${ajustes.length} ajustes`} de {primeiro} {ajustes.length === 1 ? 'sai' : 'saem'}.
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => escolherCargo(trocaPara, true)} className="h-8 px-3 rounded-lg bg-zinc-900 text-white text-[12px] font-bold cursor-pointer">Trocar</button>
                        <button onClick={() => setTrocaPara(null)} className="h-8 px-3 rounded-lg border border-amber-200 bg-white text-[12px] font-bold cursor-pointer">Cancelar</button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* O que faz */}
              <section className="mt-5">
                <div className="flex items-baseline gap-2 mb-1"><h3 className="text-[15px] font-extrabold text-zinc-900">O que {primeiro} faz em {loja.loja}</h3></div>
                {GRUPOS_TRABALHO.map((g) => {
                  const itens = TRABALHOS.filter((t) => t.grupo === g && trabalhoDoCargo(t, r.papel));
                  if (!itens.length && g !== 'Dinheiro') return null;
                  return (
                    <div key={g} className="mt-3">
                      <p className="text-[11px] font-extrabold uppercase tracking-widest text-zinc-400 mb-1.5 px-1">{g}</p>
                      <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
                        {itens.map((t) => {
                          const fixo = trabalhoFixoNoCargo(t, r.papel);
                          const est = estadoTrabalho(t, r.keys);
                          const estPadrao = estadoTrabalho(t, padrao);
                          const pode = editavel && !fixo && (est !== 'off' || t.keys.every(podeDar));
                          const bloqueado = editavel && !fixo && !pode;
                          return (
                            <button key={t.id} disabled={!pode} onClick={() => alternar(t)}
                              className={`w-full flex items-start gap-3 px-3.5 py-3 text-left ${pode ? 'cursor-pointer hover:bg-zinc-50' : 'cursor-default'}`}>
                              <span className={`w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center ${est !== 'off' ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-400'}`}><i className={`${t.icone} text-lg`} /></span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[14px] font-bold text-zinc-800 leading-snug">{t.titulo}</span>
                                <span className="block text-[12px] text-zinc-400 leading-snug">{t.pode}</span>
                                {est === 'parcial' && <span className="inline-block mt-1 text-[10.5px] font-bold text-zinc-500 bg-zinc-100 rounded-md px-1.5">em parte — veja no Avançado</span>}
                                {est !== estPadrao && editavel && <span className="inline-block mt-1 ml-1 text-[10.5px] font-bold text-violet-700 bg-violet-50 rounded-md px-1.5">{est === 'off' ? 'tirado do' : 'a mais que o'} padrão de {nomeCargo(r.papel)}</span>}
                              </span>
                              {fixo
                                ? <span className="flex-shrink-0 mt-1.5 text-[11px] font-bold text-zinc-400 inline-flex items-center gap-1" title="O servidor confere o cargo: não muda por pessoa"><i className="ri-shield-user-line" />vem do cargo</span>
                                : bloqueado
                                ? <span className="flex-shrink-0 mt-1.5 text-[11px] font-bold text-zinc-400 inline-flex items-center gap-1"><i className="ri-lock-2-line" />só o Administrador</span>
                                : <span className={`relative flex-shrink-0 mt-1.5 w-11 h-6 rounded-full transition-colors ${est === 'on' ? 'bg-emerald-600' : est === 'parcial' ? 'bg-emerald-300' : 'bg-zinc-300'}`}>
                                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${est === 'off' ? 'left-0.5' : 'left-[22px]'}`} />
                                  </span>}
                            </button>
                          );
                        })}
                        {g === 'Dinheiro' && (
                          <div className="flex items-start gap-3 px-3.5 py-3">
                            <span className="w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center bg-zinc-100 text-zinc-400"><i className="ri-lock-2-line text-lg" /></span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[14px] font-bold text-zinc-800">Paga contas e muda o acesso das pessoas</span>
                              <span className="block text-[12px] text-zinc-400">Pix e boleto saem só com o PIN do dono</span>
                            </span>
                            <span className="flex-shrink-0 mt-1.5 text-[11px] font-bold text-zinc-400 inline-flex items-center gap-1"><i className="ri-lock-2-line" />só o dono</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {PAPEIS_PRESOS.includes(r.papel)
                  ? <p className="mt-2 px-1 text-[11px] text-zinc-500">{nomeCargo(r.papel)} fica preso à área dele: o que faz vem do cargo.{r.papel === 'financeiro' || r.papel === 'contabilidade' ? ' As abas do Financeiro se ajustam no Avançado.' : ''}</p>
                  : <p className="mt-2 px-1 text-[11px] text-zinc-400">Dinheiro, configurar a loja, clientes e cadastro de pessoas aparecem só para Supervisor. "Vem do cargo" é conferido pelo servidor pelo cargo — muda trocando o cargo.</p>}
              </section>

              {/* Prévia */}
              <Previa papel={r.papel} keys={r.keys} primeiro={primeiro} />

              {/* Avançado: as permissões uma a uma */}
              <details className="mt-3 rounded-2xl border border-zinc-200 bg-white">
                <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-bold text-zinc-600 flex items-center gap-2">
                  <i className="ri-settings-3-line" /> Avançado: as {r.keys.size} permissões, uma a uma <i className="ri-arrow-down-s-line ml-auto" />
                </summary>
                <div className="px-4 pb-4">
                  {[...new Set(PERMISSOES_CATALOGO.map((p) => p.categoria))].map((cat) => (
                    <div key={cat} className="mt-2">
                      <p className="text-[11px] font-extrabold uppercase tracking-widest text-zinc-400 mt-2 mb-1">{cat}</p>
                      {PERMISSOES_CATALOGO.filter((p) => p.categoria === cat).map((p) => {
                        const on = r.keys.has(p.id);
                        const pode = editavel && (on || podeDar(p.id));
                        return (
                          <label key={p.id} className={`flex items-center gap-2 py-1 text-[13px] ${pode ? 'text-zinc-700 cursor-pointer' : 'text-zinc-400'}`}>
                            <input type="checkbox" checked={on} disabled={!pode} onChange={() => alternarKey(p.id)} className="accent-emerald-600" />
                            <span className="flex-1">{p.descricao}</span>
                            {on !== padrao.has(p.id) && editavel && <span className="text-[10px] font-bold text-violet-700">{on ? '+ pessoa' : '− pessoa'}</span>}
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </div>

        {/* Rodapé */}
        {loja && r && editavel && (
          <div className="px-5 py-3 border-t border-zinc-200 bg-white flex items-center gap-3">
            <p className="flex-1 min-w-0 text-[12px] text-zinc-500 leading-snug">
              <b className="text-zinc-800 text-[13px]">{nomeCargo(r.papel)}{mais ? ` +${mais}` : ''}{menos ? ` −${menos}` : ''}</b><br />
              {ajustes.length ? `ajuste só de ${primeiro} em ${loja.loja}` : `igual ao padrão do cargo em ${loja.loja}`}
            </p>
            <button onClick={salvar} disabled={salvando || !mudou(loja.tenant_id)}
              className="h-11 px-5 rounded-xl bg-amber-500 text-zinc-900 text-[14px] font-extrabold disabled:opacity-40 cursor-pointer">
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Como a pessoa vai ver o app com esse acesso (mesmas regras de InicioPorPerfil e dos atalhos da Hoje). */
function Previa({ papel, keys, primeiro }: { papel: string; keys: Set<string>; primeiro: string }) {
  const tem = (k: string) => keys.has(k);
  const entra = papel === 'gerente' || papel === 'supervisao' ? 'Na Hoje — o que precisa ser feito agora'
    : papel === 'caixa' ? 'No computador, direto no caixa; no celular, na Hoje'
    : papel === 'financeiro' || papel === 'contabilidade' ? 'Direto no Financeiro'
    : papel === 'tarefas' ? 'Direto em Tarefas'
    : 'Na tela de módulos';
  const atalhos = [
    (papel === 'caixa' || papel === 'supervisao' || papel === 'gerente') && 'Ir para o caixa',
    ['estoque_receber', 'estoque_movimentar', 'pag_reembolso', 'pag_freelancer', 'pag_fornecedor', 'pag_compra_online', 'pag_beneficio', 'pag_aprovar'].some(tem) && 'Receber mercadoria',
    tem('estoque_movimentar') && 'Contar estoque',
    tem('gestao_dashboard') && 'Loja ao vivo',
    [...keys].some((k) => k.startsWith('fin_')) && 'Financeiro',
  ].filter(Boolean) as string[];
  const naoVe = [
    !tem('gestao_dashboard') && 'faturamento',
    ![...keys].some((k) => k.startsWith('fin_')) && 'financeiro e banco',
    !tem('cardapio_alterar_preco') && 'preços do cardápio',
    !tem('usuarios_gerenciar') && 'cadastro da equipe',
    !tem('configuracoes_editar') && 'configurações',
    'pagar contas',
  ].filter(Boolean) as string[];
  const avisos = [
    (papel === 'supervisao' || papel === 'gerente') && 'pedido de aprovação do caixa',
    (papel === 'supervisao' || papel === 'gerente') && 'bom dia às 8h30',
  ].filter(Boolean) as string[];
  return (
    <section className="mt-5">
      <h3 className="text-[15px] font-extrabold text-zinc-900 mb-2">{primeiro} vai ver assim</h3>
      <div className="relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-b from-white to-amber-50/40 p-4 space-y-2.5">
        <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-amber-100/50 pointer-events-none" />
        <Linha icone="ri-door-open-line" k="Entra em" v={entra} />
        <Linha icone="ri-apps-2-line" k="Atalhos na Hoje" v={atalhos.length ? `Lançar · ${atalhos.join(' · ')}` : 'Lançar'} />
        {avisos.length > 0 && <Linha icone="ri-notification-3-line" k="Avisos no celular" v={avisos.join(' · ')} />}
        <Linha icone="ri-eye-off-line" k="Não vê" v={naoVe.join(', ')} apagado />
      </div>
    </section>
  );
}

function Linha({ icone, k, v, apagado }: { icone: string; k: string; v: string; apagado?: boolean }) {
  return (
    <div className="relative flex items-start gap-2.5">
      <i className={`${icone} text-amber-600 text-base mt-0.5`} />
      <div className="min-w-0">
        <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-400">{k}</p>
        <p className={`text-[13px] leading-snug ${apagado ? 'text-zinc-400' : 'font-semibold text-zinc-800'}`}>{v}</p>
      </div>
    </div>
  );
}
