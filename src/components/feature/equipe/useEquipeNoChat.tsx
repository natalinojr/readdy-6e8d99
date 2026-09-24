// Liga a conversa com a equipe a um painel de chat (2026-09-23): o do dono (AssistenteChat) e o das
// demais pessoas (AcoesRapidasFlutuante). Devolve a seção da lista, a camada aberta por cima do
// painel (nova conversa / conversa) e as não lidas para o badge do botão.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ConversaEquipe from './ConversaEquipe';
import { ListaEquipe, NovaConversaEquipe, type ConversaAberta } from './ListaEquipe';
import { useConversasEquipe } from './useConversasEquipe';

export function useEquipeNoChat({ ativo = true, abrirPainel, fecharPainel }: {
  /** false = não carrega nem escuta nada (o mesmo componente monta para quem não usa). */
  ativo?: boolean;
  /** O link do aviso no celular (?conversa=<id>) abre o painel do chat já na conversa. */
  abrirPainel: () => void;
  fecharPainel?: () => void;
}) {
  const { user, availableTenants: lojas } = useAuth();
  const availableTenants = lojas ?? [];
  const { conversas, naoLidas, recarregar } = useConversasEquipe(ativo ? user?.id : undefined);
  const [aberta, setAberta] = useState<ConversaAberta | null>(null);
  const [nova, setNova] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Tocou no aviso "mensagem de Fulano": /modulos?conversa=<thread_id>.
  const pedida = ativo ? new URLSearchParams(location.search).get('conversa') : null;
  useEffect(() => {
    if (!pedida) return;
    const c = conversas.find((x) => x.thread_id === pedida);
    setAberta({ threadId: pedida, pessoa: c?.pessoa ?? null, loja: c?.loja });
    abrirPainel();
    const q = new URLSearchParams(location.search);
    q.delete('conversa');
    navigate({ pathname: location.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
  }, [pedida]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nome da pessoa chegou depois (a lista carregou depois do link): completa o cabeçalho.
  useEffect(() => {
    if (!aberta || aberta.pessoa) return;
    const c = conversas.find((x) => x.thread_id === aberta.threadId);
    if (c?.pessoa) setAberta({ ...aberta, pessoa: c.pessoa, loja: c.loja });
  }, [conversas, aberta]);

  const secao = (
    <ListaEquipe
      conversas={conversas}
      onAbrir={setAberta}
      onNova={() => setNova(true)}
      mostrarLoja={availableTenants.length > 1}
    />
  );

  const camada = aberta ? (
    <ConversaEquipe
      key={aberta.threadId}
      threadId={aberta.threadId}
      pessoa={aberta.pessoa}
      loja={availableTenants.length > 1 ? aberta.loja : undefined}
      onVoltar={() => { setAberta(null); recarregar(); }}
      onFechar={fecharPainel ? () => { setAberta(null); fecharPainel(); } : undefined}
      onMudou={recarregar}
    />
  ) : nova ? (
    <NovaConversaEquipe
      onVoltar={() => setNova(false)}
      onEscolher={(c) => { setNova(false); setAberta(c); recarregar(); }}
    />
  ) : null;

  return { secao, camada, naoLidas, recarregar };
}
