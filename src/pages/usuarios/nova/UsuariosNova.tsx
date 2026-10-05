// Usuários — tela nova (chave por loja `usuarios_novo`, Configurações › Operação › Recursos novos).
// Protótipo aprovado: docs/prototipos/sistema-proposta.html (tela "equipe"). Manchete com o estado, "Precisa de
// você" com o botão que resolve, lista enxuta, aparelhos (totens) à parte e Nova pessoa em passos.
// Usa os mesmos dados e as mesmas chamadas da tela de hoje (useUsuarios, user-write, acesso-pessoa): só muda
// como se mostra e se pede. Nada saiu: Acesso entre lojas, Exportar CSV, editar, senha/PIN, modo treino,
// ativar/desativar e excluir continuam alcançáveis (⋯ do topo ou dentro da pessoa).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { todayBrasilia } from '@/lib/dateUtils';
import { getAppBaseUrl } from '@/lib/appUrl';
import { confirmar } from '@/components/base/Dialogos';
import { useUsuarios, type UsuarioReal } from '@/hooks/useUsuarios';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';
import { CartaoAcao, Chips, Etiqueta, MenuMais, SecaoTitulo, Vazio, btn, type OpcaoChip } from '@/pages/estoque/components/ui/EstoqueUi';
import Folha from '@/pages/estoque/components/inicio/Folha';
import UsuarioModal from '../components/UsuarioModal';
import AcessoMultiLojaModal from '../components/AcessoMultiLojaModal';
import AcessoPessoa from '../components/AcessoPessoa';
import NovaPessoaFolha from './NovaPessoaFolha';
import PessoaFolha, { type AcoesPessoa } from './PessoaFolha';
import {
  DIAS_PARADO, avisosEquipe, diasSemEntrar, ehAparelho, emailReal, entraPor, filtrarPessoas, linkWhatsApp, loginCompartilhado,
  loginsDaLoja, mensagemAcesso, ordenarPessoas, partesManchete, resumoEquipe, rotuloCargo, ultimoAcessoTxt,
  type FiltroStatus,
} from '@/lib/usuariosEquipe';

type ModalState =
  | { tipo: 'novo'; perfilInicial?: PerfilUsuario }
  | { tipo: 'editar'; usuario: UsuarioReal }
  | { tipo: 'senha'; usuario: UsuarioReal }
  | null;

const MAX_AVISOS = 4;
const CARGOS_FILTRO: PerfilUsuario[] = ['admin', 'gerente', 'supervisao', 'caixa', 'cozinha', 'garcom', 'gestor_entregas', 'financeiro', 'contabilidade', 'tarefas'];

function Avatar({ u }: { u: UsuarioReal }) {
  const compart = loginCompartilhado(u);
  if (compart || ehAparelho(u)) {
    const ic = ehAparelho(u) ? 'ri-tablet-line' : u.perfil === 'cozinha' ? 'ri-fire-line' : 'ri-computer-line';
    return <span className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center flex-shrink-0"><i className={`${ic} text-lg`} /></span>;
  }
  const ini = u.nome.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return (
    <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-extrabold ${u.perfil === 'admin' ? 'bg-amber-400 text-zinc-900' : 'bg-zinc-100 text-zinc-600'}`}>{ini}</span>
  );
}

function AcessoTxt({ u }: { u: UsuarioReal }) {
  const d = diasSemEntrar(u);
  if (d == null) return <span className="font-extrabold text-red-600">nunca entrou</span>;
  if (d >= DIAS_PARADO) return <span className="font-extrabold text-amber-700">{ultimoAcessoTxt(d)}</span>;
  return <span>último acesso {ultimoAcessoTxt(d)}</span>;
}

export default function UsuariosNova() {
  const { user } = useAuth();
  const toast = useToast();
  const { usuarios, loading, error, toggleAtivo, editarUsuario, criarUsuario, excluirUsuario, redefinirSenha, definirPIN, limparPIN, alterarMatricula } = useUsuarios();

  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState<FiltroStatus>('todas');
  const [cargo, setCargo] = useState<PerfilUsuario | null>(null);
  const [vazios, setVazios] = useState(false);
  const [todosAvisos, setTodosAvisos] = useState(false);
  const [verAparelhos, setVerAparelhos] = useState(false);
  const [sel, setSel] = useState<UsuarioReal | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [acessoDe, setAcessoDe] = useState<{ id: string; nome: string } | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [loginAberto, setLoginAberto] = useState(false);
  const [multiLoja, setMultiLoja] = useState(false);
  const [multiLojaAberto, setMultiLojaAberto] = useState(false);

  useEffect(() => {
    supabase.rpc('fn_get_my_admin_tenants').then(({ data }) => setMultiLoja(((data as unknown[]) ?? []).length >= 2));
  }, []);

  const loja = user?.loja ?? 'a loja';
  const pessoasTodas = useMemo(() => usuarios.filter((u) => !ehAparelho(u)), [usuarios]);
  const aparelhos = useMemo(() => ordenarPessoas(usuarios.filter(ehAparelho)), [usuarios]);
  const resumo = useMemo(() => resumoEquipe(usuarios), [usuarios]);
  const avisos = useMemo(() => avisosEquipe(usuarios, user?.id), [usuarios, user?.id]);
  const logins = useMemo(() => loginsDaLoja(usuarios), [usuarios]);
  const lista = useMemo(() => ordenarPessoas(filtrarPessoas(pessoasTodas, { status, cargo, busca })), [pessoasTodas, status, cargo, busca]);

  const nDesativadas = pessoasTodas.filter((u) => !u.ativo).length;
  const nTreino = pessoasTodas.filter((u) => u.modoTreino).length;
  const opcoesStatus: OpcaoChip<FiltroStatus>[] = [
    { id: 'todas', rotulo: 'Todas', n: pessoasTodas.length },
    { id: 'ativas', rotulo: 'Ativas', n: pessoasTodas.length - nDesativadas },
    ...(nDesativadas || status === 'desativadas' ? [{ id: 'desativadas' as const, rotulo: 'Desativadas', n: nDesativadas }] : []),
    ...(nTreino || status === 'treino' ? [{ id: 'treino' as const, rotulo: 'Em treino', n: nTreino }] : []),
  ];
  const contCargo = (c: PerfilUsuario) => pessoasTodas.filter((u) => u.perfil === c).length;
  const cargosComGente = CARGOS_FILTRO.filter((c) => contCargo(c) > 0);
  const cargosVazios = CARGOS_FILTRO.filter((c) => contCargo(c) === 0);

  // ── ações (as mesmas da tela de hoje, com confirmação onde o efeito pesa) ──────────
  const falha = (titulo: string, msg?: string) => toast.error(titulo, msg);

  const desativar = async (u: UsuarioReal) => {
    const extra = u.id === user?.id ? ' Você está desativando o seu próprio acesso.'
      : u.perfil === 'admin' ? ' Esta conta tem poder total: confira que ninguém usa antes de desativar.'
      : loginCompartilhado(u) ? ' É um login da loja: quem usa deixa de conseguir entrar.'
      : '';
    const sim = await confirmar({
      titulo: `Desativar ${u.nome}?`,
      mensagem: `${u.nome} perde o acesso na hora. Pedidos e registros continuam. Dá para reativar quando quiser.${extra}`,
      confirmarLabel: 'Desativar', perigo: true, icone: 'ri-user-forbid-line',
    });
    if (!sim) return false;
    const res = await toggleAtivo(u.id);
    if (!res.success) { falha('Não consegui desativar', res.error); return false; }
    toast.success(`${u.nome} desativado`, 'Dá para reativar em Desativadas.');
    return true;
  };
  const reativar = async (u: UsuarioReal) => {
    const res = await toggleAtivo(u.id);
    if (!res.success) { falha('Não consegui reativar', res.error); return; }
    toast.success(`${u.nome} reativado`);
  };
  const excluir = async (u: UsuarioReal) => {
    const sim = await confirmar({
      titulo: `Excluir ${u.nome}?`,
      mensagem: 'O acesso some de vez e não dá para desfazer. Pedidos e registros históricos continuam.',
      confirmarLabel: 'Excluir', perigo: true,
    });
    if (!sim) return;
    const res = await excluirUsuario(u.id);
    if (!res.success) { falha('Não consegui excluir', res.error); return; }
    toast.success('Usuário excluído');
  };
  const confirmarAdmin = (nome: string) => confirmar({
    titulo: `Trocar ${nome} para Administrador?`,
    mensagem: 'O Administrador vai poder ver o financeiro inteiro (contas, bancos e DRE), mudar preços e o cardápio, apagar pedidos e dar ou tirar o acesso de outras pessoas.',
    confirmarLabel: 'Trocar mesmo assim', perigo: true, icone: 'ri-shield-star-line',
  });
  const mudarCargo = async (u: UsuarioReal, perfil: PerfilUsuario) => {
    if (perfil === 'admin') { if (!(await confirmarAdmin(u.nome))) return; }
    else {
      const sim = await confirmar({
        titulo: `Trocar ${u.nome} para ${rotuloCargo(perfil)}?`,
        mensagem: `O cargo muda na hora, de ${rotuloCargo(u.perfil)} para ${rotuloCargo(perfil)}. Confira depois em “O que faz”.`,
        confirmarLabel: 'Trocar',
      });
      if (!sim) return;
    }
    const ok = await editarUsuario(u.id, { nome: u.nome, perfil, modoTreino: u.modoTreino, ativo: u.ativo });
    if (ok) { toast.success(`${u.nome} agora é ${rotuloCargo(perfil)}`); setSel(null); } else falha('Não consegui trocar o cargo');
  };

  const reenviar = (u: UsuarioReal) => {
    const porPin = entraPor(u) === 'matrícula + PIN';
    const msg = mensagemAcesso({ nome: u.nome, loja, url: getAppBaseUrl(), matricula: u.matricula, email: emailReal(u.email), porPin });
    window.open(linkWhatsApp(msg), '_blank', 'noopener,noreferrer');
  };

  const acoes: AcoesPessoa = {
    oQueFaz: (u) => { setSel(null); setAcessoDe({ id: u.id, nome: u.nome }); },
    reenviar: (u) => { setSel(null); reenviar(u); },
    editar: (u) => { setSel(null); setModal({ tipo: 'editar', usuario: u }); },
    senha: (u) => { setSel(null); setModal({ tipo: 'senha', usuario: u }); },
    mudarCargo: (u, p) => { mudarCargo(u, p); },
    desativar: async (u) => { if (await desativar(u)) setSel(null); },
    reativar: async (u) => { await reativar(u); setSel(null); },
    excluir: async (u) => { await excluir(u); setSel(null); },
    loginDaLoja: () => { setSel(null); setLoginAberto(true); },
  };

  // ── Exportar CSV (mesmas colunas da tela de hoje; vai a lista filtrada + os aparelhos) ──
  const exportarCSV = () => {
    const headers = ['Nome', 'E-mail', 'Matrícula', 'Perfil', 'Status', 'Modo Treino', 'Último Acesso'];
    const linhas = [...lista, ...aparelhos].map((u) => [
      u.nome, u.email, u.matricula, perfilConfig[u.perfil]?.label ?? u.perfil, u.ativo ? 'Ativo' : 'Inativo', u.modoTreino ? 'Sim' : 'Não',
      u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : 'Nunca',
    ]);
    const csv = [headers, ...linhas].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `usuarios_${todayBrasilia()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Salvar do formulário completo (mesmo caminho da tela de hoje + confirmações) ──────
  const salvarModal = async (payload: Record<string, unknown>) => {
    if (!modal) return;
    if (modal.tipo === 'novo') {
      const res = await criarUsuario(payload as unknown as Parameters<typeof criarUsuario>[0]);
      if (res.success) { toast.success('Usuário criado', res.matricula ? `Matrícula: ${res.matricula}` : undefined); setModal(null); }
      else falha('Não consegui criar', res.error);
    } else if (modal.tipo === 'editar') {
      const u = modal.usuario;
      // Cargo para Administrador e desativar pedem confirmação, mesmo vindo da edição.
      if (payload.perfil === 'admin' && u.perfil !== 'admin' && !(await confirmarAdmin(String(payload.nome ?? u.nome)))) return;
      if (payload.ativo === false && u.ativo && !(await confirmar({
        titulo: `Desativar ${u.nome}?`, mensagem: `${u.nome} perde o acesso na hora. Pedidos e registros continuam.`, confirmarLabel: 'Desativar', perigo: true,
      }))) return;
      const novaMatricula = typeof payload.matricula === 'string' ? payload.matricula : '';
      if (novaMatricula && novaMatricula !== u.matricula) {
        const m = await alterarMatricula(u.id, novaMatricula);
        if (!m.success) { falha('Não consegui trocar a matrícula', m.error); return; }
      }
      if (payload.senha && typeof payload.senha === 'string') {
        const s = await redefinirSenha(u.id, payload.senha);
        if (!s.success) { falha('Não consegui redefinir a senha', s.error); return; }
      }
      const ok = await editarUsuario(u.id, {
        nome: payload.nome as string, perfil: payload.perfil as PerfilUsuario, modoTreino: payload.modoTreino as boolean, ativo: payload.ativo as boolean,
      });
      if (ok) { toast.success('Dados atualizados'); setModal(null); } else falha('Não consegui atualizar os dados');
    } else if (modal.tipo === 'senha') {
      const res = await redefinirSenha(modal.usuario.id, (payload as { senha: string }).senha);
      if (res.success) { toast.success('Senha redefinida'); setModal(null); } else falha('Não consegui redefinir a senha', res.error);
    }
  };

  // ── Itens do "Precisa de você" ───────────────────────────────────────────────────
  const cartoesAviso = avisos.map((a) => {
    const u = usuarios.find((x) => x.id === a.pessoa.id)!;
    const cargoTxt = rotuloCargo(u.perfil);
    if (a.tipo === 'nunca') {
      return (
        <CartaoAcao key={`n-${u.id}`} tom={a.admin ? 'alerta' : 'prop'} icone={a.admin ? 'ri-shield-star-line' : 'ri-user-unfollow-line'}
          titulo={`${u.nome} (${cargoTxt}) nunca entrou`}
          acoes={<>
            <button type="button" onClick={() => reenviar(u)} className={btn('p', 'sm')}><i className="ri-whatsapp-line" />Reenviar o acesso</button>
            {a.admin && <button type="button" onClick={() => desativar(u)} className={btn('out', 'sm')}>Desativar</button>}
          </>}>
          {a.admin
            ? 'Conta com poder total que nunca foi usada. Se ninguém usa, é mais seguro desativar.'
            : 'A conta existe, mas a pessoa nunca fez o primeiro acesso. Reenvie o acesso para ela poder entrar.'}
        </CartaoAcao>
      );
    }
    return (
      <CartaoAcao key={`p-${u.id}`} tom="prop" icone="ri-time-line" titulo={`${u.nome} (${cargoTxt}) não entra há ${a.dias} dias`}
        acoes={<>
          <button type="button" onClick={() => setSel(u)} className={btn('p', 'sm')}>Ver</button>
          <button type="button" onClick={() => desativar(u)} className={btn('out', 'sm')}>Desativar</button>
        </>}>
        {a.admin ? 'Conta com poder total parada: se ninguém usa mais, desative.' : 'Se saiu da equipe, desative para tirar o acesso.'}
      </CartaoAcao>
    );
  });
  const cartaoLogin = logins.length > 0 && (
    <CartaoAcao key="login" tom="info" icone="ri-group-line" titulo={`${logins.map((l) => l.nome).join(' e ')} ${logins.length === 1 ? 'é um login' : 'são logins'} da loja, usado${logins.length === 1 ? '' : 's'} por várias pessoas`}
      acoes={<button type="button" onClick={() => setLoginAberto(true)} className={btn('out', 'sm')}>Ver o que fazer</button>}>
      Tudo o que é feito neles fica gravado com o nome do login, não da pessoa.
    </CartaoAcao>
  );
  const nAvisos = avisos.length + (cartaoLogin ? 1 : 0);
  const cartoes = [...cartoesAviso, ...(cartaoLogin ? [cartaoLogin] : [])];
  const cartoesVistos = todosAvisos ? cartoes : cartoes.slice(0, MAX_AVISOS);

  const linhaPessoa = (u: UsuarioReal) => {
    const compart = loginCompartilhado(u);
    return (
      <div key={u.id} role="button" tabIndex={0} onClick={() => setSel(u)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(u); }}
        className={`flex items-center gap-3 px-3 py-2.5 border-b border-zinc-100 last:border-0 cursor-pointer hover:bg-zinc-50 ${u.ativo ? '' : 'opacity-60'}`}>
        <Avatar u={u} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-zinc-900 truncate">
            {u.nome}{u.modoTreino && <span className="ml-1.5 align-middle"><Etiqueta tom="amber">treino</Etiqueta></span>}
          </p>
          <p className="text-[12px] text-zinc-500 truncate md:hidden">
            {rotuloCargo(u.perfil)}{compart ? ' · login da loja' : ''} · <AcessoTxt u={u} />
          </p>
          <p className="text-[12px] text-zinc-400 truncate hidden md:block">
            Entra por {entraPor(u)}{emailReal(u.email) ? ` · ${emailReal(u.email)}` : ''}{u.matricula ? ` · matrícula ${u.matricula}` : ''}{compart ? ' · login da loja, várias pessoas' : ''}
          </p>
        </div>
        <span className="hidden md:block w-36"><Etiqueta tom={u.perfil === 'admin' ? 'amber' : 'zinc'}>{rotuloCargo(u.perfil)}</Etiqueta></span>
        <span className="hidden md:block w-36 text-[12.5px] text-zinc-600"><AcessoTxt u={u} /></span>
        <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {!u.ativo
            ? <button type="button" onClick={() => reativar(u)} className={btn('out', 'sm')}>Reativar</button>
            : u.perfil === 'admin'
              ? <Etiqueta tom="blue">Acesso total</Etiqueta>
              : <button type="button" onClick={() => setAcessoDe({ id: u.id, nome: u.nome })} className={btn('out', 'sm')}><i className="ri-key-2-line" />O que faz</button>}
        </span>
        <i className="ri-more-2-fill text-zinc-400 text-lg flex-shrink-0" aria-hidden />
      </div>
    );
  };

  const linhaAparelho = (u: UsuarioReal) => (
    <div key={u.id} className={`flex items-center gap-3 px-3 py-2.5 border-b border-zinc-100 last:border-0 ${u.ativo ? '' : 'opacity-60'}`}>
      <Avatar u={u} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-zinc-900 truncate">{u.nome}</p>
        <p className="text-[12px] text-zinc-500 truncate">
          {u.ativo ? (u.kioskOnline ? 'online agora' : 'sem sinal agora') : 'desativado'}{u.matricula ? ` · matrícula ${u.matricula}` : ''} · {u.ultimoAcesso ? `último acesso ${ultimoAcessoTxt(diasSemEntrar(u))}` : 'nunca entrou'}
        </p>
      </div>
      <MenuMais rotulo="Ações do aparelho" itens={[
        { rotulo: 'Redefinir o PIN / editar', icone: 'ri-edit-2-line', onClick: () => setModal({ tipo: 'editar', usuario: u }) },
        { rotulo: 'Redefinir a senha do sistema', icone: 'ri-lock-password-line', onClick: () => setModal({ tipo: 'senha', usuario: u }) },
        { rotulo: u.ativo ? 'Desativar' : 'Reativar', icone: u.ativo ? 'ri-user-forbid-line' : 'ri-user-follow-line', onClick: () => { if (u.ativo) desativar(u); else reativar(u); } },
        { rotulo: 'Excluir', icone: 'ri-delete-bin-line', perigo: true, oculto: u.ativo, onClick: () => excluir(u) },
      ]} />
    </div>
  );

  const nAparelhosOn = aparelhos.filter((a) => a.ativo).length;

  return (
    <div className="flex flex-col h-full" style={{ background: '#FAF7F2' }}>
      {/* Cabeçalho */}
      <div className="px-4 md:px-6 py-3 md:py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <i className="ri-team-line text-white text-base md:text-lg" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-bold text-zinc-800">Usuários</h1>
            <p className="text-xs text-zinc-400 hidden sm:block">Quem entra no ERPOS e o que cada pessoa faz</p>
          </div>
          <MenuMais rotulo="Mais: acesso entre lojas, exportar" className="!w-9 !h-9" itens={[
            { rotulo: 'Acesso entre lojas', icone: 'ri-building-2-line', oculto: !multiLoja, onClick: () => setMultiLojaAberto(true) },
            { rotulo: 'Exportar CSV', icone: 'ri-download-line', onClick: exportarCSV },
            { rotulo: 'Novo aparelho (totem)', icone: 'ri-tablet-line', onClick: () => setModal({ tipo: 'novo', perfilInicial: 'totem' }) },
            { rotulo: 'Cadastro completo (formulário)', icone: 'ri-file-user-line', onClick: () => setModal({ tipo: 'novo' }) },
          ]} />
          <button type="button" onClick={() => setNovaAberta(true)} className={`${btn('p')} !min-h-[36px] shadow-sm`}>
            <i className="ri-add-line text-base" />Nova pessoa
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 max-w-[1100px] mx-auto pb-16 space-y-5">
          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>}

          {loading && usuarios.length === 0 ? (
            <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (<>
            {/* Manchete */}
            <div>
              <h2 className="text-[21px] md:text-[27px] font-extrabold text-zinc-900 leading-tight">
                {partesManchete(resumo).map((p, i) => (
                  <span key={i}>{i > 0 && <span className="text-zinc-300"> · </span>}
                    <span className={p.tom === 'red' ? 'text-red-600' : p.tom === 'amber' ? 'text-amber-700' : ''}>{p.texto}</span>
                  </span>
                ))}
              </h2>
              <p className="text-[13px] text-zinc-500 mt-1">Quem entra no ERPOS na {loja} e o que cada pessoa faz.{aparelhos.length > 0 && ` Os ${aparelhos.length === 1 ? 'aparelho' : `${aparelhos.length} aparelhos`} ficam à parte, abaixo.`}</p>
            </div>

            {/* Precisa de você */}
            <section>
              <SecaoTitulo titulo="Precisa de você" n={nAvisos || undefined} tomN="amber" />
              {nAvisos === 0 ? (
                <CartaoAcao tom="ok" icone="ri-check-line" titulo="Todo mundo está em dia" />
              ) : (
                <div className="grid gap-2.5 md:grid-cols-2">{cartoesVistos}</div>
              )}
              {cartoes.length > MAX_AVISOS && (
                <button type="button" onClick={() => setTodosAvisos((v) => !v)} className={`${btn('ghost', 'sm')} mt-1.5`}>
                  {todosAvisos ? 'Mostrar menos' : `Ver os outros ${cartoes.length - MAX_AVISOS}`}
                </button>
              )}
            </section>

            {/* Pessoas */}
            <section>
              <SecaoTitulo titulo="Pessoas" sub="toque numa pessoa para ver o que dá para fazer" tomN="zinc" />
              <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl px-3 h-10 mb-2">
                <i className="ri-search-line text-zinc-400" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, e-mail ou matrícula"
                  className="flex-1 min-w-0 text-[13px] bg-transparent text-zinc-800 placeholder-zinc-400 focus:outline-none" />
                {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar a busca" className="text-zinc-400 cursor-pointer"><i className="ri-close-line" /></button>}
              </div>
              <Chips<FiltroStatus> opcoes={opcoesStatus} valor={status} onChange={setStatus} />
              <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
                {cargosComGente.map((c) => (
                  <button key={c} type="button" onClick={() => setCargo(cargo === c ? null : c)}
                    className={`inline-flex items-center gap-1 h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer ${cargo === c ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}>
                    {rotuloCargo(c)} <span className={cargo === c ? 'text-white/70' : 'opacity-70'}>{contCargo(c)}</span>
                  </button>
                ))}
                {vazios && cargosVazios.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-dashed border-zinc-200 text-[12.5px] font-bold text-zinc-400">{rotuloCargo(c)} <span>0</span></span>
                ))}
                <button type="button" onClick={() => setVazios((v) => !v)} className="h-8 px-2 text-[12.5px] font-bold text-amber-700 cursor-pointer">
                  {vazios ? 'Esconder os vazios' : 'Mostrar os vazios'}
                </button>
              </div>

              <div className="mt-3">
                {lista.length === 0 ? (
                  <Vazio icone="ri-user-line" titulo="Ninguém aqui">
                    {status === 'desativadas' ? 'Ninguém está desativado.' : status === 'treino' ? 'Ninguém está em modo treino.' : 'Tente outro filtro ou outra busca.'}
                  </Vazio>
                ) : (
                  <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">{lista.map(linhaPessoa)}</div>
                )}
              </div>
            </section>

            {/* Aparelhos */}
            <section>
              <SecaoTitulo titulo="Aparelhos" tomN="zinc" />
              <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <span className="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center flex-shrink-0"><i className="ri-tablet-line text-base" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14.5px] font-extrabold text-zinc-900 pt-1">
                      {aparelhos.length === 0 ? 'Nenhum totem ou tablet cadastrado' : `${aparelhos.length} ${aparelhos.length === 1 ? 'aparelho' : 'aparelhos'} da loja`}
                      {aparelhos.length > 0 && <span className="ml-2 text-[12px] font-bold text-emerald-700">{nAparelhosOn} ativo{nAparelhosOn === 1 ? '' : 's'}</span>}
                    </p>
                    <p className="text-[12.5px] text-zinc-600 mt-0.5">Não entram na conta das pessoas. Cada totem entra por matrícula + PIN.</p>
                  </div>
                </div>
                {verAparelhos && aparelhos.length > 0 && <div className="mt-2 -mx-1 border-t border-zinc-100">{aparelhos.map(linhaAparelho)}</div>}
                <div className="flex gap-2 flex-wrap mt-2.5">
                  {aparelhos.length > 0 && <button type="button" onClick={() => setVerAparelhos((v) => !v)} className={btn('out', 'sm')}>{verAparelhos ? 'Fechar' : `Ver ${aparelhos.length === 1 ? 'o aparelho' : `os ${aparelhos.length}`}`}</button>}
                  <button type="button" onClick={() => setModal({ tipo: 'novo', perfilInicial: 'totem' })} className={btn('out', 'sm')}><i className="ri-add-line" />Novo aparelho</button>
                </div>
              </div>
            </section>
          </>)}
        </div>
      </div>

      <PessoaFolha u={sel} eu={user?.id} quemEdita={user?.perfil} acoes={acoes} onFechar={() => setSel(null)} />

      <NovaPessoaFolha aberta={novaAberta} onFechar={() => setNovaAberta(false)} quemCria={user?.perfil} loja={loja}
        onCriar={(p) => criarUsuario(p)} />

      <Folha aberta={loginAberto} titulo="Logins da loja" subtitulo="Caixa e Cozinha, usados por várias pessoas" onFechar={() => setLoginAberto(false)}
        rodape={<>
          <button type="button" onClick={() => setLoginAberto(false)} className={`${btn('out')} flex-1`}>Entendi</button>
          <button type="button" onClick={() => { setLoginAberto(false); setNovaAberta(true); }} className={`${btn('p')} flex-[2]`}>Criar um acesso para cada pessoa</button>
        </>}>
        <div className="pb-3 text-[13.5px] text-zinc-700 leading-relaxed space-y-2">
          <p>Hoje, tudo o que é feito num login da loja (como <b>Caixa</b> ou <b>Cozinha</b>) fica gravado com o nome do login, e não com o nome de quem fez.</p>
          <p>Para saber quem fez, cada pessoa pode ter o próprio acesso por matrícula + PIN: use <b>Nova pessoa</b>. Nas marcações da Hoje (tarefas e produção do dia), o login da loja já pergunta “quem fez?”.</p>
          {logins.length > 0 && <p className="text-[12.5px] text-zinc-500">Logins da loja agora: {logins.map((l) => `${l.nome} (${rotuloCargo(l.perfil)}, ${l.ultimoAcesso ? `último acesso ${ultimoAcessoTxt(diasSemEntrar(l))}` : 'nunca entrou'})`).join('; ')}.</p>}
        </div>
      </Folha>

      {modal && (
        <UsuarioModal
          modo={modal.tipo}
          usuario={modal.tipo !== 'novo' ? modal.usuario : null}
          perfilInicial={modal.tipo === 'novo' ? modal.perfilInicial : undefined}
          onClose={() => setModal(null)}
          onDefinirPIN={modal.tipo === 'editar' ? (pin) => definirPIN(modal.usuario.id, pin) : undefined}
          onLimparPIN={modal.tipo === 'editar' ? () => limparPIN(modal.usuario.id) : undefined}
          onSalvar={salvarModal}
        />
      )}
      {multiLojaAberto && <AcessoMultiLojaModal onClose={() => setMultiLojaAberto(false)} />}
      {acessoDe && (
        <AcessoPessoa userId={acessoDe.id} nome={acessoDe.nome} onClose={() => setAcessoDe(null)} onSalvo={(msg) => toast.success(msg)} />
      )}
    </div>
  );
}
