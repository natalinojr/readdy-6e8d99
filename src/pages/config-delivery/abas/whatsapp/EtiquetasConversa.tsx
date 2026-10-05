import { Etiqueta } from '../../ui';
import type { Conversa } from './tipos';
import { pausado } from './util';

/** Etiquetas de uma conversa: chamou a equipe, equipe atendendo, recebeu o link, teste. */
export default function EtiquetasConversa({ c }: { c: Conversa }) {
  return (
    <>
      {c.status === 'aberta' && c.needs_human && <Etiqueta tom="red">Chamou a equipe</Etiqueta>}
      {pausado(c) && <Etiqueta tom="amber">Equipe atendendo</Etiqueta>}
      {c.link_sent_at && <Etiqueta tom="green">Recebeu o link</Etiqueta>}
      {c.is_test && <Etiqueta tom="blue">Teste</Etiqueta>}
    </>
  );
}
