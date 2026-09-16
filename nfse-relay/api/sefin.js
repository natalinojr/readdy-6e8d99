// Relay da NFS-e Nacional (Sefin Nacional).
//
// Por que existe: a Sefin exige mTLS com o certificado A1 da empresa e o servidor (IIS) derruba a
// conexão do Deno/rustls das Edge Functions do Supabase. Node (OpenSSL) funciona. Então a Edge
// `nfse-write` cuida de regras e banco, e chama este relay só para assinar e transmitir.
//
// Autenticação: header `x-relay-key` = env NFSE_RELAY_KEY (segredo compartilhado com a Edge).
// Nada é gravado aqui; o certificado chega a cada chamada e só vive na memória da requisição.
//
// POST { op, ambiente (1|2), pfx_b64, senha, ... }
//   cert_info                        → { titular, documento, validade_inicio, validade_fim }
//   emitir     { xml }               → assina infDPS, envia POST /nfse
//   evento     { chave, xml }        → assina infPedReg, envia POST /nfse/{chave}/eventos
//   consultar  { chave }             → GET /nfse/{chave}
//   dps        { id_dps }            → GET /dps/{id}
//   parametros { cod_municipio, c_trib_nac? } → GET /parametros_municipais/...

const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');

const BASES = {
  1: 'https://sefin.nfse.gov.br/SefinNacional',
  2: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
};
const TIMEOUT_MS = 50_000;

function lerPfx(pfxB64, senha) {
  const der = forge.util.decode64(pfxB64);
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, senha);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/mac|password|invalid/i.test(msg)) throw new Error('Senha do certificado incorreta ou arquivo inválido.');
    throw new Error('Não foi possível ler o certificado: ' + msg);
  }
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const keyBag = keyBags[0] || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
  if (!keyBag || !keyBag.key) throw new Error('O arquivo não contém a chave privada.');
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!certBags.length) throw new Error('O arquivo não contém certificado.');
  // Certificado do titular = o que casa com a chave privada (o arquivo pode trazer a cadeia).
  const pubPem = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(keyBag.key.n, keyBag.key.e));
  const titularBag = certBags.find((b) => b.cert && forge.pki.publicKeyToPem(b.cert.publicKey) === pubPem) || certBags[0];
  const cert = titularBag.cert;
  const cadeia = certBags.filter((b) => b !== titularBag && b.cert).map((b) => forge.pki.certificateToPem(b.cert));
  return {
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    certPem: forge.pki.certificateToPem(cert),
    cadeiaPem: cadeia,
    cert,
  };
}

function infoCert(cert) {
  const cn = (cert.subject.getField('CN') || {}).value || '';
  // Padrão ICP-Brasil: "RAZAO SOCIAL:12345678000199" (e-CNPJ) ou "NOME:12345678901" (e-CPF).
  const m = cn.match(/:(\d{11}|\d{14})$/);
  return {
    titular: m ? cn.slice(0, cn.length - m[0].length) : cn,
    documento: m ? m[1] : null,
    validade_inicio: cert.validity.notBefore.toISOString(),
    validade_fim: cert.validity.notAfter.toISOString(),
  };
}

// XMLDSig no perfil aceito pela Sefin para DPS/eventos: C14N 1.0 inclusivo, RSA-SHA1, SHA1,
// transforms enveloped + c14n, <Signature> como irmã logo depois do elemento assinado.
function assinar(xml, tagAssinada, { keyPem, certPem }) {
  const sig = new SignedXml({
    privateKey: keyPem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${tagAssinada}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.getKeyInfoContent = () => {
    const b64 = certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
    return `<X509Data><X509Certificate>${b64}</X509Certificate></X509Data>`;
  };
  sig.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${tagAssinada}']`, action: 'after' },
  });
  return sig.getSignedXml();
}

const gz64 = (txt) => zlib.gzipSync(Buffer.from(txt, 'utf8')).toString('base64');
const ungz64 = (b64) => {
  try { return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'); } catch { return null; }
};

function chamar(ambiente, metodo, caminho, corpo, tls) {
  const url = new URL(BASES[ambiente] + caminho);
  const payload = corpo ? Buffer.from(JSON.stringify(corpo), 'utf8') : null;
  const inicio = Date.now();
  return new Promise((resolve) => {
    let fim = false;
    const terminar = (r) => {
      if (fim) return;
      fim = true;
      clearTimeout(timer);
      r.ms = Date.now() - inicio;
      console.log(JSON.stringify({ metodo: metodo, caminho: caminho.replace(/\d{20,}/g, '…'), http: r.http, ms: r.ms, erro_rede: r.erro_rede }));
      resolve(r);
    };
    // Timer próprio: req.setTimeout reage a qualquer timeout do socket (inclusive de camadas do runtime)
    // e cortava a chamada em ~6 s na Vercel.
    const timer = setTimeout(() => {
      terminar({ http: 0, json: null, erro_rede: `Tempo esgotado (${Math.round(TIMEOUT_MS / 1000)} s) falando com a Sefin Nacional` });
      req.destroy();
    }, TIMEOUT_MS);
    const req = https.request(url, {
      method: metodo,
      key: tls.keyPem,
      cert: [tls.certPem, ...tls.cadeiaPem].join('\n'),
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      const partes = [];
      res.on('data', (d) => partes.push(d));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch { /* HTML de erro do IIS */ }
        terminar({ http: res.statusCode, json, texto: json ? undefined : texto.slice(0, 2000) });
      });
      res.on('error', (e) => terminar({ http: 0, json: null, erro_rede: `${e.code || ''} ${e.message || e}`.trim() }));
    });
    req.on('error', (e) => terminar({ http: 0, json: null, erro_rede: `${e.code || ''} ${e.message || e}`.trim() }));
    if (payload) req.write(payload);
    req.end();
  });
}

// Decodifica os campos *XmlGZipB64 da resposta para XML legível.
function abrirResposta(r) {
  if (r.json && typeof r.json === 'object') {
    for (const [k, v] of Object.entries(r.json)) {
      if (typeof v === 'string' && /XmlGZipB64$/i.test(k)) {
        r.json[k.replace(/GZipB64$/i, '')] = ungz64(v);
        delete r.json[k];
      }
    }
  }
  return r;
}

function igual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST apenas' });
  if (!process.env.NFSE_RELAY_KEY || !igual(req.headers['x-relay-key'], process.env.NFSE_RELAY_KEY)) {
    return res.status(401).json({ ok: false, error: 'não autorizado' });
  }
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const ambiente = Number(b.ambiente) === 1 ? 1 : 2;
  try {
    if (!b.pfx_b64 || typeof b.senha !== 'string') throw new Error('Certificado não configurado.');
    const tls = lerPfx(b.pfx_b64, b.senha);
    const info = infoCert(tls.cert);

    switch (b.op) {
      case 'cert_info':
        return res.json({ ok: true, cert: info });

      case 'emitir': {
        if (!b.xml) throw new Error('xml obrigatório');
        const assinado = assinar(b.xml, 'infDPS', tls);
        const r = abrirResposta(await chamar(ambiente, 'POST', '/nfse', { dpsXmlGZipB64: gz64(assinado) }, tls));
        return res.json({ ok: true, xml_assinado: assinado, ...r });
      }

      case 'evento': {
        if (!/^\d{50}$/.test(String(b.chave || ''))) throw new Error('chave inválida');
        if (!b.xml) throw new Error('xml obrigatório');
        const assinado = assinar(b.xml, 'infPedReg', tls);
        const r = abrirResposta(await chamar(ambiente, 'POST', `/nfse/${b.chave}/eventos`,
          { pedidoRegistroEventoXmlGZipB64: gz64(assinado) }, tls));
        return res.json({ ok: true, xml_assinado: assinado, ...r });
      }

      case 'consultar': {
        if (!/^\d{50}$/.test(String(b.chave || ''))) throw new Error('chave inválida');
        return res.json({ ok: true, ...abrirResposta(await chamar(ambiente, 'GET', `/nfse/${b.chave}`, null, tls)) });
      }

      case 'dps': {
        if (!/^DPS\d{42}$/.test(String(b.id_dps || ''))) throw new Error('id_dps inválido');
        return res.json({ ok: true, ...abrirResposta(await chamar(ambiente, 'GET', `/dps/${b.id_dps}`, null, tls)) });
      }

      case 'parametros': {
        const mun = String(b.cod_municipio || '');
        if (!/^\d{7}$/.test(mun)) throw new Error('cod_municipio inválido');
        const caminho = b.c_trib_nac && /^\d{6}$/.test(b.c_trib_nac)
          ? `/parametros_municipais/${mun}/${b.c_trib_nac}`
          : `/parametros_municipais/${mun}/convenio`;
        return res.json({ ok: true, ...(await chamar(ambiente, 'GET', caminho, null, tls)) });
      }

      default:
        throw new Error('op desconhecida');
    }
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
};
