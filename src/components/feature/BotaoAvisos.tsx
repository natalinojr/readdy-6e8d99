// Botão "Ativar avisos": inscreve ESTE aparelho para receber notificações (Web Push no navegador/PWA,
// Firebase no app Android). Nasceu no chat do assistente; virou componente em 2026-09-16 para a
// Contratação, onde entrevistador que é usuário do ERPOS precisa ligar os avisos de entrevista.
// Sem loja também funciona: o send-push aceita quem só tem módulo liberado (tenant nulo).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function BotaoAvisos({ tenantId, titulo }: { tenantId: string | null | undefined; titulo?: string }) {
  const [estado, setEstado] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Dentro do app Android (Capacitor) o Web Push não existe: usa a notificação nativa (Firebase),
  // e só quando o servidor diz que o Firebase está configurado (send-push › fcm_status).
  type PN = { [k: string]: (a?: unknown, b?: unknown) => Promise<unknown> };
  const pn = (window as unknown as { Capacitor?: { Plugins?: Record<string, PN> } }).Capacitor?.Plugins?.PushNotifications;
  useEffect(() => {
    if (!pn) {
      import('@/lib/push').then((m) => m.estadoPush()).then(setEstado).catch(() => setEstado('nao-suportado'));
      return;
    }
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('send-push', { body: { action: 'fcm_status' } });
        if (!(data as { configured?: boolean } | null)?.configured) { setEstado('nao-suportado'); return; }
        // Tocar na notificação abre a tela que veio no aviso (ex.: /assistente).
        await pn.addListener('pushNotificationActionPerformed', (ev: unknown) => {
          const url = (ev as { notification?: { data?: { url?: string } } })?.notification?.data?.url;
          if (url && url.startsWith('/')) window.location.assign(url);
        });
        const perm = (await pn.checkPermissions()) as { receive?: string };
        let ok = false;
        try { ok = localStorage.getItem('erpos-fcm-ok') === '1'; } catch { /* sem storage */ }
        setEstado(perm?.receive === 'granted' && ok ? 'ativo' : perm?.receive === 'denied' ? 'negado' : 'inativo');
      } catch { setEstado('nao-suportado'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!estado || estado === 'ativo' || estado === 'nao-suportado') return null;
  const ativar = async () => {
    if (pn) {
      try {
        const perm = (await pn.requestPermissions()) as { receive?: string };
        if (perm?.receive !== 'granted') { setEstado('negado'); return; }
        await pn.createChannel({ id: 'erpos', name: 'Avisos do ERPOS', importance: 5, visibility: 1 }).catch(() => {});
        await pn.addListener('registration', async (t: unknown) => {
          const token = String((t as { value?: string })?.value ?? '');
          if (!token) return;
          const { data } = await supabase.functions.invoke('send-push', {
            body: { action: 'subscribe', active_tenant_id: tenantId ?? undefined, subscription: { endpoint: `fcm:${token}`, keys: { p256dh: 'fcm', auth: 'fcm' } } },
          });
          if ((data as { success?: boolean } | null)?.success) {
            try { localStorage.setItem('erpos-fcm-ok', '1'); } catch { /* sem storage */ }
            setEstado('ativo');
          } else setMsg('Não deu para registrar o aparelho.');
        });
        await pn.addListener('registrationError', () => setMsg('O Firebase recusou o registro deste aparelho.'));
        await pn.register();
      } catch (e) { setMsg(e instanceof Error ? e.message : 'Não deu para ativar.'); }
      return;
    }
    const m = await import('@/lib/push');
    const r = await m.ativarPush(tenantId);
    if (r.ok) setEstado('ativo'); else setMsg(r.erro ?? 'Não deu para ativar.');
  };
  return (
    <button
      onClick={ativar}
      title={msg ?? (estado === 'negado' ? 'Notificações bloqueadas: libere nas configurações do navegador' : (titulo ?? 'Receber os avisos no celular'))}
      className={`flex items-center gap-1 px-2.5 h-8 rounded-lg text-[11px] font-bold cursor-pointer ${msg || estado === 'negado' ? 'text-red-600 bg-red-50' : 'text-violet-700 bg-violet-50 hover:bg-violet-100'}`}
    >
      <i className="ri-notification-3-line" /> {estado === 'negado' ? 'Bloqueadas' : msg ? 'Tentar de novo' : 'Ativar avisos'}
    </button>
  );
}
