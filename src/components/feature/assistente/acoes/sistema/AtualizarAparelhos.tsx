// Ação rápida: "Atualizar os aparelhos" (2026-09-24). Depois de um deploy, manda todo aparelho
// logado (celulares, PDV, KDS, tablets, de todas as lojas) recarregar na versão nova — cada tela
// mostra o aviso e recarrega quando a pessoa parar de digitar (AvisoAtualizacao). Só Admin.
import { useEffect, useRef, useState } from 'react';
import { pedirAtualizacaoDosAparelhos } from '@/hooks/useAtualizarApp';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, type AcaoProps } from '../kit';

export default function AtualizarAparelhos({ onFechar }: AcaoProps) {
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'confirmar' | 'gravando' | 'fim'>('confirmar');
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot('Todos os aparelhos com alguém logado (celulares, PDV, KDS, tablets) vão recarregar na versão mais nova do sistema. Quem estiver digitando termina antes — a tela espera parar.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mandar = async () => {
    eu('Atualizar agora');
    setPasso('gravando');
    const ok = await pedirAtualizacaoDosAparelhos();
    bot(ok ? '✅ Pedido enviado. Os aparelhos recarregam em até ~20 segundos.' : 'Não consegui avisar os aparelhos (sem conexão?). Tente de novo.');
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Atualizar os aparelhos" icone="ri-refresh-line" cor="bg-violet-50 text-violet-600" baloes={baloes}
      carregando={passo === 'gravando'} textoCarregando="Avisando os aparelhos…" onFechar={onFechar}>
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={mandar}>Atualizar agora</Opcao>
          <OpcaoNeutra onClick={onFechar}>Agora não</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} />}
    </Roteiro>
  );
}
