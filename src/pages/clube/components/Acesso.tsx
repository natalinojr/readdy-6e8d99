// Entrar no app do clube: CPF + celular completo. CPF que ainda não é do clube vira
// cadastro ali mesmo (nome, aniversário opcional e aceite) — o servidor decide.
import { useState } from 'react';
import { cpfValido, formatarCpf } from '@/lib/fidelidade';
import { clubeApp, nomeDoAparelho } from '@/lib/clubeApp';
import { Botao, FUNDO_MARCA, Logo } from './ui';

const INPUT = 'w-full h-[54px] rounded-[15px] border-[1.5px] border-[#EFE7DD] bg-white px-4 text-[18px] font-bold tracking-wide text-zinc-900 outline-none focus:border-[var(--brand)]';

export function formatarCelular(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export default function Acesso({ slug, lojaNome, logo, programaNome, contatoLoja, indicacao, aviso, onEntrou }: {
  slug: string; lojaNome: string; logo: string | null; programaNome: string;
  contatoLoja: string | null; indicacao: string | null; aviso?: string;
  onEntrou: (token: string) => void;
}) {
  const [cpf, setCpf] = useState('');
  const [cel, setCel] = useState('');
  const [cadastro, setCadastro] = useState(false);
  const [nome, setNome] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [aceita, setAceita] = useState(true);
  const [ofertas, setOfertas] = useState(true);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setErro('');
    const d = cpf.replace(/\D/g, '');
    const c = cel.replace(/\D/g, '');
    if (!cpfValido(d)) { setErro('CPF inválido. Confira os números.'); return; }
    if (c.length < 10) { setErro('Digite o celular com DDD.'); return; }
    if (cadastro) {
      if (nome.trim().length < 2) { setErro('Digite seu nome.'); return; }
      if (!aceita) { setErro('Para entrar no clube é preciso aceitar.'); return; }
    }
    setEnviando(true);
    const r = await clubeApp<{ token?: string; precisa_cadastro?: boolean }>({
      action: 'entrar', slug, cpf: d, celular: c, aparelho: nomeDoAparelho(),
      ...(cadastro ? { nome: nome.trim(), nascimento: nascimento || null, aceita_termos: aceita, aceita_ofertas: ofertas, indicacao } : {}),
    });
    setEnviando(false);
    if (r.precisa_cadastro) { setCadastro(true); return; }
    if (r.error || !r.token) { setErro(r.message || 'Não consegui entrar agora.'); return; }
    onEntrou(r.token);
  };

  return (
    <div className="min-h-dvh bg-[#FBF7F2]">
      <div className="text-white text-center px-6 pt-[max(56px,calc(env(safe-area-inset-top)+36px))] pb-8 rounded-b-[32px]" style={{ background: FUNDO_MARCA }}>
        <Logo src={logo} nome={lojaNome} className="w-[84px] h-[84px] rounded-[22px] mx-auto border-2 border-white/20 shadow-xl text-3xl" />
        <p className="mt-4 text-[12px] font-extrabold tracking-[.16em] uppercase" style={{ color: 'var(--acc)' }}>{programaNome}</p>
        <h1 className="text-[24px] font-extrabold leading-tight mt-1">{cadastro ? 'Falta pouco para entrar' : 'Entre para ver seus pontos'}</h1>
        {indicacao && !cadastro && <p className="text-[13px] mt-2 opacity-90">Você veio por um convite 🎁</p>}
      </div>
      <div className="max-w-md mx-auto px-5 pt-6 pb-10">
        {aviso && <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">{aviso}</p>}
        <label className="block mb-3.5">
          <span className="block text-[13px] font-bold text-zinc-600 mb-1.5">CPF</span>
          <input value={formatarCpf(cpf)} onChange={(e) => { setCpf(e.target.value.replace(/\D/g, '').slice(0, 11)); setCadastro(false); }}
            inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" className={INPUT} />
        </label>
        <label className="block mb-3.5">
          <span className="block text-[13px] font-bold text-zinc-600 mb-1.5">Celular com DDD</span>
          <input value={formatarCelular(cel)} onChange={(e) => { setCel(e.target.value.replace(/\D/g, '').slice(0, 11)); setCadastro(false); }}
            inputMode="tel" autoComplete="tel-national" placeholder="(41) 99999-9999" className={INPUT} />
        </label>

        {cadastro && (
          <div className="mb-2">
            <p className="text-sm text-zinc-600 bg-white border border-[#EFE7DD] rounded-xl p-3 mb-3.5">Este CPF ainda não é do {programaNome}. Complete para entrar:</p>
            <label className="block mb-3.5">
              <span className="block text-[13px] font-bold text-zinc-600 mb-1.5">Seu nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="name" className={INPUT.replace('text-[18px]', 'text-[16px]')} />
            </label>
            <label className="block mb-3.5">
              <span className="block text-[13px] font-bold text-zinc-600 mb-1.5">Aniversário <span className="font-normal text-zinc-400">(opcional — tem presente)</span></span>
              <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className={INPUT.replace('text-[18px]', 'text-[16px]')} />
            </label>
            <label className="flex items-start gap-2.5 text-[13.5px] text-zinc-700 mb-2.5">
              <input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} className="mt-0.5 w-5 h-5 accent-[var(--brand)]" />
              Quero participar do {programaNome}. Meu CPF e celular servem só para somar pontos e liberar prêmios.
            </label>
            <label className="flex items-start gap-2.5 text-[13.5px] text-zinc-700 mb-3">
              <input type="checkbox" checked={ofertas} onChange={(e) => setOfertas(e.target.checked)} className="mt-0.5 w-5 h-5 accent-[var(--brand)]" />
              Quero receber novidades e ofertas no WhatsApp.
            </label>
          </div>
        )}

        {erro && <p className="text-sm font-semibold text-rose-600 mb-3" role="alert">{erro}</p>}
        <Botao onClick={() => { void enviar(); }} disabled={enviando}>{enviando ? 'Aguarde…' : cadastro ? 'Entrar no clube' : 'Entrar'}</Botao>

        {!cadastro && <p className="text-[12.5px] text-zinc-400 text-center leading-relaxed mt-3.5">Ainda não é do clube? Toque em Entrar do mesmo jeito: a gente pede só o seu nome.</p>}
        <p className="text-[12.5px] text-zinc-400 text-center mt-1.5">
          Mudou de número? {contatoLoja
            ? <a className="underline" href={`https://wa.me/${contatoLoja}`} target="_blank" rel="noreferrer">Fale com a loja</a>
            : <span>Fale com o caixa da loja.</span>}
        </p>
        <div className="mt-5 flex gap-2.5 items-start rounded-[14px] border border-[#DCEBE1] bg-[#F3F7F4] p-3 text-[12px] leading-snug text-[#2F5A3E]">
          <i className="ri-shield-check-fill text-lg text-[#2F8A55] leading-none" />
          <span>Seu CPF e celular ficam guardados com a {lojaNome} e servem só para o clube. Na loja, o QR do tablet também te leva direto para cá.</span>
        </div>
      </div>
    </div>
  );
}
