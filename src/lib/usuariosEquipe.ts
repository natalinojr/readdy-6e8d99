// Regras da tela Usuários nova (chave por loja `usuarios_novo`, protótipo aprovado em
// docs/prototipos/sistema-proposta.html, tela "equipe"). Só lógica pura: a tela decide como mostrar.
import { entraSoPorPin } from './senhaPerfil';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';

/** Dias sem entrar a partir dos quais a pessoa vira aviso em "Precisa de você". */
export const DIAS_PARADO = 15;

/** O mínimo que a lógica precisa de cada usuário (UsuarioReal cabe aqui). */
export interface PessoaBase {
  id: string;
  nome: string;
  email: string;
  matricula: string;
  perfil: PerfilUsuario;
  ativo: boolean;
  ultimoAcesso: string | null;
  diasDesdeAcesso: number | null;
}

/** Totem/tablet é aparelho da loja: fica fora da contagem de pessoas. */
export const ehAparelho = (u: Pick<PessoaBase, 'perfil'>) => u.perfil === 'totem';

/** Login da loja: Caixa/Cozinha que entram só por matrícula + PIN (e-mail de mentira), usados por várias pessoas. */
export const loginCompartilhado = (u: Pick<PessoaBase, 'perfil' | 'email'>) =>
  (u.perfil === 'caixa' || u.perfil === 'cozinha') && entraSoPorPin(u.email);

export const entraPor = (u: Pick<PessoaBase, 'email'>) => (entraSoPorPin(u.email) ? 'matrícula + PIN' : 'e-mail e senha');

/** E-mail de verdade (o de mentira não aparece para ninguém). */
export const emailReal = (email: string | null | undefined) => (entraSoPorPin(email) ? '' : (email ?? ''));

/** Dias desde o último acesso: null = nunca entrou. Usa a conta do servidor; sem ela, a do relógio. */
export function diasSemEntrar(u: Pick<PessoaBase, 'ultimoAcesso' | 'diasDesdeAcesso'>, agora: number = Date.now()): number | null {
  if (!u.ultimoAcesso) return null;
  if (u.diasDesdeAcesso != null) return u.diasDesdeAcesso;
  return Math.max(0, Math.floor((agora - new Date(u.ultimoAcesso).getTime()) / 86400000));
}

/** "hoje", "ontem", "há 11 dias", "há 2 meses", "nunca". */
export function ultimoAcessoTxt(dias: number | null): string {
  if (dias == null) return 'nunca';
  if (dias < 1) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 60) return `há ${dias} dias`;
  return `há ${Math.floor(dias / 30)} meses`;
}

export interface ResumoEquipe { pessoas: number; nunca: number; parados: number; maxDias: number }

/** Conta só pessoas ativas (sem aparelhos). */
export function resumoEquipe(us: PessoaBase[], limite = DIAS_PARADO): ResumoEquipe {
  const vivas = us.filter((u) => u.ativo && !ehAparelho(u));
  let nunca = 0; let parados = 0; let maxDias = 0;
  for (const u of vivas) {
    const d = diasSemEntrar(u);
    if (d == null) nunca++;
    else if (d >= limite) { parados++; maxDias = Math.max(maxDias, d); }
  }
  return { pessoas: vivas.length, nunca, parados, maxDias };
}

export interface ParteManchete { texto: string; tom?: 'red' | 'amber' }

/** "7 pessoas · 2 nunca entraram · 1 sem entrar há 11 dias" (em partes, para pintar cada uma). */
export function partesManchete(r: ResumoEquipe, limite = DIAS_PARADO): ParteManchete[] {
  const p: ParteManchete[] = [{ texto: `${r.pessoas} ${r.pessoas === 1 ? 'pessoa' : 'pessoas'}` }];
  if (r.nunca) p.push({ texto: `${r.nunca} ${r.nunca === 1 ? 'nunca entrou' : 'nunca entraram'}`, tom: 'red' });
  if (r.parados) p.push({ texto: r.parados === 1 ? `1 sem entrar há ${r.maxDias} dias` : `${r.parados} sem entrar há ${limite}+ dias`, tom: 'amber' });
  return p;
}

export type TipoAviso = 'nunca' | 'parado';
export interface AvisoEquipe { tipo: TipoAviso; pessoa: PessoaBase; dias: number | null; admin: boolean }

/**
 * Pessoas que pedem uma decisão: quem nunca entrou (conta com poder total primeiro) e quem não entra há
 * `limite` dias ou mais (os mais parados primeiro). A própria pessoa logada e os desativados não entram.
 */
export function avisosEquipe(us: PessoaBase[], selfId?: string | null, limite = DIAS_PARADO): AvisoEquipe[] {
  const vivas = us.filter((u) => u.ativo && !ehAparelho(u) && u.id !== selfId);
  const nunca: AvisoEquipe[] = []; const parados: AvisoEquipe[] = [];
  for (const u of vivas) {
    const d = diasSemEntrar(u);
    if (d == null) nunca.push({ tipo: 'nunca', pessoa: u, dias: null, admin: u.perfil === 'admin' });
    else if (d >= limite) parados.push({ tipo: 'parado', pessoa: u, dias: d, admin: u.perfil === 'admin' });
  }
  nunca.sort((a, b) => Number(b.admin) - Number(a.admin));
  parados.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0));
  return [...nunca, ...parados];
}

/** Logins da loja (Caixa/Cozinha) ativos, para o cartão que explica o login compartilhado. */
export const loginsDaLoja = (us: PessoaBase[]) => us.filter((u) => u.ativo && !ehAparelho(u) && loginCompartilhado(u));

// ── Cargos da nova pessoa ───────────────────────────────────────────────────────
export const CARGO_FRASE: Partial<Record<PerfilUsuario, { frase: string; icone: string }>> = {
  admin: { frase: 'Poder total na loja', icone: 'ri-shield-star-line' },
  gerente: { frase: 'Acompanha a loja e aprova', icone: 'ri-shield-user-line' },
  supervisao: { frase: 'Cuida da loja no turno', icone: 'ri-user-star-line' },
  caixa: { frase: 'Vende e abre e fecha a loja', icone: 'ri-shopping-cart-2-line' },
  cozinha: { frase: 'Vê e prepara os pedidos', icone: 'ri-fire-line' },
  garcom: { frase: 'Atende as mesas', icone: 'ri-restaurant-line' },
  gestor_entregas: { frase: 'Acompanha as entregas', icone: 'ri-e-bike-2-line' },
  tarefas: { frase: 'Só o módulo de Tarefas', icone: 'ri-task-line' },
  financeiro: { frase: 'Cuida das contas, das notas e dos pagamentos', icone: 'ri-money-dollar-circle-line' },
  contabilidade: { frase: 'Contador(a): vê DRE, contas, notas e folha; não paga nada', icone: 'ri-calculator-line' },
};
export const CARGOS_PRINCIPAIS: PerfilUsuario[] = ['caixa', 'cozinha', 'supervisao', 'gerente', 'financeiro', 'contabilidade'];
export const CARGOS_OUTROS: PerfilUsuario[] = ['garcom', 'gestor_entregas', 'tarefas', 'admin'];
/** O supervisor (gerente com "Gerenciar usuários") só dá os cargos de baixo; o servidor recusa o resto. */
const SO_DO_DONO: PerfilUsuario[] = ['admin', 'gerente', 'contabilidade', 'tarefas', 'financeiro'];

export const rotuloCargo = (p: PerfilUsuario) => perfilConfig[p]?.label ?? p;

/** Cargos que `quemCria` pode dar (mesma regra do UsuarioModal). Totem fica de fora: é aparelho. */
export function cargosPermitidos(quemCria: PerfilUsuario | undefined, lista: PerfilUsuario[]): PerfilUsuario[] {
  return lista.filter((p) => quemCria === 'admin' || !SO_DO_DONO.includes(p));
}

// ── Nova pessoa, em passos ──────────────────────────────────────────────────────
export type EntradaNova = 'pin' | 'mail' | null;
export interface NovaPessoa {
  passo: 1 | 2 | 3 | 4;
  nome: string;
  cargo: PerfilUsuario | null;
  entra: EntradaNova;
  pin: string;
  email: string;
  senha: string;
}
export const novaPessoaVazia = (): NovaPessoa => ({ passo: 1, nome: '', cargo: null, entra: null, pin: '', email: '', senha: '' });

export const PIN_OK = /^\d{4,8}$/;
export const EMAIL_OK = /^\S+@\S+\.\S+$/;
export const SENHA_MIN = 6;

/** O passo só libera quando existe um jeito de entrar: ninguém é criado sem conseguir acessar. */
export function passoOk(n: NovaPessoa): boolean {
  if (n.passo === 1) return n.nome.trim().length >= 2;
  if (n.passo === 2) return !!n.cargo;
  if (n.passo === 3) {
    if (n.entra === 'pin') return PIN_OK.test(n.pin.trim());
    if (n.entra === 'mail') return EMAIL_OK.test(n.email.trim()) && n.senha.trim().length >= SENHA_MIN;
    return false;
  }
  return true;
}

export function dicaPasso(n: NovaPessoa): string {
  if (n.passo === 1) return 'Falta o nome';
  if (n.passo === 2) return 'Escolha o trabalho';
  if (n.entra === 'pin') return 'Falta o PIN (4 a 8 números)';
  if (n.entra === 'mail') return !EMAIL_OK.test(n.email.trim()) ? 'Falta um e-mail válido' : `Falta a senha (mínimo ${SENHA_MIN} caracteres)`;
  return 'Escolha como a pessoa vai entrar';
}

/** Corpo do create_user pelas mesmas regras do formulário de hoje (a Edge exige senha de quem não é totem). */
export function payloadCriar(n: NovaPessoa, senhaInterna: string) {
  return {
    nome: n.nome.trim(),
    email: n.entra === 'mail' ? n.email.trim() : undefined,
    // Matrícula + PIN: a Edge pede uma senha mesmo assim; vai uma interna que ninguém precisa saber
    // (quem entra só pelo PIN nunca digita senha; o administrador pode redefinir depois).
    senha: n.entra === 'mail' ? n.senha.trim() : senhaInterna,
    perfil: n.cargo as PerfilUsuario,
    training_mode: false,
    pin: n.entra === 'pin' ? n.pin.trim() : undefined,
  };
}

const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Senha aleatória (sem letras que se confundem). `rnd` entra só nos testes. */
export function senhaAleatoria(tam = 16, rnd?: (n: number) => number): string {
  const sorteio = rnd ?? ((n: number) => {
    const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n;
  });
  let s = '';
  for (let i = 0; i < tam; i++) s += ALFABETO[sorteio(ALFABETO.length)];
  return s;
}

/** PIN de 4 números sem sequência óbvia. */
export function pinSugerido(rnd?: (n: number) => number): string {
  const sorteio = rnd ?? ((n: number) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; });
  for (let t = 0; t < 50; t++) {
    const p = String(sorteio(10000)).padStart(4, '0');
    const d = [...p].map(Number);
    const igual = d.every((x) => x === d[0]);
    const seq = d.every((x, i) => i === 0 || x === d[i - 1] + 1) || d.every((x, i) => i === 0 || x === d[i - 1] - 1);
    if (!igual && !seq) return p;
  }
  return '4729';
}

// ── WhatsApp ────────────────────────────────────────────────────────────────────
export const primeiroNome = (n: string) => (n || '').trim().split(/\s+/)[0] || 'a pessoa';

/**
 * Mensagem de acesso. NUNCA leva PIN nem senha: só o endereço e como entrar (matrícula ou e-mail).
 * O PIN/senha a pessoa recebe pessoalmente de quem cadastrou.
 */
export function mensagemAcesso(o: { nome: string; loja: string; url: string; matricula?: string; email?: string; porPin: boolean }): string {
  const oi = `Oi, ${primeiroNome(o.nome)}! Seu acesso ao ERPOS da ${o.loja} está pronto.`;
  const onde = o.url ? ` Endereço: ${o.url}` : '';
  if (o.porPin) {
    return `${oi}${onde}\nEntre com a matrícula ${o.matricula || '(a matrícula que te passei)'} e o seu PIN. O PIN eu combino com você pessoalmente.`;
  }
  return `${oi}${onde}\nEntre com o e-mail ${o.email || ''} e a sua senha. A senha eu combino com você pessoalmente; depois você troca em Perfil.`;
}

/** Abre a conversa sem número: o WhatsApp deixa escolher o contato. */
export const linkWhatsApp = (mensagem: string) => `https://wa.me/?text=${encodeURIComponent(mensagem)}`;

// ── Filtros e busca ─────────────────────────────────────────────────────────────
export type FiltroStatus = 'todas' | 'ativas' | 'desativadas' | 'treino';

export const semAcentoMin = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function filtrarPessoas<T extends PessoaBase & { modoTreino?: boolean }>(
  us: T[], o: { status: FiltroStatus; cargo: PerfilUsuario | null; busca: string },
): T[] {
  const q = semAcentoMin(o.busca);
  return us.filter((u) => {
    if (o.status === 'ativas' && !u.ativo) return false;
    if (o.status === 'desativadas' && u.ativo) return false;
    if (o.status === 'treino' && !u.modoTreino) return false;
    if (o.cargo && u.perfil !== o.cargo) return false;
    if (!q) return true;
    return semAcentoMin(`${u.nome} ${emailReal(u.email)} ${u.matricula}`).includes(q);
  });
}

/** Ordem da lista: ativos antes, depois por cargo (do maior poder ao menor) e por nome. */
const ORDEM_CARGO: PerfilUsuario[] = ['admin', 'gerente', 'supervisao', 'caixa', 'cozinha', 'garcom', 'gestor_entregas', 'financeiro', 'contabilidade', 'tarefas', 'totem'];
export function ordenarPessoas<T extends PessoaBase>(us: T[]): T[] {
  return [...us].sort((a, b) =>
    Number(b.ativo) - Number(a.ativo)
    || ORDEM_CARGO.indexOf(a.perfil) - ORDEM_CARGO.indexOf(b.perfil)
    || a.nome.localeCompare(b.nome, 'pt-BR'));
}
