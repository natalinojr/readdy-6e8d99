import { createContext, useContext } from 'react';
import type { ConfigDelivery } from './config';
import type { UseDeliveryStateReturn } from '@/hooks/useDeliveryState';

// Contexto da tela Delivery (layout novo aprovado em 2026-10-05, protótipo docs/prototipos/delivery-proposta.html).
// A página (page.tsx) carrega a configuração uma vez; cada aba lê `cfg` e muda com `mudar` — nada grava até
// o "Salvar" da barra de baixo (que aparece sozinha quando há mudança). Ações que valem na hora (bloquear
// entregador, pausar o delivery, responder conversa) continuam gravando direto, como antes.

export type AbaDelivery =
  | 'inicio'
  | 'area' | 'horario' | 'pagamento' | 'regras'
  | 'equipe' | 'acerto' | 'avisos'
  | 'links'
  | 'conversas' | 'assistente' | 'mensagens';

export interface Motoboy {
  id: string;
  name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  /** Entregas entregues nos últimos 30 dias. */
  entregas_30d: number;
}

export interface DeliveryTelaApi {
  tenantId: string;
  slug: string;
  nomeLoja: string;
  /** Link público do delivery da loja (https://…/<slug>-delivery). */
  linkDelivery: string;
  /** Rascunho da configuração (o que está na tela, salvo ou não). */
  cfg: ConfigDelivery;
  /** Como está gravado no banco. */
  salvo: ConfigDelivery;
  /** Muda o rascunho (não grava). */
  mudar: (patch: Partial<ConfigDelivery> | ((c: ConfigDelivery) => Partial<ConfigDelivery>)) => void;
  irPara: (aba: AbaDelivery) => void;
  /**
   * Uma aba que tem rascunho PRÓPRIO (fora da barra de salvar da página) diz aqui quantas mudanças não salvas tem
   * (`n` 0 = nenhuma). O aviso "Sair sem salvar?" e o do navegador ao fechar a aba passam a contar isso.
   * `chave` identifica quem avisa (ex.: 'assistente').
   */
  marcarPendenciaExtra: (chave: string, n: number) => void;
  /** A barra "Salvar" da página está na tela (mudança não salva ou "Salvo")? As abas com barra própria sobem acima dela. */
  barraSalvarAberta: boolean;
  /** Dono (perfil admin): só ele vê a parte do WhatsApp (o banco só deixa o dono ler as conversas). */
  ehDono: boolean;
  /** Entregadores da loja (carregados uma vez pela página). */
  motoboys: Motoboy[];
  motoboysCarregando: boolean;
  recarregarMotoboys: () => Promise<void>;
  /** Estado do delivery agora (aberto/pausado/dia corrido) — um só para o cabeçalho e o Início (um canal realtime). */
  estado: UseDeliveryStateReturn;
}

export const DeliveryTelaContext = createContext<DeliveryTelaApi | null>(null);

export function useDeliveryTela(): DeliveryTelaApi {
  const api = useContext(DeliveryTelaContext);
  if (!api) throw new Error('useDeliveryTela fora da tela Delivery');
  return api;
}
