// Enviar a nota pelo WhatsApp (dono, 2026-10-07): vai o PDF da nota, não um link, e quem escolhe o
// contato é a pessoa, na hora. O PDF é preparado assim que a nota aparece (gerar leva ~1 s e o
// "Compartilhar" do navegador só abre colado no toque); o toque só entrega o arquivo ao sistema.
// - Navegador com Compartilhar de arquivo (Android, iPhone, Windows): abre a lista de apps → WhatsApp.
// - App Android com o plugin Share: grava no cache e abre o Compartilhar do Android.
// - Sem Compartilhar (Firefox, app Android sem o plugin): baixa/salva o PDF e abre o WhatsApp com o
//   texto, para anexar o arquivo.
import { useEffect, useState } from 'react';
import { type Empresa, type Nota, fmtBRL, fmtData } from '../api';
import { pdfDanfse } from './danfse';

export const textoNota = (n: { numero: string | null; valor: number; competencia: string; empresa: string }) =>
  `Nota fiscal de serviço${n.numero ? ` nº ${n.numero}` : ''} de ${n.empresa} · ${fmtBRL(n.valor)} · competência ${fmtData(n.competencia)}`;

type Plugin = { [k: string]: (a?: unknown) => Promise<unknown> };
const plugins = () => (window as unknown as { Capacitor?: { Plugins?: Record<string, Plugin> } }).Capacitor?.Plugins;

const base64De = (f: Blob) => new Promise<string>((ok, erro) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).replace(/^data:[^,]*,/, ''));
  fr.onerror = () => erro(fr.error);
  fr.readAsDataURL(f);
});

export type ResultadoEnvio = 'compartilhado' | 'cancelado' | 'baixado' | 'salvo';

/** Entrega o PDF ao Compartilhar do aparelho. Lança NotAllowedError se o toque "esfriou" (tocar de novo). */
export async function enviarPdfWhatsApp(arquivo: File, texto: string): Promise<ResultadoEnvio> {
  const cap = plugins();
  if (cap?.Share && cap?.Filesystem) {
    const { uri } = (await cap.Filesystem.writeFile({ path: arquivo.name, data: await base64De(arquivo), directory: 'CACHE' })) as { uri: string };
    try { await cap.Share.share({ title: texto, files: [uri] }); return 'compartilhado'; } catch { return 'cancelado'; }
  }
  if (cap?.Filesystem) {
    // App Android sem o plugin Share: salva em Documentos para anexar no WhatsApp.
    await cap.Filesystem.writeFile({ path: `ERPOS/${arquivo.name}`, data: await base64De(arquivo), directory: 'DOCUMENTS', recursive: true });
    return 'salvo';
  }
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], text: texto });
      return 'compartilhado';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelado';
      throw e;
    }
  }
  // Sem Compartilhar de arquivo: baixa o PDF e abre o WhatsApp (sem número: a pessoa escolhe o contato).
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  // api.whatsapp.com: o redirecionamento do wa.me estraga acentos no WhatsApp Web/Desktop.
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`${texto}\n(PDF em anexo)`)}`, '_blank', 'noopener');
  return 'baixado';
}

/** PDF da nota autorizada preparado de antemão + o toque que envia. `enviar` devolve um aviso ou null. */
export function useEnviarNota(nota: Nota | null, empresa: Empresa | null) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [estado, setEstado] = useState<'preparando' | 'pronto' | 'erro'>('preparando');
  const ativo = nota?.status === 'autorizada' && !!empresa;

  useEffect(() => {
    if (!ativo || !nota || !empresa) return;
    let vivo = true;
    setArquivo(null);
    setEstado('preparando');
    pdfDanfse(nota, empresa)
      .then((f) => { if (vivo) { setArquivo(f); setEstado('pronto'); } })
      .catch(() => { if (vivo) setEstado('erro'); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, nota?.id, nota?.status, empresa?.id]);

  const enviar = async (): Promise<string | null> => {
    if (!arquivo || !nota || !empresa) return estado === 'erro' ? 'Não foi possível gerar o PDF da nota.' : 'O PDF ainda está sendo preparado.';
    const texto = textoNota({ numero: nota.numero_nfse, valor: nota.valor_servico, competencia: nota.competencia, empresa: empresa.nome_fantasia || empresa.razao_social });
    try {
      const r = await enviarPdfWhatsApp(arquivo, texto);
      if (r === 'baixado') return 'O PDF foi baixado. No WhatsApp que abriu, escolha o contato e anexe o arquivo.';
      if (r === 'salvo') return `O PDF foi salvo em Documentos/ERPOS (${arquivo.name}). Anexe no WhatsApp.`;
      return null;
    } catch (e) {
      if ((e as Error).name === 'NotAllowedError') return 'Toque de novo para enviar.';
      return `Não foi possível compartilhar: ${(e as Error).message}`;
    }
  };

  return { ativo, estado, enviar };
}
