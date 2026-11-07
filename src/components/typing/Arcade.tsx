import { useEffect, useRef } from 'react';
import { FINGER_COLOR, targetForChar } from '../../typing/keyboard';
import type { PlayMode } from '../../typing/types';

interface ArcadeProps {
  mode: Exclude<PlayMode, 'focus'>;
  glyph: string;
  hitTick: number;
  missTick: number;
  hitChar: string;
  active: boolean;
  onBreach: () => void;
}

interface Block {
  y: number;
  vy: number;
  x: number;
  color: string;
}

interface Sim {
  mode: Exclude<PlayMode, 'focus'>;
  glyph: string;
  hitTick: number;
  missTick: number;
  active: boolean;
  shake: number;
  mole: number;
  moleY: number;
  enemyY: number;
  breached: boolean;
  laser: number;
  blocks: Block[];
  reduce: boolean;
  onBreach: () => void;
}

export function Arcade({ mode, glyph, hitTick, missTick, hitChar, active, onBreach }: ArcadeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim>({
    mode,
    glyph,
    hitTick: 0,
    missTick: 0,
    active: false,
    shake: 0,
    mole: 0,
    moleY: 0,
    enemyY: 36,
    breached: false,
    laser: 0,
    blocks: [],
    reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    onBreach,
  });

  useEffect(() => {
    const sim = simRef.current;
    sim.mode = mode;
    sim.glyph = glyph;
    sim.active = active;
    sim.onBreach = onBreach;
    if (hitTick !== sim.hitTick) {
      sim.hitTick = hitTick;
      sim.laser = 1;
      sim.mole = hitTick % 6;
      sim.moleY = sim.reduce ? 1 : 0.2;
      if (mode === 'shooter') sim.enemyY = 28;
      if (mode === 'tower' && hitChar) {
        const finger = targetForChar(hitChar).finger;
        sim.blocks.push({
          y: 24,
          vy: 0,
          x: (Math.random() - 0.5) * 16,
          color: finger ? FINGER_COLOR[finger] : '#4f46e5',
        });
        if (sim.blocks.length > 14) sim.blocks.shift();
      }
    }
    if (missTick !== sim.missTick) {
      sim.missTick = missTick;
      sim.shake = sim.reduce ? 0 : 10;
    }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sim = simRef.current;
    sim.blocks = [];
    sim.enemyY = 28;
    sim.moleY = 0;
    let frame = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      step(sim, dt, rect.height || 1);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(ctx, sim, rect.width, rect.height);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  return (
    <div className="relative h-full min-h-0 w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

function step(sim: Sim, dt: number, height: number) {
  if (sim.shake > 0) sim.shake = Math.max(0, sim.shake - dt * 30);
  if (sim.laser > 0) sim.laser = Math.max(0, sim.laser - dt * 3);
  sim.moleY += (1 - sim.moleY) * Math.min(1, dt * 7);
  if (sim.mode === 'shooter' && sim.active) {
    sim.enemyY += (sim.reduce ? 70 : 46) * dt;
    if (sim.enemyY > height - 72) {
      if (!sim.breached) {
        sim.breached = true;
        sim.onBreach();
      }
      sim.enemyY = 28;
    } else if (sim.enemyY < 70) {
      sim.breached = false;
    }
  }
  if (sim.mode === 'tower') {
    const base = height - 28;
    sim.blocks.forEach((block, index) => {
      const target = base - (index + 1) * 18;
      if (sim.reduce) {
        block.y = target;
        block.vy = 0;
        return;
      }
      const accel = (target - block.y) * 80 - block.vy * 14;
      block.vy += accel * dt;
      block.y += block.vy * dt * 60;
    });
  }
}

function draw(ctx: CanvasRenderingContext2D, sim: Sim, width: number, height: number) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (sim.shake > 0) ctx.translate((Math.random() - 0.5) * sim.shake, 0);
  if (sim.mode === 'mole') drawMole(ctx, sim, width, height, dark);
  if (sim.mode === 'shooter') drawShooter(ctx, sim, width, height, dark);
  if (sim.mode === 'tower') drawTower(ctx, sim, width, height, dark);
  ctx.restore();
}

function drawMole(ctx: CanvasRenderingContext2D, sim: Sim, width: number, height: number, dark: boolean) {
  const holes = [
    [0.22, 0.36], [0.5, 0.36], [0.78, 0.36],
    [0.22, 0.72], [0.5, 0.72], [0.78, 0.72],
  ];
  holes.forEach(([x, y], index) => {
    const cx = x * width;
    const cy = y * height;
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 16, 36, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    if (index !== sim.mole) return;
    const rise = 22 * sim.moleY;
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 16 - rise, 22, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sim.glyph, cx, cy + 16 - rise);
  });
}

function drawShooter(ctx: CanvasRenderingContext2D, sim: Sim, width: number, height: number, dark: boolean) {
  const shipX = width / 2;
  const shipY = height - 36;
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.28)';
  for (let index = 0; index < 18; index += 1) {
    const x = ((index * 97) % Math.max(1, width));
    const y = (index * 53 + sim.enemyY) % Math.max(1, height);
    ctx.fillRect(x, y, 2, 2);
  }
  if (sim.laser > 0) {
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shipX, shipY - 16);
    ctx.lineTo(shipX, sim.enemyY + 16);
    ctx.stroke();
  }
  roundBox(ctx, shipX - 28, sim.enemyY, 56, 36, 8, '#4f46e5');
  ctx.fillStyle = '#fff';
  ctx.font = '700 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sim.glyph, shipX, sim.enemyY + 18);
  ctx.fillStyle = dark ? '#e2e8f0' : '#334155';
  ctx.beginPath();
  ctx.moveTo(shipX, shipY - 18);
  ctx.lineTo(shipX - 16, shipY + 8);
  ctx.lineTo(shipX + 16, shipY + 8);
  ctx.closePath();
  ctx.fill();
}

function drawTower(ctx: CanvasRenderingContext2D, sim: Sim, width: number, height: number, dark: boolean) {
  const ground = height - 22;
  ctx.strokeStyle = dark ? '#334155' : '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(width * 0.28, ground);
  ctx.lineTo(width * 0.72, ground);
  ctx.stroke();
  sim.blocks.forEach((block) => {
    roundBox(ctx, width / 2 + block.x - 28, block.y, 56, 16, 3, block.color);
  });
  ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(sim.glyph, width / 2, 28);
}

function roundBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}
