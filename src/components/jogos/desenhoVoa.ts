import { VOA, type EstadoVoa } from '@/lib/jogos/voa';

function nuvem(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.arc(x, y, 16 * s, 0, Math.PI * 2);
  ctx.arc(x + 18 * s, y - 8 * s, 20 * s, 0, Math.PI * 2);
  ctx.arc(x + 40 * s, y, 15 * s, 0, Math.PI * 2);
  ctx.rect(x, y - 2 * s, 40 * s, 16 * s);
  ctx.fill();
}

export function textoContorno(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, tam: number, alinhar: CanvasTextAlign = 'center') {
  ctx.font = '900 ' + tam + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = alinhar;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, tam / 6);
  ctx.strokeStyle = '#1f2937';
  ctx.strokeText(texto, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(texto, x, y);
}

export function desenharVoa(ctx: CanvasRenderingContext2D, e: EstadoVoa) {
  const { VW, VH, CHAO, X, R, COLUNA_L, VAO } = VOA;

  const ceu = ctx.createLinearGradient(0, 0, 0, CHAO);
  ceu.addColorStop(0, '#38bdf8');
  ceu.addColorStop(1, '#bae6fd');
  ctx.fillStyle = ceu;
  ctx.fillRect(0, 0, VW, CHAO);

  // nuvens (bem devagar)
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const n0 = (e.rolagem * 0.15) % 240;
  for (let i = -1; i < 3; i++) {
    nuvem(ctx, i * 240 - n0 + 30, 110 + (i % 2) * 60, 1);
    nuvem(ctx, i * 240 - n0 + 150, 240 + (i % 2) * -40, 0.7);
  }
  // morros
  ctx.fillStyle = '#86efac';
  const m0 = (e.rolagem * 0.4) % 180;
  for (let i = -1; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(i * 180 - m0 + 90, CHAO + 20, 110, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#4ade80';
  const m1 = (e.rolagem * 0.6) % 140;
  for (let i = -1; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(i * 140 - m1 + 40, CHAO + 10, 60, Math.PI, 0);
    ctx.fill();
  }

  // colunas
  for (const c of e.colunas) {
    const topo = c.vaoY - VAO / 2;
    const base = c.vaoY + VAO / 2;
    const corpo = ctx.createLinearGradient(c.x, 0, c.x + COLUNA_L, 0);
    corpo.addColorStop(0, '#16a34a');
    corpo.addColorStop(0.35, '#4ade80');
    corpo.addColorStop(1, '#15803d');
    ctx.fillStyle = corpo;
    ctx.fillRect(c.x + 4, 0, COLUNA_L - 8, topo);
    ctx.fillRect(c.x + 4, base, COLUNA_L - 8, CHAO - base);
    ctx.fillRect(c.x, topo - 26, COLUNA_L, 26);
    ctx.fillRect(c.x, base, COLUNA_L, 26);
    ctx.strokeStyle = '#14532d';
    ctx.lineWidth = 3;
    ctx.strokeRect(c.x + 4, -4, COLUNA_L - 8, topo - 22);
    ctx.strokeRect(c.x, topo - 26, COLUNA_L, 26);
    ctx.strokeRect(c.x, base, COLUNA_L, 26);
    ctx.strokeRect(c.x + 4, base + 26, COLUNA_L - 8, CHAO - base);
  }

  // chão com listras andando
  ctx.fillStyle = '#fde68a';
  ctx.fillRect(0, CHAO, VW, VH - CHAO);
  ctx.fillStyle = '#65a30d';
  ctx.fillRect(0, CHAO, VW, 14);
  ctx.fillStyle = '#84cc16';
  const l0 = e.rolagem % 24;
  for (let x = -24; x < VW + 24; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x - l0, CHAO + 14);
    ctx.lineTo(x - l0 + 12, CHAO);
    ctx.lineTo(x - l0 + 24, CHAO);
    ctx.lineTo(x - l0 + 12, CHAO + 14);
    ctx.fill();
  }
  ctx.strokeStyle = '#3f6212';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, CHAO); ctx.lineTo(VW, CHAO); ctx.stroke();

  // passarinho
  const ang = e.fase === 'pronto' ? 0 : Math.max(-0.5, Math.min(e.vy * 0.07, 1.2));
  ctx.save();
  ctx.translate(X, e.y);
  ctx.rotate(ang);
  ctx.fillStyle = '#f97316';
  ctx.strokeStyle = '#7c2d12';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(0, 0, R + 4, R + 1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fed7aa';
  ctx.beginPath(); ctx.ellipse(2, 6, R - 3, R - 7, 0, 0, Math.PI * 2); ctx.fill();
  // asa batendo
  const bate = e.fase === 'fim' ? 0 : Math.sin(e.quadro / 3) * 5;
  ctx.fillStyle = '#fb923c';
  ctx.beginPath(); ctx.ellipse(-6, 1 + bate, 9, 6, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // olho
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(7, -5, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111827';
  ctx.beginPath(); ctx.arc(9, -5, 2.6, 0, Math.PI * 2); ctx.fill();
  // bico
  ctx.fillStyle = '#facc15';
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(25, 3); ctx.lineTo(14, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  if (e.fase !== 'pronto') textoContorno(ctx, String(e.pontos), VW / 2, 70, 52);
  else {
    textoContorno(ctx, 'Voa Voa', VW / 2, 150, 44);
    textoContorno(ctx, 'Toque na tela para voar', VW / 2, 400, 20);
  }
}
