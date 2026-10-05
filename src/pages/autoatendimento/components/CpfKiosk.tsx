// CPF na nota — passo opcional do totem. Só aparece quando a loja emite NFC-e no
// balcão (fiscal_settings.enabled + emit_on_counter): o CPF digitado aqui vai no
// pedido (orders.customer_cpf) e a nota automática sai identificada.
// Aceita CPF (11) e CNPJ (14) — nota de empresa é o mesmo campo.
// Convite do clube: confirmado um CPF válido (não CNPJ), e se a página passar `convite`
// (clube ligado, pessoa ainda fora do clube), pergunta ao servidor se o CPF já é membro (máx. ~3s):
// não é → ConviteClubeKiosk antes de seguir; é membro, deu erro ou demorou → segue direto.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidCpfCnpj, mascaraCpfCnpj, tipoDoc } from '@/lib/cpfCnpj';
import { cpfElegivelAoConvite, type ResultadoConsultaClube } from '@/lib/conviteClubeKiosk';
import ConviteClubeKiosk, { type ConviteClube } from './ConviteClubeKiosk';

interface Props {
  total: number;
  onContinuar: (cpf: string | null) => void;
  onVoltar: () => void;
  /** CPF que o cliente já digitou no clube de fidelidade (vem preenchido; ele pode apagar). */
  cpfInicial?: string;
  /** Convite do clube (ausente = não convida: clube desligado, pessoa já no clube, treino etc.). */
  convite?: ConviteClube;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function CpfKiosk({ total, onContinuar, onVoltar, cpfInicial, convite }: Props) {
  const { t } = useTranslation();
  const [digitos, setDigitos] = useState(cpfInicial ?? '');
  const [erro, setErro] = useState('');
  // Consulta ao clube em andamento (botão "Verificando…") e convite aberto. O convite guarda uma
  // cópia dos dados da página: ao entrar no clube a página deixa de oferecer `convite`, mas a tela
  // do convite precisa continuar de pé até mostrar a confirmação.
  const [verificando, setVerificando] = useState(false);
  const [conviteAberto, setConviteAberto] = useState<ConviteClube | null>(null);
  // Numera a consulta: qualquer toque (tecla, Voltar, Sem CPF) ou sair da tela invalida a resposta que ainda vem.
  const consulta = useRef(0);
  useEffect(() => () => { consulta.current += 1; }, []);
  const cancelarConsulta = () => { consulta.current += 1; setVerificando(false); };

  const ehCnpj = tipoDoc(digitos) === 'CNPJ' || digitos.length > 11;
  const completo = digitos.length === 11 || digitos.length === 14;
  const valido = completo && isValidCpfCnpj(digitos);

  const teclar = (d: string) => {
    cancelarConsulta();
    setErro('');
    if (d === '⌫') { setDigitos((v) => v.slice(0, -1)); return; }
    setDigitos((v) => (v + d).slice(0, 14));
  };

  const confirmar = async () => {
    if (verificando) return;
    if (!valido) {
      setErro(digitos.length < 11 ? t('cliente.cpfFaltamDigitos') : t('cliente.cpfInvalido'));
      return;
    }
    if (convite && cpfElegivelAoConvite(digitos) && !convite.jaTratado(digitos)) {
      const cpf = digitos;
      const minha = ++consulta.current;
      setVerificando(true);
      let r: ResultadoConsultaClube;
      try { r = await convite.consultar(cpf); } catch { r = 'erro'; }
      if (minha !== consulta.current) return; // a pessoa mexeu ou saiu da tela: ignora a resposta
      setVerificando(false);
      convite.onTratado(cpf);
      if (r === 'nao_membro') { setConviteAberto(convite); return; }
    }
    onContinuar(digitos);
  };

  if (conviteAberto) {
    return (
      <ConviteClubeKiosk
        cpf={digitos}
        programa={conviteAberto.programa}
        cadastrar={conviteAberto.cadastrar}
        onSeguir={() => onContinuar(digitos)}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center overflow-hidden portrait:overflow-y-auto portrait:py-6">
      {/* Tablet deitado: duas colunas. Tablet em pé: explicação em cima, teclado embaixo. */}
      <div className="flex portrait:flex-col items-center gap-6 portrait:gap-4 w-full max-w-3xl portrait:max-w-sm">

        {/* Coluna esquerda — explicação */}
        <div className="flex-1 portrait:flex-none flex flex-col gap-3 text-left portrait:text-center portrait:items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 flex items-center justify-center bg-amber-500/20 rounded-2xl flex-shrink-0">
              <i className="ri-file-text-line text-2xl text-amber-400" />
            </div>
            <h2 className="text-2xl font-black text-white">{t('cliente.cpfNaNota')}</h2>
          </div>
          <p className="text-zinc-400 text-base">{t('cliente.cpfExplicacao')}</p>
          <div className="bg-zinc-800 rounded-2xl px-6 py-3 self-start portrait:self-center">
            <p className="text-zinc-400 text-sm mb-0.5">{t('cliente.totalPedido')}</p>
            <p className="text-amber-400 font-black text-2xl">{fmt(total)}</p>
          </div>
        </div>

        {/* Coluna direita — display + teclado */}
        <div className="flex flex-col items-center gap-2 portrait:w-full">
          <div className="w-64 portrait:w-full bg-zinc-800 rounded-2xl px-3 py-3 text-center border border-zinc-700 overflow-hidden">
            <p className="text-zinc-500 text-xs font-semibold mb-1">
              {ehCnpj ? 'CNPJ' : 'CPF'}
            </p>
            {/* CNPJ formatado tem 18 caracteres: em uma linha só, com fonte menor,
                senão o final ("-75") some na borda do display. */}
            <p className={`font-black leading-none whitespace-nowrap tracking-tight ${
              !digitos ? 'text-zinc-600 text-xl portrait:text-2xl' : ehCnpj ? 'text-white text-xl portrait:text-2xl' : 'text-white text-2xl portrait:text-3xl'
            }`}>
              {digitos ? mascaraCpfCnpj(digitos) : '000.000.000-00'}
            </p>
            {erro && <p className="text-red-400 text-sm mt-1 font-semibold">{erro}</p>}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
              <button
                key={i}
                onClick={() => teclar(d)}
                disabled={d === ''}
                className={`w-20 h-14 portrait:w-24 portrait:h-16 portrait:text-2xl flex items-center justify-center rounded-xl text-xl font-bold cursor-pointer transition-all select-none ${
                  d === ''
                    ? 'opacity-0 pointer-events-none'
                    : d === '⌫'
                    ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300 border border-zinc-600'
                    : 'bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white border border-zinc-700'
                }`}
              >
                {d === '⌫' ? <i className="ri-delete-back-2-line text-xl" /> : d}
              </button>
            ))}
          </div>

          <div className="flex gap-2 w-full">
            <button onClick={() => { cancelarConsulta(); onVoltar(); }}
              className="px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-base rounded-xl cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-arrow-left-line mr-1" />
              {t('cliente.voltar')}
            </button>
            <button
              onClick={() => { void confirmar(); }}
              disabled={!completo || verificando}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 text-xl font-black rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
            >
              <i className="ri-checkbox-circle-line mr-1" />
              {verificando ? t('cliente.clubeVerificando') : t('cliente.confirmar')}
            </button>
          </div>

          {/* Sem CPF é o caminho normal: fica sempre à mão, sem precisar apagar o que digitou */}
          <button
            onClick={() => { cancelarConsulta(); onContinuar(null); }}
            className="w-full py-3 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 font-bold text-base rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
          >
            {t('cliente.semCpf')}
          </button>
        </div>
      </div>
    </div>
  );
}
