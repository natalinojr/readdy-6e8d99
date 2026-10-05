// Usuários (tela nova) › uma pessoa: tudo o que dá para fazer com ela num lugar só (O que faz, reenviar o
// acesso, editar, redefinir senha/PIN, mudar o cargo, desativar, excluir). Protótipo: folha "pessoa".
import { Folha } from '@/components/kit';
import type { UsuarioReal } from '@/hooks/useUsuarios';
import type { PerfilUsuario } from '@/constants/usuarios';
import { CARGOS_OUTROS, CARGOS_PRINCIPAIS, cargosPermitidos, diasSemEntrar, entraPor, loginCompartilhado, rotuloCargo, ultimoAcessoTxt } from '@/lib/usuariosEquipe';

export interface AcoesPessoa {
  oQueFaz: (u: UsuarioReal) => void;
  reenviar: (u: UsuarioReal) => void;
  editar: (u: UsuarioReal) => void;
  senha: (u: UsuarioReal) => void;
  mudarCargo: (u: UsuarioReal, p: PerfilUsuario) => void;
  desativar: (u: UsuarioReal) => void;
  reativar: (u: UsuarioReal) => void;
  excluir: (u: UsuarioReal) => void;
  loginDaLoja: () => void;
}

function Linha({ icone, tom = 'zinc', titulo, sub, onClick, desligada }: {
  icone: string; tom?: 'zinc' | 'amber' | 'green' | 'red'; titulo: string; sub: string; onClick?: () => void; desligada?: boolean;
}) {
  const cor = { zinc: 'bg-zinc-100 text-zinc-600', amber: 'bg-amber-100 text-amber-700', green: 'bg-emerald-100 text-emerald-700', red: 'bg-red-100 text-red-600' }[tom];
  return (
    <button type="button" disabled={desligada} onClick={onClick}
      className={`w-full flex items-center gap-3 px-1 py-2.5 text-left border-b border-zinc-100 last:border-0 ${desligada ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-zinc-50'}`}>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cor}`}><i className={`${icone} text-lg`} /></span>
      <span className="flex-1 min-w-0"><b className="block text-[14px] text-zinc-900">{titulo}</b><span className="block text-[12px] text-zinc-500 leading-snug">{sub}</span></span>
      {!desligada && <i className="ri-arrow-right-s-line text-zinc-300 text-lg" />}
    </button>
  );
}

export default function PessoaFolha({ u, eu, quemEdita, acoes, onFechar }: {
  u: UsuarioReal | null;
  /** id de quem está logado (não troca o próprio cargo por aqui) */
  eu?: string;
  quemEdita: PerfilUsuario | undefined;
  acoes: AcoesPessoa;
  onFechar: () => void;
}) {
  if (!u) return <Folha aberta={false} titulo="" onFechar={onFechar}>{null}</Folha>;
  const dias = diasSemEntrar(u);
  const aparelho = u.perfil === 'totem';
  const admin = u.perfil === 'admin';
  const compart = loginCompartilhado(u);
  const nunca = dias == null;
  const porPin = entraPor(u) === 'matrícula + PIN';
  const trocas = (aparelho || admin || u.id === eu) ? [] : cargosPermitidos(quemEdita, [...CARGOS_PRINCIPAIS, ...CARGOS_OUTROS]).filter((c) => c !== u.perfil);
  const primeiro = u.nome.trim().split(/\s+/)[0] || u.nome;

  return (
    <Folha aberta titulo={u.nome} subtitulo={`${rotuloCargo(u.perfil)} · Entra por ${entraPor(u)}`} onFechar={onFechar}>
      <div className="pb-3">
        <p className="text-[13px] text-zinc-600">
          {nunca ? <b className="text-red-600">Nunca entrou</b> : <>Último acesso: <b>{ultimoAcessoTxt(dias)}</b></>}
          {u.matricula && <> · matrícula <b className="tabular-nums">{u.matricula}</b></>}
          {u.modoTreino && <> · <b className="text-amber-700">modo treino</b></>}
        </p>
        {!u.ativo && <p className="text-[13px] font-bold text-red-600 mt-1">Desativado: sem acesso</p>}
        {compart && (
          <p className="mt-2 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-[12.5px] text-blue-900 leading-snug">
            Este é um login da loja: várias pessoas podem usar. Tudo o que for feito aqui fica como “{u.nome}”.{' '}
            <button type="button" onClick={acoes.loginDaLoja} className="font-bold underline cursor-pointer">Ver o que fazer ›</button>
          </p>
        )}

        <div className="mt-3">
          {!admin && !aparelho && (
            <Linha icone="ri-key-2-line" tom="amber" titulo="O que faz" sub="o que a pessoa faz em cada loja, a partir do cargo" onClick={() => acoes.oQueFaz(u)} />
          )}
          {nunca && u.ativo && !aparelho && (
            <Linha icone="ri-whatsapp-line" tom="green" titulo="Reenviar o acesso pelo WhatsApp" sub="a mensagem sai pronta; você escolhe o contato" onClick={() => acoes.reenviar(u)} />
          )}
          <Linha icone="ri-edit-2-line" titulo="Editar dados" sub="nome, matrícula, PIN, cargo e modo treino" onClick={() => acoes.editar(u)} />
          <Linha icone="ri-lock-password-line" titulo={aparelho ? 'Redefinir a senha do sistema' : 'Redefinir a senha'}
            sub={porPin ? 'o PIN se muda em Editar dados; a senha quase não é usada aqui' : 'você define uma senha nova e combina com a pessoa'} onClick={() => acoes.senha(u)} />
        </div>

        {trocas.length > 0 && (
          <div className="mt-3">
            <p className="text-[12px] font-bold text-zinc-500 mb-1.5">Mudar o cargo</p>
            <div className="flex flex-wrap gap-1.5">
              {trocas.map((c) => (
                <button key={c} type="button" onClick={() => acoes.mudarCargo(u, c)}
                  className={`h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer ${c === 'admin' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}>
                  {rotuloCargo(c)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3">
          {u.ativo
            ? <Linha icone="ri-user-forbid-line" tom="red" titulo="Desativar" sub="perde o acesso na hora; pedidos e registros ficam" onClick={() => acoes.desativar(u)} />
            : <Linha icone="ri-user-follow-line" tom="green" titulo="Reativar" sub={`${primeiro} volta a poder entrar`} onClick={() => acoes.reativar(u)} />}
          <Linha icone="ri-delete-bin-line" tom="red" titulo="Excluir"
            sub={u.ativo ? 'só aparece para quem está desativado: desative antes' : 'o acesso some de vez; pedidos e registros ficam'}
            desligada={u.ativo} onClick={() => acoes.excluir(u)} />
        </div>
      </div>
    </Folha>
  );
}
