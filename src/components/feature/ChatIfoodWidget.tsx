import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// Chat do iFood dentro do ERPOS (2026-10-06): o "Widget" oficial do iFood (script em widgets.ifood.com.br,
// abre um iframe de embeddables.ifood.com.br) traz Conversas com o cliente, avisos e acompanhamento do
// pedido. A loja responde o cliente sem abrir o Gestor de Pedidos do iFood e cola ali o "Copiar link do
// cliente". Fica só nas telas de operação (decisão do dono 06/10): Gestor de Pedidos, Gestor de
// Entregas e PDV Caixa. O ERPOS NÃO manda mensagem sozinho: o iFood não tem API de chat — quem escreve é a pessoa.
// widgetId (público, vai no HTML de qualquer jeito; VITE_IFOOD_WIDGET_ID troca) = criado no Portal do Desenvolvedor do iFood (menu Widgets › Registrar widget; lá também se
// escolhem cor e posição do botão — usar o canto ESQUERDO, o direito é do balão do assistente).
// merchantIds = UUIDs das lojas do iFood desta loja do ERPOS (fin_ifood_merchants, até 10). A própria loja
// autoriza o widget uma vez dentro dele (código no Portal do Parceiro).
export const IFOOD_WIDGET_ID = (import.meta.env.VITE_IFOOD_WIDGET_ID as string | undefined) || 'a348fcdd-31f3-4ba0-bac6-173b5e12239a';
const SCRIPT_URL = 'https://widgets.ifood.com.br/widget.js';

type IfoodWidgetApi = {
  init: (p: { widgetId: string; merchantIds: string[]; autoShow?: boolean }) => Promise<void>;
  show: () => void;
  hide: () => void;
};
declare global { interface Window { iFoodWidget?: IfoodWidgetApi } }

let carregando: Promise<IfoodWidgetApi> | null = null;
let iniciadoCom = '';

function carregarScript(): Promise<IfoodWidgetApi> {
  if (window.iFoodWidget) return Promise.resolve(window.iFoodWidget);
  if (!carregando) {
    carregando = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = () => (window.iFoodWidget ? resolve(window.iFoodWidget) : reject(new Error('iFoodWidget ausente')));
      s.onerror = () => { carregando = null; s.remove(); reject(new Error('Não carregou o widget do iFood')); };
      document.head.appendChild(s);
    });
  }
  return carregando;
}

/** Botão flutuante do chat do iFood enquanto a tela estiver aberta (some ao sair dela). */
export default function ChatIfoodWidget() {
  const tenantId = useAuth().user?.tenantId;
  const [merchants, setMerchants] = useState<string[] | null>(null);

  useEffect(() => {
    if (!tenantId || !IFOOD_WIDGET_ID) { setMerchants(null); return; }
    let vivo = true;
    supabase.from('fin_ifood_merchants').select('merchant_id').eq('tenant_id', tenantId).eq('api_sync', true)
      .then(({ data }) => {
        if (!vivo) return;
        const ids = (data ?? []).map((r) => String(r.merchant_id)).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 10);
        setMerchants(ids.length ? ids : null);
      });
    return () => { vivo = false; };
  }, [tenantId]);

  useEffect(() => {
    if (!merchants) return;
    let vivo = true;
    const chave = merchants.join(',');
    carregarScript()
      .then(async (w) => {
        if (!vivo) return;
        if (iniciadoCom !== chave) {
          iniciadoCom = chave;
          await w.init({ widgetId: IFOOD_WIDGET_ID, merchantIds: merchants, autoShow: false });
        }
        if (vivo) w.show();
      })
      .catch((e) => { iniciadoCom = ''; console.warn('[chat iFood]', e); });
    return () => { vivo = false; window.iFoodWidget?.hide(); };
  }, [merchants]);

  return null;
}
