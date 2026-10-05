import { fmtTelefone } from '../../ui';
import type { Conversa } from './tipos';
import { pausado, quandoConversa } from './util';

/** Nome de quem chamou (ou o telefone, se o WhatsApp não trouxe o nome). */
export function nomeDaConversa(c: Conversa): string {
  return c.contact_name || fmtTelefone(c.contact_phone);
}

/** "chamou a equipe · 20:12" */
export function estadoDaConversa(c: Conversa): string {
  const estado = c.status !== 'aberta' ? 'encerrada'
    : c.needs_human ? 'chamou a equipe'
    : pausado(c) ? 'equipe atendendo'
    : 'assistente cuidando';
  return `${estado} · ${quandoConversa(c.last_message_at)}`;
}
