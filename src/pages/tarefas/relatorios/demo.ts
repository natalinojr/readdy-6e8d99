/**
 * Relatórios no modo demo (/dev/tarefas, só em `npm run dev`): mesmas ações do
 * task-reports, em memória, para testar a tela sem login nem banco.
 */
import type { CampoRel, ImagemRel, ItemRel, Relatorio, RespostaRel, ResumoRelatorio, Convidado, StatusItem, ValorCampo } from './api';

type Rel = Relatorio & { items: ItemRel[]; guests: Convidado[] };

const agora = () => new Date().toISOString();
let seq = 0;
const novoId = () => `demo-${++seq}`;

const relatorios: Rel[] = [{
  id: 'demo-rel-1', title: 'Vistoria da reforma — pendências', description: 'Responda cada ponto com prazo ou foto do serviço feito.',
  status: 'open', guests_can_add_items: false, owner_name: 'Você (demo)', created_at: agora(), updated_at: agora(),
  share_token: 'demo_token_abc', link_enabled: true, created_by: 'demo-eu', list_id: 'manut', access: 'creator',
  links: [{ url: 'https://drive.google.com/drive/folders/exemplo', title: 'Projeto elétrico rev. 2' }],
  guests: [{ id: 'g1', name: 'Carlos (empreiteiro)', contact: '41 99999-0000', created_at: agora(), last_seen_at: agora() }],
  items: [
    {
      id: 'i1', position: 1, title: 'Rejunte do banheiro soltando', body: 'Perto do ralo, lado esquerdo.', images: [], status: 'answered',
      created_by_guest_name: null, created_at: agora(), updated_at: agora(),
      responses: [{ id: 'r1', kind: 'reply', body: 'Refaço na terça.', images: [], new_status: null, author_name: 'Carlos (empreiteiro)', author_type: 'guest', author_guest_id: 'g1', created_at: agora() }],
    },
    {
      id: 'i2', position: 2, title: 'Tomada da cozinha sem energia', body: null, images: [], status: 'open', created_by_guest_name: null, created_at: agora(), updated_at: agora(), responses: [],
      fields: [
        { id: 'c1', type: 'escolha', label: 'Situação', options: [{ id: 'o1', label: 'Resolvido' }, { id: 'o2', label: 'Precisa de eletricista' }] },
        { id: 'c2', type: 'multipla', label: 'Tomadas afetadas', options: [{ id: 'a', label: 'Bancada' }, { id: 'b', label: 'Geladeira' }, { id: 'c', label: 'Micro-ondas' }], min: 1, max: 2 },
        { id: 'c3', type: 'data', label: 'Prazo' },
      ],
    },
  ],
}, {
  // Relatório de outra pessoa numa pasta compartilhada comigo com "só ver".
  id: 'demo-rel-2', title: 'Auditoria da cozinha (Ana)', description: null,
  status: 'open', guests_can_add_items: false, owner_name: 'Ana Souza', created_at: agora(), updated_at: agora(),
  share_token: 'demo_token_ana', link_enabled: true, created_by: 'demo-ana', list_id: 'cozinha', access: 'view',
  guests: [],
  items: [{
    id: 'a1', position: 1, title: 'Validade dos molhos', body: 'Conferir etiquetas.', images: [], status: 'open',
    created_by_guest_name: null, created_at: agora(), updated_at: agora(),
    responses: [{ id: 'ar1', kind: 'reply', body: 'Vou ver amanhã cedo.', images: [], new_status: null, author_name: 'Ana Souza', author_type: 'owner', author_guest_id: null, author_is_creator: true, author_user_id: 'demo-ana', created_at: agora() }],
  }],
}];

const PASTAS_DEMO: Record<string, { name: string; color: string }> = {
  manut: { name: 'Manutenção', color: '#6366f1' },
  cozinha: { name: 'Cozinha', color: '#f59e0b' },
};
const vistos = new Map<string, string>();
const modelos: Array<{ id: string; name: string; content: { description: string | null; links: unknown[]; items: ItemRel[] } }> = [];
const ligacoes = new Map<string, Set<string>>();
const ligadas = (id: string) => { if (!ligacoes.has(id)) ligacoes.set(id, new Set()); return ligacoes.get(id)!; };

function achar(id: unknown) {
  const r = relatorios.find((x) => x.id === id);
  if (!r) throw new Error('Relatório não encontrado');
  return r;
}

export async function demoDono(action: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (action) {
    case 'list':
      return {
        reports: relatorios.map((r): ResumoRelatorio => ({
          id: r.id, title: r.title, status: r.status, link_enabled: !!r.link_enabled, share_token: r.share_token ?? '',
          created_by: r.created_by ?? 'demo-eu', access: r.access ?? 'creator', owner_name: r.owner_name,
          list_id: r.list_id ?? null, list_name: r.list_id ? PASTAS_DEMO[r.list_id]?.name ?? null : null,
          list_color: r.list_id ? PASTAS_DEMO[r.list_id]?.color ?? null : null,
          created_at: r.created_at, updated_at: r.updated_at,
          items_total: r.items.length, items_open: r.items.filter((i) => i.status === 'open').length,
          items_resolved: r.items.filter((i) => i.status === 'resolved').length,
          guest_responses: r.items.flatMap((i) => i.responses).filter((x) => x.author_type === 'guest').length,
          unseen: vistos.has(r.id) ? 0 : 1,
        })),
      };
    case 'get': {
      const r = achar(p.report_id);
      if (p.mark_seen) vistos.set(r.id, agora());
      const { items, guests, ...report } = r;
      return { report: { ...report, linked_task_ids: [...ligadas(r.id)] }, items: structuredClone(items), guests };
    }
    case 'create': {
      const id = novoId();
      const modelo = modelos.find((m) => m.id === p.template_id);
      relatorios.unshift({
        id, title: String(p.title), description: null, status: 'open', guests_can_add_items: false, owner_name: 'Você (demo)',
        created_at: agora(), updated_at: agora(), share_token: `demo_${id}`, link_enabled: true, created_by: 'demo-eu', list_id: (p.list_id as string) || null, access: 'creator',
        items: modelo ? structuredClone(modelo.content.items).map((i) => ({ ...i, id: novoId() })) : [], guests: [],
        links: (modelo?.content.links as Relatorio['links']) ?? [], ...(modelo ? { description: modelo.content.description } : {}),
      });
      return { id };
    }
    case 'update': {
      const r = achar(p.report_id);
      for (const k of ['title', 'description', 'link_enabled', 'guests_can_add_items', 'status', 'list_id', 'links'] as const) {
        if (p[k] !== undefined) (r as unknown as Record<string, unknown>)[k] = p[k];
      }
      r.updated_at = agora();
      return {};
    }
    case 'regenerate_link': achar(p.report_id).share_token = `demo_${novoId()}`; return {};
    case 'archive': relatorios.splice(relatorios.indexOf(achar(p.report_id)), 1); return {};
    case 'add_item': {
      const r = achar(p.report_id);
      r.items.push({
        id: novoId(), position: (r.items.at(-1)?.position ?? 0) + 1, title: String(p.title), body: (p.body as string) || null,
        images: (p.images as ImagemRel[]) ?? [], status: 'open', created_by_guest_name: null, created_at: agora(), updated_at: agora(), responses: [],
        fields: (p.fields as CampoRel[]) ?? [],
      });
      return {};
    }
    case 'update_item': {
      const r = achar(p.report_id);
      const it = r.items.find((i) => i.id === p.item_id)!;
      if (p.title !== undefined) it.title = String(p.title);
      if (p.body !== undefined) it.body = (p.body as string) || null;
      if (p.images !== undefined) it.images = p.images as ImagemRel[];
      if (p.fields !== undefined) it.fields = p.fields as CampoRel[];
      if (p.position !== undefined) it.position = Number(p.position);
      r.items.sort((a, b) => a.position - b.position);
      return {};
    }
    case 'delete_item': { const r = achar(p.report_id); r.items = r.items.filter((i) => i.id !== p.item_id); return {}; }
    case 'reply': {
      const rel = achar(p.report_id);
      const it = rel.items.find((i) => i.id === p.item_id)!;
      const st = (p.new_status as StatusItem | null) ?? null;
      const resp: RespostaRel = {
        id: novoId(), kind: p.body || p.answers ? 'reply' : 'status', answers: (p.answers as Record<string, ValorCampo> | null) ?? null, body: (p.body as string) || null, images: (p.images as ImagemRel[]) ?? [],
        new_status: st, author_name: 'Você (demo)', author_type: 'owner', author_guest_id: null, author_is_creator: rel.created_by === 'demo-eu', author_user_id: 'demo-eu', created_at: agora(),
      };
      it.responses.push(resp);
      if (st) it.status = st;
      return { id: resp.id };
    }
    case 'list_templates':
      return { templates: modelos.map((m) => ({ id: m.id, name: m.name, items_total: m.content.items.length, links_total: m.content.links.length, created_at: agora(), updated_at: agora() })) };
    case 'save_template': {
      const r = achar(p.report_id);
      modelos.push({ id: novoId(), name: String(p.name), content: { description: r.description, links: r.links ?? [], items: structuredClone(r.items).map((i) => ({ ...i, responses: [], status: 'open' as const })) } });
      return {};
    }
    case 'delete_template': modelos.splice(modelos.findIndex((m) => m.id === p.template_id), 1); return {};
    case 'link_task': ligadas(String(p.report_id)).add(String(p.task_id)); return {};
    case 'unlink_task': ligadas(String(p.report_id)).delete(String(p.task_id)); return {};
    case 'task_links':
      return {
        reports: relatorios.filter((r) => ligadas(r.id).has(String(p.task_id)))
          .map((r) => ({ id: r.id, title: r.title, status: r.status, list_id: r.list_id, access: r.access })),
      };
    default:
      throw new Error(`Ação desconhecida: ${action}`);
  }
}
