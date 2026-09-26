import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import BoletoEmailDecisao from './BoletoEmailDecisao';
import { confirmar } from '@/components/base/Dialogos';

// ── Caixa de boletos por e-mail ─────────────────────────────────────────────
// O Gmail da loja é o endereço que se dá aos fornecedores e encaminha sozinho para um
// serviço de recebimento, que entrega o e-mail aqui por webhook.
//
// Por que não pela API do Gmail: app OAuth em "Testing" tem o acesso expirado em 7 dias pelo
// Google, e publicar exige verificação (o escopo de leitura do Gmail é restrito). Uma
// integração que morre calada depois de uma semana é o oposto do que este módulo resolve.
//
// O endereço do webhook carrega um segredo: sem ele, qualquer um que o descobrisse poderia
// empurrar "boleto" para dentro do financeiro.

interface MailConfig {
  configured: boolean;
  is_active: boolean;
  inbound_address: string | null;
  webhook_url: string | null;
  last_received_at: string | null;
  last_error: string | null;
}

interface MailMessage {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  status: string;
  reason: string | null;
  amount: number | null;
  due_date: string | null;
  attachments: number | null;
  boleto_digitavel: string | null;
  bill_id: string | null;
}

interface Props { onClose: () => void }

type Resp = { success?: boolean; error?: string; config?: MailConfig | null; messages?: MailMessage[] };

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Aguardando leitura', cls: 'bg-zinc-100 text-zinc-600' },
  bill: { label: 'Virou conta', cls: 'bg-green-100 text-green-700' },
  pendencia: { label: 'Esperando você', cls: 'bg-amber-100 text-amber-700' },
  ignored: { label: 'Sem boleto / descartado', cls: 'bg-zinc-100 text-zinc-400' },
  error: { label: 'Falhou', cls: 'bg-red-100 text-red-700' },
};

export default function CaixaBoletosModal({ onClose }: Props) {
  const { user } = useAuth();
  const [config, setConfig] = useState<MailConfig | null>(null);
  const [mensagens, setMensagens] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [endereco, setEndereco] = useState('');
  const [busy, setBusy] = useState<null | 'salvar' | 'trocar' | 'desligar'>(null);
  const [copiado, setCopiado] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cfg, msgs] = await Promise.all([
      invokeWithAuth<Resp>('contas-email', { body: { action: 'get_config', tenant_id: user?.tenantId } }),
      invokeWithAuth<Resp>('contas-email', { body: { action: 'list_messages', tenant_id: user?.tenantId, limit: 30 } }),
    ]);
    const c = cfg.data?.config ?? null;
    setConfig(c);
    setEndereco(c?.inbound_address ?? '');
    setMensagens(msgs.data?.messages ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load]);

  const salvar = async () => {
    setBusy('salvar');
    setResult(null);
    const { data, error } = await invokeWithAuth<Resp>('contas-email', {
      body: { action: 'save_config', tenant_id: user?.tenantId, inbound_address: endereco.trim() },
    });
    setBusy(null);
    const err = error?.message ?? (data?.success ? undefined : data?.error);
    if (err) { setResult({ ok: false, msg: err }); return; }
    setConfig(data?.config ?? null);
    setResult({ ok: true, msg: 'Caixa ligada. Agora cole o endereço do webhook no serviço de recebimento.' });
  };

  const trocarSegredo = async () => {
    if (!(await confirmar({
      titulo: 'Gerar um endereço novo?',
      mensagem: 'O atual para de funcionar na hora — você vai precisar atualizar no serviço de recebimento.',
      confirmarLabel: 'Gerar novo',
      perigo: true,
    }))) return;
    setBusy('trocar');
    const { data } = await invokeWithAuth<Resp>('contas-email', { body: { action: 'rotate_token', tenant_id: user?.tenantId } });
    setBusy(null);
    setConfig(data?.config ?? null);
    setResult({ ok: true, msg: 'Endereço novo gerado. Atualize no serviço de recebimento.' });
  };

  const desligar = async () => {
    if (!(await confirmar({
      titulo: 'Desligar a caixa?',
      mensagem: 'Os e-mails param de entrar. O que já virou conta continua.',
      confirmarLabel: 'Desligar',
      perigo: true,
    }))) return;
    setBusy('desligar');
    await invokeWithAuth<Resp>('contas-email', { body: { action: 'disconnect', tenant_id: user?.tenantId } });
    setBusy(null);
    load();
  };

  const copiar = () => {
    if (!config?.webhook_url) return;
    navigator.clipboard?.writeText(config.webhook_url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-amber-100">
              <i className="ri-mail-download-line text-amber-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Caixa de boletos por e-mail</h3>
              <p className="text-xs text-zinc-500">Boleto que chega no e-mail vira conta a pagar sozinho</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-4 overflow-y-auto">
            {config?.configured && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border ${config.is_active ? 'bg-green-50 border-green-200' : 'bg-zinc-50 border-zinc-200'}`}>
                <i className={`${config.is_active ? 'ri-checkbox-circle-fill text-green-600' : 'ri-pause-circle-fill text-zinc-400'} mt-0.5`} />
                <div className="flex-1 text-xs">
                  <p className={`font-semibold ${config.is_active ? 'text-green-700' : 'text-zinc-600'}`}>
                    {config.is_active ? 'Caixa ligada' : 'Caixa desligada'}
                  </p>
                  <p className="text-zinc-600">
                    {config.last_received_at
                      ? `Último e-mail: ${new Date(config.last_received_at).toLocaleString('pt-BR')}`
                      : 'Nenhum e-mail recebido ainda.'}
                  </p>
                  {config.last_error && <p className="text-red-700 mt-1">{config.last_error}</p>}
                </div>
              </div>
            )}

            <div className="bg-zinc-50 rounded-xl p-4 text-xs text-zinc-600 space-y-1.5">
              <p className="font-semibold text-zinc-700 flex items-center gap-1.5"><i className="ri-shield-check-line text-zinc-400" /> As travas</p>
              <p>Boleto de fornecedor <strong>já cadastrado</strong>, com o beneficiário batendo, é lançado direto em Contas a Pagar. Remetente novo ou beneficiário diferente fica <strong>esperando você</strong>.</p>
              <p>Todo boleto passa pela conferência dos <strong>dígitos verificadores</strong>: número que não fecha não vira conta, mesmo que tenha sido lido de um PDF.</p>
              <p className="text-zinc-400">O pagamento nunca é automático — continua sendo seu clique no Banco Inter.</p>
            </div>

            {/* Passo 1 */}
            <div className="rounded-xl border border-zinc-200 p-4 space-y-2.5">
              <p className="text-sm font-bold text-zinc-800">1. Endereço que recebe os e-mails</p>
              <p className="text-xs text-zinc-500">
                Crie uma conta num serviço de recebimento de e-mail (o plano grátis dá conta do volume de uma loja).
                Ele te dá um endereço — cole aqui só para registro.
              </p>
              <input value={endereco} onChange={(e) => setEndereco(e.target.value)}
                placeholder="endereco-que-o-servico-deu@..."
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <button onClick={salvar} disabled={busy !== null}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 cursor-pointer whitespace-nowrap disabled:opacity-50">
                {busy === 'salvar' ? 'Salvando…' : config?.configured ? 'Salvar' : 'Ligar a caixa'}
              </button>
            </div>

            {/* Passo 2 */}
            {config?.webhook_url && (
              <div className="rounded-xl border border-zinc-200 p-4 space-y-2.5">
                <p className="text-sm font-bold text-zinc-800">2. Para onde o serviço entrega</p>
                <p className="text-xs text-zinc-500">
                  No serviço de recebimento, cole este endereço como destino (webhook) dos e-mails que chegarem:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] bg-zinc-900 text-zinc-100 rounded-lg px-3 py-2 font-mono break-all">{config.webhook_url}</code>
                  <button onClick={copiar}
                    className="px-3 py-2 text-xs font-semibold border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
                    {copiado ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <i className="ri-alert-line" /> Esse endereço é uma senha: quem tiver ele consegue mandar e-mail para dentro do seu financeiro. Não publique em lugar nenhum.
                </p>
                <button onClick={trocarSegredo} disabled={busy !== null}
                  className="text-xs text-zinc-500 hover:text-zinc-700 underline cursor-pointer">
                  {busy === 'trocar' ? 'Gerando…' : 'Gerar um endereço novo (se este tiver vazado)'}
                </button>
              </div>
            )}

            {/* Passo 3 */}
            {config?.configured && (
              <div className="rounded-xl border border-zinc-200 p-4 space-y-2">
                <p className="text-sm font-bold text-zinc-800">3. Encaminhamento no Gmail</p>
                <p className="text-xs text-zinc-500">
                  No Gmail da loja: <strong>Configurações → Encaminhamento e POP/IMAP → Adicionar endereço de encaminhamento</strong>,
                  aponte para o endereço do passo 1 e confirme. Depois crie um filtro para encaminhar só o que interessa
                  (por exemplo, e-mails com anexo dos fornecedores), ou encaminhe tudo — o sistema ignora o que não for boleto.
                </p>
              </div>
            )}

            {result && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
                <span className="break-words">{result.msg}</span>
              </div>
            )}

            {/* Histórico */}
            {mensagens.length > 0 && (
              <div className="rounded-xl border border-zinc-200 overflow-hidden">
                <p className="text-xs font-semibold text-zinc-700 px-4 py-2.5 bg-zinc-50">E-mails recebidos ({mensagens.length})</p>
                <div className="divide-y divide-zinc-100 max-h-[28rem] overflow-y-auto">
                  {mensagens.map((m) => {
                    const st = STATUS[m.status] ?? STATUS.pending;
                    return (
                      <div key={m.id} className="px-4 py-2.5 text-xs">
                        <div onClick={() => setAberto((x) => (x === m.id ? null : m.id))} className="cursor-pointer">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-zinc-700 truncate">{m.from_name || m.from_email || 'desconhecido'}</span>
                          <span className={`px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${st.cls}`}>{st.label}</span>
                        </div>
                        <p className="text-zinc-500 truncate">{m.subject || '(sem assunto)'}</p>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5 flex-wrap">
                          {m.received_at && <span>{new Date(m.received_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                          {m.amount != null && <span className="text-zinc-600 font-semibold">{formatCurrency(Number(m.amount))}</span>}
                          {m.due_date && <span>vence {new Date(m.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>}
                          {(m.attachments ?? 0) > 0 && <span><i className="ri-attachment-2" /> {m.attachments}</span>}
                          {m.reason && <span className={m.status === 'bill' ? 'text-green-700' : 'text-amber-700'}>{m.reason}</span>}
                        </div>
                        </div>
                        {aberto === m.id && user?.tenantId && (
                          <BoletoEmailDecisao tenantId={user.tenantId} mailId={m.id}
                            onFeito={(msg) => { setAberto(null); setResult({ ok: true, msg }); load(); }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {config?.configured && config.is_active && (
              <button onClick={desligar} disabled={busy !== null}
                className="text-xs text-red-600 hover:underline cursor-pointer">
                Desligar a caixa
              </button>
            )}

            <p className="text-[11px] text-zinc-400">
              O boleto é lido do texto do e-mail ou do PDF anexo (PDF escaneado é lido pela IA e conferido pelos dígitos).
              O que fica "esperando você" também aparece no 📥 do chat. Toque num e-mail para ver o boleto e decidir.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
