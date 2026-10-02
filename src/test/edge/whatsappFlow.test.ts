// @vitest-environment node
// whatsapp-flow — criptografia do endpoint (feita como a Meta faz, com node:crypto), token do formulário
// e montagem das listas de dia/horário do agendamento de entrevista.
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCipheriv, createDecipheriv, createHmac, createPublicKey, generateKeyPairSync, publicEncrypt, randomBytes, constants } from 'node:crypto';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const base = resolve(__dirname, '../../../supabase/functions');
const url = (p: string) => pathToFileURL(resolve(base, p)).href;
// deno-lint-ignore no-explicit-any
type Any = any;
let C: Any, T: Any, W: Any;
beforeAll(async () => {
  C = await import(/* @vite-ignore */ url('whatsapp-flow/cripto.ts'));
  T = await import(/* @vite-ignore */ url('whatsapp-flow/telas.ts'));
  W = await import(/* @vite-ignore */ url('_shared/wa-flow.ts'));
});

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

// O que a Meta faz: sorteia a chave AES-128, cifra com a nossa pública (OAEP SHA-256) e o corpo em AES-GCM.
function comoAMeta(corpo: unknown) {
  const aes = randomBytes(16), iv = randomBytes(16);
  const c = createCipheriv('aes-128-gcm', aes, iv);
  const dados = Buffer.concat([c.update(JSON.stringify(corpo), 'utf8'), c.final(), c.getAuthTag()]);
  return {
    aes, iv,
    req: {
      encrypted_aes_key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes).toString('base64'),
      encrypted_flow_data: dados.toString('base64'),
      initial_vector: iv.toString('base64'),
    },
  };
}
// O que a Meta faz com a nossa resposta: mesma chave, vetor invertido.
function abrirResposta(b64: string, aes: Buffer, iv: Buffer) {
  const buf = Buffer.from(b64, 'base64');
  const invertido = Buffer.from(iv.map((b) => ~b & 0xff));
  const d = createDecipheriv('aes-128-gcm', aes, invertido);
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
}

describe('criptografia do endpoint', () => {
  it('decifra o pedido e cifra a resposta com o vetor invertido (ida e volta)', async () => {
    const chave = await C.importarPrivada(privateKey);
    const pedido = { version: '3.0', action: 'INIT', flow_token: 'x', data: { acentuação: 'ção' } };
    const m = comoAMeta(pedido);
    const dec = await C.decifrar(m.req, chave);
    expect(dec.body).toEqual(pedido);
    const resposta = { version: '3.0', screen: 'DIA', data: { vaga: 'Atendente' } };
    expect(abrirResposta(await C.cifrarResposta(resposta, dec.aes, dec.iv), m.aes, m.iv)).toEqual(resposta);
  });

  it('aceita o PEM com "\\n" literais (segredo colado pela CLI)', async () => {
    const chave = await C.importarPrivada(privateKey.replace(/\n/g, '\\n'));
    const m = comoAMeta({ action: 'ping' });
    expect((await C.decifrar(m.req, chave)).body).toEqual({ action: 'ping' });
  });

  it('chave AES cifrada com outra pública → 421', async () => {
    const outra = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const chave = await C.importarPrivada(outra.privateKey);
    await expect(C.decifrar(comoAMeta({ a: 1 }).req, chave)).rejects.toMatchObject({ status: 421 });
  });

  it('a pública derivada é a mesma do par', async () => {
    const pem = await C.publicaDaPrivada(await C.importarPrivada(privateKey));
    expect(createPublicKey(pem).export({ type: 'spki', format: 'pem' })).toBe(createPublicKey(publicKey).export({ type: 'spki', format: 'pem' }));
  });

  it('assinatura X-Hub-Signature-256', async () => {
    const corpo = '{"encrypted_flow_data":"abc"}';
    const sig = `sha256=${createHmac('sha256', 'segredo-do-app').update(corpo).digest('hex')}`;
    expect(await C.assinaturaMetaOk('segredo-do-app', corpo, sig)).toBe(true);
    expect(await C.assinaturaMetaOk('segredo-do-app', `${corpo} `, sig)).toBe(false);
    expect(await C.assinaturaMetaOk('outro', corpo, sig)).toBe(false);
    expect(await C.assinaturaMetaOk('segredo-do-app', corpo, null)).toBe(false);
  });
});

describe('token do formulário', () => {
  const K = 'chave-interna-com-mais-de-20-caracteres';
  const SESS = '3f1c2b9a-0d4e-4b6a-9c1e-2a7b8c9d0e1f';
  it('volta para a mesma sessão', async () => {
    expect(await W.sessaoDoToken(K, await W.tokenDoFlow(K, SESS))).toBe(SESS);
  });
  it('recusa token mexido, de outra chave ou de outra sessão', async () => {
    const tk = await W.tokenDoFlow(K, SESS);
    expect(await W.sessaoDoToken(K, tk.replace(/.$/, (c: string) => (c === '0' ? '1' : '0')))).toBeNull();
    expect(await W.sessaoDoToken('outra-chave-com-mais-de-20-caracteres', tk)).toBeNull();
    const outra = '00000000-0000-4000-8000-000000000000';
    expect(await W.sessaoDoToken(K, `${outra}.${tk.split('.')[1]}`)).toBeNull();
    expect(await W.sessaoDoToken(K, '')).toBeNull();
  });
  it('configuração e lista de números de teste (com e sem 55 / 9)', () => {
    const cfg = W.lerFlowCfg({ flow_id: 123, ativo: true, numeros: ['41 98409-8094'], modo: 'qualquer' });
    expect(cfg).toEqual({ flow_id: '123', ativo: true, numeros: ['41984098094'], modo: 'draft' });
    expect(W.numeroLiberado(cfg, '554184098094')).toBe(true);
    expect(W.numeroLiberado(cfg, '5541999990000')).toBe(false);
    expect(W.numeroLiberado(W.lerFlowCfg(null), '5541999990000')).toBe(true);
  });
});

describe('telas', () => {
  const sp = (s: string) => new Date(`${s}:00-03:00`).toISOString();
  const agora = new Date(sp('2026-10-01T15:00')); // quinta

  it('dias: descarta horário a menos de 30 min, agrupa pela data de São Paulo e nomeia', () => {
    const slots = [sp('2026-10-01T15:20'), sp('2026-10-01T16:00'), sp('2026-10-02T10:00'), sp('2026-10-02T10:20'), sp('2026-10-03T09:00'), sp('2026-10-02T10:00')];
    expect(T.diasDisponiveis(slots, agora)).toEqual([
      { id: '2026-10-01', title: 'Hoje · quinta 01/10', description: '1 horário' },
      { id: '2026-10-02', title: 'Amanhã · sexta 02/10', description: '2 horários' },
      { id: '2026-10-03', title: 'Sábado 03/10', description: '1 horário' },
    ]);
  });

  it('dias: horário das 22h de SP fica no dia certo (UTC já é o dia seguinte)', () => {
    expect(T.diasDisponiveis([sp('2026-10-05T22:00')], agora).map((d: Any) => d.id)).toEqual(['2026-10-05']);
  });

  it('dias: no máximo 7', () => {
    const slots = Array.from({ length: 10 }, (_, i) => sp(`2026-10-${String(2 + i).padStart(2, '0')}T10:00`));
    expect(T.diasDisponiveis(slots, agora)).toHaveLength(7);
  });

  it('horários do dia: HH:MM em São Paulo, ordenados, e "Nenhum" no fim', () => {
    const slots = [sp('2026-10-02T14:20'), sp('2026-10-02T14:00'), sp('2026-10-03T09:00')];
    expect(T.horariosDoDia(slots, '2026-10-02', agora)).toEqual([
      { id: sp('2026-10-02T14:00'), title: '14:00' },
      { id: sp('2026-10-02T14:20'), title: '14:20' },
      { id: T.NENHUM, title: 'Nenhum horário serve' },
    ]);
  });

  it('tela HORARIO leva o dia, o nome e o aviso', () => {
    const t = T.telaHorario([sp('2026-10-02T14:00')], '2026-10-02', agora, 'Esse horário acabou de ser preenchido');
    expect(t.screen).toBe('HORARIO');
    expect(t.data).toMatchObject({ dia: '2026-10-02', dia_label: 'Amanhã · sexta 02/10', tem_aviso: true });
    expect(T.telaHorario([], '2026-10-02', agora).data.tem_aviso).toBe(false);
  });

  it('Flow JSON: rotas batem com as telas, títulos e rótulos dentro dos limites da Meta', () => {
    const f = T.FLOW_JSON;
    const ids = f.screens.map((s: Any) => s.id);
    expect(Object.keys(f.routing_model).sort()).toEqual([...ids].sort());
    for (const s of f.screens) {
      for (const c of s.layout.children) {
        if (c.type === 'Footer') expect(c.label.length).toBeLessThanOrEqual(35);
        // todo ${data.x} usado na tela tem que estar declarado no data dela
        for (const m of JSON.stringify(c).matchAll(/\$\{data\.(\w+)\}/g)) expect(Object.keys(s.data)).toContain(m[1]);
      }
      for (const v of Object.values(s.data) as Any[]) {
        if (Array.isArray(v.__example__)) for (const it of v.__example__) expect(it.title.length).toBeLessThanOrEqual(30);
      }
    }
    const nomes = Array.from({ length: 7 }, (_, i) => T.nomeDoDia(`2026-10-${String(1 + i).padStart(2, '0')}`, agora));
    for (const n of nomes) expect(n.length).toBeLessThanOrEqual(30);
  });
});
