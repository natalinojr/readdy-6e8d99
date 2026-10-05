// "Mandar foto do boleto" no cartão "Falta o boleto" (2026-10-05) — o mesmo botão na tela Hoje e na caixa
// de pendências do chat. Abre a câmera/arquivo (foto ou PDF), a Edge lê o boleto (assistente-app ›
// conta_ler_boleto, que reaproveita a leitura do boleto de benefício: texto do PDF + IA, linha conferida
// pelo dígito verificador) e o boleto é gravado na conta pelo mesmo caminho da Trilha (conta_guardar_boleto).
//
// Antes de gravar, confere VALOR, VENCIMENTO e QUEM é o fornecedor (regras em src/lib/boletoFoto.ts):
//   · só grava SOZINHO (a pendência fecha sozinha) quando valor E vencimento batem (os dois lidos), as contas do
//     cartão são de UM fornecedor só e o beneficiário lido não contradiz esse fornecedor;
//   · em qualquer outro caso (Pix/concessionária sem vencimento, várias contas ou fornecedores, valor ou vencimento
//     diferente, beneficiário outro) mostra a conta com fornecedor/valor/vencimento e pede confirmação explícita.
// O arquivo não é guardado em lugar nenhum (vai em base64 pela Edge). Só o dono chama (assistente-app).
import { useRef, useState } from 'react';
import { chamarAssistente } from '@/lib/assistenteApp';
import { comprovanteParaEnvio } from '@/pages/receber/pedidos/api';
import { avisosDeConfirmacao, bateCerto, brl, codigoDoBoleto, contaParaGravarSozinho, ddmm, diferencas, type Candidata, type Codigo, type Lido } from '@/lib/boletoFoto';

interface Props {
  /** Contas (em aberto, sem boleto) que a pendência cobre: uma no cartão simples, várias no do fornecedor. */
  billIds: string[];
  /** Classes do botão (cada tela tem o seu estilo). */
  className: string;
  /** Gravou (a pendência já fechou na Edge): recarregar a lista. */
  onFeito: () => void;
}

export default function BoletoPorFoto({ billIds, className, onFeito }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const leitura = useRef(0);
  const [lendo, setLendo] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [lido, setLido] = useState<Lido | null>(null);
  const [cands, setCands] = useState<Candidata[]>([]);
  const [pixQr, setPixQr] = useState<string | null>(null);
  const [colado, setColado] = useState('');

  const limpar = () => { setLido(null); setCands([]); setPixQr(null); setColado(''); setErro(null); };

  const codigo = (l: Lido, qr: string | null, texto: string): Codigo | null => {
    const c = codigoDoBoleto(l, qr);
    if (c) return c;
    const t = texto.trim();
    if (!t) return null;
    return t.startsWith('000201') ? { copia_e_cola: t.replace(/\r?\n/g, '') } : { linha: t };
  };

  const guardar = async (c: Candidata, cod: Codigo, l: Lido, confirmar: boolean) => {
    setGuardando(c.bill_id); setErro(null);
    try {
      const r = await chamarAssistente<{ precisa_confirmar?: boolean; valor_boleto?: number | null; valor_conta?: number; avisos?: string[] }>(
        'conta_guardar_boleto', { bill_id: c.bill_id, ...cod, ...(confirmar ? { confirmar_valor: true } : {}) });
      if (r.precisa_confirmar) {
        // O código gravado diz outro valor que a leitura da foto (ex.: linha colada à mão): pergunta antes.
        setCands((lista) => lista.map((x) => (x.bill_id === c.bill_id ? { ...x, bate_valor: false } : x)));
        setLido({ ...l, valor: r.valor_boleto ?? l.valor });
        return;
      }
      limpar();
      setFeito(`Boleto guardado em ${c.fornecedor} (${brl(c.saldo)}, vence ${ddmm(c.vencimento)}).${(r.avisos ?? []).length ? ` ${(r.avisos ?? []).join(' ')}` : ''}`);
      onFeito();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setGuardando(null); }
  };

  const escolheuArquivo = async (f: File | null) => {
    if (!f) return;
    const minha = ++leitura.current;
    limpar(); setFeito(null); setLendo(true);
    try {
      // Foto: o QR do Pix é lido no próprio aparelho (texto exato); PDF e foto vão à Edge, que lê o resto.
      const [envio, qr] = await Promise.all([
        comprovanteParaEnvio(f),
        f.type.startsWith('image/') ? import('@/pages/receber/leitura').then((m) => m.lerPixDaFoto(f)).catch(() => null) : Promise.resolve(null),
      ]);
      const r = await chamarAssistente<{ lido: Lido; candidatas: Candidata[] }>('conta_ler_boleto', { bill_ids: billIds, arquivo: envio });
      if (minha !== leitura.current) return;
      const cod = codigo(r.lido, qr, '');
      const sozinha = contaParaGravarSozinho(r.candidatas, r.lido);
      // A lista fica pronta antes de gravar: se a gravação pedir confirmação ou falhar, a pessoa já a vê.
      setLido(r.lido); setPixQr(qr);
      setCands([...r.candidatas].sort((a, b) => Number(bateCerto(b)) - Number(bateCerto(a))));
      // Tudo certo e sem nenhuma dúvida (valor, vencimento, um fornecedor só, beneficiário confere) e o código inteiro: grava direto.
      if (cod && sozinha) {
        setLendo(false);
        await guardar(sozinha, cod, r.lido, false);
        return;
      }
      if (!cod) setErro('Não consegui ler o código do boleto nesta foto. Cole a linha digitável abaixo ou mande outra foto (inteira e nítida) ou o PDF.');
    } catch (e) {
      if (minha === leitura.current) setErro(e instanceof Error ? e.message : String(e));
    } finally {
      if (minha === leitura.current) setLendo(false);
    }
  };

  const cod = lido ? codigo(lido, pixQr, colado) : null;
  const painel = erro || feito || lido;

  return (
    <>
      <input ref={entrada} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void escolheuArquivo(f); }} />
      <button type="button" disabled={lendo || guardando != null} onClick={() => entrada.current?.click()} className={className}>
        <i className={lendo ? 'ri-loader-4-line animate-spin' : 'ri-camera-line'} /> {lendo ? 'Lendo o boleto…' : 'Mandar foto do boleto'}
      </button>
      {painel && (
        <div className="basis-full w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 space-y-2 text-left">
          {feito && <p className="text-[13px] font-semibold text-emerald-700"><i className="ri-check-line" /> {feito}</p>}
          {erro && <p className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5 text-xs text-red-700">{erro}</p>}
          {lido && (
            <>
              <p className="text-[12px] text-zinc-600">
                Li no boleto: <b className="tabular-nums">{lido.valor != null ? brl(lido.valor) : 'valor não lido'}</b>
                {lido.vencimento ? <> · vence <b>{ddmm(lido.vencimento)}</b></> : ''}{lido.beneficiario ? <> · {lido.beneficiario}</> : ''}
              </p>
              {!codigoDoBoleto(lido, pixQr) && (
                <textarea value={colado} onChange={(e) => setColado(e.target.value)} rows={2} placeholder="Linha digitável (47 ou 48 números) ou Pix copia e cola"
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-amber-400" />
              )}
              <p className="text-[12px] font-semibold text-zinc-700">{cands.length > 1 ? 'Em qual conta guardar?' : 'Guardar nesta conta?'}</p>
              {cands.map((c) => {
                const dif = diferencas(c, lido);
                const av = avisosDeConfirmacao(c, lido);
                const duvida = dif.length > 0 || av.length > 0;
                const outroNome = av.some((a) => a.startsWith('O boleto é de'));
                return (
                  <div key={c.bill_id} className={`rounded-lg border bg-white px-2.5 py-2 ${duvida ? 'border-amber-200' : 'border-emerald-200'}`}>
                    <p className="text-[13px] text-zinc-800"><b>{c.fornecedor}</b> · <span className="tabular-nums">{brl(c.saldo)}</span> · vence {ddmm(c.vencimento)}</p>
                    {[...dif, ...av].map((d) => <p key={d} className="text-[12px] text-amber-800">{d}</p>)}
                    {(dif.length > 0 || outroNome) && <p className="text-[12px] text-amber-800">{outroNome ? 'Confirme que o boleto é desta conta. Guardar mesmo assim?' : 'Pode ser de outra parcela ou um boleto atualizado. Guardar mesmo assim?'}</p>}
                    <button type="button" disabled={!cod || guardando != null} onClick={() => cod && lido && void guardar(c, cod, lido, dif.length > 0)}
                      className={`mt-1.5 h-9 px-3 rounded-lg text-[12px] font-bold disabled:opacity-50 cursor-pointer ${duvida ? 'bg-amber-100 text-amber-900 hover:bg-amber-200' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}>
                      {guardando === c.bill_id ? 'Guardando…' : dif.length > 0 || outroNome ? 'Guardar mesmo assim' : 'Guardar nesta conta'}
                    </button>
                  </div>
                );
              })}
            </>
          )}
          {(lido || erro) && <button type="button" onClick={() => { limpar(); }} className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer">Cancelar</button>}
        </div>
      )}
    </>
  );
}
