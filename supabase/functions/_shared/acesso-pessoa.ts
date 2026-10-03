// Acesso por pessoa (2026-10-03): quem pode mudar o acesso de quem, e o que pode dar. Puro — a tela
// (Usuários › Acesso) usa para desabilitar o que não pode, e a Edge acesso-pessoa confere de novo antes
// de gravar. Decisões do dono:
//   - o dono (admin) ajusta qualquer pessoa, menos outro administrador (admin tem tudo);
//   - o gerente ajusta só quem está abaixo dele na loja, só dá o que ele mesmo tem e nunca dinheiro
//     nem cadastro de pessoas (KEYS_SO_DONO);
//   - cada loja tem a sua configuração para a pessoa (cargo + ajuste por loja).
import { FIN_KEYS } from './permissoes-abas.ts';
import { DEFAULT_PERMISSOES, permissoesDaPessoa } from './permissoes-padrao.ts';

/** Permissões que só o dono concede — o gerente não dá a ninguém, mesmo tendo. */
export const KEYS_SO_DONO: readonly string[] = [...FIN_KEYS, 'pag_aprovar', 'usuarios_gerenciar', 'cfg_permissoes'];

/** Cargos que o gerente pode dar e mudar (os de baixo dele). */
export const PAPEIS_DO_GERENTE: readonly string[] = ['supervisao', 'caixa', 'garcom', 'cozinha', 'gestor_entregas'];

/** Cargos que o dono escolhe nesta tela (admin continua só pelo "Editar" do usuário). */
export const PAPEIS_DO_DONO: readonly string[] = ['gerente', 'supervisao', 'caixa', 'garcom', 'cozinha', 'gestor_entregas', 'financeiro', 'contabilidade', 'tarefas'];

/** Todas as chaves que existem (as do admin). Chave fora daqui é recusada. */
export const TODAS_AS_KEYS: ReadonlySet<string> = new Set<string>(DEFAULT_PERMISSOES.admin);

export type Linha = { permission_key: string; allowed: boolean };

/** Ajuste da pessoa = diferença entre o que ela fica tendo e o padrão do cargo na loja. */
export function ajustesDaPessoa(padrao: Iterable<string>, pessoa: Iterable<string>): Linha[] {
  const p = new Set(padrao);
  const q = new Set(pessoa);
  const out: Linha[] = [];
  for (const k of q) if (!p.has(k)) out.push({ permission_key: k, allowed: true });
  for (const k of p) if (!q.has(k)) out.push({ permission_key: k, allowed: false });
  return out.sort((a, b) => a.permission_key.localeCompare(b.permission_key));
}

export interface PedidoDeAcesso {
  /** papel de quem edita NESTA loja (PT: 'admin' | 'gerente' | …) */
  editor: string;
  /** o editor é a própria pessoa */
  propria: boolean;
  /** permissões de quem edita nesta loja (para o gerente: só dá o que tem) */
  keysDoEditor: ReadonlySet<string>;
  /** cargo atual e novo da pessoa nesta loja (PT) */
  papelAtual: string;
  papelNovo: string;
  /** o que a pessoa tem hoje nesta loja (o que já tinha pode ficar, mesmo que o gerente não tenha) */
  keysAtuais: ReadonlySet<string>;
  /** o que a pessoa vai ter no fim */
  keys: readonly string[];
  /** padrão do cargo novo nesta loja (código + Configurações › Permissões) */
  padraoDoCargoNovo: readonly string[];
}

/** Confere se pode gravar. Devolve a mensagem para a pessoa, ou null quando pode. */
export function conferirAcesso(p: PedidoDeAcesso): string | null {
  if (p.propria) return 'Ninguém muda o próprio acesso — peça a outra pessoa (o dono).';
  if (p.editor !== 'admin' && p.editor !== 'gerente') return 'Só o dono ou o gerente da loja mudam o acesso das pessoas.';
  if (p.papelAtual === 'admin') return 'Administrador tem tudo — não tem ajuste. O cargo dele muda em "Editar".';
  const desconhecida = p.keys.find((k) => !TODAS_AS_KEYS.has(k));
  if (desconhecida) return `Permissão desconhecida: ${desconhecida}`;
  if (p.editor === 'admin') {
    return PAPEIS_DO_DONO.includes(p.papelNovo) ? null : 'Cargo inválido para esta tela.';
  }
  // Gerente
  if (!PAPEIS_DO_GERENTE.includes(p.papelAtual)) return 'O gerente só muda o acesso de quem está abaixo dele na loja.';
  if (!PAPEIS_DO_GERENTE.includes(p.papelNovo)) return 'O gerente não dá esse cargo — só o dono.';
  const padrao = new Set(p.padraoDoCargoNovo);
  for (const k of p.keys) {
    // vem do cargo ou a pessoa já tinha (o dono deu): não é o gerente que está dando
    if (padrao.has(k) || p.keysAtuais.has(k)) continue;
    if (KEYS_SO_DONO.includes(k)) return 'Dinheiro e cadastro de pessoas, só o dono libera.';
    if (!p.keysDoEditor.has(k)) return 'O gerente só libera o que ele mesmo tem.';
  }
  return null;
}

/** Atalho para o servidor: padrão de um cargo numa loja a partir das linhas de permissions. */
export function padraoDoCargo(papel: string, linhasCargo: readonly Linha[]): string[] {
  return permissoesDaPessoa(papel, linhasCargo, []);
}
