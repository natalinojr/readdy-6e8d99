// DANFSe (documento auxiliar da NFS-e) gerado pelo próprio sistema: a API oficial do DANFSe foi
// encerrada em 01/07/2026 (NT 008/2026). Layout espelhado no DANFSe v2.0 do Emissor Nacional
// (grade de 4 colunas, seções com rótulo cinza, canhoto no rodapé). Abre pronto para imprimir / salvar em PDF.
// Os dados vêm do XML autorizado (fonte da verdade); o que faltar cai nos campos da nota/empresa.
import QRCodeImpl from 'qr.js/lib/QRCode';
import ErrorCorrectLevel from 'qr.js/lib/ErrorCorrectLevel';
import { type Empresa, type Nota, nomeArquivoNota } from '../api';

// QR Code em SVG direto do qr.js (react-dom/server + react-qr-code quebrava no bundle do navegador).
function qrSvg(texto: string, tamanho = 92) {
  const qr = new QRCodeImpl(-1, ErrorCorrectLevel.M);
  qr.addData(texto);
  qr.make();
  const mods: boolean[][] = qr.modules;
  const n = mods.length;
  let d = '';
  mods.forEach((linha, y) => linha.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ou = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? '-' : String(v));
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

const fmtDoc = (v: unknown) => {
  const d = dig(v);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return ou(v);
};
const fmtCep = (v: unknown) => (dig(v).length === 8 ? dig(v).replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3') : '-');
const fmtIbge = (v: unknown) => (dig(v).length === 7 ? dig(v).replace(/^(\d{2})(\d{5})$/, '$1.$2') : '-');
const fmtFone = (v: unknown) => {
  const d = dig(v);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return ou(v);
};
const brl = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
function dataBR(iso: unknown, comHora: boolean) {
  if (!iso) return '-';
  const s = String(iso);
  const d = s.length === 10 ? new Date(`${s}T12:00:00-03:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '-';
  const o: Intl.DateTimeFormatOptions = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', ...(comHora ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}) };
  return d.toLocaleString('pt-BR', o).replace(',', '');
}
const fmtTribNac = (v: unknown) => (dig(v).length === 6 ? dig(v).replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : ou(v));
const fmtNbs = (v: unknown) => (dig(v).length === 9 ? dig(v).replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3.$4') : ou(v));

const SIMPLES: Record<string, string> = {
  '1': 'Não Optante',
  '2': 'Optante - Microempreendedor Individual (MEI)',
  '3': 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)',
};
const REG_AP_SN: Record<string, string> = {
  '1': 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional',
  '2': 'Regime de apuração dos tributos federais pelo SN e o ISSQN por fora do SN conforme respectiva legislação municipal',
  '3': 'Regime de apuração dos tributos federais e municipal por fora do SN conforme respectivas legislações',
};
const TRIB_ISSQN: Record<string, string> = { '1': 'Operação Tributável', '2': 'Imunidade', '3': 'Exportação de Serviço', '4': 'Não Incidência' };
const RET_ISSQN: Record<string, string> = { '1': 'Não Retido', '2': 'Retido pelo Tomador', '3': 'Retido pelo Intermediário' };
const EMITENTE: Record<string, string> = { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' };

function lerXml(xml: string | null) {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  // Primeiro elemento `nome` dentro do primeiro grupo `grupo` (ignora namespace). grupo null = documento todo.
  return (grupo: string | null, nome: string): string | null => {
    const base = grupo ? doc.getElementsByTagNameNS('*', grupo)[0] : doc.documentElement;
    const el = base?.getElementsByTagNameNS('*', nome)[0];
    return el?.textContent ?? null;
  };
}

export function abrirDanfse(nota: Nota, empresa: Empresa) {
  const x = lerXml(nota.xml_nfse);
  const g = (grupo: string | null, nome: string, fallback: unknown = null): string | null => {
    const v = x?.(grupo, nome);
    if (v != null) return v;
    return fallback == null ? null : String(fallback);
  };

  const cancelada = nota.status === 'cancelada';
  const numero = g('infNFSe', 'nNFSe', nota.numero_nfse);
  const chave = nota.chave_acesso ?? '';
  const consulta = chave ? `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}` : '';
  const qr = consulta ? qrSvg(consulta) : '';

  // Prestador: grupo emit da NFS-e (dados que a Receita conhece); cai no cadastro da empresa.
  const emitEnd = [g('emit', 'xLgr', empresa.logradouro), g('emit', 'nro', empresa.numero), g('emit', 'xCpl', empresa.complemento), g('emit', 'xBairro', empresa.bairro)]
    .filter((v) => v && v.trim()).join(', ');
  // Tomador: grupo toma da DPS + fotografia salva na nota.
  const tomDoc = g('toma', 'CNPJ') ?? g('toma', 'CPF') ?? nota.tomador?.documento ?? null;
  const tomEnd = [g('toma', 'xLgr'), g('toma', 'nro'), g('toma', 'xCpl'), g('toma', 'xBairro')].filter((v) => v && v.trim()).join(', ');
  const tomMun = nota.tomador?.municipio ? `${nota.tomador.municipio} / ${nota.tomador.uf ?? ''}` : '-';

  const munEmit = g('infNFSe', 'xLocEmi', empresa.municipio_nome);
  const locPrest = g('infNFSe', 'xLocPrestacao', empresa.municipio_nome);
  const locIncid = g('infNFSe', 'xLocIncid');
  const ufEmp = g('emit', 'UF', empresa.uf) ?? '';

  const vServ = g('vServPrest', 'vServ', nota.valor_servico);
  const vDescIncond = g('vDescCondIncond', 'vDescIncond');
  const vDescCond = g('vDescCondIncond', 'vDescCond');
  const vLiq = g('infNFSe', 'vLiq') ?? String(Number(vServ ?? 0) - Number(vDescIncond ?? 0));

  // Totais aproximados (Lei 12.741/2012), como o emissor oficial escreve nas informações complementares.
  const pSN = g('totTrib', 'pTotTribSN');
  const nz = (v: string | null) => (v && Number(v) > 0 ? pct(v) : '-');
  const totais = pSN
    ? `Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: Simples Nacional: ${pct(pSN)};`
    : `Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: Federais: ${nz(g('pTotTrib', 'pTotTribFed'))}; Estaduais: ${nz(g('pTotTrib', 'pTotTribEst'))}; Municipais: ${nz(g('pTotTrib', 'pTotTribMun'))};`;
  const infCompl = [nota.info_complementar, totais].filter(Boolean).join('\n');

  const c = (rotulo: string, valor: unknown, extra = '') => `<div class="c ${extra}"><b>${esc(rotulo)}</b><span>${esc(ou(valor))}</span></div>`;
  const sec = (titulo: string) => `<div class="c sec"><h2>${esc(titulo)}</h2></div>`;
  const regAp = g('regTrib', 'regApTribSN', empresa.reg_ap_trib_sn);

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(nomeArquivoNota(empresa, nota))}</title>
<style>
  /* Margem fica no body (não no @page): assim sai igual com qualquer opção de margem do diálogo de impressão. */
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  body { font-family: Arial, "Microsoft Sans Serif", Helvetica, sans-serif; color: #000; font-size: 7.5pt; }
  .doc { width: 194mm; min-height: 279mm; margin: 0 auto; border: 1px solid #000; position: relative; display: flex; flex-direction: column; }
  .topo { display: grid; grid-template-columns: 1fr 1.2fr 1fr; align-items: center; background: #f0f0f0; border-bottom: 1px solid #000; padding: 4px 8px; }
  .logo { font-weight: 700; font-size: 20pt; letter-spacing: -1px; color: #2e7d32; line-height: 1; white-space: nowrap; }
  .logo small { display: inline-block; font-size: 7pt; font-weight: 400; color: #555; letter-spacing: 0; line-height: 1.1; margin-left: 4px; vertical-align: middle; }
  .titulo { text-align: center; font-weight: 700; font-size: 10.5pt; line-height: 1.25; }
  .mun { font-size: 9pt; line-height: 1.15; }
  .mun small { display: block; font-size: 6.5pt; }
  .g { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 8px; padding: 0 8px; }
  .c { padding: 3px 0 2px; min-width: 0; }
  .c b { display: block; font-size: 6.5pt; font-weight: 700; line-height: 1.15; }
  .c span { display: block; font-size: 8pt; line-height: 1.2; white-space: pre-wrap; word-break: break-word; }
  .sec { background: #eee; margin-left: -8px; padding-left: 8px; }
  .sec h2 { margin: 0; font-size: 8pt; font-weight: 700; text-transform: uppercase; white-space: nowrap; }
  .corta span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .w2 { grid-column: span 2; } .w3 { grid-column: span 3; } .w4 { grid-column: span 4; }
  .bl { border-top: 1px solid #000; }
  .cinza { background: #eee; }
  .aviso { text-align: center; font-size: 8pt; border-top: 1px solid #000; padding: 1px 0; }
  .qr { grid-column: 4; grid-row: 1 / span 4; text-align: center; font-size: 6.5pt; line-height: 1.2; padding: 4px 0; }
  .qr svg { display: block; margin: 0 auto 2px; }
  .desc-trib { grid-column: span 4; font-size: 7.5pt; padding: 4px 0; }
  .infcompl { flex: 1; padding: 3px 8px; border-top: 1px solid #000; }
  .infcompl h2 { margin: 0 0 8px; font-size: 8.5pt; }
  .infcompl p { margin: 0; font-size: 7.5pt; white-space: pre-wrap; }
  .canhoto { display: grid; grid-template-columns: 1fr 1fr 2fr; margin: 6px 6px 18px; border: 1px solid #000; }
  .canhoto div { padding: 3px 5px 14px; border-left: 1px solid #000; }
  .canhoto div:first-child { border-left: 0; }
  .canhoto b { display: block; font-size: 6.5pt; }
  .canhoto span { font-size: 8pt; }
  .dagua { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-size: 46pt; font-weight: 700; color: rgba(200,0,0,.22); transform: rotate(-22deg); pointer-events: none; }
  .noprint { text-align: center; margin: 10px; }
  @media print { .noprint { display: none; } body { padding: 10mm 8mm 8mm; } .doc { min-height: 0; height: 278mm; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()" style="font-size:14px;padding:8px 18px;cursor:pointer">Imprimir / salvar em PDF</button></div>
<div class="doc">
  ${cancelada ? '<div class="dagua">NFS-e CANCELADA</div>' : nota.ambiente === 2 ? '<div class="dagua">SEM VALOR FISCAL</div>' : ''}
  <div class="topo">
    <div class="logo">NFS<span style="font-size:15pt">e</span><small>Nota Fiscal de<br>Serviço eletrônica</small></div>
    <div class="titulo">DANFSe v2.0<br>Documento Auxiliar da NFS-e</div>
    <div class="mun">Município: ${esc(ou(munEmit))} - ${esc(ufEmp)}
      <small>Ambiente Gerador: ${esc(ou(g('infNFSe', 'ambGer')))}</small>
      <small>Tipo de Ambiente: ${esc(ou(g('infDPS', 'tpAmb', nota.ambiente)))}</small></div>
  </div>

  <div class="g">
    <div class="c w3"><b style="font-size:7.5pt">CHAVE DE ACESSO DA NFS-e</b><span>${esc(ou(chave))}</span></div>
    <div class="qr">${qr}A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e</div>
    ${c('NÚMERO DA NFS-e', numero)}
    ${c('COMPETÊNCIA DA NFS-e', dataBR(g('infDPS', 'dCompet', nota.competencia), false))}
    ${c('DATA E HORA DA EMISSÃO DA NFS-e', dataBR(g('infNFSe', 'dhProc', nota.dh_processamento), true))}
    ${c('NÚMERO DA DPS', g('infDPS', 'nDPS', nota.numero_dps))}
    ${c('SÉRIE DA DPS', g('infDPS', 'serie', nota.serie))}
    ${c('DATA E HORA DA EMISSÃO DA DPS', dataBR(g('infDPS', 'dhEmi', nota.dh_emissao), true))}
    ${c('EMITENTE DA NFS-e', EMITENTE[g('infDPS', 'tpEmit', '1') ?? '1'], 'cinza')}
    ${c('SITUAÇÃO DA NFS-e', cancelada ? 'NFS-e Cancelada' : 'NFS-e Gerada')}
    ${c('FINALIDADE', '-')}
  </div>

  <div class="g bl">
    ${sec('PRESTADOR / FORNECEDOR')}
    ${c('CNPJ / CPF / NIF', fmtDoc(g('emit', 'CNPJ', empresa.cnpj)))}
    ${c('Indicador Municipal (Inscrição)', g('emit', 'IM'))}
    ${c('Telefone', fmtFone(g('emit', 'fone', empresa.fone)))}
    ${c('Nome / Nome Empresarial', g('emit', 'xNome', empresa.razao_social), 'w2')}
    ${c('Município / Sigla UF', `${ou(munEmit)} / ${ufEmp || '-'}`)}
    ${c('Código IBGE / CEP', `${fmtIbge(g('emit', 'cMun', empresa.cod_municipio))} / ${fmtCep(g('emit', 'CEP', empresa.cep))}`)}
    ${c('Endereço', emitEnd, 'w2')}
    ${c('E-mail', g('emit', 'email', empresa.email), 'w2')}
    ${c('Simples Nacional na Data de Competência', SIMPLES[g('regTrib', 'opSimpNac', empresa.op_simp_nac) ?? ''], 'corta')}
    ${c('Regime de Apuração Tributária pelo SN', regAp ? REG_AP_SN[regAp] : '-', 'w3')}
  </div>

  <div class="g bl">
    ${sec('TOMADOR / ADQUIRENTE')}
    ${c('CNPJ / CPF / NIF', tomDoc ? fmtDoc(tomDoc) : '-')}
    ${c('Indicador Municipal (Inscrição)', g('toma', 'IM'))}
    ${c('Telefone', fmtFone(g('toma', 'fone')))}
    ${c('Nome / Nome Empresarial', g('toma', 'xNome', nota.tomador?.nome), 'w2')}
    ${c('Município / Sigla UF', tomMun)}
    ${c('Código IBGE / CEP', `${fmtIbge(g('toma', 'cMun'))} / ${fmtCep(g('toma', 'CEP'))}`)}
    ${c('Endereço', tomEnd, 'w2')}
    ${c('E-mail', g('toma', 'email', nota.tomador?.email), 'w2')}
  </div>
  <div class="aviso">DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e</div>
  <div class="aviso">INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e</div>

  <div class="g bl">
    ${sec('SERVIÇO PRESTADO')}
    ${c('Código de Tributação Nacional/Municipal', `${fmtTribNac(g('cServ', 'cTribNac', nota.c_trib_nac))} / ${ou(g('cServ', 'cTribMun', nota.c_trib_mun))}`)}
    ${c('Código da NBS', fmtNbs(g('cServ', 'cNBS', nota.c_nbs)))}
    ${c('Local da Prestação / Sigla UF / País', `${ou(locPrest)} / ${ufEmp || '-'} / -`)}
    ${g('infNFSe', 'xTribNac') ? `<div class="desc-trib">${esc(g('infNFSe', 'xTribNac'))}</div>` : ''}
    ${c('Descrição do Serviço', g('cServ', 'xDescServ', nota.descricao), 'w4')}
  </div>

  <div class="g bl">
    ${sec('TRIBUTAÇÃO MUNICIPAL (ISSQN)')}
    ${c('Tipo de Tributação do ISSQN', TRIB_ISSQN[g('tribMun', 'tribISSQN', '1') ?? '1'])}
    ${c('Município / Sigla UF / País de Incidência do ISSQN', locIncid ? `${locIncid} / ${ufEmp || '-'} / -` : '-', 'w2')}
    ${c('BC ISSQN', brl(g('infNFSe', 'vBC')))}
    ${c('Alíquota Aplicada', pct(g('infNFSe', 'pAliqAplic')))}
    ${c('Retenção do ISSQN', RET_ISSQN[g('tribMun', 'tpRetISSQN', nota.iss_retido ? '2' : '1') ?? '1'])}
    ${c('ISSQN Apurado', brl(g('infNFSe', 'vISSQN')))}
  </div>

  <div class="g bl">
    ${sec('TRIBUTAÇÃO FEDERAL (EXCETO CBS)')}
    ${c('IRRF', brl(g('tribFed', 'vRetIRRF')))}
    ${c('Contribuição Previdenciária - Retida', brl(g('tribFed', 'vRetCP')))}
    ${c('Contribuições Sociais - Retidas', brl(g('tribFed', 'vRetCSLL')))}
    ${c('PIS - Débito Apuração Própria', brl(g('piscofins', 'vPis')))}
    ${c('COFINS - Débito Apuração Própria', brl(g('piscofins', 'vCofins')))}
    ${c('Descrição Contrib. Sociais - Retidas', '0 - PIS/COFINS/CSLL Não Retidos', 'w2')}
  </div>

  <div class="g bl">
    ${sec('TRIBUTAÇÃO IBS/CBS')}
    ${c('CST / cClassTrib', '- / -')}
    ${c('Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', '- / - / - / -', 'w2')}
    ${c('Exclusões e Reduções da Base de Cálculo', 'R$ 0,00')}
    ${c('Base de Cálculo Após Exclusões e Reduções', '-')}
    ${c('Red. Alíquota IBS / Red. Alíquota CBS', '- / - / -')}
    ${c('Alíquota - IBS UF / IBS Mun', '- / -')}
    ${c('Alíq. Efetiva Municipal - IBS', '-')}
    ${c('Valor Apurado Municipal - IBS', '-')}
    ${c('Alíq. Efetiva Estadual - IBS', '-')}
    ${c('Valor Apurado Estadual - IBS', '-')}
    ${c('Valor Total Apurado - IBS', '-')}
    ${c('Alíquota - CBS', '-')}
    ${c('Alíquota Efetiva - CBS', '-')}
    ${c('Valor Total Apurado - CBS', '-')}
  </div>

  <div class="g bl">
    ${sec('VALOR TOTAL DA NFS-e')}
    ${c('VALOR DA OPERAÇÃO / SERVIÇO', brl(vServ))}
    ${c('Desconto Incondicionado', brl(vDescIncond))}
    ${c('Desconto Condicionado', brl(vDescCond))}
    ${c('Total das Retenções (ISSQN / Federais)', brl(g('infNFSe', 'vTotalRet')))}
    ${c('VALOR LÍQUIDO DA NFS-e', brl(vLiq))}
    ${c('Total do IBS/CBS', 'R$ 0,00')}
    ${c('VALOR LÍQUIDO DA NFS-e + IBS/CBS', 'R$ 0,00', 'cinza')}
  </div>

  <div class="infcompl">
    <h2>INFORMAÇÕES COMPLEMENTARES</h2>
    <p>${esc(infCompl)}</p>
    ${cancelada ? `<p style="margin-top:6px"><b>Cancelada em ${esc(dataBR(nota.cancelada_em, true))}:</b> ${esc(nota.cancel_motivo ?? '')}</p>` : ''}
  </div>

  <div class="canhoto">
    <div><b>DATA CIENTIFICAÇÃO:</b></div>
    <div><b>IDENTIFICAÇÃO E ASSINATURA</b></div>
    <div><b>N° NFS-e / CHAVE NFS-e</b><span>${esc(ou(numero))} / ${esc(ou(chave))}</span></div>
  </div>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
