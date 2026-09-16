// DANFSe (documento auxiliar da NFS-e) gerado pelo próprio sistema: a API oficial do DANFSe foi
// encerrada em 01/07/2026 (NT 008/2026). Abre uma janela pronta para imprimir / salvar em PDF.
// Os dados vêm do XML autorizado (fonte da verdade); o que faltar cai nos campos da nota.
import QRCodeImpl from 'qr.js/lib/QRCode';
import ErrorCorrectLevel from 'qr.js/lib/ErrorCorrectLevel';
import { type Empresa, type Nota, fmtBRL, fmtChave, fmtData, fmtDataHora, fmtDoc, nomeArquivoNota } from '../api';

// QR Code em SVG direto do qr.js (react-dom/server + react-qr-code quebrava no bundle do navegador).
function qrSvg(texto: string, tamanho = 96) {
  const qr = new QRCodeImpl(-1, ErrorCorrectLevel.M);
  qr.addData(texto);
  qr.make();
  const mods: boolean[][] = qr.modules;
  const n = mods.length;
  let d = '';
  mods.forEach((linha, y) => linha.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lerXml(xml: string | null) {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  // Primeiro elemento com o nome dentro de um grupo (ignora namespace).
  const em = (grupo: string | null, nome: string): string | null => {
    const base = grupo ? doc.getElementsByTagNameNS('*', grupo)[0] : doc.documentElement;
    const el = base?.getElementsByTagNameNS('*', nome)[0];
    return el?.textContent ?? null;
  };
  return { em };
}

export function abrirDanfse(nota: Nota, empresa: Empresa) {
  const x = lerXml(nota.xml_nfse);
  const g = (grupo: string | null, nome: string, fallback: unknown = '') => x?.em(grupo, nome) ?? fallback;
  const num = (v: unknown) => (v === '' || v == null ? null : Number(v));

  const numero = g('infNFSe', 'nNFSe', nota.numero_nfse ?? '—');
  const dhProc = g('infNFSe', 'dhProc', nota.dh_processamento);
  const vServ = num(g('vServPrest', 'vServ', nota.valor_servico)) ?? 0;
  const vDesc = num(g('vDescCondIncond', 'vDescIncond', nota.desconto_incondicionado));
  const vBC = num(g('valores', 'vBC'));
  const pAliq = num(g('valores', 'pAliqAplic', nota.aliquota_iss));
  const vIss = num(g('valores', 'vISSQN'));
  const vRet = num(g('valores', 'vTotalRet'));
  const vLiq = num(g('valores', 'vLiq')) ?? vServ - (vDesc ?? 0);
  const tom = nota.tomador;
  const tomEnd = [g('toma', 'xLgr'), g('toma', 'nro'), g('toma', 'xBairro')].filter(Boolean).join(', ');
  const consulta = nota.chave_acesso ? `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${nota.chave_acesso}` : '';
  const qr = consulta ? qrSvg(consulta) : '';
  const cancelada = nota.status === 'cancelada';
  const testes = nota.ambiente === 2;

  const linha = (rotulo: string, valor: unknown) => `<div class="c"><span>${esc(rotulo)}</span><b>${esc(valor || '—')}</b></div>`;

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(nomeArquivoNota(empresa, nota))}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Microsoft Sans Serif", sans-serif; font-size: 8pt; color: #000; margin: 0; }
  .doc { max-width: 190mm; margin: 0 auto; border: 1px solid #000; position: relative; }
  .sec { border-top: 1px solid #000; padding: 4px 6px; }
  .sec:first-child { border-top: 0; }
  h1 { font-size: 11pt; margin: 0; }
  h2 { font-size: 8pt; margin: 0 0 3px; text-transform: uppercase; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 8px; }
  .c span { display: block; font-size: 7pt; color: #333; }
  .c b { font-weight: 700; font-size: 8pt; word-break: break-word; }
  .w2 { grid-column: span 2; } .w4 { grid-column: span 4; }
  .top { display: flex; gap: 8px; align-items: center; }
  .top .t { flex: 1; }
  .marca { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 40pt; color: rgba(200,0,0,.25); transform: rotate(-20deg); pointer-events: none; font-weight: 700; }
  .desc { white-space: pre-wrap; font-size: 8pt; }
  .tot { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 8px; }
  .noprint { text-align: center; margin: 12px; }
  @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()" style="font-size:14px;padding:8px 18px;cursor:pointer">Imprimir / salvar em PDF</button></div>
<div class="doc">
  ${cancelada ? '<div class="marca">CANCELADA</div>' : testes ? '<div class="marca">SEM VALOR FISCAL</div>' : ''}
  <div class="sec top">
    <div class="t">
      <h1>DANFSe — Documento Auxiliar da NFS-e</h1>
      <div class="grid" style="margin-top:4px">
        ${linha('Número da NFS-e', numero)}
        ${linha('Competência', fmtData(nota.competencia))}
        ${linha('Emissão / processamento', fmtDataHora(String(dhProc || nota.dh_emissao)))}
        ${linha('DPS', `${nota.numero_dps} / série ${nota.serie}`)}
        <div class="c w4"><span>Chave de acesso</span><b>${esc(fmtChave(nota.chave_acesso))}</b></div>
      </div>
    </div>
    ${qr ? `<div>${qr}</div>` : ''}
  </div>
  <div class="sec">
    <h2>Prestador do serviço</h2>
    <div class="grid">
      <div class="c w2"><span>Nome / razão social</span><b>${esc(g('emit', 'xNome', empresa.razao_social))}</b></div>
      ${linha('CNPJ', fmtDoc(g('emit', 'CNPJ', empresa.cnpj) as string))}
      ${linha('Inscrição municipal', g('emit', 'IM', empresa.inscricao_municipal))}
      <div class="c w2"><span>Endereço</span><b>${esc([empresa.logradouro, empresa.numero, empresa.bairro].filter(Boolean).join(', '))}</b></div>
      ${linha('Município', empresa.municipio_nome ? `${empresa.municipio_nome}/${empresa.uf}` : '')}
      ${linha('Simples Nacional', empresa.op_simp_nac === 3 ? 'Optante ME/EPP' : empresa.op_simp_nac === 2 ? 'MEI' : 'Não optante')}
    </div>
  </div>
  <div class="sec">
    <h2>Tomador do serviço</h2>
    <div class="grid">
      <div class="c w2"><span>Nome / razão social</span><b>${esc(tom?.nome ?? 'Não identificado')}</b></div>
      ${linha('CPF / CNPJ', tom ? fmtDoc(tom.documento) : '')}
      ${linha('E-mail', tom?.email)}
      <div class="c w2"><span>Endereço</span><b>${esc(tomEnd || '—')}</b></div>
      ${linha('Município', tom?.municipio ? `${tom.municipio}/${tom.uf ?? ''}` : '')}
    </div>
  </div>
  <div class="sec">
    <h2>Serviço prestado</h2>
    <div class="grid">
      ${linha('Código de tributação nacional', nota.c_trib_nac)}
      ${linha('Código municipal', nota.c_trib_mun)}
      ${linha('NBS', nota.c_nbs)}
      ${linha('Local da prestação', g('infNFSe', 'xLocPrestacao', nota.cod_municipio_prestacao))}
      <div class="c w4"><span>Descrição</span><div class="desc">${esc(nota.descricao)}</div></div>
    </div>
  </div>
  <div class="sec">
    <h2>Valores e tributação</h2>
    <div class="tot">
      ${linha('Valor do serviço', fmtBRL(vServ))}
      ${linha('Desconto incondicionado', vDesc ? fmtBRL(vDesc) : '')}
      ${linha('Base de cálculo ISS', vBC != null ? fmtBRL(vBC) : '')}
      ${linha('Alíquota ISS', pAliq != null ? `${pAliq.toFixed(2)}%` : '')}
      ${linha('Valor do ISS', vIss != null ? fmtBRL(vIss) : '')}
      ${linha('ISS retido', nota.iss_retido ? 'Sim, pelo tomador' : 'Não')}
      ${linha('Retenções', vRet ? fmtBRL(vRet) : '')}
      <div class="c"><span>Valor líquido</span><b style="font-size:10pt">${esc(fmtBRL(vLiq))}</b></div>
    </div>
    ${empresa.op_simp_nac === 3 && empresa.aliquota_simples != null ? `<p style="margin:4px 0 0">Tributos pelo Simples Nacional: alíquota efetiva de ${Number(empresa.aliquota_simples).toFixed(2)}%.</p>` : ''}
  </div>
  ${nota.info_complementar ? `<div class="sec"><h2>Informações complementares</h2><div class="desc">${esc(nota.info_complementar)}</div></div>` : ''}
  ${cancelada ? `<div class="sec"><h2>Cancelamento</h2>Cancelada em ${esc(fmtDataHora(nota.cancelada_em))}: ${esc(nota.cancel_motivo)}</div>` : ''}
  <div class="sec" style="font-size:7pt">Consulte a autenticidade em https://www.nfse.gov.br/ConsultaPublica informando a chave de acesso.</div>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
