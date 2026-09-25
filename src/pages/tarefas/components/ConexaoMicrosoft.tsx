import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Cloud, ExternalLink, File, Folder, Globe, HardDrive, Loader2, LogOut, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { invokeWithAuth } from '@/lib/supabase';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { modoDemo } from '../demo/modoDemo';

/**
 * Conexão das Tarefas com o Microsoft 365 (OneDrive/SharePoint) — Fase 1.
 * Ver BRIEFING-ONEDRIVE-TAREFAS.md. Login em popup; a volta com ?code= é tratada
 * no main.tsx (posta a mensagem 'meta_oauth' para esta janela e fecha o popup).
 * O navegador de pastas aqui serve para conferir a conexão e, na próxima etapa,
 * para escolher a pasta da nuvem ligada a uma pasta das Tarefas.
 */

type TipoConta = 'pessoal' | 'empresa';
interface Conexao { ms_user_email: string | null; ms_user_name: string | null; account_kind?: TipoConta; needs_reconnect: boolean; last_error?: string | null }
interface Resp { success: boolean; error?: string; reconectar?: boolean; [k: string]: unknown }

interface ItemNuvem {
  id: string; name: string; tipo: 'pasta' | 'arquivo'; tamanho: number | null; filhos: number | null;
  web_url: string | null; alterado_em: string | null; alterado_por: string | null;
}

type Nivel =
  | { tipo: 'raizes' }
  | { tipo: 'site'; site_id: string; nome: string }
  | { tipo: 'pasta'; drive_id: string; item_id: string | null; nome: string };

const chamar = async (body: Record<string, unknown>): Promise<Resp> => {
  const { data, error } = await invokeWithAuth<Resp>('ms-graph', { body });
  if (error) return { success: false, error: error.message };
  return data ?? { success: false, error: 'Sem resposta' };
};

function tamanho(b: number | null): string {
  if (b == null) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

export default function ConexaoMicrosoft({ onClose }: { onClose: () => void }) {
  useVoltarFecha(true, onClose, 'tarefas-microsoft');
  const toast = useToast();
  const [carregando, setCarregando] = useState(true);
  const [configurado, setConfigurado] = useState(true);
  const [conexao, setConexao] = useState<Conexao | null>(null);
  const [conectando, setConectando] = useState(false);
  const [tipo, setTipo] = useState<TipoConta>('pessoal');

  const carregarStatus = useCallback(async () => {
    if (modoDemo()) { setCarregando(false); return; }
    const r = await chamar({ action: 'status' });
    setConfigurado(r.configured !== false);
    setConexao((r.connection as Conexao) ?? null);
    setCarregando(false);
  }, []);

  useEffect(() => { carregarStatus(); }, [carregarStatus]);
  // Reconectar usa o mesmo tipo de conta da conexão que expirou.
  useEffect(() => { if (conexao?.account_kind) setTipo(conexao.account_kind); }, [conexao?.account_kind]);

  const conectar = async () => {
    if (modoDemo()) { toast.info('Modo demonstração', 'O login da Microsoft só funciona no sistema de verdade.'); return; }
    setConectando(true);
    const redirectUri = `${window.location.origin}/tarefas`;
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    const cfg = await chamar({ action: 'config', redirect_uri: redirectUri, state, tipo });
    if (!cfg.success || typeof cfg.url !== 'string') {
      setConectando(false);
      toast.error('Não foi possível iniciar a conexão', cfg.error);
      return;
    }
    const w = 520, h = 700;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(cfg.url, 'ms_oauth', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      setConectando(false);
      toast.error('O navegador bloqueou a janela de login', 'Permita pop-ups para o ERPOS e tente de novo.');
      return;
    }

    let timer = 0;
    let recebido = false;
    const onMessage = async (event: MessageEvent) => {
      // main.tsx usa o mesmo tipo de mensagem para qualquer login em popup
      if (event.origin !== window.location.origin || event.data?.type !== 'meta_oauth') return;
      recebido = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(timer);
      try { popup.close(); } catch { /* ignora */ }
      if (event.data.error) { setConectando(false); toast.error('Login cancelado na Microsoft', String(event.data.error)); return; }
      if (event.data.state !== state) { setConectando(false); toast.error('Falha na verificação de segurança', 'Tente conectar de novo.'); return; }
      const r = await chamar({ action: 'exchange', code: event.data.code, redirect_uri: redirectUri, tipo });
      setConectando(false);
      if (!r.success) { toast.error('Não foi possível conectar', r.error); return; }
      setConexao(r.connection as Conexao);
      toast.success('Microsoft 365 conectado');
    };
    window.addEventListener('message', onMessage);
    timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        // dá tempo da mensagem chegar antes de desistir
        window.setTimeout(() => {
          window.removeEventListener('message', onMessage);
          if (!recebido) setConectando(false);
        }, 1500);
      }
    }, 800);
  };

  const desconectar = async () => {
    if (!window.confirm('Desconectar a conta Microsoft? Os arquivos na nuvem não são apagados.')) return;
    const r = await chamar({ action: 'disconnect' });
    if (!r.success) { toast.error('Não foi possível desconectar', r.error); return; }
    setConexao(null);
    toast.success('Conta desconectada');
  };

  const conteudo = (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-slate-900/40 md:p-4" onClick={onClose}>
      <div
        className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[88vh] flex flex-col pb-[max(env(safe-area-inset-bottom),12px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200" />
        <div className="flex items-center gap-2.5 px-5 pt-3 md:pt-4 pb-3 border-b border-slate-100">
          <span className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0"><Cloud size={16} /></span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm max-md:text-base font-semibold text-slate-800">OneDrive / SharePoint</h2>
            <p className="text-[11px] text-slate-400">Arquivos dos projetos ligados às pastas</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {carregando ? (
            <div className="p-6 flex justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
          ) : !configurado ? (
            <p className="text-sm text-slate-500 rounded-xl bg-amber-50 border border-amber-200 p-3">
              A integração com a Microsoft ainda não foi configurada no servidor (falta registrar o app no Microsoft Entra).
            </p>
          ) : !conexao || conexao.needs_reconnect ? (
            <div className="space-y-3">
              {conexao?.needs_reconnect && (
                <p className="text-xs text-amber-700 rounded-xl bg-amber-50 border border-amber-200 p-3">
                  A conexão com {conexao.ms_user_email ?? 'a conta Microsoft'} expirou. Conecte de novo.
                </p>
              )}
              <p className="text-sm text-slate-600">
                Entre com a conta Microsoft onde ficam os arquivos. O ERPOS passa a criar as pastas dos projetos
                e anexar arquivos da nuvem nas tarefas. Nada é apagado na nuvem pelo ERPOS.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['pessoal', 'Conta pessoal', 'Outlook, Hotmail ou Microsoft 365 Family — só OneDrive'],
                  ['empresa', 'Conta do trabalho', 'Microsoft 365 Business — OneDrive e SharePoint'],
                ] as const).map(([v, titulo, desc]) => (
                  <button
                    key={v}
                    onClick={() => setTipo(v)}
                    className={`text-left rounded-xl border p-3 transition ${
                      tipo === v ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="block text-sm font-medium text-slate-800">{titulo}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">{desc}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={conectar}
                disabled={conectando}
                className="w-full rounded-xl bg-sky-600 text-white text-sm font-medium py-2.5 max-md:py-3 hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {conectando ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
                {conectando ? 'Aguardando o login…' : 'Conectar Microsoft 365'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <span className="w-9 h-9 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-sm font-semibold shrink-0">
                  {(conexao.ms_user_name ?? conexao.ms_user_email ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{conexao.ms_user_name ?? 'Conta conectada'}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {conexao.ms_user_email}{conexao.account_kind === 'pessoal' ? ' · conta pessoal' : ' · conta do trabalho'}
                  </p>
                </div>
                <button onClick={desconectar} title="Desconectar" className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <LogOut size={15} />
                </button>
              </div>
              <NavegadorNuvem onReconectar={carregarStatus} />
            </>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(conteudo, document.body);
}

/** Navega em "Meu OneDrive" e nos sites/bibliotecas do SharePoint da conta conectada. */
function NavegadorNuvem({ onReconectar }: { onReconectar: () => void }) {
  const [pilha, setPilha] = useState<Nivel[]>([{ tipo: 'raizes' }]);
  const [dados, setDados] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atual = pilha[pilha.length - 1];

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    const body: Record<string, unknown> = { action: 'browse' };
    if (atual.tipo === 'site') body.site_id = atual.site_id;
    if (atual.tipo === 'pasta') { body.drive_id = atual.drive_id; if (atual.item_id) body.item_id = atual.item_id; }
    chamar(body).then((r) => {
      if (!vivo) return;
      if (!r.success) { setErro(r.error ?? 'Erro'); if (r.reconectar) onReconectar(); return; }
      setDados(r);
    });
    return () => { vivo = false; };
  }, [atual, onReconectar]);

  const entrar = (n: Nivel) => setPilha((p) => [...p, n]);
  const voltar = () => setPilha((p) => (p.length > 1 ? p.slice(0, -1) : p));
  const titulo = atual.tipo === 'raizes' ? 'Onde estão os arquivos' : atual.nome;

  const linha = 'w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 active:bg-slate-100';

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        {pilha.length > 1 && (
          <button onClick={voltar} className="p-1 rounded text-slate-500 hover:bg-slate-200"><ArrowLeft size={14} /></button>
        )}
        <span className="text-xs font-medium text-slate-600 truncate flex-1">{titulo}</span>
        {atual.tipo === 'pasta' && typeof (dados?.pasta as ItemNuvem | undefined)?.web_url === 'string' && (
          <a href={(dados!.pasta as ItemNuvem).web_url!} target="_blank" rel="noreferrer" title="Abrir no navegador"
            className="p-1 rounded text-slate-400 hover:text-sky-600"><ExternalLink size={13} /></a>
        )}
      </div>

      <div className="max-h-[45vh] overflow-y-auto divide-y divide-slate-100">
        {erro ? (
          <p className="p-4 text-xs text-red-600">{erro}</p>
        ) : !dados ? (
          <div className="p-6 flex justify-center"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
        ) : atual.tipo === 'raizes' ? (
          <>
            {dados.meu_drive && (() => {
              const d = dados.meu_drive as { id: string; usado: number | null; total: number | null };
              return (
                <button className={linha} onClick={() => entrar({ tipo: 'pasta', drive_id: d.id, item_id: null, nome: 'Meu OneDrive' })}>
                  <HardDrive size={15} className="text-sky-600 shrink-0" />
                  <span className="text-sm text-slate-700 flex-1">Meu OneDrive</span>
                  {d.total ? <span className="text-[11px] text-slate-400">{tamanho(d.usado)} de {tamanho(d.total)}</span> : null}
                </button>
              );
            })()}
            {((dados.sites as Array<{ id: string; name: string }>) ?? []).map((s) => (
              <button key={s.id} className={linha} onClick={() => entrar({ tipo: 'site', site_id: s.id, nome: s.name })}>
                <Globe size={15} className="text-teal-600 shrink-0" />
                <span className="text-sm text-slate-700 flex-1 truncate">{s.name}</span>
              </button>
            ))}
            {!dados.meu_drive && !((dados.sites as unknown[]) ?? []).length && (
              <p className="p-4 text-xs text-slate-400">Nenhum OneDrive ou site encontrado nesta conta.</p>
            )}
          </>
        ) : atual.tipo === 'site' ? (
          ((dados.bibliotecas as Array<{ id: string; name: string }>) ?? []).map((b) => (
            <button key={b.id} className={linha} onClick={() => entrar({ tipo: 'pasta', drive_id: b.id, item_id: null, nome: b.name })}>
              <Folder size={15} className="text-teal-600 shrink-0" />
              <span className="text-sm text-slate-700 flex-1 truncate">{b.name}</span>
            </button>
          ))
        ) : (
          <>
            {((dados.itens as ItemNuvem[]) ?? []).map((i) => i.tipo === 'pasta' ? (
              <button key={i.id} className={linha}
                onClick={() => entrar({ tipo: 'pasta', drive_id: atual.drive_id, item_id: i.id, nome: i.name })}>
                <Folder size={15} className="text-amber-500 shrink-0" />
                <span className="text-sm text-slate-700 flex-1 truncate">{i.name}</span>
                {i.filhos != null && <span className="text-[11px] text-slate-400">{i.filhos}</span>}
              </button>
            ) : (
              <a key={i.id} href={i.web_url ?? undefined} target="_blank" rel="noreferrer" className={linha}>
                <File size={15} className="text-slate-400 shrink-0" />
                <span className="text-sm text-slate-700 flex-1 truncate">{i.name}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{tamanho(i.tamanho)}</span>
              </a>
            ))}
            {!((dados.itens as unknown[]) ?? []).length && <p className="p-4 text-xs text-slate-400">Pasta vazia.</p>}
            {dados.mais === true && <p className="p-3 text-[11px] text-slate-400">Mostrando os primeiros 500 itens.</p>}
          </>
        )}
      </div>
    </div>
  );
}
