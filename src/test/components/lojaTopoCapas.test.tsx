import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import LojaTopo from '@/components/cliente/LojaTopo';
import { lerCapasLoja, lerFotosLoja } from '@/lib/capasLoja';

describe('lerCapasLoja', () => {
  it('usa cover_images na ordem e com a posição de cada foto', () => {
    expect(lerCapasLoja({
      cover_images: [{ url: 'https://x/a.jpg', position: '10% 20%' }, { url: 'https://x/b.jpg', position: '' }],
      cover_url: 'https://x/a.jpg',
    })).toEqual([{ url: 'https://x/a.jpg', posicao: '10% 20%' }, { url: 'https://x/b.jpg', posicao: '' }]);
  });

  it('loja antiga (só cover_url) vira uma foto', () => {
    expect(lerCapasLoja({ cover_images: [], cover_url: 'https://x/a.jpg', cover_position: '50% 0%' }))
      .toEqual([{ url: 'https://x/a.jpg', posicao: '50% 0%' }]);
  });

  it('ignora lixo e corta em 10', () => {
    const muitas = Array.from({ length: 12 }, (_, i) => ({ url: 'https://x/' + i + '.jpg' }));
    expect(lerCapasLoja({ cover_images: [null, { position: '1% 1%' }, ...muitas] })).toHaveLength(10);
    expect(lerCapasLoja(null)).toEqual([]);
    expect(lerCapasLoja({ cover_images: 'x' })).toEqual([]);
  });
});

describe('LojaTopo — carrossel de capas', () => {
  const capas = [
    { url: 'https://x/1.jpg', posicao: '' },
    { url: 'https://x/2.jpg', posicao: '' },
    { url: 'https://x/3.jpg', posicao: '20% 30%' },
  ];

  function slides() { return Array.from(document.querySelectorAll('[data-slide]')) as HTMLElement[]; }
  function fotos() { return slides().map((d) => d.querySelector('img')).filter(Boolean) as HTMLImageElement[]; }
  function atual() { return slides().find((d) => d.className.includes('opacity-100'))?.querySelector('img')?.getAttribute('src'); }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('só baixa a 1ª até ela carregar; depois passa sozinha a cada 5 s', () => {
    render(<LojaTopo nome="Loja" capas={capas} />);
    expect(fotos()).toHaveLength(1);
    expect(atual()).toBe('https://x/1.jpg');

    // Sem a 1ª carregada não gira
    act(() => { vi.advanceTimersByTime(6000); });
    expect(atual()).toBe('https://x/1.jpg');

    fireEvent.load(fotos()[0]);
    // A próxima entra no DOM (pré-carrega), a 3ª ainda não
    expect(fotos().map((i) => i.getAttribute('src'))).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);

    act(() => { vi.advanceTimersByTime(5000); });
    expect(atual()).toBe('https://x/2.jpg');
    expect(fotos()).toHaveLength(3);

    act(() => { vi.advanceTimersByTime(5000); });
    expect(atual()).toBe('https://x/3.jpg');
    expect(fotos().find((i) => i.getAttribute('src') === 'https://x/3.jpg')?.style.objectPosition).toBe('20% 30%');

    act(() => { vi.advanceTimersByTime(5000); });
    expect(atual()).toBe('https://x/1.jpg');
  });

  it('bolinha leva direto à foto', () => {
    render(<LojaTopo nome="Loja" capas={capas} />);
    fireEvent.load(fotos()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Foto 3 de 3' }));
    expect(atual()).toBe('https://x/3.jpg');
    expect(screen.getByRole('button', { name: 'Foto 3 de 3' }).getAttribute('aria-current')).toBe('true');
  });

  it('uma foto só: sem bolinhas e sem troca', () => {
    render(<LojaTopo nome="Loja" capas={[capas[0]]} />);
    fireEvent.load(fotos()[0]);
    expect(screen.queryByRole('button', { name: /Foto 1 de/ })).toBeNull();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(atual()).toBe('https://x/1.jpg');
  });

  it('sem capas: faixa na cor da loja', () => {
    const { container } = render(<LojaTopo nome="Loja" capas={[]} />);
    expect(fotos()).toHaveLength(0);
    expect(container.querySelector('.bg-\\[var\\(--cor-loja\\)\\]')).not.toBeNull();
  });
});

describe('vídeos da loja', () => {
  it('vídeos vêm antes das fotos, com o quadro de capa como imagem', () => {
    const capas = lerCapasLoja({
      cover_videos: [{ url: 'https://x/v.mp4', poster: 'https://x/v.jpg' }, { url: '' }],
      cover_images: [{ url: 'https://x/a.jpg', position: '' }],
    });
    expect(capas).toEqual([
      { url: 'https://x/v.jpg', posicao: '', video: 'https://x/v.mp4' },
      { url: 'https://x/a.jpg', posicao: '' },
    ]);
    // Configurações edita as fotos à parte
    expect(lerFotosLoja({ cover_images: [{ url: 'https://x/a.jpg' }] })).toHaveLength(1);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom não toca vídeo
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('só o slide da vez tem <video>; ele passa no fim do vídeo, não aos 5 s', () => {
    const capas = [
      { url: 'https://x/v.jpg', posicao: '', video: 'https://x/v.mp4' },
      { url: 'https://x/a.jpg', posicao: '' },
    ];
    render(<LojaTopo nome="Loja" capas={capas} />);
    const img0 = document.querySelector('[data-slide="video"] img') as HTMLImageElement;
    fireEvent.load(img0);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.getAttribute('src')).toBe('https://x/v.mp4');

    act(() => { vi.advanceTimersByTime(6000); });
    expect(document.querySelector('[data-slide="video"]')!.className).toContain('opacity-100');

    fireEvent.ended(video);
    expect(document.querySelector('[data-slide="foto"]')!.className).toContain('opacity-100');
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Vídeo 1 de 2' })).toBeTruthy();
  });

  it('vídeo com erro vira foto (fica o quadro de capa) e não entra em ciclo', () => {
    const capas = [
      { url: 'https://x/v1.jpg', posicao: '', video: 'https://x/quebrado1.mp4' },
      { url: 'https://x/v2.jpg', posicao: '', video: 'https://x/quebrado2.mp4' },
    ];
    render(<LojaTopo nome="Loja" capas={capas} />);
    fireEvent.load(document.querySelector('[data-slide="video"] img') as HTMLImageElement);
    fireEvent.error(document.querySelector('video') as HTMLVideoElement);
    // Continua no 1º slide, sem <video>, só o quadro de capa
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelectorAll('[data-slide]')[0].className).toContain('opacity-100');
    // Passa como foto (5 s); o 2º também quebra e fica parado nele por 5 s, sem trocar na hora
    act(() => { vi.advanceTimersByTime(5000); });
    fireEvent.error(document.querySelector('video') as HTMLVideoElement);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelectorAll('[data-slide]')[1].className).toContain('opacity-100');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(document.querySelectorAll('[data-slide]')[0].className).toContain('opacity-100');
    expect(document.querySelector('video')).toBeNull();
  });

  it('vídeo sozinho fica em loop', () => {
    render(<LojaTopo nome="Loja" capas={[{ url: '', posicao: '', video: 'https://x/v.mp4' }]} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(true);
  });
});
