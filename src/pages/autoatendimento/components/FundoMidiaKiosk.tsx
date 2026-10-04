// Fundo da tela de espera do totem: os vídeos da loja em sequência, sem som e sem parar
// (Configurações › Loja). Sem vídeo, as fotos de capa trocam devagar. Sem nenhum dos dois,
// não desenha nada e fica o fundo escuro de sempre.
// O tablet fica no Wi-Fi da loja e o navegador guarda o arquivo em cache: cada vídeo
// baixa uma vez, não a cada volta.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { lerFotosLoja, lerVideosLoja, type CapaLoja, type VideoLoja } from '@/lib/capasLoja';
import { VideoMudo } from '@/components/cliente/LojaTopo';

const FOTO_MS = 7000;

export default function FundoMidiaKiosk(props: { tenantId: string; onTemMidia?: (tem: boolean) => void }) {
  const [videos, setVideos] = useState<VideoLoja[]>([]);
  const [fotos, setFotos] = useState<CapaLoja[]>([]);

  useEffect(function () {
    if (!props.tenantId) return;
    let ativo = true;
    supabase
      .from('tenants')
      .select('cover_url, cover_position, cover_images, cover_videos')
      .eq('id', props.tenantId)
      .maybeSingle()
      .then(function ({ data }) {
        if (!ativo || !data) return;
        setVideos(lerVideosLoja(data as { cover_videos?: unknown }));
        setFotos(lerFotosLoja(data as { cover_images?: unknown; cover_url?: string | null; cover_position?: string | null }));
      });
    return function () { ativo = false; };
  }, [props.tenantId]);

  return <FundoMidia videos={videos} fotos={fotos} onTemMidia={props.onTemMidia} />;
}

/** Parte visual, separada da leitura do banco (testável sem Supabase). */
export function FundoMidia(props: { videos: VideoLoja[]; fotos: CapaLoja[]; onTemMidia?: (tem: boolean) => void }) {
  // Vídeo com erro sai da roda (o totem fica ligado o dia todo: sem isso, vídeo quebrado
  // viraria pedido de rede sem fim). Todos quebrados → fotos.
  const [falhos, setFalhos] = useState<string[]>([]);
  const videos = props.videos.filter(function (v) { return falhos.indexOf(v.url) < 0; });
  const fotos = props.fotos;
  const [atual, setAtual] = useState(0);
  const onTemMidia = props.onTemMidia;

  const usaVideo = videos.length > 0;
  const total = usaVideo ? videos.length : fotos.length;
  const idx = total > 0 ? atual % total : 0;

  useEffect(function () { if (onTemMidia) onTemMidia(total > 0); }, [total, onTemMidia]);

  // Fotos: troca por tempo. Vídeo: troca no fim (onEnded).
  useEffect(function () {
    if (usaVideo || fotos.length < 2) return;
    const t = setTimeout(function () { setAtual(function (a) { return a + 1; }); }, FOTO_MS);
    return function () { clearTimeout(t); };
  }, [usaVideo, fotos.length, atual]);

  if (total === 0) return null;

  function proximo() { setAtual(function (a) { return a + 1; }); }

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {usaVideo ? (
        <>
          {/* Quadro de capa por baixo: cobre o instante em que o próximo vídeo carrega */}
          {videos[idx].poster ? <img src={videos[idx].poster} alt="" className="absolute inset-0 w-full h-full object-cover" /> : null}
          <VideoMudo
            key={videos[idx].url + idx}
            src={videos[idx].url}
            loop={videos.length < 2}
            onEnded={proximo}
            onError={function () { const url = videos[idx].url; setFalhos(function (f) { return f.indexOf(url) >= 0 ? f : f.concat([url]); }); }}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* O próximo já vai baixando enquanto este toca (escondido, sem tocar) */}
          {videos.length > 1 ? (
            <video key={'prox-' + videos[(idx + 1) % videos.length].url} src={videos[(idx + 1) % videos.length].url} muted playsInline preload="auto" className="hidden" />
          ) : null}
        </>
      ) : (
        fotos.map(function (f, i) {
          return (
            <img
              key={f.url + i}
              src={f.url}
              alt=""
              className={'absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ' + (i === idx ? 'opacity-100' : 'opacity-0')}
              style={f.posicao ? { objectPosition: f.posicao } : undefined}
            />
          );
        })
      )}
      {/* Escurece para o texto branco continuar legível em cima de qualquer vídeo */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/45 to-black/75" />
    </div>
  );
}
