import { VOA, criarVoa, passoVoa, type EstadoVoa, type FaseJogo } from '@/lib/jogos/voa';
import { CORRE, criarCorre, passoCorre, type EstadoCorre } from '@/lib/jogos/corre';
import { desenharVoa } from './desenhoVoa';
import { desenharCorre } from './desenhoCorre';

export interface MotorJogo {
  id: string;
  nome: string;
  descricao: string;
  icone: string;
  cor: string;
  VW: number;
  VH: number;
  /** 'toque' = só conta o instante do toque; 'segurar' = conta enquanto o dedo está na tela */
  entrada: 'toque' | 'segurar';
  criar(semente: number): unknown;
  passo(e: unknown, entrada: boolean): void;
  quadro(e: unknown): number;
  fase(e: unknown): FaseJogo;
  pontos(e: unknown): number;
  desenhar(ctx: CanvasRenderingContext2D, e: unknown): void;
}

export const JOGOS: MotorJogo[] = [
  {
    id: 'voa',
    nome: 'Voa Voa',
    descricao: 'Toque para voar e passe entre as colunas',
    icone: 'ri-flight-takeoff-line',
    cor: 'from-sky-400 to-cyan-500',
    VW: VOA.VW,
    VH: VOA.VH,
    entrada: 'toque',
    criar: criarVoa,
    passo: function (e, v) { passoVoa(e as EstadoVoa, v); },
    quadro: function (e) { return (e as EstadoVoa).quadro; },
    fase: function (e) { return (e as EstadoVoa).fase; },
    pontos: function (e) { return (e as EstadoVoa).pontos; },
    desenhar: function (ctx, e) { desenharVoa(ctx, e as EstadoVoa); },
  },
  {
    id: 'corre',
    nome: 'Corre Corre',
    descricao: 'Pule buracos, pise nos bichinhos e pegue moedas',
    icone: 'ri-run-line',
    cor: 'from-orange-400 to-red-500',
    VW: CORRE.VW,
    VH: CORRE.VH,
    entrada: 'segurar',
    criar: criarCorre,
    passo: function (e, v) { passoCorre(e as EstadoCorre, v); },
    quadro: function (e) { return (e as EstadoCorre).quadro; },
    fase: function (e) { return (e as EstadoCorre).fase; },
    pontos: function (e) { return (e as EstadoCorre).pontos; },
    desenhar: function (ctx, e) { desenharCorre(ctx, e as EstadoCorre); },
  },
];
