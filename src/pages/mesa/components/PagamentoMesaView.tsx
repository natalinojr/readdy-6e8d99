import { useState, useMemo, useEffect, useCallback } from 'react';
import QRCode from 'react-qr-code';
import { SUPABASE_URL } from '@/lib/supabase';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const TABLE_WRITE_URL = `${SUPABASE_URL}/functions/v1/table-write`;

interface ClienteMesa {
  nome: string;
  telefone: string;
}

interface Props {
  totalGeral: number;
  mesaNumero: number;
  clienteNome: string;
  onChamarGarcom: () => void;
  clientesMesa?: ClienteMesa[];
  tableSessionId?: string | null;
  onSolicitarEncerramento?: () => void;
}

type Etapa = 'selecionar_conta' | 'escolha' | 'pix' | 'aguardando' | 'confirmado';

export default function PagamentoMesaView({
  totalGeral,
  mesaNumero,
  clienteNome,
  onChamarGarcom,
  clientesMesa = [],
  tableSessionId,
  onSolicitarEncerramento,
}: Props) {
  const [etapa, setEtapa] = useState<Etapa>(
    clientesMesa.length > 1 ? 'selecionar_conta' : 'escolha',
  );
  const [gorjeta, setGorjeta] = useState(0);
  const [podeEncerrar, setPodeEncerrar] = useState(false);
  const [verificandoEncerramento, setVerificandoEncerramento] = useState(false);

  // Verificar se pode encerrar (conta paga + itens entregues) — sem fechar
  const verificarEncerramento = useCallback(async () => {
    if (!tableSessionId) return;
    setVerificandoEncerramento(true);
    try {
      const res = await fetch(TABLE_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_close_conditions', table_session_id: tableSessionId }),
      });
      const data = await res.json();
      setPodeEncerrar(data.can_close === true);
    } catch {
      setPodeEncerrar(false);
    } finally {
      setVerificandoEncerramento(false);
    }
  }, [tableSessionId]);

  // contas: each person has an equal share (we don't track per-person items)
  const contasPorPessoa = useMemo(() => {
    const n = clientesMesa.length || 1;
    const valorPorPessoa = parseFloat((totalGeral / n).toFixed(2));
    const diff = parseFloat((totalGeral - valorPorPessoa * n).toFixed(2));
    return clientesMesa.map((c, i) => ({
      ...c,
      valor: i === 0 ? valorPorPessoa + diff : valorPorPessoa,
      pago: false,
    }));
  }, [clientesMesa, totalGeral]);

  // Selected accounts to pay
  const [contasSelecionadas, setContasSelecionadas] = useState<Set<string>>(
    () => new Set([clienteNome]),
  );

  const toggleConta = (nome: string) => {
    setContasSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) {
        if (next.size > 1) next.delete(nome);
      } else {
        next.add(nome);
      }
      return next;
    });
  };

  const totalSelecionado = useMemo(
    () =>
      contasPorPessoa
        .filter((c) => contasSelecionadas.has(c.nome))
        .reduce((a, c) => a + c.valor, 0),
    [contasPorPessoa, contasSelecionadas],
  );

  // Verificar condições ao montar e quando tableSessionId mudar
  useEffect(() => {
    verificarEncerramento();
  }, [verificarEncerramento]);

  const gorjetaOpts = [0, 5, 10, 15];
  const valorGorjeta = (totalSelecionado * gorjeta) / 100;
  const totalFinal = totalSelecionado + valorGorjeta;

  const pixPayload = `00020126580014br.gov.bcb.pix0136${Date.now()}520400005303986540${totalFinal.toFixed(2)}5802BR5913${encodeURIComponent('ERPOS Pagamentos')}6009SAO PAULO62070503***6304`;

  /* ── Etapa: selecionar conta ── */
  if (etapa === 'selecionar_conta') {
    return (
      <div className="flex flex-col px-4 py-5 pb-28 gap-4">
        <div className="text-center mb-1">
          <h2 className="text-base font-bold text-zinc-900">Selecionar Conta</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Mesa {mesaNumero} · {clientesMesa.length} {clientesMesa.length === 1 ? 'pessoa' : 'pessoas'}
          </p>
        </div>

        <p className="text-xs text-zinc-500 text-center">
          Escolha quais contas você deseja pagar agora
        </p>

        <div className="space-y-2">
          {contasPorPessoa.map((conta) => {
            const sel = contasSelecionadas.has(conta.nome);
            const ehVoce = conta.nome === clienteNome;
            return (
              <button
                key={conta.nome}
                onClick={() => toggleConta(conta.nome)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition-all cursor-pointer text-left ${
                  sel
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-zinc-200 bg-white hover:border-zinc-300'
                }`}
              >
                <div
                  className={`w-6 h-6 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                    sel ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                  }`}
                >
                  {sel && <i className="ri-check-line text-white text-[10px]" />}
                </div>
                <div
                  className={`w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 font-black text-sm ${
                    sel ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {conta.nome.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-zinc-900 truncate">{conta.nome}</p>
                    {ehVoce && (
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                        Você
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">Conta individual</p>
                </div>
                <span className={`text-base font-black flex-shrink-0 ${sel ? 'text-amber-700' : 'text-zinc-600'}`}>
                  {fmt(conta.valor)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Total */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-600">
            Total a pagar ({contasSelecionadas.size} {contasSelecionadas.size === 1 ? 'conta' : 'contas'})
          </span>
          <span className="text-xl font-black text-zinc-900">{fmt(totalSelecionado)}</span>
        </div>

        <button
          onClick={() => setEtapa('escolha')}
          disabled={contasSelecionadas.size === 0 || totalSelecionado === 0}
          className="w-full py-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold rounded-2xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
        >
          <i className="ri-arrow-right-line" />
          Continuar · {fmt(totalSelecionado)}
        </button>
      </div>
    );
  }

  /* ── Etapa: confirmado ── */
  if (etapa === 'confirmado') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 pb-24 text-center">
        <div className="w-20 h-20 flex items-center justify-center bg-emerald-100 rounded-full mb-5">
          <i className="ri-checkbox-circle-fill text-4xl text-emerald-500" />
        </div>
        <h2 className="text-xl font-black text-zinc-900 mb-2">Pagamento Confirmado!</h2>
        <p className="text-sm text-zinc-500 mb-1">
          Obrigado, <strong>{clienteNome}</strong>!
        </p>
        <p className="text-xs text-zinc-400">Mesa {mesaNumero} · {fmt(totalFinal)}</p>
        <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-4 w-full">
          <p className="text-xs text-emerald-600 font-semibold">
            Comprovante gerado · PIX confirmado via Stone
          </p>
          <p className="text-[10px] text-emerald-400 mt-0.5">
            Protocolo: TXN{Date.now().toString().slice(-8)}
          </p>
        </div>
      </div>
    );
  }

  /* ── Etapa: aguardando ── */
  if (etapa === 'aguardando') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 pb-24 text-center">
        <div className="w-20 h-20 flex items-center justify-center bg-amber-100 rounded-full mb-5">
          <i className="ri-loader-4-line text-4xl text-amber-500 animate-spin" />
        </div>
        <h2 className="text-lg font-bold text-zinc-900 mb-2">Aguardando confirmação</h2>
        <p className="text-sm text-zinc-500">Verificando pagamento PIX...</p>
        <p className="text-xs text-zinc-400 mt-1">Isso pode levar alguns segundos</p>
      </div>
    );
  }

  /* ── Etapa: QR PIX ── */
  if (etapa === 'pix') {
    return (
      <div className="flex flex-col px-4 py-5 pb-28 gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEtapa('escolha')}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-left-line text-zinc-600" />
          </button>
          <div>
            <p className="text-xs text-zinc-500 font-semibold">Pagamento PIX</p>
            <p className="font-bold text-zinc-900 text-sm">Mesa {mesaNumero}</p>
          </div>
        </div>

        <div className="bg-white border-2 border-zinc-100 rounded-2xl p-5 flex flex-col items-center gap-4">
          <p className="text-xs text-zinc-500 font-semibold text-center">
            Escaneie o QR Code com o app do seu banco
          </p>
          <div className="p-3 bg-white border-4 border-zinc-900 rounded-2xl">
            <QRCode value={pixPayload} size={180} level="M" style={{ display: 'block' }} />
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-emerald-600">{fmt(totalFinal)}</p>
            {gorjeta > 0 && (
              <p className="text-xs text-zinc-400 mt-0.5">
                Consumo {fmt(totalSelecionado)} + Gorjeta {gorjeta}% ({fmt(valorGorjeta)})
              </p>
            )}
            {contasSelecionadas.size > 1 && (
              <p className="text-xs text-zinc-400 mt-0.5">
                {contasSelecionadas.size} contas selecionadas
              </p>
            )}
          </div>
          <div className="w-full bg-zinc-50 rounded-xl px-3 py-2 flex items-center gap-2">
            <i className="ri-information-line text-zinc-400 text-sm flex-shrink-0" />
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              QR Code dinâmico gerado via API Stone · Confirmação automática por webhook · Válido por 30 min
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {['Abra o app do seu banco', 'Acesse a área PIX', 'Escaneie o QR Code acima', 'Confirme o pagamento'].map(
            (passo, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-6 h-6 flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <p className="text-sm text-zinc-700">{passo}</p>
              </div>
            ),
          )}
        </div>

        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 text-center">
          <p className="text-[10px] text-zinc-400 mb-2">Modo demonstração — simular confirmação</p>
          <button
            onClick={() => {
              setEtapa('aguardando');
              setTimeout(() => setEtapa('confirmado'), 2500);
            }}
            className="px-4 py-2 bg-zinc-800 text-white text-xs font-bold rounded-lg cursor-pointer hover:bg-zinc-700 whitespace-nowrap transition-colors"
          >
            <i className="ri-test-tube-line mr-1" />
            Simular Pagamento PIX
          </button>
        </div>
      </div>
    );
  }

  /* ── Etapa: escolha de método ── */
  return (
    <div className="flex flex-col px-4 py-5 pb-28 gap-4">
      {/* Voltar para seleção de contas (se múltiplas pessoas) */}
      {clientesMesa.length > 1 && (
        <button
          onClick={() => setEtapa('selecionar_conta')}
          className="flex items-center gap-2 self-start text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors"
        >
          <i className="ri-arrow-left-line" />
          Voltar para seleção de contas
        </button>
      )}

      <div className="text-center mb-1">
        <h2 className="text-base font-bold text-zinc-900">Pagamento da Conta</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Mesa {mesaNumero} · {clienteNome}</p>
        {contasSelecionadas.size > 1 && (
          <p className="text-xs text-amber-600 font-semibold mt-0.5">
            {contasSelecionadas.size} contas selecionadas
          </p>
        )}
      </div>

      {/* Resumo */}
      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
        <p className="text-xs font-semibold text-zinc-500 mb-2">Resumo da conta</p>
        {clientesMesa.length > 1 && (
          <div className="space-y-1 mb-3">
            {contasPorPessoa
              .filter((c) => contasSelecionadas.has(c.nome))
              .map((c) => (
                <div key={c.nome} className="flex justify-between text-xs text-zinc-600">
                  <span className="flex items-center gap-1">
                    {c.nome === clienteNome && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                    )}
                    {c.nome}
                  </span>
                  <span className="font-semibold">{fmt(c.valor)}</span>
                </div>
              ))}
            <div className="border-t border-zinc-200 mt-1 pt-1" />
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-sm text-zinc-700">Total a pagar</span>
          <span className="text-lg font-black text-zinc-900">{fmt(totalSelecionado)}</span>
        </div>
        {totalSelecionado === 0 && (
          <p className="text-xs text-zinc-400 mt-2 text-center">Nenhum item enviado ainda</p>
        )}
      </div>

      {/* Gorjeta */}
      <div>
        <p className="text-xs font-semibold text-zinc-700 mb-2">Gorjeta (opcional)</p>
        <div className="flex gap-2">
          {gorjetaOpts.map((pct) => (
            <button
              key={pct}
              onClick={() => setGorjeta(pct)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all cursor-pointer whitespace-nowrap ${
                gorjeta === pct
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {pct === 0 ? 'Sem' : `${pct}%`}
            </button>
          ))}
        </div>
        {gorjeta > 0 && (
          <p className="text-xs text-zinc-500 mt-1.5 text-center">
            Gorjeta: {fmt(valorGorjeta)} · Total:{' '}
            <strong className="text-zinc-800">{fmt(totalFinal)}</strong>
          </p>
        )}
      </div>

      {/* Métodos */}
      <p className="text-xs font-semibold text-zinc-700">Escolha a forma de pagamento</p>

      {/* PIX */}
      <button
        onClick={() => setEtapa('pix')}
        disabled={totalSelecionado === 0}
        className="flex items-center gap-4 px-5 py-5 rounded-2xl border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 cursor-pointer transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <div className="w-12 h-12 flex items-center justify-center bg-emerald-500 rounded-xl flex-shrink-0">
          <i className="ri-qr-code-line text-2xl text-white" />
        </div>
        <div className="text-left flex-1">
          <p className="text-sm font-bold text-emerald-800">Pagar via PIX</p>
          <p className="text-xs text-emerald-600 mt-0.5">QR Code dinâmico · Confirmação automática</p>
          <div className="flex items-center gap-1 mt-1">
            <div className="w-3 h-3 flex items-center justify-center">
              <i className="ri-shield-check-line text-[10px] text-emerald-500" />
            </div>
            <span className="text-[10px] text-emerald-500 font-semibold">Processado via Stone</span>
          </div>
        </div>
        <i className="ri-arrow-right-line text-emerald-500" />
      </button>

      {/* Chamar garçom */}
      <button
        onClick={onChamarGarcom}
        className="flex items-center gap-4 px-5 py-5 rounded-2xl border-2 border-zinc-200 bg-zinc-50 hover:bg-zinc-100 cursor-pointer transition-all active:scale-[0.98]"
      >
        <div className="w-12 h-12 flex items-center justify-center bg-amber-500 rounded-xl flex-shrink-0">
          <i className="ri-service-line text-2xl text-white" />
        </div>
        <div className="text-left flex-1">
          <p className="text-sm font-bold text-zinc-800">Chamar Garçom para Finalizar</p>
          <p className="text-xs text-zinc-500 mt-0.5">Cartão, dinheiro, voucher, etc.</p>
        </div>
        <i className="ri-arrow-right-line text-zinc-400" />
      </button>

      <p className="text-[10px] text-zinc-400 text-center leading-relaxed">
        Para outras formas de pagamento, o garçom irá até você com a maquininha.
      </p>

      {/* Encerrar mesa */}
      {(podeEncerrar || verificandoEncerramento) && (
        <div className="border-t border-zinc-100 pt-4 mt-2">
          {verificandoEncerramento ? (
            <div className="flex items-center justify-center gap-2 py-2">
              <i className="ri-loader-4-line animate-spin text-zinc-400 text-sm" />
              <span className="text-xs text-zinc-400">Verificando condições...</span>
            </div>
          ) : podeEncerrar ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 flex items-center justify-center bg-emerald-500 rounded-full flex-shrink-0">
                  <i className="ri-checkbox-circle-fill text-white text-sm" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-800">Tudo certo!</p>
                  <p className="text-xs text-emerald-600">Conta paga e itens entregues</p>
                </div>
              </div>
              <button
                onClick={onSolicitarEncerramento}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
              >
                <i className="ri-door-open-line" />
                Encerrar Mesa
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
