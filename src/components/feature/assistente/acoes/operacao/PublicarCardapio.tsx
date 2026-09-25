// Ação rápida: "Publicar cardápio" (2026-09-24) — o mesmo botão "Publicar alterações" da aba
// Cardápio (publicarCardapio → canal menu-ping da loja): toda tela aberta com o cardápio (PDV,
// garçom, delivery, totem, mesa, QR) recarrega o cardápio sem ninguém dar F5.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { publicarCardapio } from '@/hooks/useMenuPing';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, type AcaoProps } from '../kit';

export default function PublicarCardapio({ onFechar }: AcaoProps) {
  const { user } = useAuth();
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'confirmar' | 'gravando' | 'fim'>('confirmar');
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(`*Loja: ${user?.loja || 'loja ativa'}*`);
    if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    bot('Todas as telas abertas com o cardápio desta loja (PDV, garçom, delivery, totem, mesa e QR) vão recarregar o cardápio agora.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mandar = async () => {
    if (!user?.tenantId) return;
    eu('Publicar agora');
    setPasso('gravando');
    const ok = await publicarCardapio(user.tenantId);
    bot(ok ? '✅ Cardápio publicado. As telas atualizam em alguns segundos.' : 'Não consegui avisar as telas (sem conexão?). Tente de novo.');
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Publicar cardápio" icone="ri-restaurant-line" cor="bg-orange-50 text-orange-600" baloes={baloes}
      carregando={passo === 'gravando'} textoCarregando="Avisando as telas…" onFechar={onFechar}>
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={mandar}>Publicar agora</Opcao>
          <OpcaoNeutra onClick={onFechar}>Agora não</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} />}
    </Roteiro>
  );
}
