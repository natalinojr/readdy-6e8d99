// Clube de fidelidade no tablet de autoatendimento.
//
// ClubeEntradaKiosk: logo depois de tocar na tela — "Digite seu CPF". Achou →
// painel do cliente (nível, pontos, o que ele já pode usar, roleta). Não achou →
// cadastro rápido (nome + celular + aceite), que já ganha o bônus de boas-vindas.
// ClubePainelKiosk: o mesmo painel, reaberto do carrinho ("Meus prêmios").
//
// Regras de dinheiro ficam no banco (Edge `fidelidade` → fn_fidelidade_*): aqui
// só se mostra e se pede. Gastar pontos pede os 4 últimos números do celular.
import { useEffect, useRef, useState } from 'react';
import QRCodeImport from 'react-qr-code';
import RoletaSvg, { rotacaoParaFatia, type FatiaRoleta } from '@/components/fidelidade/RoletaSvg';
// react-qr-code exporta como default em alguns bundles e como named em outros.
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;
import { cpfValido, formatarCpf, pctProduto, rotuloPremio, type ClubeBeneficio, type ClubeRecompensa, type ClubeResumo, type ClubeReserva } from '@/lib/fidelidade';

export interface ClubeStatus {
  ativo: boolean;
  programa: string;
  bonus_cadastro: number;
  pontos_por_real: number;
  niveis: { id: string; nome: string; emoji: string; cor: string; min_compras: number }[];
  roleta: FatiaRoleta[];
}

export interface CadastroClube { cpf: string; nome: string; celular: string; nascimento: string | null; aceita_termos: boolean; aceita_ofertas: boolean }

export interface ClubeApi {
  buscar: (cpf: string) => Promise<{ encontrado: boolean; resumo?: ClubeResumo; erro?: string }>;
  /** `aindaVale` (opcional): a resposta só entra no estado se ainda valer quando chegar (convite do CPF na nota). */
  cadastrar: (d: CadastroClube, aindaVale?: () => boolean) => Promise<{ resumo?: ClubeResumo; erro?: string }>;
  usar: (alvo: { recompensa_id?: string; beneficio_id?: string }, celularFinal: string) => Promise<{ ok: boolean; erro?: string; aviso?: string }>;
  girar: () => Promise<{ indice?: number; premio?: { nome: string; tipo: string }; resumo?: ClubeResumo; erro?: string }>;
  /** Link de uso único para abrir a página do clube no celular do cliente (QR). */
  link: (celularFinal: string) => Promise<{ url?: string; erro?: string }>;
}

const pts = (n: number) => Math.floor(n).toLocaleString('pt-BR');
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Teclado({ onTecla, grande = true }: { onTecla: (t: string) => void; grande?: boolean }) {
  const h = grande ? 'h-16 text-2xl' : 'h-14 text-xl';
  return (
    <div className="grid grid-cols-3 gap-2 w-full">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onTecla(k)}
          className={`${h} flex items-center justify-center rounded-2xl font-bold cursor-pointer transition-colors ${
            k === 'C' || k === '⌫' ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-800 text-white hover:bg-zinc-700 active:bg-zinc-600'
          }`}
        >
          {k === '⌫' ? <i className="ri-delete-back-2-line" /> : k === 'C' ? <i className="ri-delete-bin-line text-lg" /> : k}
        </button>
      ))}
    </div>
  );
}

// ── Cartão do cliente: nível, pontos e progresso ────────────────────────────
function CartaoNivel({ r }: { r: ClubeResumo }) {
  const cor = r.nivel?.cor ?? '#f59e0b';
  const faltam = r.faltam_compras ?? 0;
  const base = r.nivel?.min_compras ?? 0;
  const alvo = r.proximo?.min_compras ?? base;
  const progresso = r.proximo ? Math.min(100, Math.max(4, ((r.compras_janela - base) / Math.max(1, alvo - base)) * 100)) : 100;
  return (
    <div className="rounded-3xl p-5 border-2 relative overflow-hidden" style={{ borderColor: cor, background: `linear-gradient(135deg, ${cor}33, #18181b 70%)` }}>
      <div className="flex items-center gap-4">
        <div className="text-5xl leading-none">{r.nivel?.emoji ?? '⭐'}</div>
        <div className="min-w-0 flex-1">
          <p className="text-zinc-300 text-sm">Olá, <b className="text-white">{r.primeiro_nome || 'cliente'}</b>!</p>
          <p className="text-2xl font-black" style={{ color: cor }}>{r.nivel ? `Nível ${r.nivel.nome}` : 'Bem-vindo ao clube'}</p>
          {r.nivel?.beneficios && <p className="text-zinc-400 text-xs mt-0.5 truncate">{r.nivel.beneficios}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-4xl font-black text-white tabular-nums leading-none">{pts(r.saldo)}</p>
          <p className="text-zinc-400 text-xs mt-1">pontos</p>
        </div>
      </div>
      {r.proximo && (
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-zinc-400">{r.compras_janela} compra{r.compras_janela === 1 ? '' : 's'}</span>
            <span className="text-zinc-300 font-semibold">
              {faltam > 0 ? <>Faltam <b className="text-white">{faltam}</b> {faltam === 1 ? 'compra' : 'compras'} para {r.proximo.emoji} {r.proximo.nome}</> : <>Próxima compra: {r.proximo.emoji} {r.proximo.nome}</>}
            </span>
          </div>
          <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progresso}%`, background: r.proximo.cor }} />
          </div>
        </div>
      )}
      {r.vence_30d > 0 && (
        <p className="mt-3 text-xs text-amber-300"><i className="ri-time-line mr-1" />{pts(r.vence_30d)} pontos vencem nos próximos 30 dias — use hoje!</p>
      )}
    </div>
  );
}

// ── Pede os 4 últimos números do celular antes de gastar ────────────────────
function ConfirmarCelular({ titulo, onConfirmar, onCancelar }: {
  titulo: string;
  onConfirmar: (final: string) => Promise<string | null>;
  onCancelar: () => void;
}) {
  const [d, setD] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const tecla = async (k: string) => {
    if (enviando) return;
    setErro('');
    if (k === '⌫') { setD((v) => v.slice(0, -1)); return; }
    if (k === 'C') { setD(''); return; }
    const novo = (d + k).slice(0, 4);
    setD(novo);
    if (novo.length === 4) {
      setEnviando(true);
      const e = await onConfirmar(novo);
      setEnviando(false);
      if (e) { setErro(e); setD(''); }
    }
  };
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-6" onClick={onCancelar}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <p className="text-amber-400 text-sm font-bold text-center">{titulo}</p>
        <h3 className="text-white text-xl font-black text-center mt-1">Confirme os 4 últimos números do seu celular</h3>
        <div className="flex gap-3 justify-center my-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-14 h-16 rounded-2xl border-2 flex items-center justify-center text-3xl font-black ${i < d.length ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-zinc-700 text-zinc-600'}`}>
              {d[i] ?? ''}
            </div>
          ))}
        </div>
        {erro && <p className="text-red-400 text-sm font-semibold text-center mb-3">{erro}</p>}
        {enviando && <p className="text-zinc-400 text-sm text-center mb-3">Conferindo…</p>}
        <Teclado onTecla={(k) => { void tecla(k); }} grande={false} />
        <button onClick={onCancelar} className="w-full mt-3 py-3 text-zinc-400 font-semibold cursor-pointer">Cancelar</button>
      </div>
    </div>
  );
}

// ── Roleta ──────────────────────────────────────────────────────────────────
function RoletaModal({ fatias, giros, girar, onFechar }: {
  fatias: FatiaRoleta[];
  giros: number;
  girar: ClubeApi['girar'];
  onFechar: () => void;
}) {
  const [rot, setRot] = useState(0);
  const [girando, setGirando] = useState(false);
  const [premio, setPremio] = useState<{ nome: string; tipo: string } | null>(null);
  const [restantes, setRestantes] = useState(giros);
  const [erro, setErro] = useState('');
  const vivo = useRef(true);
  // Liga no mount (o StrictMode monta duas vezes: sem isto ficava false para sempre).
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const rodar = async () => {
    if (girando || restantes <= 0) return;
    setGirando(true);
    setPremio(null);
    setErro('');
    // Começa a girar na hora (resposta do servidor chega durante a animação).
    setRot((r) => r + 720);
    const res = await girar();
    if (!vivo.current) return;
    if (res.erro || res.indice == null || res.indice < 0) {
      setErro(res.erro || 'Não consegui girar agora.');
      setGirando(false);
      return;
    }
    setRot((r) => rotacaoParaFatia(fatias, res.indice!, r, 6));
    setTimeout(() => {
      if (!vivo.current) return;
      setGirando(false);
      setPremio(res.premio ?? null);
      setRestantes(res.resumo?.giros ?? Math.max(0, restantes - 1));
    }, 3300);
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/85 p-6">
      <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-6 w-full max-w-md text-center">
        <h3 className="text-white text-2xl font-black">Roleta do clube 🎡</h3>
        <p className="text-zinc-400 text-sm mb-4">{restantes > 0 ? `Você tem ${restantes} giro${restantes > 1 ? 's' : ''}` : 'Sem giros por enquanto'}</p>
        <RoletaSvg premios={fatias} rotacao={rot} tamanho="w-72 h-72" seta="border-t-amber-400" />
        <div className="min-h-[5rem] mt-4 flex flex-col items-center justify-center">
          {premio ? (
            premio.tipo === 'nada'
              ? <p className="text-xl font-black text-zinc-300">{premio.nome} 😅<br /><span className="text-sm font-normal text-zinc-500">Na próxima vai!</span></p>
              : <p className="text-2xl font-black text-amber-400 animate-bounce">🎉 {premio.nome}!<br /><span className="text-sm font-semibold text-zinc-300">{premio.tipo === 'pontos' ? 'Já está no seu saldo.' : 'Ficou guardado nos seus prêmios.'}</span></p>
          ) : erro ? <p className="text-red-400 font-semibold">{erro}</p> : girando ? <p className="text-zinc-400">Girando…</p> : null}
        </div>
        <div className="flex gap-3 mt-2">
          <button onClick={onFechar} disabled={girando} className="flex-1 py-4 bg-zinc-800 text-zinc-300 font-bold rounded-2xl cursor-pointer disabled:opacity-40">Fechar</button>
          {restantes > 0 && (
            <button onClick={() => { void rodar(); }} disabled={girando} className="flex-1 py-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-lg rounded-2xl cursor-pointer disabled:opacity-40">
              {girando ? '…' : 'GIRAR'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Painel: o que ele pode usar agora ───────────────────────────────────────
export function ClubePainelKiosk({ status, resumo, reservas, api, onContinuar, textoContinuar = 'Continuar meu pedido', onRecarregar }: {
  status: ClubeStatus;
  resumo: ClubeResumo;
  reservas: ClubeReserva[];
  api: ClubeApi;
  onContinuar: () => void;
  textoContinuar?: string;
  onRecarregar?: () => void;
}) {
  const [confirmar, setConfirmar] = useState<{ titulo: string; alvo: { recompensa_id?: string; beneficio_id?: string } } | null>(null);
  const [pedindoQr, setPedindoQr] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [roleta, setRoleta] = useState(false);
  const [aviso, setAviso] = useState('');

  const reservadoIds = new Set(reservas.map((r) => r.hold_id));
  const disponiveis = resumo.recompensas.filter((r) => r.nivel_ok && r.falta <= 0);
  const proximas = resumo.recompensas.filter((r) => !(r.nivel_ok && r.falta <= 0)).slice(0, 3);

  const usar = async (final: string): Promise<string | null> => {
    if (!confirmar) return null;
    const res = await api.usar(confirmar.alvo, final);
    if (!res.ok) return res.erro || 'Não consegui usar agora.';
    setConfirmar(null);
    setAviso(res.aviso || `${confirmar.titulo} vai no seu pedido! 🎉`);
    return null;
  };

  const descricao = (tipo: string, valor: number) =>
    tipo === 'desconto_valor' ? `${brl(valor)} de desconto` : tipo === 'desconto_percentual' ? `${valor}% de desconto no pedido`
      : pctProduto(valor) >= 100 ? 'Sai de graça neste pedido' : `Sai com ${pctProduto(valor)}% de desconto neste pedido`;

  const BotaoUsar = ({ titulo, alvo }: { titulo: string; alvo: { recompensa_id?: string; beneficio_id?: string } }) => (!resumo.tem_celular ? (
    <span className="text-zinc-400 text-xs text-right">Use no caixa<br />(cadastro sem celular)</span>
  ) : (
    <button
      onClick={() => setConfirmar({ titulo, alvo })}
      className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black rounded-xl cursor-pointer whitespace-nowrap"
    >
      Usar agora
    </button>
  ));

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-4">
      <CartaoNivel r={resumo} />

      {aviso && (
        <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded-2xl px-4 py-3 font-semibold text-center">{aviso}</div>
      )}

      {resumo.giros > 0 && status.roleta.length >= 2 && (
        <button
          onClick={() => setRoleta(true)}
          className="w-full rounded-2xl p-4 flex items-center gap-4 bg-gradient-to-r from-fuchsia-600 to-amber-500 text-white cursor-pointer animate-pulse hover:animate-none"
        >
          <span className="text-4xl">🎡</span>
          <span className="text-left flex-1">
            <b className="block text-xl font-black">Você tem {resumo.giros} giro{resumo.giros > 1 ? 's' : ''} na roleta!</b>
            <span className="text-sm opacity-90">Toque para girar e ganhar prêmios</span>
          </span>
          <i className="ri-arrow-right-line text-2xl" />
        </button>
      )}

      {(resumo.beneficios.length > 0 || disponiveis.length > 0) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
          <p className="text-white font-black text-lg mb-3">🎁 Você pode usar hoje</p>
          <div className="flex flex-col gap-2">
            {resumo.beneficios.map((b: ClubeBeneficio) => (
              <div key={b.id} className="flex items-center gap-3 bg-zinc-800/70 rounded-2xl p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold">{b.reward.nome}</p>
                  <p className="text-zinc-400 text-xs">{b.reward.motivo || 'Prêmio'} · {descricao(b.reward.tipo, b.reward.valor)}{b.expires_at ? ` · até ${new Date(b.expires_at).toLocaleDateString('pt-BR')}` : ''}</p>
                </div>
                {reservadoIds.has(b.id) ? <span className="text-emerald-400 font-bold text-sm">No pedido ✓</span> : <BotaoUsar titulo={b.reward.nome} alvo={{ beneficio_id: b.id }} />}
              </div>
            ))}
            {disponiveis.map((r: ClubeRecompensa) => (
              <div key={r.id} className="flex items-center gap-3 bg-zinc-800/70 rounded-2xl p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold">{r.nome}</p>
                  <p className="text-zinc-400 text-xs">{pts(r.custo_pontos)} pontos · {descricao(r.tipo, r.valor)}</p>
                </div>
                <BotaoUsar titulo={r.nome} alvo={{ recompensa_id: r.id }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {proximas.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
          <p className="text-zinc-300 font-bold mb-2">Quase lá</p>
          <div className="flex flex-col gap-2">
            {proximas.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-300 truncate">{rotuloPremio(r)}</span>
                <span className="text-zinc-500 whitespace-nowrap">
                  {!r.nivel_ok && r.nivel_minimo ? `a partir do nível ${r.nivel_minimo}` : `faltam ${pts(r.falta)} pts`}
                </span>
              </div>
            ))}
          </div>
          {resumo.pontos_por_real > 0 && (
            <p className="text-zinc-500 text-xs mt-3">Cada R$ 1 gasto vale {resumo.pontos_por_real * (resumo.nivel?.multiplicador ?? 1)} ponto{resumo.pontos_por_real * (resumo.nivel?.multiplicador ?? 1) === 1 ? '' : 's'} no seu nível. Os pontos entram quando o pedido é pago.</p>
          )}
        </div>
      )}

      {resumo.tem_celular && (
        <button
          onClick={() => setPedindoQr(true)}
          className="w-full rounded-2xl p-4 flex items-center gap-4 bg-zinc-900 border border-zinc-700 text-left cursor-pointer hover:bg-zinc-800"
        >
          <span className="text-3xl">📱</span>
          <span className="flex-1">
            <b className="block text-white text-lg">Ver meu clube no celular</b>
            <span className="text-zinc-400 text-sm">Pontos, prêmios e extrato — leia o QR com a câmera</span>
          </span>
          <i className="ri-qr-code-line text-3xl text-amber-400" />
        </button>
      )}

      <button onClick={onContinuar} className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xl rounded-2xl cursor-pointer">
        {textoContinuar} <i className="ri-arrow-right-line ml-1" />
      </button>

      {pedindoQr && (
        <ConfirmarCelular
          titulo="Ver no celular"
          onCancelar={() => setPedindoQr(false)}
          onConfirmar={async (final) => {
            const r = await api.link(final);
            if (r.erro || !r.url) return r.erro || 'Não consegui gerar o QR agora.';
            setPedindoQr(false);
            setQrUrl(r.url);
            return null;
          }}
        />
      )}
      {qrUrl && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/85 p-6" onClick={() => setQrUrl(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-zinc-900 text-2xl font-black">Aponte a câmera do celular</p>
            <p className="text-zinc-500 text-sm mb-4">Abre o seu clube já logado. O QR vale por 10 minutos e uma leitura.</p>
            <div className="bg-white p-3 inline-block"><QRCode value={qrUrl} size={240} /></div>
            <button onClick={() => setQrUrl(null)} className="w-full mt-4 py-4 bg-zinc-900 text-white font-bold rounded-2xl cursor-pointer">Pronto</button>
          </div>
        </div>
      )}

      {confirmar && <ConfirmarCelular titulo={confirmar.titulo} onConfirmar={usar} onCancelar={() => setConfirmar(null)} />}
      {roleta && (
        <RoletaModal
          fatias={status.roleta}
          giros={resumo.giros}
          girar={api.girar}
          onFechar={() => { setRoleta(false); onRecarregar?.(); }}
        />
      )}
    </div>
  );
}

// ── Entrada: CPF → painel ou cadastro ───────────────────────────────────────
export default function ClubeEntradaKiosk({ status, resumo, reservas, api, onContinuar, onPular }: {
  status: ClubeStatus;
  resumo: ClubeResumo | null;
  reservas: ClubeReserva[];
  api: ClubeApi;
  onContinuar: () => void;
  onPular: () => void;
}) {
  const [cpf, setCpf] = useState('');
  const [erro, setErro] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [cadastro, setCadastro] = useState(false);
  const [nome, setNome] = useState('');
  const [celular, setCelular] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [aceita, setAceita] = useState(true);
  const [ofertas, setOfertas] = useState(true);
  const [boasVindas, setBoasVindas] = useState(false);

  const tecla = (k: string) => {
    setErro('');
    if (k === '⌫') setCpf((v) => v.slice(0, -1));
    else if (k === 'C') setCpf('');
    else setCpf((v) => (v + k).slice(0, 11));
  };

  const buscar = async () => {
    if (!cpfValido(cpf)) { setErro(cpf.length < 11 ? 'Faltam números no CPF.' : 'CPF inválido. Confira os números.'); return; }
    setBuscando(true);
    const res = await api.buscar(cpf);
    setBuscando(false);
    if (res.erro) { setErro(res.erro); return; }
    if (!res.encontrado) setCadastro(true);
  };

  const cadastrar = async () => {
    setErro('');
    if (nome.trim().length < 2) { setErro('Digite seu nome.'); return; }
    const cel = celular.replace(/\D/g, '');
    if (cel.length < 10) { setErro('Digite o celular com DDD.'); return; }
    if (!aceita) { setErro('Marque que aceita participar do clube.'); return; }
    setBuscando(true);
    const res = await api.cadastrar({ cpf, nome: nome.trim(), celular: cel, nascimento: nascimento || null, aceita_termos: true, aceita_ofertas: ofertas });
    setBuscando(false);
    if (res.erro) { setErro(res.erro); return; }
    setBoasVindas(true);
  };

  if (resumo) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        {boasVindas && status.bonus_cadastro > 0 && (
          <div className="max-w-3xl mx-auto mb-4 text-center bg-amber-500/15 border border-amber-500/40 rounded-3xl p-4">
            <p className="text-3xl">🎉</p>
            <p className="text-white text-xl font-black">Bem-vindo ao {status.programa}!</p>
            <p className="text-amber-300 font-semibold">Você ganhou {pts(status.bonus_cadastro)} pontos de boas-vindas.</p>
          </div>
        )}
        <ClubePainelKiosk status={status} resumo={resumo} reservas={reservas} api={api} onContinuar={onContinuar} />
      </div>
    );
  }

  if (cadastro) {
    const inp = 'w-full px-4 py-4 bg-zinc-800 border-2 border-zinc-700 focus:border-amber-500 rounded-2xl text-white text-lg outline-none';
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6 flex items-start md:items-center justify-center">
        <div className="w-full max-w-xl flex flex-col gap-4">
          <div className="text-center">
            <p className="text-4xl">✨</p>
            <h2 className="text-white text-3xl font-black">Entre no {status.programa}</h2>
            <p className="text-zinc-400">CPF {formatarCpf(cpf)} · leva 20 segundos{status.bonus_cadastro > 0 ? <> e você já ganha <b className="text-amber-400">{pts(status.bonus_cadastro)} pontos</b></> : null}</p>
          </div>
          <label className="block">
            <span className="text-zinc-300 text-sm font-semibold">Seu nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="off" className={inp} placeholder="Como te chamamos?" />
          </label>
          <label className="block">
            <span className="text-zinc-300 text-sm font-semibold">Celular com DDD</span>
            <input value={celular} onChange={(e) => setCelular(e.target.value.replace(/[^\d() -]/g, '').slice(0, 16))} inputMode="numeric" autoComplete="off" className={inp} placeholder="(41) 99999-9999" />
          </label>
          <label className="block">
            <span className="text-zinc-300 text-sm font-semibold">Aniversário <span className="text-zinc-500 font-normal">(opcional — tem presente!)</span></span>
            <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className={inp} />
          </label>
          <label className="flex items-start gap-3 text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} className="mt-1 w-6 h-6 accent-amber-500" />
            <span>Quero participar do clube. Meu CPF e celular serão usados só para somar pontos e liberar prêmios.</span>
          </label>
          <label className="flex items-start gap-3 text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={ofertas} onChange={(e) => setOfertas(e.target.checked)} className="mt-1 w-6 h-6 accent-amber-500" />
            <span>Quero receber novidades e ofertas no WhatsApp.</span>
          </label>
          {erro && <p className="text-red-400 font-semibold text-center">{erro}</p>}
          <div className="flex gap-3">
            <button onClick={() => { setCadastro(false); setErro(''); }} className="flex-1 py-4 bg-zinc-800 text-zinc-300 font-bold rounded-2xl cursor-pointer">Voltar</button>
            <button onClick={() => { void cadastrar(); }} disabled={buscando} className="flex-[2] py-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-lg rounded-2xl cursor-pointer disabled:opacity-50">
              {buscando ? 'Entrando…' : 'Entrar no clube'}
            </button>
          </div>
          <button onClick={onPular} className="text-zinc-500 font-semibold py-2 cursor-pointer">Agora não, só quero pedir</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 flex items-center justify-center">
      <div className="flex portrait:flex-col items-center gap-8 portrait:gap-5 w-full max-w-4xl">
        <div className="flex-1 text-left portrait:text-center">
          <p className="text-5xl mb-2">👑</p>
          <h2 className="text-white text-4xl font-black leading-tight">{status.programa}</h2>
          <p className="text-zinc-300 text-lg mt-2">Digite seu CPF e ganhe pontos neste pedido.</p>
          <ul className="mt-4 space-y-2 text-zinc-300">
            {status.pontos_por_real > 0 && <li>⭐ Cada R$ 1 vale {status.pontos_por_real} ponto{status.pontos_por_real === 1 ? '' : 's'}</li>}
            <li>🎁 Troque pontos por produtos e descontos</li>
            {status.niveis.length > 1 && <li>🏆 Suba de nível: {status.niveis.map((n) => `${n.emoji} ${n.nome}`).join(' → ')}</li>}
            {status.roleta.length >= 2 && <li>🎡 Ganhe giros na roleta de prêmios</li>}
            {status.bonus_cadastro > 0 && <li>✨ {pts(status.bonus_cadastro)} pontos de boas-vindas</li>}
          </ul>
        </div>
        <div className="w-full max-w-sm flex flex-col gap-3">
          <div className={`h-20 rounded-2xl border-2 flex items-center justify-center text-3xl font-black tracking-wider ${erro ? 'border-red-500' : 'border-amber-500'} bg-zinc-900 text-white tabular-nums`}>
            {cpf ? formatarCpf(cpf) : <span className="text-zinc-600 text-2xl">000.000.000-00</span>}
          </div>
          {erro && <p className="text-red-400 font-semibold text-center">{erro}</p>}
          <Teclado onTecla={tecla} />
          <button onClick={() => { void buscar(); }} disabled={buscando || cpf.length < 11} className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xl rounded-2xl cursor-pointer disabled:opacity-40">
            {buscando ? 'Procurando…' : 'Continuar'}
          </button>
          <button onClick={onPular} className="w-full py-3 text-zinc-400 font-semibold cursor-pointer">Agora não, só quero pedir</button>
        </div>
      </div>
    </div>
  );
}

// ── Pedido que ficou R$ 0,00 com os resgates: nada a cobrar ─────────────────
// Sem isto o tablet abriria Pix/cartão de R$ 0. Cria o pedido, marca pago e segue.
export function PedidoGratisKiosk({ numero, onConfirmar, onConcluir, onVoltar }: {
  numero?: number;
  onConfirmar: () => Promise<boolean>;
  onConcluir: () => void;
  onVoltar: () => void;
}) {
  const [estado, setEstado] = useState<'pergunta' | 'enviando' | 'feito' | 'erro'>('pergunta');
  const [seg, setSeg] = useState(12);
  useEffect(() => {
    if (estado !== 'feito') return;
    const t = setInterval(() => setSeg((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [estado]);
  useEffect(() => { if (estado === 'feito' && seg <= 0) onConcluir(); }, [estado, seg, onConcluir]);

  const confirmar = async () => {
    setEstado('enviando');
    setEstado((await onConfirmar()) ? 'feito' : 'erro');
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center flex flex-col gap-5">
        <p className="text-6xl">🎁</p>
        {estado === 'feito' ? (
          <>
            <h2 className="text-white text-4xl font-black">Pedido confirmado!{numero ? ` #${String(numero).padStart(4, '0')}` : ''}</h2>
            <p className="text-zinc-300 text-lg">Tudo por conta do clube. É só aguardar a chamada. 😄</p>
            <button onClick={onConcluir} className="py-5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xl rounded-2xl cursor-pointer">Novo pedido</button>
            <p className="text-zinc-500 text-sm">Voltando em {Math.max(0, seg)}s</p>
          </>
        ) : (
          <>
            <h2 className="text-white text-4xl font-black">Tudo por conta do clube!</h2>
            <p className="text-zinc-300 text-lg">Seus prêmios cobriram o pedido inteiro: não há nada a pagar.</p>
            {estado === 'erro' && <p className="text-red-400 font-semibold">Não consegui registrar o pedido. Tente de novo ou chame o atendente.</p>}
            <div className="flex gap-3">
              <button onClick={onVoltar} disabled={estado === 'enviando'} className="flex-1 py-5 bg-zinc-800 text-zinc-300 font-bold rounded-2xl cursor-pointer disabled:opacity-40">Voltar</button>
              <button onClick={() => { void confirmar(); }} disabled={estado === 'enviando'} className="flex-[2] py-5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xl rounded-2xl cursor-pointer disabled:opacity-50">
                {estado === 'enviando' ? 'Enviando…' : 'Confirmar pedido'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
