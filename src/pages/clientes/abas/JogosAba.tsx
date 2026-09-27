// Aba Jogos de Clientes & Marketing — ranking semanal dos jogos "enquanto espera"
// (mesa QR e acompanhamento do delivery). A loja liga o ranking, escreve o prêmio do
// 1º ao 3º lugar e, depois que a semana fecha (domingo 23:59), marca quem já recebeu.
// A pontuação é conferida no servidor (Edge `jogos` refaz a partida); só joga valendo
// quem tem pedido de verdade na loja nas últimas 12h.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';

interface Premio { posicao: number; descricao: string }
interface Config { ranking_ativo: boolean; jogos: string[]; premios: Premio[]; regras: string }
interface LinhaAdmin { posicao: number; nome: string; telefone: string; pontos: number; entregue_em?: string | null; premio?: string | null }
interface DadosJogo {
  semana_atual: { semana: string; termina_em: string; jogadores: number; top: LinhaAdmin[] };
  anteriores: { semana: string; jogadores: number; top: LinhaAdmin[] }[];
}
interface Resposta { config: Config; semana: string; jogos: Record<string, DadosJogo>; partidas_semana: number; error?: string; message?: string }

const NOMES: Record<string, string> = { voa: 'Voa Voa', corre: 'Corre Corre' };
const MEDALHA = ['🥇', '🥈', '🥉'];

function fone(t: string) {
  return t.length === 11 ? '(' + t.slice(0, 2) + ') ' + t.slice(2, 7) + '-' + t.slice(7) : '(' + t.slice(0, 2) + ') ' + t.slice(2, 6) + '-' + t.slice(6);
}
function periodo(semana: string) {
  const ini = new Date(semana + 'T12:00:00');
  const fim = new Date(ini.getTime() + 6 * 86400000);
  const f = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return f(ini) + ' a ' + f(fim);
}

export default function JogosAba() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [dados, setDados] = useState<Resposta | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState<number | null>(null);
  const [jogoVer, setJogoVer] = useState('voa');
  const [marcando, setMarcando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const { data, error } = await invokeWithAuth<Resposta>('jogos', { body: { action: 'admin_get', tenant_id: tenantId } });
    if (error || !data || data.error) { setErro(data?.message || error?.message || 'Não foi possível carregar.'); return; }
    setErro(null);
    setDados(data);
    setCfg(function (c) { return c ?? data.config; });
  }, [tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvar() {
    if (!tenantId || !cfg) return;
    setSalvando(true);
    const { data, error } = await invokeWithAuth<{ config?: Config; error?: string; message?: string }>('jogos', {
      body: { action: 'admin_save', tenant_id: tenantId, config: cfg },
    });
    setSalvando(false);
    if (error || !data || data.error) { setErro(data?.message || error?.message || 'Não foi possível salvar.'); return; }
    setCfg(data.config!);
    setSalvoEm(Date.now());
    carregar();
  }

  async function marcar(semana: string, jogo: string, posicao: number, entregue: boolean) {
    if (!tenantId) return;
    const chave = semana + jogo + posicao;
    setMarcando(chave);
    const { data, error } = await invokeWithAuth<{ error?: string; message?: string }>('jogos', {
      body: { action: entregue ? 'admin_unaward' : 'admin_award', tenant_id: tenantId, semana, jogo, posicao },
    });
    setMarcando(null);
    if (error || data?.error) { setErro(data?.message || error?.message || 'Não foi possível marcar.'); return; }
    carregar();
  }

  function premioTexto(p: number) {
    return cfg?.premios.find((x) => x.posicao === p)?.descricao ?? '';
  }
  function setPremio(p: number, texto: string) {
    if (!cfg) return;
    const outros = cfg.premios.filter((x) => x.posicao !== p);
    setCfg({ ...cfg, premios: [...outros, { posicao: p, descricao: texto }].sort((a, b) => a.posicao - b.posicao) });
  }

  if (!dados || !cfg) {
    return (
      <div className="p-6">
        {erro ? <p className="text-sm text-red-600">{erro}</p> : (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }

  const dj = dados.jogos[jogoVer];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {erro ? <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{erro}</p> : null}

      <div className="bg-white rounded-2xl border border-zinc-100 p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
            <i className="ri-gamepad-line text-white text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-900">Jogos enquanto espera</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Voa Voa e Corre Corre aparecem para o cliente depois do pedido na mesa (QR) e no acompanhamento do delivery.
              Com o ranking ligado, os 3 melhores de cada jogo na semana (segunda a domingo) ganham o prêmio abaixo.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <span className="text-xs font-bold text-zinc-600">{cfg.ranking_ativo ? 'Ranking ligado' : 'Ranking desligado'}</span>
            <button
              type="button"
              role="switch"
              aria-checked={cfg.ranking_ativo}
              onClick={() => setCfg({ ...cfg, ranking_ativo: !cfg.ranking_ativo })}
              className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer ${cfg.ranking_ativo ? 'bg-emerald-500' : 'bg-zinc-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${cfg.ranking_ativo ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </label>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mt-4">
          {[1, 2, 3].map((p) => (
            <div key={p}>
              <label className="text-xs font-bold text-zinc-600">{MEDALHA[p - 1]} Prêmio do {p}º lugar</label>
              <input
                value={premioTexto(p)}
                onChange={(e) => setPremio(p, e.target.value)}
                maxLength={80}
                placeholder={p === 1 ? 'Ex.: Combo grátis' : p === 2 ? 'Ex.: Sobremesa grátis' : 'Ex.: Refri grátis'}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm"
              />
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <div>
            <p className="text-xs font-bold text-zinc-600">Jogos que valem ranking</p>
            <div className="flex gap-2 mt-1">
              {Object.keys(NOMES).map((j) => {
                const on = cfg.jogos.includes(j);
                return (
                  <button
                    key={j}
                    type="button"
                    onClick={() => {
                      const novo = on ? cfg.jogos.filter((x) => x !== j) : [...cfg.jogos, j];
                      if (novo.length) setCfg({ ...cfg, jogos: novo });
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${on ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-white border-zinc-200 text-zinc-400'}`}
                  >
                    {on ? <i className="ri-check-line mr-1" /> : null}{NOMES[j]}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">Cada jogo tem o seu ranking e o seu top 3.</p>
          </div>
          <div>
            <label className="text-xs font-bold text-zinc-600">Regras (aparecem para o cliente)</label>
            <textarea
              value={cfg.regras}
              onChange={(e) => setCfg({ ...cfg, regras: e.target.value })}
              maxLength={500}
              rows={2}
              placeholder="Ex.: Prêmio retirado na loja em até 30 dias, mostrando o WhatsApp cadastrado."
              className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-4">
          {salvoEm ? <span className="text-xs text-emerald-600 font-semibold"><i className="ri-check-line" /> Salvo</span> : null}
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold cursor-pointer disabled:opacity-60"
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        <p className="text-[11px] text-zinc-400 mt-3 leading-relaxed">
          Como a loja fica protegida: só joga valendo quem fez pedido na loja nas últimas 12h (mesa: pela senha do QR; delivery: pelo nº do pedido + o celular do pedido).
          A pontuação é refeita no servidor a partir dos toques da partida — não dá para inventar número. Máximo de 60 partidas por pedido.
          Mesmo assim, confira o 1º lugar antes de entregar (ex.: pontuação muito acima dos outros).
        </p>
      </div>

      <div className="flex gap-2">
        {Object.keys(NOMES).map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => setJogoVer(j)}
            className={`px-4 py-2 rounded-xl text-sm font-bold cursor-pointer ${jogoVer === j ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600'}`}
          >
            {NOMES[j]}
          </button>
        ))}
      </div>

      {dj ? (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-zinc-100 p-4">
            <p className="text-sm font-bold text-zinc-900">Semana atual <span className="font-medium text-zinc-400">· {periodo(dj.semana_atual.semana)}</span></p>
            <p className="text-xs text-zinc-500">{dj.semana_atual.jogadores} jogador{dj.semana_atual.jogadores === 1 ? '' : 'es'} · fecha domingo às 23:59</p>
            {dj.semana_atual.top.length === 0 ? (
              <p className="text-sm text-zinc-400 py-6 text-center">Ninguém jogou valendo esta semana.</p>
            ) : (
              <div className="mt-3 divide-y divide-zinc-100">
                {dj.semana_atual.top.map((l) => (
                  <div key={l.posicao} className="flex items-center gap-3 py-2">
                    <span className="w-7 text-center text-sm font-black text-zinc-500">{l.posicao <= 3 ? MEDALHA[l.posicao - 1] : l.posicao + 'º'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-800 truncate">{l.nome}</p>
                      <p className="text-xs text-zinc-400">{fone(l.telefone)}</p>
                    </div>
                    <span className="text-sm font-black text-zinc-900">{l.pontos}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-zinc-100 p-4">
            <p className="text-sm font-bold text-zinc-900">Semanas fechadas · prêmios</p>
            <p className="text-xs text-zinc-500">Avise o ganhador pelo WhatsApp e marque quando ele receber.</p>
            {dj.anteriores.length === 0 ? (
              <p className="text-sm text-zinc-400 py-6 text-center">Nenhuma semana fechada com jogadores ainda.</p>
            ) : dj.anteriores.map((w) => (
              <div key={w.semana} className="mt-3">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{periodo(w.semana)} · {w.jogadores} jogador{w.jogadores === 1 ? '' : 'es'}</p>
                <div className="mt-1 divide-y divide-zinc-100">
                  {w.top.map((l) => {
                    const entregue = !!l.entregue_em;
                    const chave = w.semana + jogoVer + l.posicao;
                    const premio = premioTexto(l.posicao);
                    const msg = encodeURIComponent(`Olá, ${l.nome.split(' ')[0]}! Você ficou em ${l.posicao}º lugar no ${NOMES[jogoVer]} da semana${premio ? ' e ganhou: ' + premio : ''}. Parabéns!`);
                    return (
                      <div key={l.posicao} className="flex items-center gap-2 py-2">
                        <span className="w-7 text-center">{MEDALHA[l.posicao - 1]}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-zinc-800 truncate">{l.nome} <span className="text-zinc-400 font-medium">· {l.pontos} pts</span></p>
                          <p className="text-xs text-zinc-400 truncate">{fone(l.telefone)}{entregue ? ' · entregue ' + new Date(l.entregue_em!).toLocaleDateString('pt-BR') : premio ? ' · ' + premio : ''}</p>
                        </div>
                        <a
                          href={`https://wa.me/55${l.telefone}?text=${msg}`}
                          target="_blank"
                          rel="noreferrer"
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"
                          title="Avisar no WhatsApp"
                        >
                          <i className="ri-whatsapp-line" />
                        </a>
                        <button
                          type="button"
                          disabled={marcando === chave}
                          onClick={() => marcar(w.semana, jogoVer, l.posicao, entregue)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${entregue ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-700'}`}
                        >
                          {entregue ? <><i className="ri-check-line" /> Entregue</> : 'Marcar entregue'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
