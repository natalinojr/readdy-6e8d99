// Usuários (tela nova) › "+ Nova pessoa" em 4 passos: Nome · Qual o trabalho · Como vai entrar · Pronto.
// Cria pela MESMA chamada do formulário de hoje (useUsuarios.criarUsuario → Edge user-write/create_user),
// com as mesmas validações; só muda como se pede. Protótipo: docs/prototipos/sistema-proposta.html (folha "nova").
import { useEffect, useMemo, useState } from 'react';
import { Folha } from '@/components/kit';
import { btn } from '@/components/kit';
import { confirmar } from '@/components/base/Dialogos';
import { getAppBaseUrl } from '@/lib/appUrl';
import type { PerfilUsuario } from '@/constants/usuarios';
import {
  CARGO_FRASE, CARGOS_OUTROS, DIAS_PARADO, CARGOS_PRINCIPAIS, cargosPermitidos, dicaPasso, linkWhatsApp, mensagemAcesso, novaPessoaVazia,
  passoOk, payloadCriar, pinSugerido, primeiroNome, rotuloCargo, senhaAleatoria, type NovaPessoa,
} from '@/lib/usuariosEquipe';

type Resultado = { success: boolean; error?: string; matricula?: string };

const NOMES_PASSO = ['Nome', 'Trabalho', 'Entrada', 'Pronto'];
const campo = 'block w-full mt-1 h-12 rounded-xl border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-300';

export default function NovaPessoaFolha({ aberta, onFechar, onCriar, quemCria, loja }: {
  aberta: boolean;
  onFechar: () => void;
  onCriar: (payload: ReturnType<typeof payloadCriar>) => Promise<Resultado>;
  quemCria: PerfilUsuario | undefined;
  loja: string;
}) {
  const [n, setN] = useState<NovaPessoa>(novaPessoaVazia());
  const [mais, setMais] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [matricula, setMatricula] = useState('');

  // Cada vez que abre, recomeça do zero.
  useEffect(() => {
    if (!aberta) return;
    setN(novaPessoaVazia()); setMais(false); setVerSenha(false); setErro(null); setMatricula(''); setCriando(false);
  }, [aberta]);

  const principais = useMemo(() => cargosPermitidos(quemCria, CARGOS_PRINCIPAIS), [quemCria]);
  const outros = useMemo(() => cargosPermitidos(quemCria, CARGOS_OUTROS), [quemCria]);
  const ok = passoOk(n);
  const p = n.passo;
  const set = (parte: Partial<NovaPessoa>) => { setErro(null); setN((x) => ({ ...x, ...parte })); };
  const vai = (passo: NovaPessoa['passo']) => setN((x) => ({ ...x, passo }));
  const primeiro = primeiroNome(n.nome);

  const criar = async () => {
    if (!ok || criando) return;
    if (n.cargo === 'admin') {
      const sim = await confirmar({
        titulo: `Criar ${primeiro} como Administrador?`,
        mensagem: 'O Administrador vai poder ver o financeiro inteiro, mudar preços e o cardápio, apagar pedidos e dar ou tirar o acesso de outras pessoas.',
        confirmarLabel: 'Criar mesmo assim', perigo: true, icone: 'ri-shield-star-line',
      });
      if (!sim) return;
    }
    setCriando(true); setErro(null);
    const res = await onCriar(payloadCriar(n, senhaAleatoria(16)));
    setCriando(false);
    if (!res.success) { setErro(res.error ?? 'Não consegui criar a pessoa.'); return; }
    setMatricula(res.matricula ?? '');
    vai(4);
  };

  const mensagem = mensagemAcesso({
    nome: n.nome, loja, url: getAppBaseUrl(), matricula, email: n.email.trim(), porPin: n.entra === 'pin',
  });

  const cartaoCargo = (c: PerfilUsuario) => {
    const info = CARGO_FRASE[c];
    const sel = n.cargo === c;
    return (
      <button key={c} type="button" onClick={() => set({ cargo: c })}
        className={`text-left rounded-2xl border-2 p-3 cursor-pointer transition-colors ${sel ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}>
        <i className={`${info?.icone ?? 'ri-user-line'} text-xl ${sel ? 'text-amber-700' : 'text-zinc-400'}`} />
        <b className="block text-[14px] text-zinc-900 mt-1">{rotuloCargo(c)}</b>
        <span className="block text-[12px] text-zinc-500 leading-snug">{info?.frase}</span>
      </button>
    );
  };

  const opcaoEntrada = (id: 'pin' | 'mail', icone: string, titulo: string, sub: string) => (
    <button type="button" onClick={() => set({ entra: id })}
      className={`w-full text-left rounded-2xl border-2 p-3 flex items-start gap-3 cursor-pointer transition-colors ${n.entra === id ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}>
      <i className={`${icone} text-xl mt-0.5 ${n.entra === id ? 'text-amber-700' : 'text-zinc-400'}`} />
      <span><b className="block text-[14px] text-zinc-900">{titulo}</b><span className="block text-[12px] text-zinc-500 leading-snug">{sub}</span></span>
    </button>
  );

  const rodape = p === 4 ? (
    <>
      <button type="button" onClick={onFechar} className={`${btn('out')} flex-1`}>Fechar</button>
      <button type="button" onClick={() => window.open(linkWhatsApp(mensagem), '_blank', 'noopener,noreferrer')} className={`${btn('wa')} flex-[2]`}>
        <i className="ri-whatsapp-line text-base" />Mandar o acesso pelo WhatsApp
      </button>
    </>
  ) : (
    <>
      <button type="button" onClick={() => (p === 1 ? onFechar() : vai((p - 1) as NovaPessoa['passo']))} disabled={criando} className={`${btn('out')} flex-1`}>
        {p === 1 ? 'Cancelar' : 'Voltar'}
      </button>
      <button type="button" disabled={!ok || criando} onClick={() => (p === 3 ? criar() : vai((p + 1) as NovaPessoa['passo']))} className={`${btn('p')} flex-[2]`}>
        {criando && <span className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />}
        {p === 3 ? 'Criar a pessoa' : 'Continuar'}
      </button>
    </>
  );

  return (
    <Folha aberta={aberta} titulo="Nova pessoa" subtitulo={`Passo ${p} de 4${p === 4 ? ' · criada' : ''}`} onFechar={onFechar} fecharNoFundo={false} rodape={rodape}>
      <div className="flex gap-1.5 pb-3 overflow-x-auto">
        {NOMES_PASSO.map((x, i) => {
          const feito = i + 1 < p;
          return (
            <button key={x} type="button" disabled={!feito || p === 4} onClick={() => vai((i + 1) as NovaPessoa['passo'])}
              className={`flex-1 min-w-0 h-8 rounded-full text-[12px] font-bold whitespace-nowrap ${p === i + 1 ? 'bg-zinc-900 text-white' : feito ? 'bg-amber-100 text-amber-800 cursor-pointer' : 'bg-zinc-100 text-zinc-400'}`}>
              {feito ? '✓ ' : `${i + 1} `}{x}
            </button>
          );
        })}
      </div>

      {p === 1 && (
        <div className="pb-2">
          <h3 className="text-[16px] font-extrabold text-zinc-900">Como a pessoa se chama?</h3>
          <label className="block text-[12px] font-bold text-zinc-500 mt-3">Nome e sobrenome
            <input autoFocus value={n.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Bruna Souza" className={campo} />
          </label>
          <p className="text-[12px] text-zinc-500 mt-3">Entra na loja que está aberta aqui: <b>{loja}</b>. Para dar acesso a outra loja: ⋯ › Acesso entre lojas.</p>
        </div>
      )}

      {p === 2 && (
        <div className="pb-2">
          <h3 className="text-[16px] font-extrabold text-zinc-900">Qual o trabalho de {primeiro}?</h3>
          <div className="grid grid-cols-2 gap-2 mt-3">{principais.map(cartaoCargo)}</div>
          {outros.length > 0 && (
            <button type="button" onClick={() => setMais((m) => !m)} className="mt-3 text-[13px] font-bold text-amber-700 cursor-pointer">
              {mais ? 'Esconder' : 'Outros cargos'}: {outros.map(rotuloCargo).join(', ')} ›
            </button>
          )}
          {mais && <div className="grid grid-cols-2 gap-2 mt-2">{outros.map(cartaoCargo)}</div>}
          {n.cargo === 'admin' && (
            <p className="mt-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-[13px] text-red-700">
              <b>Administrador vê o financeiro, muda preços e apaga pedidos.</b> Só escolha para quem tem a sua confiança total.
            </p>
          )}
          <p className="text-[12px] text-zinc-500 mt-3">
            {quemCria === 'admin' ? 'Você vê todos os cargos.' : 'Você só vê os cargos de baixo: Líder, Caixa, Cozinha, Garçom e Gestor de Entregas.'}
          </p>
        </div>
      )}

      {p === 3 && (
        <div className="pb-2">
          <h3 className="text-[16px] font-extrabold text-zinc-900">Como {primeiro} vai entrar?</h3>
          <div className="space-y-2 mt-3">
            {opcaoEntrada('pin', 'ri-hashtag', 'Matrícula + PIN', 'Para quem usa o aparelho da loja: caixa, cozinha, celular da loja.')}
            {n.entra === 'pin' && (
              <div className="px-1 pb-1">
                <p className="text-[12px] text-zinc-500">A matrícula é gerada sozinha (a próxima da loja) e aparece quando terminar.</p>
                <label className="block text-[12px] font-bold text-zinc-500 mt-2">PIN, de 4 a 8 números
                  <input inputMode="numeric" maxLength={8} value={n.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="••••" className={`${campo} tracking-widest`} />
                </label>
                <button type="button" onClick={() => set({ pin: pinSugerido() })} className={`${btn('ghost', 'sm')} mt-1`}>Sugerir um PIN</button>
              </div>
            )}
            {opcaoEntrada('mail', 'ri-mail-line', 'E-mail + senha', 'Para quem usa o próprio celular ou computador.')}
            {n.entra === 'mail' && (
              <div className="px-1 pb-1">
                <label className="block text-[12px] font-bold text-zinc-500 mt-1">E-mail
                  <input type="email" value={n.email} onChange={(e) => set({ email: e.target.value })} placeholder="nome@exemplo.com" className={campo} />
                </label>
                <label className="block text-[12px] font-bold text-zinc-500 mt-2">Senha inicial (mínimo 6 caracteres)
                  <div className="relative">
                    <input type={verSenha ? 'text' : 'password'} value={n.senha} onChange={(e) => set({ senha: e.target.value })} className={`${campo} pr-11`} autoComplete="new-password" />
                    <button type="button" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? 'Esconder a senha' : 'Mostrar a senha'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 mt-0.5 w-8 h-8 flex items-center justify-center text-zinc-400 cursor-pointer">
                      <i className={verSenha ? 'ri-eye-off-line' : 'ri-eye-line'} />
                    </button>
                  </div>
                </label>
                <button type="button" onClick={() => { set({ senha: senhaAleatoria(10) }); setVerSenha(true); }} className={`${btn('ghost', 'sm')} mt-1`}>Sugerir uma senha</button>
                <p className="text-[12px] text-zinc-500 mt-1">Você combina a senha com a pessoa; ela troca depois em Perfil.</p>
              </div>
            )}
          </div>
          <p className="text-[12px] text-zinc-500 mt-3">O botão só libera quando existe um jeito de entrar: é assim que ninguém é criado sem conseguir acessar. Dá para ligar o outro jeito depois, em Editar dados.</p>
          {erro && <p className="mt-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-[13px] text-red-700">{erro}</p>}
        </div>
      )}

      {p === 4 && (
        <div className="pb-2">
          <div className="text-center pt-2">
            <span className="w-14 h-14 rounded-full bg-emerald-600 text-white inline-flex items-center justify-center text-3xl"><i className="ri-check-line" /></span>
            <b className="block text-[19px] font-extrabold text-zinc-900 mt-2">Pronto: {primeiro} já pode entrar</b>
            <p className="text-[13px] text-zinc-600 mt-1">
              Entra como <b>{n.cargo ? rotuloCargo(n.cargo) : ''}</b> na {loja},{' '}
              {n.entra === 'mail' ? <>com o e-mail <b>{n.email.trim()}</b></> : <>por matrícula <b>{matricula || '—'}</b> + PIN no aparelho da loja</>}.
            </p>
          </div>
          <div className="mt-3 rounded-2xl rounded-bl-sm bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-[12.5px] leading-relaxed text-emerald-900 whitespace-pre-line">
            <b>Mensagem que vai no WhatsApp</b>{'\n'}{mensagem}
          </div>
          <p className="text-[12px] text-zinc-500 mt-3">
            O {n.entra === 'pin' ? 'PIN' : 'a senha'} não vai na mensagem: combine pessoalmente. O WhatsApp abre para você escolher o contato.
            {' '}{primeiro} aparece em Usuários na hora, com o último acesso “nunca”; se não entrar em {DIAS_PARADO} dias, vira um aviso em “Precisa de você”.
          </p>
        </div>
      )}

      {p < 4 && p !== 3 && !ok && <p className="text-[12px] font-bold text-red-600 mt-1">{dicaPasso(n)}</p>}
      {p === 3 && !ok && !erro && <p className="text-[12px] font-bold text-red-600 mt-1">{dicaPasso(n)}</p>}
    </Folha>
  );
}
