// Liga a conversa com a equipe a um painel de chat (2026-09-23): o do dono (AssistenteChat) e o das
// demais pessoas (AcoesRapidasFlutuante). Devolve a seção da lista, a camada aberta por cima do
// painel (nova conversa / conversa) e as não lidas para o badge do botão.
// Por loja (2026-09-24): quem está em mais de uma loja vê uma aba por loja, com as não lidas de cada
// uma; a lista mostra só as conversas da loja escolhida (começa na loja aberta no ERPOS).
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import { ESCOPO_TAREFAS } from './api';
import ConversaEquipe from './ConversaEquipe';
import { ListaEquipe, NovaConversaEquipe, type ConversaAberta, type LojaEquipe } from './ListaEquipe';
import { useConversasEquipe } from './useConversasEquipe';

export function useEquipeNoChat({ ativo = true, abrirPainel, fecharPainel, semTitulo }: {
  /** false = não carrega nem escuta nada (o mesmo componente monta para quem não usa). */
  ativo?: boolean;
  /** O link do aviso no celular (?conversa=<id>) abre o painel do chat já na conversa. */
  abrirPainel: () => void;
  fecharPainel?: () => void;
  /** A lista fica numa aba própria (chat do dono): sem o título "Equipe". */
  semTitulo?: boolean;
}) {
  const { user } = useAuth();
  // Sem loja o user do AuthContext é nulo: o id vem da sessão (useEuTarefas, 2026-09-24).
  const eu = useEuTarefas();
  const { hasModule } = useModuleAccess();
  const { conversas, naoLidas, recarregar } = useConversasEquipe(ativo ? (user?.id ?? eu.id ?? undefined) : undefined);
  const [aberta, setAberta] = useState<ConversaAberta | null>(null);
  const [nova, setNova] = useState(false);
  // Sem loja, a única aba é Tarefas.
  const lojaAtiva = user?.tenantId ?? (hasModule('tarefas') ? ESCOPO_TAREFAS : '');
  const [lojaSel, setLojaSel] = useState(lojaAtiva);
  // Trocou de loja no ERPOS: a lista acompanha.
  useEffect(() => { if (lojaAtiva) setLojaSel(lojaAtiva); }, [lojaAtiva]);
  const location = useLocation();
  const navigate = useNavigate();

  // Tocou no aviso "mensagem de Fulano": /modulos?conversa=<thread_id>.
  const pedida = ativo ? new URLSearchParams(location.search).get('conversa') : null;
  useEffect(() => {
    if (!pedida) return;
    const c = conversas.find((x) => x.thread_id === pedida);
    setAberta({ threadId: pedida, pessoa: c?.pessoa ?? null, loja: c?.loja });
    if (c?.tenant_id) setLojaSel(c.tenant_id);
    abrirPainel();
    const q = new URLSearchParams(location.search);
    q.delete('conversa');
    navigate({ pathname: location.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
  }, [pedida]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nome da pessoa / loja chegaram depois (a lista carregou depois do link): completa o cabeçalho.
  useEffect(() => {
    if (!aberta || aberta.pessoa) return;
    const c = conversas.find((x) => x.thread_id === aberta.threadId);
    if (c?.pessoa) {
      setAberta({ ...aberta, pessoa: c.pessoa, loja: c.loja });
      if (c.tenant_id) setLojaSel(c.tenant_id);
    }
  }, [conversas, aberta]);

  // Abas: a loja aberta no ERPOS + toda loja onde já existe conversa (com as não lidas de cada uma).
  // NÃO usar availableTenants do AuthContext: ele só fica preenchido na tela de escolher loja e volta
  // vazio depois de entrar — as abas nunca apareciam e a lista misturava as lojas (visto em 2026-09-24).
  // Para começar conversa numa loja sem conversa ainda, troca-se a loja no ERPOS (a aba vem junto).
  const lojas: LojaEquipe[] = [];
  const somar = (id: string, nome: string, n: number) => {
    const l = lojas.find((x) => x.id === id);
    if (l) { l.naoLidas += n; if (!l.nome && nome) l.nome = nome; } else lojas.push({ id, nome, naoLidas: n });
  };
  if (lojaAtiva) somar(lojaAtiva, lojaAtiva === ESCOPO_TAREFAS ? 'Tarefas' : (user?.loja ?? ''), 0);
  // Quem tem Tarefas ganha a aba Tarefas: conversa com quem divide pasta/tarefa, mesmo sem loja em comum.
  if (hasModule('tarefas')) somar(ESCOPO_TAREFAS, 'Tarefas', 0);
  for (const c of conversas) if (c.tenant_id) somar(c.tenant_id, c.loja, c.nao_lidas);
  for (const l of lojas) if (!l.nome) l.nome = 'Loja';
  const multiLoja = lojas.length > 1;
  // Sempre só a loja escolhida; conversa sem tenant_id (Edge antiga) aparece em qualquer aba.
  const daLoja = conversas.filter((c) => !c.tenant_id || c.tenant_id === lojaSel);
  const nomeLojaSel = lojas.find((l) => l.id === lojaSel)?.nome;

  const secao = (
    <ListaEquipe
      conversas={daLoja}
      onAbrir={setAberta}
      onNova={() => setNova(true)}
      lojas={lojas}
      lojaSel={lojaSel}
      onLoja={setLojaSel}
      semTitulo={semTitulo}
    />
  );

  const camada = aberta ? (
    <ConversaEquipe
      key={aberta.threadId}
      threadId={aberta.threadId}
      pessoa={aberta.pessoa}
      // Nome da loja no cabeçalho sempre que há mais de uma aba — para não confundir as conversas.
      loja={multiLoja ? aberta.loja : undefined}
      onVoltar={() => { setAberta(null); recarregar(); }}
      onFechar={fecharPainel ? () => { setAberta(null); fecharPainel(); } : undefined}
      onMudou={recarregar}
    />
  ) : nova ? (
    <NovaConversaEquipe
      loja={lojaSel}
      nomeLoja={nomeLojaSel}
      onVoltar={() => setNova(false)}
      onEscolher={(c) => { setNova(false); setAberta(c); recarregar(); }}
    />
  ) : null;

  return { secao, camada, naoLidas, recarregar };
}
