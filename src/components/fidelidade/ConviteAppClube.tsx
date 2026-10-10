// Convite "Baixe o app do clube" fora da página do clube: confirmação do delivery e da
// mesa (QR), checkout e tela final do tablet. Só aparece quando a loja ligou o app
// (Clientes & Marketing › Clube › App do cliente). Leva a /clube/<loja>?instalar=1, que já
// abre o passo a passo de instalar (no tablet vira um QR para o celular do cliente).
import { useEffect, useState } from 'react';
import QRCodeImport from 'react-qr-code';
import { clubeApp } from '@/lib/clubeApp';

// react-qr-code exporta como default em alguns bundles e como named em outros.
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;

export interface AppClubeResumo { ativo: boolean; slug?: string; nome?: string; nome_curto?: string; icone?: string; programa?: string }

const cache = new Map<string, Promise<AppClubeResumo>>();
function buscar(tenantId: string): Promise<AppClubeResumo> {
  let p = cache.get(tenantId);
  if (!p) {
    p = clubeApp<AppClubeResumo>({ action: 'app_resumo', tenant_id: tenantId }).then((r) => (r.error ? { ativo: false } : r));
    cache.set(tenantId, p);
  }
  return p;
}

/** O app do clube desta loja (null enquanto carrega ou se a loja não ligou o app). */
export function useAppClube(tenantId: string | null | undefined): AppClubeResumo | null {
  const [info, setInfo] = useState<AppClubeResumo | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    void buscar(tenantId).then((r) => { if (vivo) setInfo(r.ativo ? r : null); });
    return () => { vivo = false; };
  }, [tenantId]);
  return info;
}

export const linkInstalarApp = (slug: string) => `${window.location.origin}/clube/${slug}?instalar=1`;

function Icone({ app, tamanho = 'w-12 h-12' }: { app: AppClubeResumo; tamanho?: string }) {
  return app.icone
    ? <img src={app.icone} alt="" className={`${tamanho} rounded-2xl shadow-sm shrink-0`} />
    : <span className={`${tamanho} rounded-2xl bg-zinc-200 shrink-0`} />;
}

/** Cartão para o celular do cliente (confirmação do pedido). */
export function ConviteAppCartao({ tenantId, motivo }: { tenantId: string | null | undefined; motivo?: string }) {
  const app = useAppClube(tenantId);
  if (!app?.slug) return null;
  return (
    <a href={linkInstalarApp(app.slug)} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-sm no-underline">
      <Icone app={app} />
      <span className="flex-1 min-w-0">
        <b className="block text-[15px] font-extrabold text-stone-900 leading-tight">Baixe o app do {app.nome_curto || app.nome}</b>
        <span className="block text-[12.5px] text-stone-600 leading-snug mt-0.5">{motivo ?? 'Seus pontos em 1 toque e aviso quando ganhar prêmio. Grátis, sem loja de apps.'}</span>
      </span>
      <span className="shrink-0 h-9 px-3 rounded-xl bg-stone-900 text-white text-[13px] font-bold flex items-center gap-1"><i className="ri-download-2-line" />Baixar</span>
    </a>
  );
}

/** Linha discreta (dentro do clube no checkout). */
export function ConviteAppLinha({ tenantId }: { tenantId: string | null | undefined }) {
  const app = useAppClube(tenantId);
  if (!app?.slug) return null;
  return (
    <a href={linkInstalarApp(app.slug)} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 min-h-[44px] text-[13px] leading-snug font-bold text-amber-800 underline">
      <i className="ri-smartphone-line text-lg no-underline shrink-0" />Baixe o app do clube: pontos em 1 toque e aviso de prêmio
    </a>
  );
}

/** QR para o tablet de autoatendimento (o cliente aponta o celular). */
export function ConviteAppQr({ tenantId }: { tenantId: string | null | undefined }) {
  const app = useAppClube(tenantId);
  if (!app?.slug) return null;
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white p-3 max-w-3xl w-full text-left">
      <div className="bg-white p-1 shrink-0"><QRCode value={linkInstalarApp(app.slug)} size={112} /></div>
      <div className="min-w-0">
        <div className="flex items-center gap-2"><Icone app={app} tamanho="w-8 h-8" /><b className="text-zinc-900 text-lg md:text-xl font-black leading-tight">Baixe o app do {app.nome_curto || app.nome}</b></div>
        <p className="text-zinc-600 text-sm md:text-base mt-1 leading-snug">Aponte a câmera do celular: veja seus pontos e receba aviso quando ganhar prêmio. Grátis.</p>
      </div>
    </div>
  );
}
