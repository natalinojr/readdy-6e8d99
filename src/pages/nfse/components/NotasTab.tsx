// Lista de notas, emissão e detalhe (reconsultar, cancelar, DANFSe e XML).
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { avisar, confirmar } from '@/pages/contratacao/dialog';
import {
  type Empresa, type ErroSefin, type Nota, type Servico, type StatusNota, type Tomador,
  STATUS_CLASS, STATUS_LABEL, baixarTexto, nomeArquivoNota, fmtBRL, fmtChave, fmtData, fmtDataHora, fmtDoc, inputCls, labelCls, nfseCall, soDigitos,
} from '../api';
import { Modal, TomadorModal } from './CadastrosTab';
import { abrirDanfse } from './danfse';

const mesAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

// Rejeições comuns com o que o usuário precisa fazer (a mensagem da Sefin é técnica).
const DICAS: Record<string, string> = {
  E0116: 'Preencha a Inscrição Municipal da empresa na aba Empresa (está no alvará ou com o contador) e emita de novo.',
  E0160: 'A situação no Simples Nacional da aba Empresa não bate com a Receita. Confira com o contador.',
  E0712: 'Empresa ME/EPP: confira a situação no Simples na aba Empresa.',
  E0310: 'O código de tributação nacional do serviço não existe. Corrija na aba Serviços.',
  E0314: 'O código municipal do serviço não é aceito pela prefeitura. Deixe em branco na aba Serviços.',
  E0008: 'Relógio: tente emitir de novo em 1 minuto.',
};

function ListaErros({ erros }: { erros: ErroSefin[] | null | undefined }) {
  if (!erros?.length) return null;
  return (
    <ul className="space-y-1">
      {erros.map((e, i) => (
        <li key={i} className="text-xs text-red-700">
          {e.codigo && <b className="mr-1">{e.codigo}</b>}{e.descricao}{e.complemento ? ` — ${e.complemento}` : ''}
          {e.codigo && DICAS[e.codigo] && <span className="block mt-0.5 font-semibold text-red-800">👉 {DICAS[e.codigo]}</span>}
        </li>
      ))}
    </ul>
  );
}

// ─── Emitir ──────────────────────────────────────────────────────────────────
function EmitirModal({ empresa, tomadores, servicos, onClose, onEmitida, onTomadorNovo }: {
  empresa: Empresa; tomadores: Tomador[]; servicos: Servico[]; onClose: () => void; onEmitida: (notaId: string) => void; onTomadorNovo: () => void;
}) {
  const ativos = servicos.filter((s) => s.ativo);
  const primeiro = ativos[0];
  const [servicoId, setServicoId] = useState(primeiro?.id ?? '');
  const [tomadorId, setTomadorId] = useState('');
  const [buscaTom, setBuscaTom] = useState('');
  const [descricao, setDescricao] = useState(primeiro?.descricao ?? '');
  const [valor, setValor] = useState(primeiro?.valor_padrao != null ? String(primeiro.valor_padrao) : '');
  const [desconto, setDesconto] = useState('');
  const [aliquota, setAliquota] = useState(primeiro?.aliquota_iss != null ? String(primeiro.aliquota_iss) : '');
  const [retido, setRetido] = useState(false);
  const [competencia, setCompetencia] = useState(hojeBR());
  const [info, setInfo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ status: StatusNota; erros?: ErroSefin[]; error?: string; nota_id?: string } | null>(null);
  const [novoTomador, setNovoTomador] = useState(false);
  const [tomadorCriado, setTomadorCriado] = useState<Tomador | null>(null);

  const servico = ativos.find((s) => s.id === servicoId);
  const tomador = tomadores.find((t) => t.id === tomadorId) ?? (tomadorCriado?.id === tomadorId ? tomadorCriado : undefined);
  const sugestoes = useMemo(() => {
    const q = buscaTom.trim().toLowerCase();
    if (!q) return [];
    const d = soDigitos(q);
    return tomadores.filter((t) => t.nome.toLowerCase().includes(q) || (d && t.documento.includes(d))).slice(0, 8);
  }, [buscaTom, tomadores]);

  const escolherServico = (id: string) => {
    setServicoId(id);
    const s = ativos.find((x) => x.id === id);
    if (!s) return;
    setDescricao(s.descricao);
    if (s.valor_padrao != null) setValor(String(s.valor_padrao));
    setAliquota(s.aliquota_iss != null ? String(s.aliquota_iss) : '');
  };

  const emitir = async () => {
    if (!servico) { avisar('Escolha o serviço.'); return; }
    const v = Number(valor);
    if (!(v > 0)) { avisar('Informe o valor do serviço.'); return; }
    if (!descricao.trim()) { avisar('A descrição não pode ficar vazia.'); return; }
    // Texto digitado na busca sem escolher ninguém: nunca emitir "sem tomador" por engano.
    if (!tomador && buscaTom.trim()) {
      avisar('Você digitou um tomador mas não escolheu nenhum da lista. Escolha um cadastrado ou cadastre com "+ Novo". Para emitir sem tomador, apague o campo.', 'Tomador não selecionado');
      return;
    }
    const ok = await confirmar({
      titulo: empresa.ambiente === 1 ? 'Emitir nota fiscal?' : 'Emitir nota de teste?',
      mensagem: `${fmtBRL(v - Number(desconto || 0))} para ${tomador ? `${tomador.nome} (${fmtDoc(tomador.documento)})` : 'SEM tomador identificado'}.${empresa.ambiente === 1 ? ' A nota terá valor fiscal.' : ' Ambiente de testes: sem valor fiscal.'}`,
      confirmarLabel: 'Emitir',
    });
    if (!ok) return;
    setEnviando(true);
    setResultado(null);
    const r = await nfseCall<{ status: StatusNota; erros?: ErroSefin[]; nota_id?: string }>('emitir', {
      empresa_id: empresa.id, servico_id: servico.id, tomador_id: tomador?.id ?? null,
      c_trib_nac: servico.c_trib_nac, c_trib_mun: servico.c_trib_mun, c_nbs: servico.c_nbs,
      descricao, valor_servico: v, desconto_incondicionado: desconto ? Number(desconto) : null,
      aliquota_iss: aliquota === '' ? null : Number(aliquota), iss_retido: retido, competencia, info_complementar: info,
    });
    setEnviando(false);
    if (r.success && r.nota_id) { onEmitida(r.nota_id); return; }
    // Erro de rede no navegador: a nota pode ter sido emitida. Nunca reenviar sozinho.
    if (!r.nota_id && (r as { rede?: boolean }).rede) {
      setResultado({ status: 'erro', error: 'A conexão caiu antes da resposta. Confira a lista de notas antes de tentar de novo, para não emitir duas vezes.' });
      return;
    }
    setResultado({ status: r.status ?? 'rejeitada', erros: r.erros, error: r.error, nota_id: r.nota_id });
  };

  return (
    <Modal titulo={empresa.ambiente === 1 ? 'Emitir NFS-e' : 'Emitir NFS-e (testes)'} onClose={enviando ? () => {} : onClose}
      rodape={<>
        <button onClick={onClose} disabled={enviando} className="px-4 h-10 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer disabled:opacity-40">Fechar</button>
        <button onClick={emitir} disabled={enviando || !ativos.length}
          className={`px-5 h-10 rounded-xl text-white text-sm font-bold cursor-pointer disabled:opacity-50 ${empresa.ambiente === 1 ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-sky-600 hover:bg-sky-500'}`}>
          {enviando ? 'Enviando à Sefin Nacional…' : 'Emitir'}
        </button>
      </>}>
      {!ativos.length ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">Cadastre pelo menos um serviço na aba Serviços antes de emitir.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          {resultado && (
            <div className="md:col-span-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-bold text-red-800">{resultado.status === 'erro' ? 'Sem resposta da Sefin Nacional' : 'Nota rejeitada'}</p>
              {resultado.error && <p className="text-xs text-red-700 mt-1">{resultado.error}</p>}
              <div className="mt-1"><ListaErros erros={resultado.erros} /></div>
              {resultado.status === 'erro' && resultado.nota_id && (
                <p className="text-xs text-red-700 mt-1">Abra a nota na lista e use “Consultar de novo” antes de emitir outra.</p>
              )}
            </div>
          )}

          <div className="md:col-span-6">
            <label className={labelCls}>Tomador (cliente)</label>
            {tomador ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 h-10">
                <span className="flex-1 text-sm text-zinc-800 truncate">{tomador.nome} · {fmtDoc(tomador.documento)}</span>
                <button onClick={() => setTomadorId('')} className="text-zinc-400 hover:text-zinc-700 cursor-pointer"><i className="ri-close-line" /></button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex gap-2">
                  <input className={inputCls} placeholder="Buscar por nome ou CPF/CNPJ (vazio = sem tomador)" value={buscaTom} onChange={(e) => setBuscaTom(e.target.value)} />
                  <button onClick={() => setNovoTomador(true)} className="px-3 h-10 rounded-xl border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">+ Novo</button>
                </div>
                {buscaTom.trim() && sugestoes.length === 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg px-3 py-2">
                    <p className="text-xs text-zinc-500">Nenhum tomador cadastrado com “{buscaTom.trim()}”.</p>
                    <button onClick={() => setNovoTomador(true)} className="mt-1 text-sm font-bold text-sky-700 hover:underline cursor-pointer">
                      + Cadastrar {[11, 14].includes(soDigitos(buscaTom).length) ? fmtDoc(soDigitos(buscaTom)) : 'novo tomador'}
                    </button>
                  </div>
                )}
                {sugestoes.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                    {sugestoes.map((t) => (
                      <button key={t.id} onClick={() => { setTomadorId(t.id); setBuscaTom(''); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-sky-50 cursor-pointer">
                        {t.nome} <span className="text-xs text-zinc-400">{fmtDoc(t.documento)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="md:col-span-3">
            <label className={labelCls}>Serviço</label>
            <select className={inputCls} value={servicoId} onChange={(e) => escolherServico(e.target.value)}>
              {ativos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
            {servico && <p className="text-[11px] text-zinc-400 mt-0.5">Código {servico.c_trib_nac}</p>}
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>Competência (data do serviço)</label>
            <input className={inputCls} type="date" max={hojeBR()} value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </div>
          <div className="md:col-span-6">
            <label className={labelCls}>Descrição do serviço</label>
            <textarea className={`${inputCls} h-24 py-2`} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Valor do serviço (R$)</label>
            <input className={inputCls} type="number" step="0.01" min={0} value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Desconto incondicionado</label>
            <input className={inputCls} type="number" step="0.01" min={0} value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Alíquota ISS (%)</label>
            <input className={inputCls} type="number" step="0.01" min={0} max={5} value={aliquota} onChange={(e) => setAliquota(e.target.value)} placeholder="em branco = não informar" />
          </div>
          <div className="md:col-span-6">
            <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={retido} onChange={(e) => setRetido(e.target.checked)} /> ISS retido pelo tomador
            </label>
          </div>
          <div className="md:col-span-6">
            <label className={labelCls}>Informações complementares <span className="font-normal text-zinc-400">opcional</span></label>
            <textarea className={`${inputCls} h-16 py-2`} maxLength={2000} value={info} onChange={(e) => setInfo(e.target.value)} placeholder="ex.: dados bancários, número do contrato, ART" />
          </div>
        </div>
      )}
      {novoTomador && (
        <TomadorModal empresa={empresa} inicial={null}
          documentoInicial={[11, 14].includes(soDigitos(buscaTom).length) ? soDigitos(buscaTom) : undefined}
          onClose={() => setNovoTomador(false)}
          onSalvo={(t) => { setNovoTomador(false); setTomadorCriado(t); setBuscaTom(''); onTomadorNovo(); setTomadorId(t.id); }} />
      )}
    </Modal>
  );
}

// ─── Detalhe ─────────────────────────────────────────────────────────────────
function NotaDetalhe({ notaId, empresa, souAdmin, onClose, onMudou }: { notaId: string; empresa: Empresa; souAdmin: boolean; onClose: () => void; onMudou: () => void }) {
  const [nota, setNota] = useState<Nota | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [codigo, setCodigo] = useState('1');
  const [motivo, setMotivo] = useState('');

  const carregar = async () => {
    const { data } = await supabase.from('nfse_notas').select('*').eq('id', notaId).maybeSingle();
    setNota(data as Nota | null);
  };
  useEffect(() => { carregar(); }, [notaId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!nota) return <Modal titulo="Nota" onClose={onClose} rodape={null}><p className="text-sm text-zinc-400">Carregando…</p></Modal>;

  const reconsultar = async () => {
    setBusy('reconsultar');
    const r = await nfseCall<{ status?: StatusNota }>('reconsultar', { nota_id: nota.id });
    setBusy(null);
    if (!r.success && r.error) avisar(r.error);
    await carregar();
    onMudou();
  };
  const cancelar = async () => {
    if (motivo.trim().length < 15) { avisar('Descreva o motivo com pelo menos 15 caracteres.'); return; }
    if (!(await confirmar({ titulo: 'Cancelar a nota?', mensagem: 'O cancelamento é registrado na Sefin Nacional e não pode ser desfeito.', perigo: true, confirmarLabel: 'Cancelar nota' }))) return;
    setBusy('cancelar');
    const r = await nfseCall('cancelar', { nota_id: nota.id, codigo, motivo });
    setBusy(null);
    if (!r.success) { avisar(r.error ?? 'Cancelamento recusado.'); return; }
    setCancelando(false);
    await carregar();
    onMudou();
  };

  const d = (rotulo: string, valor: React.ReactNode) => (
    <div><p className="text-[11px] text-zinc-400">{rotulo}</p><p className="text-sm text-zinc-800 break-words">{valor || '—'}</p></div>
  );

  return (
    <Modal titulo={nota.numero_nfse ? `NFS-e nº ${nota.numero_nfse}` : `DPS nº ${nota.numero_dps}`} onClose={onClose}
      rodape={<>
        {nota.xml_nfse && (
          <button onClick={() => baixarTexto(`${nomeArquivoNota(empresa, nota)}.xml`, nota.xml_nfse!)}
            className="px-3 h-10 rounded-xl border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">XML</button>
        )}
        {(nota.status === 'autorizada' || nota.status === 'cancelada') && (
          <button onClick={() => { if (!abrirDanfse(nota, empresa)) avisar('O navegador bloqueou a janela. Libere pop-ups para este site.'); }}
            className="px-3 h-10 rounded-xl bg-zinc-900 hover:bg-zinc-700 text-white text-xs font-bold cursor-pointer">DANFSe / PDF</button>
        )}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS_CLASS[nota.status]}`}>{STATUS_LABEL[nota.status]}</span>
          {nota.ambiente === 2 && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">Testes — sem valor fiscal</span>}
        </div>

        {(nota.status === 'rejeitada' || nota.status === 'erro') && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3"><ListaErros erros={nota.erros} /></div>
        )}
        {(nota.status === 'erro' || nota.status === 'processando') && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Não recebemos a resposta final. Consulte de novo: se a Sefin gerou a nota, ela aparece aqui como autorizada.
            <button onClick={reconsultar} disabled={busy !== null} className="block mt-2 px-3 h-8 rounded-lg bg-amber-500 text-white font-bold cursor-pointer disabled:opacity-50">
              {busy === 'reconsultar' ? 'Consultando…' : 'Consultar de novo'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {d('Tomador', nota.tomador ? `${nota.tomador.nome} (${fmtDoc(nota.tomador.documento)})` : 'Não identificado')}
          {d('Valor', fmtBRL(nota.valor_servico))}
          {d('Competência', fmtData(nota.competencia))}
          {d('Emitida em', fmtDataHora(nota.dh_processamento ?? nota.dh_emissao))}
          {d('Código do serviço', nota.c_trib_nac)}
          {d('ISS', `${nota.aliquota_iss != null ? `${nota.aliquota_iss}%` : 'não informado'}${nota.iss_retido ? ' · retido' : ''}`)}
        </div>
        {d('Descrição', <span className="whitespace-pre-wrap">{nota.descricao}</span>)}
        {nota.chave_acesso && d('Chave de acesso', <span className="font-mono text-xs">{fmtChave(nota.chave_acesso)}</span>)}
        {nota.status === 'cancelada' && d('Cancelamento', `${fmtDataHora(nota.cancelada_em)} — ${nota.cancel_motivo ?? ''}`)}

        {nota.status === 'autorizada' && souAdmin && (
          cancelando ? (
            <div className="rounded-xl border border-zinc-200 p-3 space-y-2">
              <label className={labelCls}>Motivo</label>
              <select className={inputCls} value={codigo} onChange={(e) => setCodigo(e.target.value)}>
                <option value="1">Erro na emissão</option>
                <option value="2">Serviço não prestado</option>
                <option value="9">Outros</option>
              </select>
              <textarea className={`${inputCls} h-20 py-2`} maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Explique (mínimo 15 caracteres)" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setCancelando(false)} className="px-3 h-9 rounded-lg border border-zinc-200 text-xs font-semibold cursor-pointer">Voltar</button>
                <button onClick={cancelar} disabled={busy !== null} className="px-3 h-9 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                  {busy === 'cancelar' ? 'Enviando…' : 'Confirmar cancelamento'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCancelando(true)} className="text-xs font-bold text-red-600 hover:underline cursor-pointer">Cancelar esta nota</button>
          )
        )}
      </div>
    </Modal>
  );
}

// ─── Lista ───────────────────────────────────────────────────────────────────
export default function NotasTab({ empresa, notas, tomadores, servicos, souAdmin, mes, onMes, onChange, onTomadores }: {
  empresa: Empresa; notas: Nota[]; tomadores: Tomador[]; servicos: Servico[]; souAdmin: boolean;
  mes: string; onMes: (m: string) => void; onChange: () => void; onTomadores: () => void;
}) {
  const [emitindo, setEmitindo] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [status, setStatus] = useState<'todas' | StatusNota>('todas');
  const [busca, setBusca] = useState('');

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return notas.filter((n) => (status === 'todas' || n.status === status)
      && (!q || (n.tomador?.nome ?? '').toLowerCase().includes(q) || (n.numero_nfse ?? '').includes(q) || n.descricao.toLowerCase().includes(q)));
  }, [notas, status, busca]);
  const autorizadas = notas.filter((n) => n.status === 'autorizada');
  const total = autorizadas.reduce((s, n) => s + Number(n.valor_servico) - Number(n.desconto_incondicionado ?? 0), 0);
  const semCert = !empresa.cert_validade;

  return (
    <div className="space-y-3">
      {semCert && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Cadastre o certificado A1 na aba <b>Empresa</b> para poder emitir.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Autorizadas no mês</p>
          <p className="text-xl font-black text-emerald-600">{autorizadas.length}</p>
          <p className="text-xs text-zinc-500">{fmtBRL(total)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Com problema</p>
          <p className="text-xl font-black text-red-600">{notas.filter((n) => n.status === 'rejeitada' || n.status === 'erro').length}</p>
          <p className="text-xs text-zinc-500">rejeitadas ou sem resposta</p>
        </div>
        <div className="col-span-2 flex items-end justify-end">
          <button onClick={() => setEmitindo(true)} disabled={semCert}
            className={`w-full md:w-auto px-5 h-12 rounded-xl text-white text-sm font-bold cursor-pointer disabled:opacity-40 ${empresa.ambiente === 1 ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-sky-600 hover:bg-sky-500'}`}>
            <i className="ri-file-add-line mr-1" />Emitir nota
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input type="month" className={`${inputCls} sm:w-44`} value={mes} max={mesAtual()} onChange={(e) => onMes(e.target.value || mesAtual())} />
        <select className={`${inputCls} sm:w-44`} value={status} onChange={(e) => setStatus(e.target.value as 'todas' | StatusNota)}>
          <option value="todas">Todas</option>
          {(Object.keys(STATUS_LABEL) as StatusNota[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input className={inputCls} placeholder="Buscar por tomador, número ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
        {lista.length === 0 && <p className="text-sm text-zinc-400 px-4 py-8 text-center">Nenhuma nota neste mês.</p>}
        {lista.map((n) => (
          <button key={n.id} onClick={() => setDetalhe(n.id)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 cursor-pointer">
            <div className="w-16 flex-shrink-0">
              <p className="text-sm font-black text-zinc-800">{n.numero_nfse ?? '—'}</p>
              <p className="text-[11px] text-zinc-400">{fmtData(n.competencia)}</p>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-800 truncate">{n.tomador?.nome ?? 'Sem tomador'}</p>
              <p className="text-xs text-zinc-400 truncate">{n.descricao}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-zinc-800">{fmtBRL(n.valor_servico)}</p>
              <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${STATUS_CLASS[n.status]}`}>
                {STATUS_LABEL[n.status]}{n.ambiente === 2 ? ' · teste' : ''}
              </span>
            </div>
          </button>
        ))}
      </div>

      {emitindo && (
        <EmitirModal empresa={empresa} tomadores={tomadores} servicos={servicos} onClose={() => { setEmitindo(false); onChange(); }} onTomadorNovo={onTomadores}
          onEmitida={(id) => { setEmitindo(false); onChange(); setDetalhe(id); }} />
      )}
      {detalhe && <NotaDetalhe notaId={detalhe} empresa={empresa} souAdmin={souAdmin} onClose={() => setDetalhe(null)} onMudou={onChange} />}
    </div>
  );
}
