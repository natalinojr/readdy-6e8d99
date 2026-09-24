// Liga a conversa com a equipe a um painel de chat (2026-09-23): o do dono (AssistenteChat) e o das
// demais pessoas (AcoesRapidasFlutuante). Devolve a seção da lista, a camada aberta por cima do
// painel (nova conversa / conversa) e as não lidas para o badge do botão.
// Por loja (2026-09-24): quem está em mais de uma loja vê uma aba por loja, com as não lidas de cada
// uma; a lista mostra só as conversas da loja escolhida (começa na loja aberta no ERPOS).
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ConversaEquipe from './ConversaEquipe';
import { ListaEquipe, NovaConversaEquipe, type ConversaAberta, type LojaEquipe } from './ListaEquipe';
import { useConversasEquipe } from './useConversasEquipe';

export function useEquipeNoChat({ ativo = true, abrirPainel, fecharPainel }: {
  /** false = não carrega nem escuta nada (o mesmo componente monta para quem não usa). */
  ativo?: boolean;
  /** O link do aviso no celular (?conversa=<id>) abre o painel do chat já na conversa. */
  abrirPainel: () => void;
  fecharPainel?: () => void;
}) {
  const { user, availableTenants: lojasAuth } = useAuth();
  const availableTenants = lojasAuth ?? [];
  const { conversas, naoLidas, recarregar } = useConversasEquipe(ativo ? user?.id : undefined);
  const [aberta, setAberta] = useState<ConversaAberta | null>(null);
  const [nova, setNova] = useState(false);
  const lojaAtiva = user?.tenantId ?? availableTenants[0]?.tenantId ?? '';
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

  // Uma aba por loja do usuário, na ordem do seletor de lojas. Conversa de loja que não está mais
  // na lista dele (saiu da loja) ainda aparece, para não sumir sem aviso.
  const lojas: LojaEquipe[] = availableTenants.map((t) => ({
    id: t.tenantId, nome: t.tenantName,
    naoLidas: conversas.filter((c) => c.tenant_id === t.tenantId).reduce((s, c) => s + c.nao_lidas, 0),
  }));
  for (const c of conversas) {
    if (c.tenant_id && !lojas.some((l) => l.id === c.tenant_id)) lojas.push({ id: c.tenant_id, nome: c.loja || 'Outra loja', naoLidas: 0 });
    if (c.tenant_id && c.nao_lidas) {
      const l = lojas.find((x) => x.id === c.tenant_id);
      if (l && !availableTenants.some((t) => t.tenantId === c.tenant_id)) l.naoLidas += c.nao_lidas;
    }
  }
  const multiLoja = lojas.length > 1;
  // Uma loja só: mostra tudo (inclui conversa antiga sem tenant_id na resposta).
  const daLoja = multiLoja ? conversas.filter((c) => c.tenant_id === lojaSel) : conversas;

  const secao = (
    <ListaEquipe
      conversas={daLoja}
      onAbrir={setAberta}
      onNova={() => setNova(true)}
      lojas={lojas}
      lojaSel={lojaSel}
      onLoja={setLojaSel}
    />
  );

  const camada = aberta ? (
    <ConversaEquipe
      key={aberta.threadId}
      threadId={aberta.threadId}
      pessoa={aberta.pessoa}
      loja={multiLoja ? aberta.loja : undefined}
      onVoltar={() => { setAberta(null); recarregar(); }}
      onFechar={fecharPainel ? () => { setAberta(null); fecharPainel(); } : undefined}
      onMudou={recarregar}
    />
  ) : nova ? (
    <NovaConversaEquipe
      loja={lojaSel}
      onVoltar={() => setNova(false)}
      onEscolher={(c) => { setNova(false); setAberta(c); recarregar(); }}
    />
  ) : null;

  return { secao, camada, naoLidas, recarregar };
}
