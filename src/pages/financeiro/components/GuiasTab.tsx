// Financeiro › Guias e impostos (2026-09-25). Porta de entrada da contabilidade para as guias do mês:
// DAS (Simples Nacional), DARF do INSS da folha e guia do FGTS Digital. O PDF vai para a Edge
// `contabilidade`, que lê sem IA (dígitos verificadores / CRC do Pix), lança a conta a pagar na loja
// do CNPJ da guia com a classificação certa e prepara o pagamento no prazo — pago só com o PIN do dono.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { avisar } from '@/components/base/Dialogos';

type Resultado = 'preparada' | 'guardada' | 'ja_paga' | 'erro' | 'nao_reconhecida';

interface GuiaEnviada {
  id: string;
  loja: string | null;
  enviado_por_nome: string | null;
  arquivo_nome: string | null;
  tem_arquivo: boolean;
  tipo: string | null;
  titulo: string | null;
  competencia: string | null;
  vencimento: string | null;
  valor: number | null;
  resultado: Resultado;
  mensagem: string | null;
  created_at: string;
  conta_status: string | null;
  conta_paga_em: string | null;
  pagamento_status: string | null;
}

interface Envio {
  nome: string;
  estado: 'enviando' | 'ok' | 'aviso' | 'erro';
  texto: string;
}

const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const compBR = (c: string | null) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '—');

function situacao(g: GuiaEnviada): { label: string; cls: string } {
  if (g.conta_status === 'paid') return { label: `Paga${g.conta_paga_em ? ` em ${dataBR(g.conta_paga_em)}` : ''}`, cls: 'bg-emerald-50 text-emerald-700' };
  if (g.resultado === 'ja_paga') return { label: 'Já estava paga', cls: 'bg-emerald-50 text-emerald-700' };
  if (g.resultado === 'nao_reconhecida') return { label: 'Não reconhecida', cls: 'bg-zinc-100 text-zinc-600' };
  if (g.resultado === 'erro') return { label: 'Não lançada', cls: 'bg-red-50 text-red-600' };
  if (g.pagamento_status === 'rejected' || g.pagamento_status === 'cancelled') return { label: 'Pagamento recusado', cls: 'bg-red-50 text-red-600' };
  if (g.resultado === 'preparada') return { label: 'Aguardando o dono pagar', cls: 'bg-amber-50 text-amber-700' };
  if (g.vencimento && g.vencimento < new Date().toISOString().slice(0, 10)) return { label: 'Vencida sem pagar', cls: 'bg-red-50 text-red-600' };
  return { label: 'Lançada · paga no vencimento', cls: 'bg-sky-50 text-sky-700' };
}

function lerBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Não consegui ler o arquivo'));
    r.readAsDataURL(file);
  });
}

export default function GuiasTab() {
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const [lista, setLista] = useState<GuiaEnviada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState('');
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const enviando = envios.some((e) => e.estado === 'enviando');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await invokeWithAuth<{ success: boolean; data: GuiaEnviada[] }>('contabilidade', { body: { action: 'listar' } });
    if (error) setErroLista(error.message);
    else { setErroLista(''); setLista(data?.data ?? []); }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar, user?.tenantId]);

  const enviar = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const outros = files.filter((f) => !pdfs.includes(f));
    setEnvios([
      ...pdfs.map((f) => ({ nome: f.name, estado: 'enviando' as const, texto: 'Lendo a guia…' })),
      ...outros.map((f) => ({ nome: f.name, estado: 'erro' as const, texto: 'Só PDF: baixe a guia original do PGDAS, e-CAC/Sicalc ou FGTS Digital.' })),
    ]);
    // Uma por vez: duas guias da mesma competência não disputam a mesma conta a pagar.
    for (let i = 0; i < pdfs.length; i++) {
      const f = pdfs[i];
      let novo: Envio;
      if (f.size > 10 * 1024 * 1024) novo = { nome: f.name, estado: 'erro', texto: 'Arquivo maior que 10 MB.' };
      // PDF de 0 KB (OneDrive/Drive "só na nuvem" ou download interrompido): o servidor respondia "Anexe o PDF"
      else if (f.size === 0) novo = { nome: f.name, estado: 'erro', texto: 'Este arquivo está vazio (0 KB) no seu computador. Se ele está no OneDrive/Google Drive, abra ou baixe de novo antes de enviar.' };
      else {
        try {
          const b64 = await lerBase64(f);
          const { data, error } = await invokeWithAuth<{ success: boolean; resultado: Resultado; texto: string }>('contabilidade', {
            body: { action: 'enviar_guia', arquivo_base64: b64, arquivo_nome: f.name },
          });
          if (error) novo = { nome: f.name, estado: 'erro', texto: error.message };
          else novo = {
            nome: f.name,
            estado: data?.success ? 'ok' : data?.resultado === 'nao_reconhecida' ? 'aviso' : 'erro',
            texto: data?.texto || 'Guia recebida.',
          };
        } catch (e) {
          novo = { nome: f.name, estado: 'erro', texto: e instanceof Error ? e.message : String(e) };
        }
      }
      setEnvios((prev) => prev.map((e, j) => (j === i ? novo : e)));
    }
    if (inputRef.current) inputRef.current.value = '';
    carregar();
  };

  const abrirArquivo = async (id: string) => {
    const aba = window.open('', '_blank');
    const { data, error } = await invokeWithAuth<{ success: boolean; url: string }>('contabilidade', { body: { action: 'abrir_arquivo', id } });
    if (error || !data?.url) { aba?.close(); await avisar(error?.message ?? 'Não consegui abrir o arquivo.', { erro: true }); return; }
    if (aba) aba.location.href = data.url; else window.location.href = data.url;
  };

  const corEnvio: Record<Envio['estado'], string> = {
    enviando: 'border-zinc-200 bg-zinc-50 text-zinc-600',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    aviso: 'border-amber-200 bg-amber-50 text-amber-800',
    erro: 'border-red-200 bg-red-50 text-red-800',
  };
  const iconeEnvio: Record<Envio['estado'], string> = {
    enviando: 'ri-loader-4-line animate-spin', ok: 'ri-checkbox-circle-line', aviso: 'ri-error-warning-line', erro: 'ri-close-circle-line',
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto w-full">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Envio das guias */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-zinc-200 p-4 md:p-5">
          <h3 className="text-sm font-bold text-zinc-800">Enviar guias do mês</h3>
          <p className="text-xs text-zinc-400 mt-1">
            DAS (Simples Nacional), DARF do INSS da folha e guia do FGTS Digital. Anexe o PDF original, como o sistema do governo gera.
            A conta a pagar é lançada na loja do CNPJ da guia, já com a classificação certa. O pagamento fica pronto no vencimento e só sai quando o dono aprova.
          </p>
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); if (!enviando) enviar(Array.from(e.dataTransfer.files)); }}
            onClick={() => !enviando && inputRef.current?.click()}
            className={`mt-4 rounded-xl border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${arrastando ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-amber-300 hover:bg-amber-50/40'} ${enviando ? 'opacity-60 cursor-wait' : ''}`}
          >
            <i className="ri-file-upload-line text-3xl text-amber-500" />
            <p className="text-sm font-semibold text-zinc-700 mt-1">{enviando ? 'Enviando…' : 'Arraste os PDFs aqui ou toque para escolher'}</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Pode mandar várias guias de uma vez</p>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) enviar(fs); }} />
          </div>
          {envios.length > 0 && (
            <ul className="mt-3 space-y-2">
              {envios.map((e, i) => (
                <li key={`${e.nome}-${i}`} className={`rounded-xl border px-3 py-2 text-xs ${corEnvio[e.estado]}`}>
                  <div className="flex items-center gap-1.5 font-semibold"><i className={iconeEnvio[e.estado]} /> <span className="truncate">{e.nome}</span></div>
                  <p className="mt-1 whitespace-pre-line leading-relaxed">{e.texto}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Outros documentos do mês */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-4 md:p-5 space-y-3">
          <h3 className="text-sm font-bold text-zinc-800">Folha de pagamento</h3>
          <p className="text-xs text-zinc-400">
            A folha entra pelo <b>Extrato Mensal</b> do Domínio em PDF, em RH / Folha › Importar do Domínio. Cada pessoa é conferida (proventos, descontos e líquido).
          </p>
          <button onClick={() => setSearchParams({ tab: 'rh' }, { replace: true })}
            className="w-full flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm">
            <i className="ri-team-line" /> Ir para RH / Folha
          </button>
          <div className="text-[11px] text-zinc-400 border-t border-zinc-100 pt-3 space-y-1">
            <p><b>INSS e FGTS</b> não entram de novo na DRE: o custo já vem da folha (bruto + FGTS). A guia serve para pagar.</p>
            <p><b>DAS</b> entra na DRE como Impostos.</p>
            <p>Mandou a guia de novo com multa? A mesma conta é atualizada; não duplica.</p>
          </div>
        </div>
      </div>

      {/* Histórico */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Guias enviadas</h3>
            <p className="text-xs text-zinc-400">últimos 6 meses</p>
          </div>
          <button onClick={carregar} className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm"><i className="ri-refresh-line" /> Atualizar</button>
        </div>
        {erroLista ? (
          <div className="m-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <i className="ri-error-warning-line text-red-500" />
            <p className="text-xs text-red-700">{erroLista}</p>
          </div>
        ) : carregando ? (
          <div className="py-14 text-center"><i className="ri-loader-4-line animate-spin text-4xl text-zinc-200" /><p className="text-zinc-400 text-sm mt-2">Carregando…</p></div>
        ) : lista.length === 0 ? (
          <div className="py-14 text-center"><i className="ri-file-list-3-line text-4xl text-zinc-200" /><p className="text-zinc-400 text-sm mt-2">Nenhuma guia enviada por aqui ainda.</p></div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left">
                    <th className="pl-5 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Guia</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Loja</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Enviada</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Vencimento</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-right">Valor</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Situação</th>
                    <th className="pl-4 pr-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100/80">
                  {lista.map((g) => {
                    const s = situacao(g);
                    const nome = g.titulo ?? g.arquivo_nome ?? 'Documento';
                    return (
                      <tr key={g.id} className="hover:bg-zinc-50">
                        <td className="pl-5 pr-4 py-3">
                          <p className="font-semibold text-zinc-800 truncate max-w-[240px]" title={nome}>
                            {nome} <span className="text-zinc-400 font-normal">· {compBR(g.competencia)}</span>
                          </p>
                          {(g.resultado === 'erro' || g.resultado === 'nao_reconhecida') && g.mensagem && (
                            <p className="text-[11px] text-red-600 mt-0.5 line-clamp-2 max-w-[320px]">{g.mensagem}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">{g.loja ?? 'sem loja'}</td>
                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">{dataBR(g.created_at)} · {g.enviado_por_nome ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">{dataBR(g.vencimento)}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">{brl(g.valor)}</td>
                        <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${s.cls}`}>{s.label}</span></td>
                        <td className="pl-4 pr-5 py-3 text-right">
                          {g.tem_arquivo && (
                            <button onClick={() => abrirArquivo(g.id)} className="text-xs text-amber-600 hover:text-amber-700 font-semibold cursor-pointer whitespace-nowrap">
                              <i className="ri-file-pdf-2-line" /> PDF
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-zinc-100/80">
              {lista.map((g) => {
                const s = situacao(g);
                return (
                  <div key={g.id} className="px-4 py-3 flex flex-col gap-1.5">
                    <p className="text-sm font-semibold text-zinc-800 truncate">
                      {g.titulo ?? g.arquivo_nome ?? 'Documento'} <span className="text-zinc-400 font-normal">· {compBR(g.competencia)}</span>
                    </p>
                    <p className="text-[11px] text-zinc-400 truncate">
                      {g.loja ?? 'sem loja'} · enviada {dataBR(g.created_at)} por {g.enviado_por_nome ?? '—'}
                    </p>
                    {(g.resultado === 'erro' || g.resultado === 'nao_reconhecida') && g.mensagem && (
                      <p className="text-[11px] text-red-600 line-clamp-2">{g.mensagem}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <span className="font-semibold text-zinc-800 tabular-nums">{brl(g.valor)}</span>
                      <span className="text-zinc-500">vence {dataBR(g.vencimento)}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${s.cls}`}>{s.label}</span>
                      {g.tem_arquivo && (
                        <button onClick={() => abrirArquivo(g.id)} className="text-amber-600 hover:text-amber-700 font-semibold cursor-pointer">
                          <i className="ri-file-pdf-2-line" /> PDF
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
