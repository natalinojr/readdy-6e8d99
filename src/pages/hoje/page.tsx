// Tela Hoje (2026-10-03) — a porta de entrada que CONDUZ: abriu, vê o que precisa de você agora,
// resolve no próprio cartão e, quando acaba, "Tudo em dia". Pedido do dono (2026-10-02): economia
// mental, poucos toques, não ficar pensando se lembrou de tudo. Protótipo aprovado em
// docs/prototipos/hoje-proposta.html. Nenhuma tela saiu: os módulos continuam no menu.
//
// Por perfil: dono = todas as lojas (botões de loja no topo); gerente = o financeiro e a gestão das
// lojas dele; supervisão = quem fica na loja (loja aberta/fechada, estoque, receber, aprovar);
// caixa = no celular (no computador ele entra direto no PDV — ver InicioPorPerfil).
import { useMemo, useState } from 'react';
import { useIsMobile } from '@/pages/tarefas/lib/mobile';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes, RECEBER_MODULO_KEYS } from '@/hooks/usePermissoes';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { kindConfig } from '@/contexts/PendenciasContext';
import { useHoje, type TarefaHoje } from './useHoje';
import { contarAgoraPorLoja, diasEntre, type ItemHoje } from './organizar';
import CartaoHoje from './CartaoHoje';
import { DinheiroHoje, LojaHoje, VendasHoje } from './ResumoHoje';

const saudacao = () => {
  const h = Number(new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
};
const dataLonga = () => {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const PAPEL: Record<string, string> = {
  admin: 'Administrador', gerente: 'Gerente', supervisao: 'Supervisão', caixa: 'Caixa', garcom: 'Garçom', cozinha: 'Cozinha', financeiro: 'Financeiro',
};

interface Atalho { icone: string; label: string; rota: string }

export default function HojePage() {
  const navigate = useNavigate();
  const { user, selectTenant } = useAuth();
  const { hasPermissao } = usePermissoes();
  const { hasModule } = useModuleAccess();
  const { itens, tarefas, feitas, erro, hoje, recarregar, concluirTarefa, marcar, papelDe, nLojas, dono, carregando } = useHoje();
  const [loja, setLoja] = useState('');
  const [verEspera, setVerEspera] = useState(false);
  const [verFeitas, setVerFeitas] = useState(false);
  const [erroTarefa, setErroTarefa] = useState<string | null>(null);
  const [todasTarefas, setTodasTarefas] = useState(false);
  const celular = useIsMobile();

  const perfil = user?.perfil;
  const gestor = perfil === 'admin' || perfil === 'gerente';
  const naLoja = perfil === 'supervisao' || perfil === 'caixa';
  const verVendas = gestor || hasPermissao('gestao_dashboard');
  const verDinheiro = gestor || perfil === 'financeiro';

  const abrir = async (tenantId: string, rota: string) => {
    if (tenantId && tenantId !== user?.tenantId) await selectTenant(tenantId);
    navigate(rota);
  };

  // Lojas com algo (botões do topo só quando há mais de uma).
  const todos = itens ?? [];
  const lojas = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of todos) if (i.bloco !== 'silenciado') m.set(i.tenantId, i.loja || 'Loja');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [todos]);
  const porLoja = useMemo(() => contarAgoraPorLoja(todos), [todos]);
  const filtro = lojas.some(([id]) => id === loja) ? loja : '';
  const vis = filtro ? todos.filter((i) => i.tenantId === filtro) : todos;
  const agora = vis.filter((i) => i.bloco === 'agora');
  const emDia = vis.filter((i) => i.bloco === 'em_dia');
  const espera = vis.filter((i) => i.bloco === 'espera');
  const outros = vis.filter((i) => i.bloco === 'outros');
  const silenciados = vis.filter((i) => i.bloco === 'silenciado').length;
  const lista = tarefas ?? [];
  const tarefasAbertas = lista.filter((t) => !t.feita);
  // Nome da loja nos cartões: quem tem mais de uma loja (mesmo que só uma tenha algo hoje).
  const varias = nLojas > 1 || lojas.length > 1;
  // "Tudo em dia" só com certeza: sem erro de leitura, nada para agora, nada acumulado e as tarefas feitas.
  const tudoEmDia = !carregando && !erro && agora.length === 0 && emDia.length === 0 && tarefasAbertas.length === 0;

  const atalhos: Atalho[] = (() => {
    const receber = gestor || RECEBER_MODULO_KEYS.some((k) => hasPermissao(k));
    const todosA: Record<string, Atalho | null> = {
      financeiro: gestor || perfil === 'financeiro' ? { icone: 'ri-money-dollar-circle-line', label: 'Financeiro', rota: '/financeiro' } : null,
      dashboard: verVendas ? { icone: 'ri-line-chart-line', label: 'Loja ao vivo', rota: '/dashboard' } : null,
      caixa: perfil === 'caixa' || perfil === 'supervisao' || gestor ? { icone: 'ri-computer-line', label: 'Ir para o caixa', rota: '/pdv/caixa' } : null,
      receber: receber ? { icone: 'ri-truck-line', label: 'Receber mercadoria', rota: '/receber' } : null,
      reembolso: receber ? { icone: 'ri-refund-2-line', label: 'Pedir reembolso', rota: '/receber?pedido=reembolso' } : null,
      contar: gestor || hasPermissao('estoque_movimentar') ? { icone: 'ri-scales-3-line', label: 'Contar estoque', rota: '/estoque?tab=inventario' } : null,
      tarefas: hasModule('tarefas') ? { icone: 'ri-task-line', label: 'Tarefas', rota: '/tarefas' } : null,
    };
    const ordem = gestor ? ['financeiro', 'dashboard', 'receber', 'tarefas']
      : perfil === 'supervisao' ? ['caixa', 'receber', 'contar', 'tarefas']
      : perfil === 'caixa' ? ['caixa', 'receber', 'reembolso', 'tarefas']
      : ['receber', 'contar', 'tarefas'];
    return ordem.map((k) => todosA[k]).filter((a): a is Atalho => !!a);
  })();

  const cartao = (i: ItemHoje, compacto = false) => (
    <CartaoHoje key={i.chave} item={i} hoje={hoje} dono={dono} papel={papelDe(i.tenantId)} meuNome={user?.nome ?? 'Gerente'}
      mostrarLoja={varias && !filtro} abrir={abrir} marcar={marcar} onMudou={recarregar} compacto={compacto} />
  );

  const concluir = async (t: TarefaHoje) => {
    setErroTarefa(null);
    try { await concluirTarefa(t); } catch (e) { setErroTarefa(e instanceof Error ? e.message : String(e)); }
  };

  const blocoAtalhos = atalhos.length > 0 && (
    <section>
      <Titulo texto="Fazer outra coisa" />
      <div className="grid grid-cols-2 gap-2">
        {atalhos.map((a) => (
          <button key={a.rota} onClick={() => navigate(a.rota)}
            className="flex items-center gap-2.5 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left text-[13px] font-bold text-zinc-800 hover:border-zinc-300 cursor-pointer min-h-[56px]">
            <span className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-amber-50 text-amber-600"><i className={`${a.icone} text-lg`} /></span>
            {a.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-zinc-400 text-center">
        As outras telas continuam no menu. <button onClick={() => navigate('/modulos')} className="font-semibold text-zinc-500 underline cursor-pointer">Ver os módulos</button>
      </p>
    </section>
  );

  const cartaoTudoEmDia = tudoEmDia && (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-emerald-100/70 pointer-events-none" />
      <div className="relative">
        <span className="mx-auto w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center"><i className="ri-check-line text-2xl" /></span>
        <p className="mt-2 text-lg font-extrabold text-emerald-900">{perfil === 'caixa' ? 'Tudo pronto para vender.' : 'Pode fechar o app.'}</p>
        <p className="text-sm text-emerald-800 mt-0.5">Se aparecer algo novo, ele volta aqui.</p>
      </div>
    </div>
  );
  // Resumo (faturamento, banco, loja). No celular a loja de quem fica na loja vai para o topo.
  const resumoSemLoja = (
    <>
      {verVendas && <VendasHoje />}
      {verDinheiro && <DinheiroHoje />}
      {gestor && !naLoja && <LojaHoje comBotao={false} />}
    </>
  );
  const resumo = (
    <>
      {cartaoTudoEmDia}
      {naLoja && <LojaHoje comBotao />}
      {resumoSemLoja}
    </>
  );

  return (
    <div className="max-w-6xl mx-auto pb-10">
      {/* Cabeçalho: quem, quando e o número que importa */}
      <header className="mb-4">
        <p className="text-sm text-zinc-500">{dataLonga()} · {PAPEL[perfil ?? ''] ?? ''}{dono ? ' · todas as lojas' : user?.loja ? ` · ${user.loja}` : ''}</p>
        <h1 className="text-lg md:text-xl font-bold text-zinc-800 mt-0.5">{saudacao()}, <span className="text-amber-500">{user?.nome?.split(' ')[0] ?? ''}</span></h1>
        <p className={`mt-3 text-[26px] md:text-3xl leading-tight font-extrabold tracking-tight ${tudoEmDia ? 'text-emerald-700' : 'text-zinc-900'}`}>
          {carregando ? 'Vendo o que tem para hoje…'
            : agora.length > 0 ? <><span className="text-red-600">{agora.length}</span> {agora.length === 1 ? 'coisa precisa' : 'coisas precisam'} de você</>
            : tudoEmDia ? 'Tudo em dia ✓' : 'Nada urgente agora'}
        </p>
        {!carregando && (
          <p className="text-sm text-zinc-500 mt-1">
            {agora.length > 0 ? 'Cada cartão resolve aqui mesmo. O resto fica guardado e volta quando apertar.'
              : tudoEmDia ? 'Nada precisa de você agora.'
              : erro ? 'Não consegui conferir tudo — veja o aviso abaixo.'
              : tarefasAbertas.length > 0 ? `Falta${tarefasAbertas.length === 1 ? '' : 'm'} ${tarefasAbertas.length} tarefa${tarefasAbertas.length === 1 ? '' : 's'} de hoje.`
              : 'Sobrou só o trabalho acumulado, para pôr em dia.'}
          </p>
        )}
        {lojas.length > 1 && (
          <div className="flex gap-2 overflow-x-auto mt-3 pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
            {[['', 'Todas'] as [string, string], ...lojas].map(([id, nome]) => {
              const total = id ? porLoja.get(id) ?? 0 : [...porLoja.values()].reduce((s, x) => s + x, 0);
              const on = filtro === id;
              return (
                <button key={id || 'todas'} onClick={() => setLoja(id)}
                  className={`flex-shrink-0 h-9 px-3 inline-flex items-center gap-1.5 rounded-full border text-[13px] font-bold cursor-pointer ${on ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                  {nome}
                  <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] flex items-center justify-center ${total ? (on ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600') : (on ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-400')}`}>{total}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {erro && <p className="mb-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">Não consegui carregar tudo: {erro}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* Computador: resumo e atalhos na coluna da direita. Celular: o que precisa de você vem
            primeiro e o resumo logo depois do "Agora" (montado num lugar só — sem buscar duas vezes). */}
        {!celular && (
          <aside className="space-y-3 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-4">
            {resumo}
            <div className="pt-2">{blocoAtalhos}</div>
          </aside>
        )}

        <main className="space-y-6 lg:col-start-1 lg:row-start-1 min-w-0">
          {celular && cartaoTudoEmDia}
          {celular && naLoja && <LojaHoje comBotao />}
          {carregando && <div className="mx-auto my-10 w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}

          {agora.length > 0 && (
            <section>
              <Titulo texto="Agora" n={agora.length} tom="red" explica="precisa de você hoje" />
              <div className="space-y-2.5">{agora.map((i) => cartao(i))}</div>
            </section>
          )}

          {celular && (verVendas || verDinheiro || gestor) && <div className="space-y-3">{resumoSemLoja}</div>}

          {lista.length > 0 && (
            <section>
              <Titulo texto="Suas tarefas de hoje" n={tarefasAbertas.length} tom={tarefasAbertas.length ? 'zinc' : 'green'} explica={tarefasAbertas.length ? 'vencidas ou para hoje' : 'tudo feito'} />
              {erroTarefa && <p className="mb-2 text-xs text-red-600">{erroTarefa}</p>}
              <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
                {(todasTarefas ? lista : lista.slice(0, 5)).map((t) => <LinhaTarefa key={t.id} t={t} hoje={hoje} onConcluir={() => concluir(t)} onAbrir={() => abrir(t.tenantId, `/tarefas?task=${encodeURIComponent(t.id)}`)} />)}
                {lista.length > 5 && (
                  <button onClick={() => setTodasTarefas((v) => !v)} className="w-full px-4 py-2.5 text-left text-[13px] font-bold text-amber-600 hover:bg-zinc-50 cursor-pointer">
                    {todasTarefas ? 'Mostrar menos' : `Ver as outras ${lista.length - 5}`}
                  </button>
                )}
              </div>
            </section>
          )}

          {emDia.length > 0 && (
            <section>
              <Titulo texto="Para pôr em dia" n={emDia.length} tom="amber" explica="trabalho acumulado" />
              <div className="space-y-2.5">{emDia.map((i) => cartao(i))}</div>
            </section>
          )}

          {outros.length > 0 && (
            <section>
              <Titulo texto="Esperando outras pessoas" n={outros.length} tom="zinc" explica="volta para cá se demorar" />
              <div className="space-y-2.5">{outros.map((i) => cartao(i, true))}</div>
            </section>
          )}

          {espera.length > 0 && (
            <section>
              <button onClick={() => setVerEspera((v) => !v)} className="w-full text-left cursor-pointer">
                <Titulo texto="Pode esperar" n={espera.length} tom="zinc" explica="volta para “Agora” quando apertar" acao={verEspera ? 'Esconder' : 'Ver'} />
              </button>
              {verEspera && <div className="space-y-2.5">{espera.map((i) => cartao(i, true))}</div>}
            </section>
          )}

          {feitas.length > 0 && (
            <section>
              <button onClick={() => setVerFeitas((v) => !v)} className="w-full text-left cursor-pointer">
                <Titulo texto="Resolvido hoje" n={feitas.length} tom="green" explica="" acao={verFeitas ? 'Esconder' : 'Ver'} />
              </button>
              {verFeitas && (
                <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                  {feitas.map((f) => (
                    <div key={f.id} className="flex items-start gap-3 px-4 py-2.5">
                      {f.status === 'descartada'
                        ? <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-400" title="Não vai fazer"><i className="ri-close-line" /></span>
                        : <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><i className="ri-check-line" /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-zinc-700 leading-snug">{f.titulo}</p>
                        <p className="text-[11px] text-zinc-400">{f.status === 'descartada' ? 'Não vai fazer' : kindConfig(f.kind).label}{varias && f.loja ? ` · ${f.loja}` : ''}{f.motivo ? ` · ${f.motivo}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {silenciados > 0 && (
            <p className="text-[12px] text-zinc-400 text-center"><i className="ri-notification-off-line" /> {silenciados} {silenciados === 1 ? 'aviso com “ciente”' : 'avisos com “ciente”'} — {silenciados === 1 ? 'volta' : 'voltam'} sozinho{silenciados === 1 ? '' : 's'} se piorar.</p>
          )}

          {celular && blocoAtalhos}
        </main>
      </div>
    </div>
  );
}

function Titulo({ texto, n, tom = 'zinc', explica, acao }: { texto: string; n?: number; tom?: 'red' | 'amber' | 'zinc' | 'green'; explica?: string; acao?: string }) {
  const cor = { red: 'bg-red-500 text-white', amber: 'bg-amber-100 text-amber-800', zinc: 'bg-zinc-200 text-zinc-600', green: 'bg-emerald-600 text-white' }[tom];
  return (
    <div className="flex items-baseline gap-2 mb-2 px-0.5">
      <h2 className="text-[15px] font-extrabold text-zinc-900">{texto}</h2>
      {n != null && <span className={`px-2 rounded-full text-[11px] font-bold leading-5 ${cor}`}>{n}</span>}
      {explica && <span className="text-[12px] text-zinc-400 truncate">{explica}</span>}
      {acao && <span className="ml-auto text-[12px] font-bold text-amber-600">{acao}</span>}
    </div>
  );
}

function LinhaTarefa({ t, hoje, onConcluir, onAbrir }: { t: TarefaHoje; hoje: string; onConcluir: () => void; onAbrir: () => void }) {
  const dia = t.prazo ? new Date(t.prazo).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : null;
  const atraso = dia ? diasEntre(dia, hoje) : 0;
  const prazo = !dia ? '' : atraso > 0 ? `venceu há ${atraso} dia${atraso > 1 ? 's' : ''}`
    : t.temHora ? `hoje às ${new Date(t.prazo as string).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}` : 'hoje';
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button onClick={onConcluir} disabled={t.feita} aria-label={t.feita ? 'Concluída' : 'Concluir tarefa'}
        className={`w-7 h-7 flex-shrink-0 rounded-full border-2 flex items-center justify-center cursor-pointer ${t.feita ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-zinc-300 hover:border-emerald-500 text-transparent hover:text-emerald-500'}`}>
        <i className="ri-check-line text-base" />
      </button>
      <button onClick={onAbrir} className="flex-1 min-w-0 text-left cursor-pointer">
        <p className={`text-[14px] font-semibold leading-snug ${t.feita ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{t.titulo}</p>
        {!t.feita && prazo && <p className={`text-[12px] ${atraso > 0 ? 'text-red-600' : 'text-zinc-400'}`}>{prazo}</p>}
      </button>
    </div>
  );
}
