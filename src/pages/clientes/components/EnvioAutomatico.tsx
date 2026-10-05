// Envio automático do funil pelo WhatsApp do assistente (API oficial da Meta).
// Painel no topo da aba Ofertas, recolhível: a linha de resumo mostra quantos estágios estão
// no automático, a situação dos modelos na Meta e as travas; "Configurar" abre o texto e os
// campos (teto por dia, só quem aceitou ofertas). O último erro do envio aparece em vermelho
// na própria linha, mesmo recolhido. O interruptor de cada estágio fica na linha do estágio
// (FunilAba), com confirmação antes de ligar.
// O painel segue montado mesmo recolhido: a consulta à Meta alimenta o bloqueio dos interruptores.
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { avisar } from '@/components/base/Dialogos';

export interface ModeloCrm { name: string; status: string; rejected_reason: string | null }

export const MODELO_COM_CUPOM = 'crm_oferta_cupom';
export const MODELO_SEM_CUPOM = 'crm_contato';

const STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: 'Aprovado', cls: 'bg-green-50 text-green-700 border-green-200' },
  PENDING: { label: 'Em análise na Meta', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  IN_APPEAL: { label: 'Em recurso', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  REJECTED: { label: 'Reprovado', cls: 'bg-red-50 text-red-700 border-red-200' },
  PAUSED: { label: 'Pausado pela Meta', cls: 'bg-red-50 text-red-700 border-red-200' },
  DISABLED: { label: 'Desativado', cls: 'bg-red-50 text-red-700 border-red-200' },
  NAO_ENVIADO: { label: 'Não enviado', cls: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
};

const NOME_MODELO: Record<string, string> = {
  [MODELO_COM_CUPOM]: 'Oferta com cupom',
  [MODELO_SEM_CUPOM]: 'Contato sem cupom',
};

interface AutoSettings {
  max_auto_por_dia?: number;
  auto_so_optin?: boolean;
  auto_ultimo_erro?: string | null;
  auto_ultimo_erro_em?: string | null;
  hora_inicio: number;
  hora_fim: number;
}

interface Props {
  tenantId: string;
  settings: AutoSettings | null;
  algumLigado: boolean;
  /** Quantos estágios estão com o envio automático ligado (para a linha de resumo). */
  qtdLigados: number;
  aberto: boolean;
  onToggle: () => void;
  onSettings: (patch: Partial<AutoSettings>) => void;
  onModelos: (m: Record<string, string>) => void;
}

export default function PainelEnvioAutomatico({ tenantId, settings, algumLigado, qtdLigados, aberto, onToggle, onSettings, onModelos }: Props) {
  const [modelos, setModelos] = useState<ModeloCrm[]>([]);
  const [podeEnviar, setPodeEnviar] = useState(false);
  const [erroModelos, setErroModelos] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
    invokeWithAuth<{ modelos?: ModeloCrm[]; pode_enviar?: boolean; erro?: string }>(
      'crm-funnel', { body: { action: 'templates_status', tenant_id: tenantId } },
    ).then(function (res) {
      setCarregando(false);
      const d = res.data;
      if (res.error || !d) { setErroModelos(res.error?.message || 'Não consegui consultar a Meta.'); return; }
      setErroModelos(d.erro || '');
      setModelos(d.modelos ?? []);
      setPodeEnviar(d.pode_enviar === true);
      const mapa: Record<string, string> = {};
      for (const m of d.modelos ?? []) mapa[m.name] = m.status;
      onModelos(mapa);
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(carregar, [tenantId]);

  async function enviarParaMeta() {
    setEnviando(true);
    const res = await invokeWithAuth<{ resultado?: Record<string, { erro?: string }>; error?: string; message?: string }>(
      'crm-funnel', { body: { action: 'submit_templates', tenant_id: tenantId } },
    );
    setEnviando(false);
    const d = res.data;
    if (res.error || !d || d.error) { await avisar(res.error?.message || d?.message || 'Falha ao enviar.', { erro: true }); return; }
    const erros = Object.entries(d.resultado ?? {}).filter(([, v]) => v?.erro).map(([k, v]) => `${NOME_MODELO[k] ?? k}: ${v.erro}`);
    await avisar(erros.length
      ? `Alguns modelos não foram aceitos: ${erros.join(' · ')}`
      : 'Modelos enviados. A Meta costuma analisar em minutos a algumas horas; a situação aparece aqui.');
    carregar();
  }

  const faltaEnviar = modelos.some((m) => m.status === 'NAO_ENVIADO' || m.status === 'REJECTED');

  // Linha de resumo (visível mesmo recolhido): usa só o que o painel já carregou.
  const erroAuto = algumLigado && settings?.auto_ultimo_erro ? settings.auto_ultimo_erro : null;
  let situacaoModelos: { texto: string; cls: string } | null = null;
  if (carregando) situacaoModelos = { texto: 'consultando a Meta…', cls: 'text-zinc-400' };
  else if (erroModelos) situacaoModelos = { texto: 'Meta indisponível agora', cls: 'text-amber-700' };
  else if (modelos.length > 0) {
    if (modelos.every((m) => m.status === 'APPROVED')) situacaoModelos = { texto: 'modelos aprovados', cls: 'text-green-700' };
    else if (modelos.some((m) => m.status === 'REJECTED' || m.status === 'PAUSED' || m.status === 'DISABLED')) situacaoModelos = { texto: 'modelo reprovado ou pausado na Meta', cls: 'text-red-600' };
    else if (modelos.some((m) => m.status === 'PENDING' || m.status === 'IN_APPEAL')) situacaoModelos = { texto: 'modelo em análise na Meta', cls: 'text-amber-700' };
    else situacaoModelos = { texto: 'modelo ainda não enviado à Meta', cls: 'text-amber-700' };
  }

  return (
    <div className={'bg-white border rounded-2xl overflow-hidden ' + (erroAuto ? 'border-red-200' : 'border-zinc-100')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-green-50 text-green-600">
          <i className="ri-robot-2-line text-sm" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-zinc-800">
            Envio automático
            <span className="font-normal text-zinc-500">
              {' · '}{qtdLigados > 0 ? `ligado em ${qtdLigados} estágio${qtdLigados === 1 ? '' : 's'}` : 'desligado em todos os estágios'}
            </span>
          </h4>
          <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">
            {situacaoModelos && <span className={situacaoModelos.cls}>{situacaoModelos.texto}</span>}
            {settings && (
              <>
                {situacaoModelos ? ' · ' : ''}até {settings.max_auto_por_dia ?? 30} por dia, das {settings.hora_inicio}h às {settings.hora_fim}h
                {settings.auto_so_optin !== false ? ' · só quem aceitou ofertas' : ' · todos os contatos'}
              </>
            )}
          </p>
          {erroAuto && (
            <p role="alert" className="text-[11px] text-red-600 font-medium leading-snug mt-1">
              <i className="ri-error-warning-line" /> Último problema no envio automático
              {settings?.auto_ultimo_erro_em ? ` (${new Date(settings.auto_ultimo_erro_em).toLocaleString('pt-BR')})` : ''}:{' '}
              {erroAuto}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={aberto}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-600 cursor-pointer flex-shrink-0"
        >
          {aberto ? 'Fechar' : 'Configurar'}
          <i className={'ri-arrow-down-s-line transition-transform ' + (aberto ? 'rotate-180' : '')} />
        </button>
      </div>

      {aberto && (
        <div className="px-4 pb-4 pt-3 space-y-3 border-t border-zinc-100">
          <p className="text-[11px] text-zinc-500">
            Com o automático ligado num estágio, o ERPOS manda sozinho a oferta (com o voucher e o link) para quem pode
            ser abordado, de hora em hora, dentro do horário da loja
            {settings ? <> ({settings.hora_inicio}h às {settings.hora_fim}h)</> : null}. A Meta só deixa a empresa
            falar primeiro com <strong>modelo aprovado</strong> e cobra cada mensagem de marketing (cerca de R$ 0,35).
            Cada cliente recebe no máximo 1 mensagem automática por semana (somando as lojas).
            Quem responder <strong>SAIR</strong> para de receber.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {carregando ? (
              <span className="text-[11px] text-zinc-400">Consultando a Meta…</span>
            ) : erroModelos ? (
              <span className="text-[11px] text-red-600">Meta: {erroModelos}</span>
            ) : modelos.map(function (m) {
              const st = STATUS[m.status] ?? { label: m.status, cls: 'bg-zinc-50 text-zinc-500 border-zinc-200' };
              return (
                <span key={m.name} title={m.rejected_reason ?? undefined}
                  className={'text-[11px] px-2 py-1 rounded-lg border ' + st.cls}>
                  {NOME_MODELO[m.name] ?? m.name}: <strong>{st.label}</strong>
                </span>
              );
            })}
            {!carregando && podeEnviar && faltaEnviar && (
              <button type="button" onClick={enviarParaMeta} disabled={enviando}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 text-white font-semibold cursor-pointer disabled:opacity-50">
                {enviando ? 'Enviando…' : 'Enviar modelos para aprovação'}
              </button>
            )}
            {!carregando && !podeEnviar && faltaEnviar && (
              <span className="text-[11px] text-zinc-400">Os modelos são enviados à Meta pelo dono do sistema.</span>
            )}
          </div>

          {settings && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-700">
                <span className="whitespace-nowrap">Máximo por dia</span>
                <input type="number" min={0} max={250} value={settings.max_auto_por_dia ?? 30}
                  onChange={function (e) { onSettings({ max_auto_por_dia: Number(e.target.value) }); }}
                  className="w-20 px-2 py-1 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <span className="text-[11px] text-zinc-400">mensagens (somando os estágios)</span>
              </label>
              <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={settings.auto_so_optin !== false}
                  onChange={function (e) { onSettings({ auto_so_optin: e.target.checked }); }} />
                <span>
                  Só para quem aceitou receber ofertas
                  <span className="block text-[11px] text-zinc-400">
                    Recomendado: a Meta pede consentimento e denúncia de quem não pediu pode limitar o número (que também
                    atende a Contratação).
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
