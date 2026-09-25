-- Caixa de boletos: anexo guardado (2026-09-25)
--
-- O PDF do boleto que chega por e-mail passa a ser guardado. Dois motivos:
--   1. quem decide uma pendência ("remetente novo", "CNPJ diferente") precisa VER o boleto antes
--      de lançar — é exatamente o momento em que um boleto falso seria aprovado;
--   2. dá para ler de novo (reprocessar) se a leitura falhou, sem pedir para encaminhar outra vez.
-- Bucket privado: só a Edge contas-email (service_role) grava e gera link assinado de leitura.
insert into storage.buckets (id, name, public, file_size_limit)
values ('fin-mail-anexos', 'fin-mail-anexos', false, 15728640)
on conflict (id) do nothing;

comment on column public.fin_mail_messages.raw is
  'Resumo do que chegou: formato, anexos (nome, tipo, bytes, path no bucket fin-mail-anexos), texto do corpo (até 20 mil caracteres) e o resultado da leitura de cada boleto.';
