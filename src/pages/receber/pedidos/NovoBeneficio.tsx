// Pedido de pagamento do boleto de benefício — VR, Alelo, Ticket… (2026-09-30, pedido do dono).
// O boleto não traz o nome dos funcionários e, com mais de um, vem só no total. Aqui a pessoa manda
// o boleto (PDF ou foto), o sistema lê, e ela marca para quem é e quanto de cada um (tem que fechar
// com o boleto). Aprovado, vira o lançamento do RH › Benefícios: uma conta no total + uma linha por
// funcionário — é assim que se sabe depois para quem foi o pagamento.
import { useEffect, useMemo, useRef, useState } from 'react';
import { brl, hojeISO } from '../api';
import { lerPixDaFoto } from '../leitura';
import { chamarPedidos, comprovanteParaEnvio, type BoletoLido, type Funcionario } from './api';
import { Chips, Comprovante, Enviar, Rotulo, Texto, Valor, cls, lerValor } from './ui';
import { lerPixCopia } from './pixCopia';

interface Props {
  tenantId: string;
  onEnviado: () => void;
  onErro: (msg: string | null) => void;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;
const mesSeguinte = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const txtValor = (n: number | null | undefined) => (n != null && n > 0 ? n.toFixed(2).replace('.', ',') : '');
const novaRef = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

export default function NovoBeneficio({ tenantId, onEnviado, onErro }: Props) {
  const hoje = hojeISO();
  const [ref] = useState(novaRef);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [lido, setLido] = useState<BoletoLido | null>(null);
  const [beneficiario, setBeneficiario] = useState('');
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [codigo, setCodigo] = useState('');   // linha digitável ou Pix copia e cola
  const [competencia, setCompetencia] = useState(mesSeguinte(hoje.slice(0, 7)));
  const [funcs, setFuncs] = useState<Funcionario[] | null>(null);
  const [sel, setSel] = useState<Record<string, { on: boolean; valor: string }>>({});
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Competência: o VA de um mês costuma ser pago no fim do mês anterior (RH › Benefícios)
  const mesVenc = (vencimento || hoje).slice(0, 7);
  useEffect(() => { setCompetencia(mesSeguinte(mesVenc)); }, [mesVenc]);

  useEffect(() => {
    let vivo = true;
    chamarPedidos<{ funcionarios: Funcionario[] }>('funcionarios', tenantId, { competencia }).then(({ data, erro }) => {
      if (!vivo) return;
      if (erro) onErro(erro);
      const lista = data?.funcionarios ?? [];
      setFuncs(lista);
      // Já vem marcado quem tem o VA mensal no cadastro e ainda não recebeu neste mês
      setSel((s) => Object.fromEntries(lista.map((f) => [f.id, s[f.id]
        ? { ...s[f.id], on: s[f.id].on && !f.ja_no_mes }
        : { on: !!f.va_mensal && !f.ja_no_mes, valor: txtValor(f.va_mensal) }])));
    });
    return () => { vivo = false; };
  }, [tenantId, competencia, onErro]);

  // Trocou o arquivo: nada do boleto anterior fica nos campos; leitura antiga que chegar depois é ignorada
  const leitura = useRef(0);
  const ler = async (f: File | null) => {
    const minha = ++leitura.current;
    setArquivo(f);
    setLido(null); setBeneficiario(''); setValor(''); setVencimento(''); setCodigo('');
    if (!f) return;
    setLendo(true); onErro(null);
    try {
      // Foto: o QR do Pix é lido no próprio celular (texto exato); a IA lê o resto
      const [envio, pixQr] = await Promise.all([comprovanteParaEnvio(f), f.type.startsWith('image/') ? lerPixDaFoto(f).catch(() => null) : Promise.resolve(null)]);
      const { data, erro } = await chamarPedidos<{ lido: BoletoLido }>('ler_boleto', tenantId, { arquivo: envio });
      if (minha !== leitura.current) return;
      if (erro || !data?.lido) {
        onErro(`${erro ?? 'Não consegui ler o boleto'}. Confira e preencha os campos abaixo.`);
        if (pixQr) setCodigo(pixQr);
        return;
      }
      const l = { ...data.lido, pix_copia_e_cola: data.lido.pix_copia_e_cola ?? (pixQr && lerPixCopia(pixQr) ? pixQr : null) };
      setLido(l);
      if (l.beneficiario) setBeneficiario(l.beneficiario);
      if (l.valor) setValor(txtValor(l.valor));
      if (l.vencimento) setVencimento(l.vencimento);
      setCodigo(l.linha_digitavel ?? l.pix_copia_e_cola ?? '');
    } catch (e) {
      if (minha === leitura.current) onErro((e as Error).message);
    } finally {
      if (minha === leitura.current) setLendo(false);
    }
  };

  const v = lerValor(valor);
  const pix = useMemo(() => (codigo.includes('000201') ? lerPixCopia(codigo) : null), [codigo]);
  const linha = !pix && codigo.replace(/\D/g, '').length >= 44 ? codigo.replace(/\D/g, '') : null;
  const marcados = (funcs ?? []).filter((f) => sel[f.id]?.on);
  const soma = r2(marcados.reduce((t, f) => t + (lerValor(sel[f.id].valor) || 0), 0));
  const diferenca = v > 0 ? r2(v - soma) : 0;

  const mudar = (id: string, p: Partial<{ on: boolean; valor: string }>) => setSel((s) => ({ ...s, [id]: { ...(s[id] ?? { on: false, valor: '' }), ...p } }));
  // Divide o total do boleto igualmente entre os marcados (os centavos que sobram vão no último)
  const dividirIgual = () => {
    if (!(v > 0) || !marcados.length) return;
    const parte = Math.floor((v / marcados.length) * 100) / 100;
    setSel((s) => {
      const n = { ...s };
      marcados.forEach((f, i) => { n[f.id] = { on: true, valor: txtValor(i === marcados.length - 1 ? r2(v - parte * (marcados.length - 1)) : parte) }; });
      return n;
    });
  };

  const faltando = (() => {
    if (lendo) return 'Lendo o boleto…';
    if (!arquivo) return 'Mande o boleto';
    if (!beneficiario.trim()) return 'Quem recebe o boleto?';
    if (!(v > 0)) return 'Informe o valor do boleto';
    if (!vencimento) return 'Informe o vencimento';
    if (codigo.trim() && !pix && !linha) return 'Código de pagamento incompleto';
    if (!marcados.length) return 'Marque para quem é';
    const semValor = marcados.find((f) => !(lerValor(sel[f.id].valor) > 0));
    if (semValor) return `Informe o valor de ${semValor.nome.split(' ')[0]}`;
    if (Math.abs(diferenca) > 0.009) return diferenca > 0 ? `Faltam ${brl(diferenca)} na divisão` : `A divisão passou ${brl(-diferenca)}`;
    return null;
  })();

  const enviar = async () => {
    if (faltando || enviando || !arquivo) return;
    setEnviando(true);
    onErro(null);
    try {
      const comprovante = await comprovanteParaEnvio(arquivo);
      const { erro } = await chamarPedidos('criar', tenantId, {
        tipo: 'beneficio', ref, valor: v, obs, comprovante, vencimento, competencia,
        boleto: {
          beneficiario, cnpj: lido?.cnpj ?? null, numero_documento: lido?.numero_documento ?? null, produto: lido?.produto ?? null,
          linha_digitavel: linha, pix_copia_e_cola: pix?.codigo ?? null,
        },
        itens: marcados.map((f) => ({ employee_id: f.id, valor: lerValor(sel[f.id].valor) })),
      });
      if (erro) { onErro(erro); return; }
      onEnviado();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="px-4 pt-4 pb-32 space-y-4">
      <Comprovante arquivo={arquivo} onArquivo={ler} obrigatorio titulo="Boleto"
        dica="PDF do boleto ou foto dele inteiro (VR, Alelo, Ticket…). O sistema lê sozinho." />
      {lendo && <p className="text-sm text-amber-700 px-1 flex items-center gap-2"><i className="ri-loader-4-line animate-spin" /> Lendo o boleto…</p>}
      {lido && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 space-y-1 text-sm">
          <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Lido do boleto</p>
          {lido.produto && <p className="text-zinc-700">{lido.produto}</p>}
          {lido.numero_documento && <p className="flex justify-between gap-3 text-zinc-600"><span>Nº do documento</span><span>{lido.numero_documento}</span></p>}
          {lido.cnpj && <p className="flex justify-between gap-3 text-zinc-600"><span>CNPJ</span><span>{lido.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}</span></p>}
          <p className="text-xs text-zinc-500 pt-1">
            {lido.linha_digitavel ? <><i className="ri-checkbox-circle-line text-emerald-600" /> Linha digitável conferida</>
              : lido.pix_copia_e_cola ? <><i className="ri-checkbox-circle-line text-emerald-600" /> Pix copia e cola conferido</>
              : 'Não achei a linha digitável nem o Pix — cole abaixo se tiver (opcional).'}
          </p>
          {lido.valor_confere === false && <p className="text-xs font-semibold text-red-700">O valor escrito no boleto é diferente do valor do código. Confira.</p>}
        </div>
      )}

      <Texto label="Quem recebe" valor={beneficiario} onValor={setBeneficiario} placeholder="Ex.: VR Benefícios" />
      <Valor label="Valor do boleto (total)" valor={valor} onValor={setValor} />
      <div>
        <Rotulo>Vencimento</Rotulo>
        <input type="date" min={hoje.slice(0, 8) + '01'} value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1.5 w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm bg-white" />
      </div>
      <div>
        <Rotulo dica="Opcional. Vem sozinho do boleto; serve para pagar depois.">Linha digitável ou Pix copia e cola</Rotulo>
        <textarea rows={2} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="00020101… ou 12345.67890 …" className={`${cls} font-mono text-xs`} />
        {codigo.trim() && !pix && !linha && <p className="text-xs text-red-600 px-1 mt-1">Código incompleto. Copie de novo ou apague.</p>}
        {pix?.valor != null && v > 0 && Math.abs(pix.valor - v) > 0.009 && <p className="text-xs text-red-600 px-1 mt-1">O Pix é de {brl(pix.valor)}, diferente do valor do boleto.</p>}
      </div>

      <div>
        <Rotulo dica="O mês do benefício (costuma ser pago no fim do mês anterior)">Benefício de qual mês?</Rotulo>
        <div className="mt-1.5">
          <Chips opcoes={[mesVenc, mesSeguinte(mesVenc)].map((m) => ({ v: m, label: nomeMes(m) }))} valor={competencia} onValor={setCompetencia} />
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-zinc-100 p-4">
        <Rotulo dica="Marque quem recebe e quanto de cada um. A soma tem que fechar com o boleto.">Para quem é</Rotulo>
        {funcs === null && <p className="text-sm text-zinc-400 mt-2">Carregando funcionários…</p>}
        {funcs?.length === 0 && <p className="text-sm text-zinc-500 mt-2">Nenhum funcionário ativo cadastrado. Cadastre em Financeiro › RH.</p>}
        <div className="mt-2 space-y-2">
          {(funcs ?? []).map((f) => {
            const s = sel[f.id] ?? { on: false, valor: '' };
            return (
              <div key={f.id} className={`flex items-center gap-3 ${f.ja_no_mes ? 'opacity-60' : ''}`}>
                <label className="flex-1 min-w-0 flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={s.on} disabled={f.ja_no_mes} onChange={(e) => mudar(f.id, { on: e.target.checked })} className="w-5 h-5 accent-amber-500 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-zinc-800 truncate">{f.nome}</span>
                    <span className="block text-xs text-zinc-400 truncate">{f.ja_no_mes ? `Já tem benefício em ${nomeMes(competencia)}` : f.funcao ?? ''}</span>
                  </span>
                </label>
                {s.on && (
                  <div className="relative w-32 flex-shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-semibold">R$</span>
                    <input value={s.valor} inputMode="decimal" placeholder="0,00" aria-label={`Valor de ${f.nome}`}
                      onChange={(e) => mudar(f.id, { valor: e.target.value.replace(/[^\d.,]/g, '') })}
                      className="w-full border border-zinc-200 rounded-xl pl-10 pr-3 py-2.5 text-right font-bold bg-white" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {marcados.length > 0 && (
          <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-zinc-500">Soma · {marcados.length} pessoa{marcados.length > 1 ? 's' : ''}</span>
              <span className="text-xl font-black text-zinc-900">{brl(soma)}</span>
            </div>
            {v > 0 && (Math.abs(diferenca) <= 0.009
              ? <p className="text-xs font-semibold text-emerald-700"><i className="ri-checkbox-circle-line" /> Fecha com o boleto</p>
              : <p className="text-xs font-semibold text-red-700">{diferenca > 0 ? `Faltam ${brl(diferenca)}` : `Passou ${brl(-diferenca)}`} para fechar com o boleto ({brl(v)})</p>)}
            {v > 0 && Math.abs(diferenca) > 0.009 && (
              <button type="button" onClick={dividirIgual} className="text-sm font-semibold text-amber-700 cursor-pointer">Dividir {brl(v)} igual entre os marcados</button>
            )}
          </div>
        )}
      </div>

      <Texto label="Observação (opcional)" valor={obs} onValor={setObs} multilinha placeholder="Ex.: fulano teve 2 faltas" />
      <p className="text-xs text-zinc-500 px-1">O pedido vai para o financeiro aprovar. Aprovado, entra em RH › Benefícios com o valor de cada funcionário.</p>

      <Enviar onClick={enviar} disabled={!!faltando || enviando}>
        {enviando ? 'Enviando…' : faltando ?? 'Enviar para aprovação'}
      </Enviar>
    </div>
  );
}
