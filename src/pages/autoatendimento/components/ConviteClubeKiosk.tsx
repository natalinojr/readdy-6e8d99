// Convite do clube de fidelidade na etapa "CPF na nota" do totem.
// Aparece só para quem acabou de informar um CPF válido na nota, ainda não é do clube e
// não entrou pelo passo "clube" do começo. O CPF vem travado (é o mesmo da nota) e o
// cadastro é o MESMO do ClubeKiosk (Edge `fidelidade` › clube_cadastrar, via `cadastrar`).
// "Agora não" segue para o pagamento sem nenhuma chamada extra: nada aqui segura o pedido.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatarCpf } from '@/lib/fidelidade';
import type { ClubeApi } from './ClubeKiosk';
import type { ResultadoConsultaClube } from '@/lib/conviteClubeKiosk';

/** O que a página entrega à etapa do CPF para ela poder convidar (ausente = sem convite). */
export interface ConviteClube {
  /** Nome do programa (ex.: "Clube El Patrón"). */
  programa: string;
  /** Este CPF já foi tratado (convite visto, membro ou consulta falhou) neste pedido? */
  jaTratado: (cpf: string) => boolean;
  onTratado: (cpf: string) => void;
  /** Pergunta ao servidor se o CPF já é membro (limite de ~3s dentro da função). */
  consultar: (cpf: string) => Promise<ResultadoConsultaClube>;
  cadastrar: ClubeApi['cadastrar'];
}

interface Props {
  /** CPF da nota, só dígitos (11). Fica travado. */
  cpf: string;
  programa: string;
  cadastrar: ClubeApi['cadastrar'];
  /** Segue para o pagamento (depois de entrar no clube ou de "Agora não"). */
  onSeguir: () => void;
}

const MS_CONFIRMACAO = 2500;

export default function ConviteClubeKiosk({ cpf, programa, cadastrar, onSeguir }: Props) {
  const { t } = useTranslation();
  const [nome, setNome] = useState('');
  const [celular, setCelular] = useState('');
  const [aceita, setAceita] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<{ saldo: number } | null>(null);

  const vivo = useRef(true);
  const seguiu = useRef(false);
  const onSeguirRef = useRef(onSeguir);
  onSeguirRef.current = onSeguir;
  // Liga no mount (StrictMode monta duas vezes: sem isto ficava false para sempre).
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const seguir = () => {
    if (seguiu.current) return;
    seguiu.current = true;
    onSeguirRef.current();
  };

  // Cadastro feito: mostra a confirmação um instante e segue sozinho para o pagamento.
  useEffect(() => {
    if (!feito) return;
    const id = setTimeout(seguir, MS_CONFIRMACAO);
    return () => clearTimeout(id);
  }, [feito]);

  const entrar = async () => {
    if (enviando) return;
    setErro('');
    // Mesmas regras do cadastro do ClubeKiosk.
    if (nome.trim().length < 2) { setErro(t('cliente.clubeConviteErroNome')); return; }
    const cel = celular.replace(/\D/g, '');
    if (cel.length < 10) { setErro(t('cliente.clubeConviteErroCelular')); return; }
    if (!aceita) { setErro(t('cliente.clubeConviteErroAceite')); return; }
    setEnviando(true);
    let res: Awaited<ReturnType<ClubeApi['cadastrar']>>;
    try {
      // Ofertas no WhatsApp: sem caixinha própria aqui, então não se assume consentimento.
      res = await cadastrar({ cpf, nome: nome.trim(), celular: cel, nascimento: null, aceita_termos: true, aceita_ofertas: false });
    } catch {
      res = { erro: t('cliente.clubeConviteErroGeral') };
    }
    if (!vivo.current) return;
    setEnviando(false);
    if (res.erro) { setErro(res.erro); return; }
    setFeito({ saldo: Math.floor(res.resumo?.saldo ?? 0) });
  };

  if (feito) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6 flex items-center justify-center">
        <div className="w-full max-w-xl flex flex-col gap-4 text-center">
          <p className="text-6xl">🎉</p>
          <h2 className="text-white text-3xl font-black">{t('cliente.clubeConviteFeito')}</h2>
          <p className="text-zinc-300 text-lg">{t('cliente.clubeConviteFeitoTexto')}</p>
          {feito.saldo > 0 && (
            <p className="text-amber-400 text-xl font-black">{t('cliente.clubeConviteSaldo', { pts: feito.saldo.toLocaleString('pt-BR') })}</p>
          )}
          <button
            onClick={seguir}
            className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xl rounded-2xl cursor-pointer active:scale-95 transition-all"
          >
            {t('cliente.clubeConviteContinuar')} <i className="ri-arrow-right-line ml-1" />
          </button>
        </div>
      </div>
    );
  }

  const inp = 'w-full px-4 py-4 bg-zinc-800 border-2 border-zinc-700 focus:border-amber-500 rounded-2xl text-white text-lg outline-none';
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 flex items-start md:items-center justify-center">
      <div className="w-full max-w-xl flex flex-col gap-4">
        <div className="text-center">
          <p className="text-4xl">✨</p>
          <h2 className="text-white text-3xl font-black">{t('cliente.clubeConviteTitulo')}</h2>
          <p className="text-zinc-400 text-base mt-1">{t('cliente.clubeConviteTexto', { programa })}</p>
        </div>

        <div className="block">
          <span className="text-zinc-300 text-sm font-semibold">{t('cliente.clubeConviteCpf')}</span>
          <div className="w-full px-4 py-4 bg-zinc-900 border-2 border-zinc-800 rounded-2xl text-zinc-300 text-lg font-bold tabular-nums flex items-center justify-between gap-2" aria-readonly="true">
            <span>{formatarCpf(cpf)}</span>
            <i className="ri-lock-line text-zinc-500" />
          </div>
        </div>
        <label className="block">
          <span className="text-zinc-300 text-sm font-semibold">{t('cliente.clubeConviteNome')}</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="off" className={inp} placeholder={t('cliente.clubeConviteNomeDica')} />
        </label>
        <label className="block">
          <span className="text-zinc-300 text-sm font-semibold">{t('cliente.clubeConviteCelular')}</span>
          <input
            value={celular}
            onChange={(e) => setCelular(e.target.value.replace(/[^\d() -]/g, '').slice(0, 16))}
            inputMode="numeric"
            autoComplete="off"
            className={inp}
            placeholder="(41) 99999-9999"
          />
        </label>
        <label className="flex items-start gap-3 text-zinc-300 cursor-pointer bg-zinc-900 rounded-2xl p-4 min-h-[56px]">
          <input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} className="mt-1 w-6 h-6 flex-shrink-0 accent-amber-500" />
          <span>{t('cliente.clubeConviteAceite')}</span>
        </label>

        {erro && <p className="text-red-400 font-semibold text-center">{erro}</p>}

        <button
          onClick={() => { void entrar(); }}
          disabled={enviando}
          className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xl rounded-2xl cursor-pointer active:scale-95 transition-all disabled:opacity-50"
        >
          {enviando ? t('cliente.clubeConviteEntrando') : t('cliente.clubeConviteEntrar')}
        </button>
        {/* Sempre disponível, até com o cadastro em andamento: o convite nunca prende o pedido. */}
        <button
          onClick={seguir}
          className="w-full min-h-[56px] py-3 text-zinc-400 hover:text-zinc-200 font-semibold text-lg cursor-pointer"
        >
          {t('cliente.clubeConviteAgoraNao')}
        </button>
      </div>
    </div>
  );
}
