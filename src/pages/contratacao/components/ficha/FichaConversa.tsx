// Aba Conversa da ficha do candidato: WhatsApp completo (wa_log), via ConversaWhatsApp (T04).
import { useEffect, useState } from 'react';
import { type Candidate } from '../../shared';
import ConversaWhatsApp from '../ConversaWhatsApp';

interface Props { c: Candidate; ativa: boolean }

export default function FichaConversa({ c, ativa }: Props) {
  const phone = c.whatsapp || c.phone;
  const [visitou, setVisitou] = useState(false);
  useEffect(() => { setVisitou(false); }, [c.id]);
  useEffect(() => { if (ativa) setVisitou(true); }, [ativa]);
  if (!phone) return <p className="text-xs text-zinc-400">Sem histórico.</p>;
  return <>{visitou && <ConversaWhatsApp phone={phone} />}</>;
}
