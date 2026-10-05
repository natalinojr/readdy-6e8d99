// Painel de senhas na TV — /senhas/<token> (pública, sem login de pessoa). Ligada por loja em
// Configurações › Operação › Recursos novos › "TV de senhas" (recursos.tv_senhas).
//
// Desenhada em 1280x720 (16:9) e escalada para a tela: serve TV, tablet velho ou celular deitado.
// Só mostra o NÚMERO da senha (nunca nome de cliente, item ou valor). Colunas: "Preparando" e
// "Pode retirar" (a última chamada grande, piscando na cor da loja). Quando uma senha passa a pronta,
// toca o sino e a voz do navegador diz "Senha trezentos e treze" (precisa de um toque na 1ª vez).
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { COR_LOJA_PADRAO } from '@/lib/corLoja';
import { corTextoSobre, fraseChamada, horaDaTv, layoutPreparando, type PainelSenhas } from '@/lib/senhasTv';
import { useSenhasTv } from './useSenhasTv';

const LARGURA = 1280;
const ALTURA = 720;
const MAX_PEQUENAS = 6;

const CSS = `
@keyframes tvs-pisca { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 var(--tvs-cor-brilho); } 50% { transform: scale(1.025); box-shadow: 0 0 0 18px transparent; } }
@keyframes tvs-respira { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
.tvs-pisca { animation: tvs-pisca 1.2s ease-in-out infinite; }
.tvs-respira { animation: tvs-respira 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .tvs-pisca, .tvs-respira { animation: none; } }
`;

function useEscala() {
  const [escala, setEscala] = useState(() => Math.min(window.innerWidth / LARGURA, window.innerHeight / ALTURA));
  useEffect(() => {
    const f = () => setEscala(Math.min(window.innerWidth / LARGURA, window.innerHeight / ALTURA));
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return escala;
}

function useRelogio() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(new Date()), 10000);
    return () => window.clearInterval(t);
  }, []);
  return agora;
}

function Mensagem({ icone, titulo, texto }: { icone: string; titulo: string; texto?: string }) {
  return (
    <div style={{ width: LARGURA, height: ALTURA, background: '#18120D', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 80 }}>
      <i className={icone} style={{ fontSize: 96, color: '#F5B544' }} />
      <div style={{ fontSize: 56, fontWeight: 800, marginTop: 20, lineHeight: 1.1 }}>{titulo}</div>
      {texto && <div style={{ fontSize: 28, opacity: 0.75, marginTop: 16, maxWidth: 900 }}>{texto}</div>}
    </div>
  );
}

function Painel({ painel, agora, somLigado, semConexao }: { painel: PainelSenhas; agora: Date; somLigado: boolean; semConexao: boolean }) {
  const cor = /^#[0-9a-fA-F]{6}$/.test(painel.loja.cor ?? '') ? (painel.loja.cor as string) : COR_LOJA_PADRAO;
  const sobreCor = corTextoSobre(cor);
  // Cor clara (ex.: amarelo) não lê sobre branco: o texto vira escuro e a cor fica só no contorno.
  const corTexto = sobreCor === '#FFFFFF' ? cor : '#1F1A14';
  const { hora, data } = horaDaTv(agora);
  const prontas = painel.prontas.map((p) => p.senha);
  const grande = prontas[0] ?? null;
  const pequenas = prontas.slice(1, 1 + MAX_PEQUENAS);
  const maisProntas = Math.max(0, prontas.length - 1 - pequenas.length);
  const lay = layoutPreparando(painel.preparando.length);
  const prep = painel.preparando.slice(0, lay.max);
  const maisPrep = painel.preparando.length - prep.length;
  const iniciais = painel.loja.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const fontePequena = pequenas.length <= 3 ? 72 : 52;

  return (
    <div style={{ width: LARGURA, height: ALTURA, display: 'flex', flexDirection: 'column', background: '#FFF8F1', color: '#1F1A14', ['--tvs-cor-brilho' as string]: `${cor}66` }}>
      {/* Topo: nome e cor da loja + hora */}
      <div style={{ height: 84, flex: 'none', background: cor, color: sobreCor, display: 'flex', alignItems: 'center', gap: 20, padding: '0 36px' }}>
        {painel.loja.logo
          ? <img src={painel.loja.logo} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', background: '#fff' }} />
          : <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,.25)', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800 }}>{iniciais}</div>}
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{painel.loja.nome}</div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right', lineHeight: 1 }}>
          <b style={{ display: 'block', fontSize: 44, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{hora}</b>
          <span style={{ fontSize: 15, opacity: 0.9, fontWeight: 600 }}>{data}</span>
        </div>
      </div>

      {/* Colunas */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 26, padding: '20px 36px' }}>
        <div style={{ borderRadius: 28, padding: '16px 26px', background: '#F4EFE7', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 32, fontWeight: 800, marginBottom: 12, color: '#5B5248' }}>
            <i className="ri-fire-line" style={{ fontSize: 34 }} />Preparando
            <em style={{ fontStyle: 'normal', marginLeft: 'auto', fontSize: 22, background: '#E3DBCF', borderRadius: 999, padding: '0 14px' }}>{painel.preparando.length}</em>
          </div>
          {prep.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${lay.colunas}, 1fr)`, gap: 10 }}>
              {prep.map((s) => (
                <span key={s} style={{ background: '#fff', border: '2px solid #E6DED2', color: '#6B6258', borderRadius: 18, textAlign: 'center', fontSize: lay.fonte, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{s}</span>
              ))}
              {maisPrep > 0 && <span style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: 24, fontWeight: 700, color: '#9A9086' }}>+ {maisPrep} em preparo</span>}
            </div>
          ) : (
            <div style={{ fontSize: 26, color: '#9A9086', fontWeight: 600, padding: '24px 4px' }}>Nada em preparo agora.</div>
          )}
        </div>

        <div style={{ borderRadius: 28, padding: '16px 26px', background: '#fff', border: `4px solid ${cor}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 32, fontWeight: 800, marginBottom: 12, color: corTexto }}>
            <i className="ri-notification-3-fill" style={{ fontSize: 34 }} />Pode retirar
          </div>
          {grande ? (
            <>
              <div className="tvs-pisca" style={{ height: 168, borderRadius: 26, background: cor, color: sobreCor, display: 'grid', placeItems: 'center', fontSize: 140, fontWeight: 800, lineHeight: 1, letterSpacing: '.02em', fontVariantNumeric: 'tabular-nums' }}>{grande}</div>
              {pequenas.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 16 }}>
                  {pequenas.map((s) => (
                    <span key={s} style={{ flex: pequenas.length <= 3 ? 1 : '0 0 calc(33.333% - 10px)', minWidth: 0, textAlign: 'center', border: `3px solid ${cor}`, color: corTexto, borderRadius: 22, fontSize: fontePequena, fontWeight: 800, lineHeight: 1.12, background: '#fff', fontVariantNumeric: 'tabular-nums' }}>{s}</span>
                  ))}
                  {maisProntas > 0 && <span style={{ width: '100%', textAlign: 'center', fontSize: 22, fontWeight: 700, color: '#9A9086' }}>+ {maisProntas} prontas</span>}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 26, color: '#9A9086', fontWeight: 600, padding: '24px 4px' }}>Nenhuma senha esperando retirada.</div>
          )}
        </div>
      </div>

      {/* Faixa da última chamada + som */}
      <div aria-live="polite" style={{ height: 56, flex: 'none', background: '#1F1A14', color: '#fff', display: 'flex', alignItems: 'center', gap: 16, padding: '0 36px', fontSize: 30, fontWeight: 700 }}>
        <i className="ri-notification-3-fill" style={{ color: '#FBBF24', fontSize: 32 }} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{grande ? fraseChamada(grande) : 'Nenhuma senha chamada agora'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {semConexao && <span style={{ fontSize: 17, fontWeight: 700, color: '#FCA5A5' }}><i className="ri-wifi-off-line" /> Sem conexão, mostrando a última leitura</span>}
          <span
            className={somLigado ? undefined : 'tvs-respira'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 700, borderRadius: 999, padding: '6px 16px', background: somLigado ? '#3a332b' : '#F59E0B', color: somLigado ? '#E8E2D9' : '#1F1A14' }}
          >
            <i className={somLigado ? 'ri-volume-up-fill' : 'ri-volume-mute-fill'} />
            {somLigado ? 'Voz ligada · voz do navegador' : 'Toque na tela uma vez para ligar a voz'}
          </span>
        </div>
      </div>

      {/* Rodapé: por ora só o nome da loja. O espaço fica para as artes do Estúdio (futuro). */}
      <div data-slot="rodape-artes" style={{ height: 110, flex: 'none', background: '#fff', borderTop: `4px solid ${cor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, fontSize: 36, fontWeight: 800, color: '#3b342c' }}>
        <span style={{ color: corTexto }}>{painel.loja.nome}</span>
        <span style={{ fontWeight: 600, color: '#8a8076', fontSize: 26 }}>· Retire no balcão quando chamarmos</span>
      </div>
    </div>
  );
}

export default function SenhasTvPage() {
  const { token } = useParams<{ token: string }>();
  const { resposta, painel, semConexao, somLigado, ligarSom } = useSenhasTv(token);
  const escala = useEscala();
  const agora = useRelogio();

  useEffect(() => { document.title = 'Senhas'; }, []);
  // Controle remoto / teclado também liberam o som.
  useEffect(() => {
    window.addEventListener('keydown', ligarSom, { once: true });
    return () => window.removeEventListener('keydown', ligarSom);
  }, [ligarSom]);

  const conteudo = useMemo(() => {
    if (!resposta) {
      return semConexao
        ? <Mensagem icone="ri-wifi-off-line" titulo="Sem conexão" texto="Tentando de novo. Confira a internet da TV." />
        : <Mensagem icone="ri-loader-4-line" titulo="Carregando senhas..." />;
    }
    if (resposta.status === 'invalido') {
      return <Mensagem icone="ri-link-unlink" titulo="Link inválido ou trocado" texto="Peça um link novo em Configurações › Operação › Recursos novos › TV de senhas." />;
    }
    if (resposta.status === 'desligado') {
      return <Mensagem icone="ri-tv-2-line" titulo="TV de senhas desligada nesta loja" texto={resposta.lojaNome ?? undefined} />;
    }
    if (resposta.status === 'ok' && painel) {
      return <Painel painel={painel} agora={agora} somLigado={somLigado} semConexao={semConexao} />;
    }
    return <Mensagem icone="ri-loader-4-line" titulo="Carregando senhas..." />;
  }, [resposta, painel, agora, somLigado, semConexao]);

  return (
    <div
      onClick={ligarSom}
      style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', userSelect: 'none', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <style>{CSS}</style>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: LARGURA, height: ALTURA, transform: `translate(-50%, -50%) scale(${escala})`, transformOrigin: 'center center' }}>
        {conteudo}
      </div>
    </div>
  );
}
