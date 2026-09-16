// Ação rápida: promoções ativas da loja (sem IA) — SÓ LEITURA.
// Criar promoção por aqui ficou de fora de propósito: a tela Promoções grava por menu-write
// (create_promotion_rule), mas essa action hoje só existe no order-write, e o formulário da tela
// não envia o item alvo (target_item_id) — reproduzir isso criaria promoção que não aplica.
// Mesma leitura da tela: promotion_rules (aqui filtrada pela loja ativa).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { PromotionRule, PromoType } from '@/types/promotions';
import { Roteiro, useRoteiro, Fim, brl, dataBR, hojeISO, type AcaoProps } from '../kit';

const TIPO: Record<PromoType, string> = {
  item_percent: '% em item', item_fixed: 'R$ em item', category_percent: '% em categoria', order_percent: '% no pedido',
  order_fixed: 'R$ no pedido', buy_x_get_y: 'Compre X Ganhe Y', combo_price: 'Preço especial combo', free_item: 'Item grátis',
};
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function desconto(r: PromotionRule): string {
  if (r.discount_value != null) return r.promo_type.includes('percent') ? `${r.discount_value}% off` : `${brl(r.discount_value)} off`;
  if (r.special_price != null) return `por ${brl(r.special_price)}`;
  if (r.buy_quantity && r.get_quantity) return `compre ${r.buy_quantity} ganhe ${r.get_quantity}`;
  return '';
}

function quando(r: PromotionRule): string {
  const p: string[] = [];
  if (r.days_of_week?.length && r.days_of_week.length < 7) p.push(r.days_of_week.map((d) => DIAS[d]).join(', '));
  if (r.time_from && r.time_until) p.push(`${r.time_from.slice(0, 5)}–${r.time_until.slice(0, 5)}`);
  if (r.valid_from || r.valid_until) p.push(`${r.valid_from ? dataBR(r.valid_from) : '…'} a ${r.valid_until ? dataBR(r.valid_until) : '…'}`);
  return p.join(' · ') || 'sempre';
}

export default function PromocaoRapida({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { baloes, bot } = useRoteiro();
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { bot('Escolha uma loja no app antes.'); setCarregando(false); return; }
      const { data, error } = await supabase.from('promotion_rules').select('*')
        .eq('tenant_id', user.tenantId).eq('is_active', true)
        .order('priority', { ascending: true }).order('created_at', { ascending: false });
      setCarregando(false);
      if (error) { bot(`Não consegui carregar as promoções: ${error.message}`); return; }
      const hoje = hojeISO();
      const regras = (data ?? []) as PromotionRule[];
      const vigentes = regras.filter((r) => !r.valid_until || r.valid_until >= hoje);
      const vencidas = regras.length - vigentes.length;
      if (!vigentes.length) {
        bot(`*${user.loja}*\nNenhuma promoção ativa agora.${vencidas ? `\n(${vencidas} marcada(s) como ativa(s), mas já vencida(s).)` : ''}`);
      } else {
        bot([
          `*${user.loja} · ${vigentes.length} promoção(ões) ativa(s)*`,
          ...vigentes.map((r) => `• ${r.name} — ${TIPO[r.promo_type] ?? r.promo_type}${desconto(r) ? ` · ${desconto(r)}` : ''}${r.coupon_code ? ` · cupom ${r.coupon_code}` : ''}\n   ${quando(r)}`),
          ...(vencidas ? [`(${vencidas} ativa(s) com data vencida)`] : []),
        ].join('\n'));
      }
      bot('Para criar ou mudar promoção, use a tela Promoções.');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Promoções ativas" icone="ri-price-tag-3-line" cor="bg-rose-50 text-rose-600" baloes={baloes}
      carregando={carregando} onFechar={onFechar}>
      {!carregando && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Promoções', onClick: () => irPara('/promocoes') }]} />}
    </Roteiro>
  );
}
