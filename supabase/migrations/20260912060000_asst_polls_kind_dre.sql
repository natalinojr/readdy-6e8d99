-- Enquete com tratamento próprio (2026-09-12): o sistema pergunta ao dono pelo
-- WhatsApp o que não sabe decidir sozinho. Primeiro caso: classificação DRE de
-- conta a pagar (pay_bill passou a exigir). O voto é tratado direto no
-- assistente-webhook, sem passar pelo modelo.
--   kind = 'dre_category' · ref = { tenant_id, bill_id, options: [{ label, category_id? , group?, name? }] }
alter table asst_polls add column if not exists kind text;
alter table asst_polls add column if not exists ref jsonb;
create index if not exists asst_polls_dre_bill_idx on asst_polls ((ref->>'bill_id')) where kind = 'dre_category';
