import { CORRE, type EstadoCorre } from '@/lib/jogos/corre';
import { textoContorno } from './desenhoVoa';

function nuvem(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.arc(x + 22, y - 10, 22, 0, Math.PI * 2);
  ctx.arc(x + 46, y, 18, 0, Math.PI * 2);
  ctx.rect(x, y - 2, 46, 20);
  ctx.fill();
}

function tijolos(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, base: string, linha: string, camX: number) {
  ctx.fillStyle = base;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = linha;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const alt = 18;
  for (let y = y0; y < y0 + h; y += alt) {
    ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y);
    const desl = (Math.floor((y - y0) / alt) % 2) * 18;
    const inicio = Math.floor((x0 + camX - desl) / 36) * 36 + desl - camX;
    for (let x = inicio; x < x0 + w; x += 36) {
      if (x > x0) { ctx.moveTo(x, y); ctx.lineTo(x, Math.min(y + alt, y0 + h)); }
    }
  }
  ctx.stroke();
}

export function desenharCorre(ctx: CanvasRenderingContext2D, e: EstadoCorre) {
  const C = CORRE;
  const camX = e.x - C.CAMERA_X;

  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(0, 0, C.VW, C.VH);

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  const n0 = (camX * 0.2) % 260;
  for (let i = -1; i < 3; i++) {
    nuvem(ctx, i * 260 - n0 + 40, 120 + (i % 2) * 50);
    nuvem(ctx, i * 260 - n0 + 180, 250);
  }
  const h0 = (camX * 0.5) % 320;
  for (let i = -1; i < 3; i++) {
    const hx = i * 320 - h0 + 120;
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.ellipse(hx, C.CHAO, 120, 90, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#15803d';
    ctx.beginPath(); ctx.arc(hx - 30, C.CHAO - 50, 4, 0, Math.PI * 2); ctx.arc(hx + 20, C.CHAO - 62, 4, 0, Math.PI * 2); ctx.fill();
  }

  ctx.save();
  ctx.translate(-camX, 0);

  for (const s of e.solidos) {
    if (s.x1 < camX - 10 || s.x0 > camX + C.VW + 10) continue;
    if (s.tipo === 'chao') {
      tijolos(ctx, s.x0, s.topo, s.x1 - s.x0, C.VH - s.topo, '#c2410c', '#7c2d12', 0);
      ctx.fillStyle = '#65a30d';
      ctx.fillRect(s.x0, s.topo, s.x1 - s.x0, 10);
      ctx.fillStyle = '#a3e635';
      ctx.fillRect(s.x0, s.topo, s.x1 - s.x0, 4);
    } else {
      const g = ctx.createLinearGradient(s.x0, 0, s.x1, 0);
      g.addColorStop(0, '#15803d'); g.addColorStop(0.35, '#4ade80'); g.addColorStop(1, '#166534');
      ctx.fillStyle = g;
      ctx.fillRect(s.x0 + 4, s.topo + 14, s.x1 - s.x0 - 8, C.CHAO - s.topo - 14);
      ctx.fillRect(s.x0, s.topo, s.x1 - s.x0, 16);
      ctx.strokeStyle = '#14532d'; ctx.lineWidth = 3;
      ctx.strokeRect(s.x0, s.topo, s.x1 - s.x0, 16);
      ctx.strokeRect(s.x0 + 4, s.topo + 16, s.x1 - s.x0 - 8, C.CHAO - s.topo - 16);
    }
  }

  for (const p of e.plataformas) {
    tijolos(ctx, p.x0, p.y, p.x1 - p.x0, 18, '#ea580c', '#7c2d12', 0);
    ctx.strokeStyle = '#7c2d12'; ctx.lineWidth = 2;
    ctx.strokeRect(p.x0, p.y, p.x1 - p.x0, 18);
  }

  const giro = Math.abs(Math.cos(e.quadro / 8));
  for (const m of e.moedas) {
    if (m.pega) continue;
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(m.x, m.y, Math.max(2, C.MOEDA_R * giro), C.MOEDA_R + 1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (giro > 0.5) { ctx.fillStyle = '#fef08a'; ctx.fillRect(m.x - 1.5, m.y - 5, 3, 10); }
  }

  for (const i of e.inimigos) {
    const L = C.INIMIGO_L; const A = C.INIMIGO_A;
    if (!i.vivo) {
      ctx.fillStyle = '#92400e';
      ctx.fillRect(i.x - L / 2, i.y - 7, L, 7);
      continue;
    }
    const passo = Math.floor(e.quadro / 8) % 2;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(i.x - L / 2 + (passo ? 0 : 3), i.y - 6, 10, 6);
    ctx.fillRect(i.x + L / 2 - 10 - (passo ? 3 : 0), i.y - 6, 10, 6);
    ctx.fillStyle = '#b45309';
    ctx.strokeStyle = '#451a03'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(i.x, i.y - A / 2 - 3, L / 2 + 2, A / 2 + 1, 0, Math.PI, 0); ctx.lineTo(i.x + L / 2, i.y - 5); ctx.lineTo(i.x - L / 2, i.y - 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(i.x - 8, i.y - A + 4, 6, 8); ctx.fillRect(i.x + 2, i.y - A + 4, 6, 8);
    ctx.fillStyle = '#111827';
    ctx.fillRect(i.x - 7, i.y - A + 7, 3, 4); ctx.fillRect(i.x + 3, i.y - A + 7, 3, 4);
    ctx.fillStyle = '#451a03';
    ctx.save(); ctx.translate(i.x, i.y - A + 2);
    ctx.fillRect(-10, 0, 8, 2.5); ctx.fillRect(2, 0, 8, 2.5);
    ctx.restore();
  }

  // boneco
  const px = e.x; const py = e.y;
  const W = C.P_LARG; const H = C.P_ALT;
  const correndo = e.noChao && e.fase === 'jogando';
  const perna = correndo ? Math.floor(e.quadro / 5) % 2 : 0;
  ctx.fillStyle = '#1e3a8a';
  if (e.noChao) {
    ctx.fillRect(px - 9 + (perna ? 3 : 0), py - 10, 7, 10);
    ctx.fillRect(px + 2 - (perna ? 3 : 0), py - 10, 7, 10);
  } else {
    ctx.fillRect(px - 10, py - 12, 7, 9);
    ctx.fillRect(px + 4, py - 9, 7, 9);
  }
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(px - W / 2 + 3, py - 20, W - 6, 11);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(px - W / 2 + 2, py - 27, W - 4, 9);
  ctx.fillStyle = '#fcd34d';
  ctx.fillRect(px - W / 2 + 8, py - 25, 3, 3);
  ctx.fillStyle = '#fdba74';
  ctx.fillRect(px - 8, py - H, 17, 10);
  ctx.fillStyle = '#111827';
  ctx.fillRect(px + 4, py - H + 3, 3, 3);
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(px - 10, py - H - 6, 18, 7);
  ctx.fillRect(px + 2, py - H - 2, 11, 3);
  ctx.strokeStyle = '#14532d'; ctx.lineWidth = 1.5;
  ctx.strokeRect(px - 10, py - H - 6, 18, 7);

  ctx.restore();

  if (e.fase === 'pronto') {
    textoContorno(ctx, 'Corre Corre', C.VW / 2, 170, 44);
    textoContorno(ctx, 'Toque para começar', C.VW / 2, 360, 20);
    textoContorno(ctx, 'Segure para pular mais alto', C.VW / 2, 392, 18);
  } else {
    textoContorno(ctx, String(e.pontos), C.VW / 2, 60, 44);
    ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#a16207'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(24, 30, 8, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    textoContorno(ctx, '× ' + e.qtdMoedas, 38, 31, 20, 'left');
  }
}
