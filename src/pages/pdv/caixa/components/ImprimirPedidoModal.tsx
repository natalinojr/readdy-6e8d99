import type { PedidoRecente } from '@/types/pdv';
import { sendToPrinter } from '@/lib/printUtils';
import { useImpressoras, PRINTER_KEY_CAIXA_PDV } from '@/contexts/ImpressorasContext';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  pedido: PedidoRecente;
  onClose: () => void;
}

type PedidoComParticipant = PedidoRecente & {
  participantToken?: string | null;
  participantName?: string | null;
};

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function destinoLabel(p: PedidoRecente): string {
  if (p.destino === 'mesa') return `Mesa ${p.mesaNumero}`;
  if (p.destino === 'nome') return p.nomeCliente ?? 'Balcão';
  if (p.destino === 'senha') return p.senha ?? '—';
  if (p.destino === 'delivery') return `Delivery · ${p.nomeCliente}`;
  return 'Balcão';
}

const ORIGEM_LABEL: Record<string, string> = {
  caixa: 'Caixa', garcom: 'Garçom', mesa: 'Mesa (cliente)',
  autoatendimento: 'Autoatendimento',
};

function buildComprovanteHTML(pedido: PedidoRecente, nomeLoja: string): string {
  const subtotal = pedido.itensDetalhes.reduce((acc, i) => acc + i.preco * i.quantidade, 0);
  const numStr = String(pedido.numero).padStart(4, '0');
  const participantToken = (pedido as PedidoComParticipant).participantToken;
  const senhaExibir = participantToken || pedido.senha || '—';

  const lojaRow = nomeLoja
    ? `<div style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">${nomeLoja}</div>`
    : '';

  const mesaRow = pedido.mesaNumero != null
    ? `<div class="row"><span>Mesa:</span><span class="bold">${pedido.mesaNumero}</span></div>`
    : '';

  const senhaRow = participantToken && pedido.destino === 'senha'
    ? `<div class="row"><span>Senha:</span><span class="bold">${participantToken}</span></div>`
    : pedido.destino !== 'mesa'
      ? `<div class="row"><span>${pedido.destino === 'senha' ? 'Senha' : pedido.destino === 'delivery' ? 'Delivery' : 'Cliente'}:</span><span class="bold">${destinoLabel(pedido)}</span></div>`
      : '';

  const garcomRow = pedido.garcomNome
    ? `<div class="row"><span>Garçom:</span><span>${pedido.garcomNome}</span></div>`
    : '';

  const itensHTML = pedido.itensDetalhes.map((item) => {
    const opcoesStr = item.opcoes.length > 0
      ? `<div style="font-size:11px;padding-left:0;color:#333;">${item.opcoes.join(' · ')}</div>`
      : '';
    const obsStr = item.observacao
      ? `<div style="font-size:11px;padding-left:0;font-weight:700;">Obs: ${item.observacao}</div>`
      : '';
    return `
      <div style="margin-bottom:10px;border-bottom:1px dashed #000;padding-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:800;line-height:1.2;">${item.quantidade > 1 ? `${item.quantidade}x ` : ''}${item.nome}</div>
            ${opcoesStr}
            ${obsStr}
          </div>
          <div style="font-size:14px;font-weight:800;flex-shrink:0;">${fmt(item.preco * item.quantidade)}</div>
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Pedido #${numStr}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 500; color: #000; padding: 14px; width: 300px; }
    .center { text-align: center; }
    .bold { font-weight: 800; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 13px; }
    @media print { body { padding: 6px; width: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="center" style="margin-bottom:10px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#555;">COMPROVANTE DE PEDIDO</div>
    ${lojaRow}
    <div style="background:#000;color:#fff;font-size:22px;font-weight:900;padding:8px 4px;margin:8px 0;letter-spacing:0.5px;">
      Senha: ${senhaExibir}
    </div>
    <div style="font-size:10px;color:#555;margin-top:2px;">Pedido #${numStr} · ${pedido.criadoEm}</div>
  </div>

  ${mesaRow}
  ${senhaRow}
  <div class="row"><span>Origem:</span><span>${ORIGEM_LABEL[pedido.origem] ?? pedido.origem}</span></div>
  ${garcomRow}

  <div class="divider"></div>

  ${itensHTML}

  <div class="divider"></div>

  <div class="row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
  <div class="row" style="font-size:16px;font-weight:900;margin-top:4px;"><span>TOTAL</span><span>${fmt(pedido.total)}</span></div>

  <div class="divider" style="margin-top:10px;"></div>
  <div class="center" style="font-size:10px;font-weight:700;letter-spacing:1px;color:#555;">VIA DO CLIENTE</div>
</body>
</html>`;
}

export default function ImprimirPedidoModal({ pedido, onClose }: Props) {
  const { getImpressoraParaEstacao } = useImpressoras();
  const { user } = useAuth();
  const nomeLoja = user?.loja ?? '';
  const participantToken = (pedido as PedidoComParticipant).participantToken;
  const subtotal = pedido.itensDetalhes.reduce((acc, i) => acc + i.preco * i.quantidade, 0);
  const numStr = String(pedido.numero).padStart(4, '0');

  const handlePrint = () => {
    const impressora = getImpressoraParaEstacao(PRINTER_KEY_CAIXA_PDV);
    const MAX_CHARS = impressora?.paperStyle === '58mm' ? 32 : 48;

    // Helpers para truncar e formatar linhas
    function trunc(s: string, max: number): string {
      return s.length <= max ? s : s.slice(0, max - 3) + '...';
    }

    function padRight(s: string, len: number): string {
      return s.length >= len ? s : s + ' '.repeat(len - s.length);
    }

    const senhaExibir = participantToken || pedido.senha || '—';
    const linhas: string[] = [];
    const D = '-'.repeat(MAX_CHARS);

    // Cabeçalho centralizado
    linhas.push(trunc('COMPROVANTE DE PEDIDO', MAX_CHARS));
    if (nomeLoja) linhas.push(trunc(nomeLoja.toUpperCase(), MAX_CHARS));
    linhas.push('');
    linhas.push(trunc(`Senha: ${senhaExibir}`, MAX_CHARS));
    linhas.push(trunc(`Pedido #${numStr}  ${pedido.criadoEm}`, MAX_CHARS));
    linhas.push('');

    // Identificação
    if (pedido.mesaNumero != null) linhas.push(trunc(`Mesa: ${pedido.mesaNumero}`, MAX_CHARS));
    if (pedido.destino !== 'mesa') {
      const label = pedido.destino === 'senha' ? 'Senha' : pedido.destino === 'delivery' ? 'Delivery' : 'Cliente';
      linhas.push(trunc(`${label}: ${destinoLabel(pedido)}`, MAX_CHARS));
    }
    linhas.push(trunc(`Origem: ${ORIGEM_LABEL[pedido.origem] ?? pedido.origem}`, MAX_CHARS));
    if (pedido.garcomNome) linhas.push(trunc(`Garcom: ${pedido.garcomNome}`, MAX_CHARS));

    linhas.push(D);

    // Itens — nome na primeira linha, preço na segunda alinhado à direita
    for (const item of pedido.itensDetalhes) {
      const qtd = item.quantidade > 1 ? `${item.quantidade}x ` : '';
      const precoStr = fmt(item.preco * item.quantidade);
      const nomeCompleto = `${qtd}${item.nome}`;

      // Se nome + preco cabem na mesma linha
      if (nomeCompleto.length + 2 + precoStr.length <= MAX_CHARS) {
        const espacos = MAX_CHARS - nomeCompleto.length - precoStr.length;
        linhas.push(`${nomeCompleto}${' '.repeat(espacos)}${precoStr}`);
      } else {
        // Nome na primeira linha (truncado se necessario), preco na segunda alinhado
        linhas.push(trunc(nomeCompleto, MAX_CHARS));
        linhas.push(padRight(precoStr, MAX_CHARS));
      }

      if (item.opcoes.length > 0) {
        const ops = trunc(item.opcoes.join(' · '), MAX_CHARS - 2);
        linhas.push(`  ${ops}`);
      }
      if (item.observacao) {
        const obs = trunc(item.observacao, MAX_CHARS - 6);
        linhas.push(`  Obs: ${obs}`);
      }
    }

    linhas.push(D);
    linhas.push(trunc(`Subtotal  ${fmt(subtotal)}`, MAX_CHARS));
    linhas.push(trunc(`TOTAL  ${fmt(pedido.total)}`, MAX_CHARS));
    linhas.push(D);
    linhas.push(trunc('VIA DO CLIENTE', MAX_CHARS));

    const plainText = linhas.join('\n');
    sendToPrinter(plainText, impressora);
  };

  // Estilo base igual à cozinha
  const S = {
    root: { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, fontWeight: 500, color: '#000', lineHeight: 1.4 } as React.CSSProperties,
    row: { display: 'flex', justifyContent: 'space-between', marginBottom: 5 } as React.CSSProperties,
    divider: { borderTop: '1px dashed #000', margin: '8px 0' } as React.CSSProperties,
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header modal */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center text-amber-500">
              <i className="ri-receipt-line text-xl" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-900">Pedido #{numStr}</p>
              <p className="text-xs text-zinc-400">{pedido.criadoEm} · {ORIGEM_LABEL[pedido.origem] ?? pedido.origem}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors">
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        {/* Preview comprovante */}
        <div className="flex-1 overflow-y-auto p-5">
          <div style={S.root}>

            {/* Cabeçalho — sem borda, loja abaixo do sistema */}
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: '#555' }}>COMPROVANTE DE PEDIDO</div>
              {nomeLoja && (
                <div style={{ fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{nomeLoja}</div>
              )}
              <div style={{ background: '#000', color: '#fff', fontSize: 22, fontWeight: 900, padding: '8px 4px', margin: '8px 0', letterSpacing: 0.5 }}>
                Senha: {participantToken || pedido.senha || '—'}
              </div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Pedido #{numStr} · {pedido.criadoEm}</div>
            </div>

            {/* Identificação */}
            {pedido.mesaNumero != null && (
              <div style={S.row}><span>Mesa:</span><span style={{ fontWeight: 800 }}>{pedido.mesaNumero}</span></div>
            )}
            {participantToken && pedido.destino === 'senha' ? (
              <div style={S.row}><span>Senha:</span><span style={{ fontWeight: 800 }}>{participantToken}</span></div>
            ) : pedido.destino !== 'mesa' ? (
              <div style={S.row}>
                <span>{pedido.destino === 'senha' ? 'Senha' : pedido.destino === 'delivery' ? 'Delivery' : 'Cliente'}:</span>
                <span style={{ fontWeight: 800 }}>{destinoLabel(pedido)}</span>
              </div>
            ) : null}
            <div style={S.row}><span>Origem:</span><span>{ORIGEM_LABEL[pedido.origem] ?? pedido.origem}</span></div>
            {pedido.garcomNome && (
              <div style={S.row}><span>Garçom:</span><span>{pedido.garcomNome}</span></div>
            )}

            <div style={S.divider} />

            {/* Itens */}
            {pedido.itensDetalhes.map((item) => (
              <div key={item.id} style={{ marginBottom: 10, borderBottom: '1px dashed #000', paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.2 }}>
                      {item.quantidade > 1 ? `${item.quantidade}x ` : ''}{item.nome}
                    </div>
                    {item.opcoes.length > 0 && (
                      <div style={{ fontSize: 11, color: '#333' }}>{item.opcoes.join(' · ')}</div>
                    )}
                    {item.observacao && (
                      <div style={{ fontSize: 11, fontWeight: 700 }}>Obs: {item.observacao}</div>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{fmt(item.preco * item.quantidade)}</div>
                </div>
              </div>
            ))}

            <div style={S.divider} />

            <div style={S.row}><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div style={{ ...S.row, fontSize: 16, fontWeight: 900, marginTop: 4 }}>
              <span>TOTAL</span><span>{fmt(pedido.total)}</span>
            </div>

            <div style={{ ...S.divider, marginTop: 10 }} />
            <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#555' }}>VIA DO CLIENTE</div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-zinc-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap">
            Fechar
          </button>
          <button onClick={handlePrint} className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2">
            <i className="ri-printer-line text-base text-amber-400" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}