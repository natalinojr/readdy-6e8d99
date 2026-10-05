import { describe, it, expect } from 'vitest';
import {
  avisosEquipe, cargosPermitidos, diasSemEntrar, entraPor, filtrarPessoas, linkWhatsApp, loginCompartilhado, loginsDaLoja,
  mensagemAcesso, novaPessoaVazia, partesManchete, passoOk, payloadCriar, pinSugerido, resumoEquipe, senhaAleatoria,
  ultimoAcessoTxt, ordenarPessoas, type PessoaBase,
} from '@/lib/usuariosEquipe';

const p = (o: Partial<PessoaBase> & { id: string }): PessoaBase => ({
  nome: o.id, email: `${o.id}@x.com`, matricula: '', perfil: 'caixa', ativo: true, ultimoAcesso: '2026-10-05T10:00:00Z', diasDesdeAcesso: 0, ...o,
});

describe('usuariosEquipe', () => {
  it('ultimoAcessoTxt em português', () => {
    expect(ultimoAcessoTxt(null)).toBe('nunca');
    expect(ultimoAcessoTxt(0)).toBe('hoje');
    expect(ultimoAcessoTxt(1)).toBe('ontem');
    expect(ultimoAcessoTxt(11)).toBe('há 11 dias');
    expect(ultimoAcessoTxt(75)).toBe('há 2 meses');
  });

  it('diasSemEntrar: null sem acesso, servidor primeiro, relógio como reserva', () => {
    expect(diasSemEntrar({ ultimoAcesso: null, diasDesdeAcesso: null })).toBeNull();
    expect(diasSemEntrar({ ultimoAcesso: '2026-09-01T00:00:00Z', diasDesdeAcesso: 4 })).toBe(4);
    const agora = new Date('2026-10-05T12:00:00Z').getTime();
    expect(diasSemEntrar({ ultimoAcesso: '2026-09-24T12:00:00Z', diasDesdeAcesso: null }, agora)).toBe(11);
  });

  const equipe: PessoaBase[] = [
    p({ id: 'dono', perfil: 'admin', diasDesdeAcesso: 0 }),
    p({ id: 'rafael', perfil: 'gerente', diasDesdeAcesso: 1 }),
    p({ id: 'eduardo', perfil: 'gerente', diasDesdeAcesso: 20 }),
    p({ id: 'thati', perfil: 'supervisao', ultimoAcesso: null, diasDesdeAcesso: null }),
    p({ id: 'conta', perfil: 'admin', ultimoAcesso: null, diasDesdeAcesso: null }),
    p({ id: 'caixa', perfil: 'caixa', email: 'user_0003_ab12@erpos.local', diasDesdeAcesso: 0 }),
    p({ id: 'totem1', perfil: 'totem', email: 'totem_1@totem.erpos.local', ultimoAcesso: null, diasDesdeAcesso: null }),
    p({ id: 'saiu', perfil: 'caixa', ativo: false, ultimoAcesso: null, diasDesdeAcesso: null }),
  ];

  it('resumo conta só pessoas ativas, sem aparelhos', () => {
    const r = resumoEquipe(equipe);
    expect(r).toEqual({ pessoas: 6, nunca: 2, parados: 1, maxDias: 20 });
    expect(partesManchete(r).map((x) => x.texto)).toEqual(['6 pessoas', '2 nunca entraram', '1 sem entrar há 20 dias']);
    expect(partesManchete({ pessoas: 1, nunca: 1, parados: 2, maxDias: 40 }).map((x) => x.texto))
      .toEqual(['1 pessoa', '1 nunca entrou', '2 sem entrar há 15+ dias']);
  });

  it('avisos: admin que nunca entrou primeiro, parados do mais antigo, sem totem/desativado/eu', () => {
    const a = avisosEquipe(equipe, 'dono');
    expect(a.map((x) => `${x.tipo}:${x.pessoa.id}`)).toEqual(['nunca:conta', 'nunca:thati', 'parado:eduardo']);
    expect(avisosEquipe(equipe, 'conta').some((x) => x.pessoa.id === 'conta')).toBe(false);
  });

  it('login compartilhado: caixa/cozinha com e-mail de mentira', () => {
    expect(loginCompartilhado(equipe[5])).toBe(true);
    expect(loginCompartilhado(p({ id: 'k', perfil: 'cozinha', email: 'kiosk-1@kiosk.erpos.internal' }))).toBe(true);
    expect(loginCompartilhado(p({ id: 'x', perfil: 'caixa', email: 'ana@gmail.com' }))).toBe(false);
    expect(loginCompartilhado(p({ id: 'y', perfil: 'gerente', email: 'user_1@erpos.local' }))).toBe(false);
    expect(loginsDaLoja(equipe).map((x) => x.id)).toEqual(['caixa']);
    expect(entraPor(equipe[5])).toBe('matrícula + PIN');
    expect(entraPor(equipe[0])).toBe('e-mail e senha');
  });

  it('cargosPermitidos: supervisor só dá os de baixo', () => {
    const todos = ['caixa', 'cozinha', 'supervisao', 'gerente', 'financeiro', 'contabilidade', 'garcom', 'gestor_entregas', 'tarefas', 'admin'] as const;
    expect(cargosPermitidos('admin', [...todos])).toHaveLength(10);
    expect(cargosPermitidos('gerente', [...todos])).toEqual(['caixa', 'cozinha', 'supervisao', 'garcom', 'gestor_entregas']);
  });

  it('nova pessoa: o passo só libera com um jeito de entrar', () => {
    const n = novaPessoaVazia();
    expect(passoOk(n)).toBe(false);
    expect(passoOk({ ...n, nome: 'Bruna Souza' })).toBe(true);
    expect(passoOk({ ...n, passo: 2 })).toBe(false);
    expect(passoOk({ ...n, passo: 2, cargo: 'caixa' })).toBe(true);
    const t3 = { ...n, passo: 3 as const };
    expect(passoOk(t3)).toBe(false);
    expect(passoOk({ ...t3, entra: 'pin', pin: '123' })).toBe(false);
    expect(passoOk({ ...t3, entra: 'pin', pin: '1234' })).toBe(true);
    expect(passoOk({ ...t3, entra: 'mail', email: 'a@b.com', senha: '123' })).toBe(false);
    expect(passoOk({ ...t3, entra: 'mail', email: 'a@b', senha: '123456' })).toBe(false);
    expect(passoOk({ ...t3, entra: 'mail', email: 'a@b.com', senha: '123456' })).toBe(true);
  });

  it('payloadCriar usa a mesma forma do create_user de hoje', () => {
    const base = { ...novaPessoaVazia(), nome: ' Bruna Souza ', cargo: 'caixa' as const };
    expect(payloadCriar({ ...base, entra: 'pin', pin: '4729' }, 'interna123456')).toEqual({
      nome: 'Bruna Souza', email: undefined, senha: 'interna123456', perfil: 'caixa', training_mode: false, pin: '4729',
    });
    expect(payloadCriar({ ...base, entra: 'mail', email: ' b@x.com ', senha: ' abcdef ' }, 'interna')).toEqual({
      nome: 'Bruna Souza', email: 'b@x.com', senha: 'abcdef', perfil: 'caixa', training_mode: false, pin: undefined,
    });
  });

  it('senha e PIN sugeridos', () => {
    expect(senhaAleatoria(12)).toHaveLength(12);
    expect(senhaAleatoria(5, () => 0)).toBe('aaaaa');
    expect(pinSugerido(() => 1111)).toBe('4729');
    expect(pinSugerido(() => 4321)).toBe('4729');
    expect(pinSugerido(() => 7)).toBe('0007');
  });

  it('mensagem de acesso nunca leva PIN nem senha', () => {
    const m = mensagemAcesso({ nome: 'Bruna Souza', loja: 'El Patron', url: 'https://erpos.vercel.app', matricula: '0010', porPin: true });
    expect(m).toContain('Oi, Bruna!');
    expect(m).toContain('matrícula 0010');
    expect(m).toContain('O PIN eu combino com você pessoalmente');
    const e = mensagemAcesso({ nome: 'Ana', loja: 'El Patron', url: '', email: 'ana@x.com', porPin: false });
    expect(e).toContain('ana@x.com');
    expect(linkWhatsApp('oi a')).toBe('https://wa.me/?text=oi%20a');
  });

  it('filtro e busca sem acento; ordem por poder', () => {
    const l = [p({ id: '1', nome: 'José', matricula: '0007' }), p({ id: '2', nome: 'Ana', perfil: 'admin' }), p({ id: '3', nome: 'Bia', ativo: false })];
    expect(filtrarPessoas(l, { status: 'todas', cargo: null, busca: 'jose' }).map((x) => x.id)).toEqual(['1']);
    expect(filtrarPessoas(l, { status: 'todas', cargo: null, busca: '0007' }).map((x) => x.id)).toEqual(['1']);
    expect(filtrarPessoas(l, { status: 'desativadas', cargo: null, busca: '' }).map((x) => x.id)).toEqual(['3']);
    expect(filtrarPessoas(l, { status: 'ativas', cargo: 'admin', busca: '' }).map((x) => x.id)).toEqual(['2']);
    expect(ordenarPessoas(l).map((x) => x.id)).toEqual(['2', '1', '3']);
  });
});
