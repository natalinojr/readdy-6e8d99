import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { confirmar } from '@/components/base/Dialogos';
import { getPublicUrl } from '@/lib/appUrl';
import { caminhoTvSenhas } from '@/lib/senhasTv';

/**
 * "TV de senhas" dentro de Recursos novos (aparece com o recurso ligado): link para abrir na TV,
 * Copiar e Gerar novo link. O link tem token próprio (tv_senhas_tokens), só de leitura das senhas;
 * gerar outro desliga o antigo. Só admin/gerente/supervisão da loja gera ou vê (RPC no banco).
 */
export default function TvSenhasBloco() {
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const tenantId = user?.tenantId;
  const [token, setToken] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc('fn_tv_senhas_token_atual', { p_tenant_id: tenantId });
    if (error) setErro(error.message || 'Não consegui ler o link.');
    else setToken((data as string | null) ?? null);
    setCarregando(false);
  }, [tenantId]);

  useEffect(() => { setToken(null); carregar(); }, [carregar]);

  const link = token ? getPublicUrl(caminhoTvSenhas(token)) : '';

  const gerar = async () => {
    if (!tenantId || gerando) return;
    if (token) {
      const ok = await confirmar({
        titulo: 'Gerar outro link?',
        mensagem: 'A TV que está usando o link de hoje para de mostrar as senhas. Você abre o link novo nela.',
        confirmarLabel: 'Gerar outro link',
      });
      if (!ok) return;
    }
    setGerando(true);
    const { data, error } = await supabase.rpc('fn_tv_senhas_token_gerar', { p_tenant_id: tenantId });
    setGerando(false);
    if (error || !data) {
      toastError('Não gerou o link', error?.message || 'Tente de novo.');
      return;
    }
    setToken(data as string);
    setCopiado(false);
    toastSuccess(token ? 'Link novo gerado. O antigo parou de funcionar.' : 'Link da TV gerado.');
  };

  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toastError('Não consegui copiar', 'Selecione o link e copie à mão.');
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 p-4" data-testid="tv-senhas-bloco">
      <div className="flex items-center gap-2 mb-1">
        <Link2 size={14} className="text-amber-700" />
        <p className="text-sm font-bold text-zinc-800">TV de senhas</p>
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        Abra o link em qualquer TV ou tablet velho, sem login. Na 1ª vez, toque na tela para liberar a voz.
        O link só mostra números de senha.
      </p>

      {erro && <p className="text-xs text-red-600 mb-2">{erro}</p>}

      {link && (
        <div className="flex items-center gap-2 mb-3 rounded-md border border-zinc-200 bg-white px-3 py-2">
          <span className="text-xs font-mono text-zinc-700 break-all select-all flex-1">{link}</span>
        </div>
      )}
      {!link && !carregando && !erro && (
        <p className="text-xs text-zinc-500 mb-3">Ainda não há link. Gere um para abrir na TV.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={gerar}
          disabled={gerando || carregando}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${link ? 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50' : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'}`}
        >
          <RefreshCw size={13} className={gerando ? 'animate-spin' : ''} />
          {link ? 'Gerar novo link' : 'Gerar link'}
        </button>
        <button
          type="button"
          onClick={copiar}
          disabled={!link}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${link ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400' : 'border border-zinc-300 bg-white text-zinc-700'}`}
        >
          <Copy size={13} />
          {copiado ? 'Copiado ✓' : 'Copiar'}
        </button>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 whitespace-nowrap"
          >
            <ExternalLink size={13} />Abrir
          </a>
        )}
      </div>
      {link && <p className="mt-2 text-[11px] text-zinc-500">Gerar outro link desliga a TV antiga.</p>}
    </div>
  );
}
