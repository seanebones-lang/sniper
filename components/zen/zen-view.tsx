'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

interface CurvePoint {
  t: number;
  equity: number;
  pnl: number;
}

interface ZenData {
  startingBudgetUsd: number;
  liveEquityUsd: number;
  netPnlUsd: number;
  realizedPnLUsd: number;
  unrealizedPnLUsd: number;
  fillCount: number;
  points: CurvePoint[];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function formatUsd(n: number, decimals = 2) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatSignedUsd(n: number) {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${formatUsd(Math.abs(n))}`;
}

function useZenData(pollMs = 4000) {
  const [data, setData] = useState<ZenData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/paper/equity-curve', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as ZenData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), pollMs);
    return () => clearInterval(id);
  }, [fetchData, pollMs]);

  return { data, error, refresh: fetchData };
}

function useAnimatedValue(target: number, speed = 0.08) {
  const [display, setDisplay] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const diff = target - current.current;
      if (Math.abs(diff) < 0.005) {
        current.current = target;
        setDisplay(target);
        return;
      }
      current.current = lerp(current.current, target, speed);
      setDisplay(current.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, speed]);

  return display;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: number;
}

function AmbientField({ positive }: { positive: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;
    const particles: Particle[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const seed = () => {
      particles.length = 0;
      const count = Math.floor((w * h) / 9000);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.15,
          vy: -(0.15 + Math.random() * 0.55),
          size: 0.6 + Math.random() * 2.2,
          alpha: 0.08 + Math.random() * 0.35,
          hue: positive ? 140 + Math.random() * 40 : 0 + Math.random() * 20,
        });
      }
    };

    const draw = () => {
      t += 0.004;
      ctx.clearRect(0, 0, w, h);

      const g1 = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, w * 0.55);
      g1.addColorStop(0, positive ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.08)');
      g1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);

      const g2 = ctx.createRadialGradient(w * 0.75, h * 0.65, 0, w * 0.75, h * 0.65, w * 0.45);
      g2.addColorStop(0, positive ? 'rgba(52,211,153,0.08)' : 'rgba(127,29,29,0.06)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);

      const waveY = h * 0.55 + Math.sin(t * 1.2) * 18;
      const wave = ctx.createLinearGradient(0, waveY - 120, 0, waveY + 120);
      wave.addColorStop(0, 'rgba(0,0,0,0)');
      wave.addColorStop(0.5, positive ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.03)');
      wave.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = wave;
      ctx.fillRect(0, waveY - 120, w, 240);

      for (const p of particles) {
        p.x += p.vx + Math.sin(t + p.y * 0.01) * 0.08;
        p.y += p.vy;
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 70%, 60%, ${p.alpha})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    seed();
    draw();
    window.addEventListener('resize', () => {
      resize();
      seed();
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [positive]);

  return <canvas ref={ref} className="absolute inset-0 pointer-events-none" aria-hidden />;
}

function EquityRiver({
  points,
  startingBudget,
  positive,
}: {
  points: CurvePoint[];
  startingBudget: number;
  positive: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const displayRef = useRef<CurvePoint[]>([]);
  const progressRef = useRef(0);

  useEffect(() => {
    displayRef.current = points.map((p) => ({ ...p }));
    progressRef.current = 0;
  }, [points.length]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      progressRef.current = Math.min(1, progressRef.current + 0.012);
      const reveal = easeOutCubic(progressRef.current);

      const display = displayRef.current;
      for (let i = 0; i < display.length && i < points.length; i++) {
        display[i].equity = lerp(display[i].equity, points[i].equity, 0.12);
        display[i].pnl = lerp(display[i].pnl, points[i].pnl, 0.12);
      }
      while (display.length < points.length) {
        const src = points[display.length];
        display.push({ ...src });
      }

      ctx.clearRect(0, 0, w, h);

      if (display.length < 2) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const padX = 32;
      const padY = 48;
      const minT = display[0].t;
      const maxT = display[display.length - 1].t || minT + 1;
      const equities = display.map((p) => p.equity);
      const minE = Math.min(startingBudget, ...equities) * 0.998;
      const maxE = Math.max(startingBudget, ...equities) * 1.002;
      const rangeE = maxE - minE || 1;

      const toX = (t: number) => padX + ((t - minT) / (maxT - minT || 1)) * (w - padX * 2);
      const toY = (e: number) => padY + (1 - (e - minE) / rangeE) * (h - padY * 2);

      const visibleCount = Math.max(2, Math.floor(display.length * reveal));
      const slice = display.slice(0, visibleCount);

      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padY + (i / 4) * (h - padY * 2);
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(w - padX, y);
        ctx.stroke();
      }

      const baselineY = toY(startingBudget);
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(padX, baselineY);
      ctx.lineTo(w - padX, baselineY);
      ctx.stroke();
      ctx.setLineDash([]);

      const fillGrad = ctx.createLinearGradient(0, padY, 0, h - padY);
      if (positive) {
        fillGrad.addColorStop(0, 'rgba(52,211,153,0.22)');
        fillGrad.addColorStop(1, 'rgba(52,211,153,0)');
      } else {
        fillGrad.addColorStop(0, 'rgba(248,113,113,0.15)');
        fillGrad.addColorStop(1, 'rgba(248,113,113,0)');
      }

      ctx.beginPath();
      ctx.moveTo(toX(slice[0].t), toY(slice[0].equity));
      for (let i = 1; i < slice.length; i++) {
        const p0 = slice[i - 1];
        const p1 = slice[i];
        const x0 = toX(p0.t);
        const y0 = toY(p0.equity);
        const x1 = toX(p1.t);
        const y1 = toY(p1.equity);
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
      }
      ctx.lineTo(toX(slice[slice.length - 1].t), h - padY);
      ctx.lineTo(toX(slice[0].t), h - padY);
      ctx.closePath();
      ctx.fillStyle = fillGrad;
      ctx.fill();

      ctx.save();
      ctx.shadowColor = positive ? 'rgba(52,211,153,0.85)' : 'rgba(248,113,113,0.65)';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = positive ? '#34d399' : '#f87171';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(toX(slice[0].t), toY(slice[0].equity));
      for (let i = 1; i < slice.length; i++) {
        const p0 = slice[i - 1];
        const p1 = slice[i];
        const x0 = toX(p0.t);
        const y0 = toY(p0.equity);
        const x1 = toX(p1.t);
        const y1 = toY(p1.equity);
        const cx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
      }
      ctx.stroke();
      ctx.restore();

      const last = slice[slice.length - 1];
      const lx = toX(last.t);
      const ly = toY(last.equity);
      const pulse = 0.5 + Math.sin(Date.now() / 600) * 0.5;
      ctx.beginPath();
      ctx.arc(lx, ly, 4 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = positive ? '#6ee7b7' : '#fca5a5';
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [points, startingBudget, positive]);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    />
  );
}

function GrowthArc({ pct, positive }: { pct: number; positive: boolean }) {
  const r = 118;
  const circ = 2 * Math.PI * r;
  const maxVisual = 30;
  const fill = Math.min(Math.abs(pct) / maxVisual, 1);
  const offset = circ * (1 - fill * 0.75);

  return (
    <svg
      className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 pointer-events-none zen-fade-in"
      width={280}
      height={280}
      viewBox="0 0 280 280"
      aria-hidden
    >
      <circle
        cx={140}
        cy={140}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.04)"
        strokeWidth={3}
      />
      <circle
        cx={140}
        cy={140}
        r={r}
        fill="none"
        stroke={positive ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.45)'}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 140 140)"
        className="zen-arc-glow"
        style={{ transition: 'stroke-dashoffset 1.2s ease-out' }}
      />
    </svg>
  );
}

function MomentumBars({ points, positive }: { points: CurvePoint[]; positive: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const barCount = 40;
    const sample = points.slice(-barCount - 1);
    const deltas: number[] = [];
    for (let i = 1; i < sample.length; i++) {
      deltas.push(sample[i].equity - sample[i - 1].equity);
    }
    while (deltas.length < barCount) deltas.unshift(0);

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const maxAbs = Math.max(0.01, ...deltas.map(Math.abs));
      const barW = w / barCount - 2;
      const t = Date.now() / 1000;

      for (let i = 0; i < barCount; i++) {
        const d = deltas[i];
        const norm = Math.abs(d) / maxAbs;
        const barH = norm * (h * 0.85);
        const x = i * (barW + 2) + 1;
        const up = d >= 0;
        const y = up ? h - barH - 4 : h * 0.5;
        const pulse = 0.85 + Math.sin(t * 2 + i * 0.3) * 0.15;

        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        if (up) {
          grad.addColorStop(0, `rgba(110,231,183,${0.35 * pulse})`);
          grad.addColorStop(1, `rgba(52,211,153,${0.08 * pulse})`);
        } else {
          grad.addColorStop(0, `rgba(248,113,113,${0.25 * pulse})`);
          grad.addColorStop(1, `rgba(248,113,113,0.04)`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH || 2);
      }

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [points, positive]);

  return (
    <canvas
      ref={ref}
      className="hidden lg:block absolute right-8 top-1/2 -translate-y-1/2 w-28 h-48 opacity-60 pointer-events-none"
      aria-hidden
    />
  );
}

function PulseRing({ positive }: { positive: boolean }) {
  return (
    <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 pointer-events-none" aria-hidden>
      <div
        className={`absolute -inset-24 rounded-full border animate-ping opacity-20 ${
          positive ? 'border-emerald-400/40' : 'border-red-400/30'
        }`}
        style={{ animationDuration: '4s' }}
      />
      <div
        className={`absolute -inset-16 rounded-full border animate-pulse opacity-30 ${
          positive ? 'border-emerald-300/30' : 'border-red-300/20'
        }`}
        style={{ animationDuration: '3s' }}
      />
    </div>
  );
}

function StatOrb({
  label,
  value,
  sub,
  delay,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  delay: string;
  positive?: boolean;
}) {
  return (
    <div
      className="zen-stat-orb rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md px-5 py-3 text-center shadow-lg shadow-black/40"
      style={{ animationDelay: delay }}
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">{label}</div>
      <div
        className={`font-mono text-lg tabular-nums ${
          positive === undefined ? 'text-zinc-100' : positive ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-600 mt-0.5 font-mono">{sub}</div>}
    </div>
  );
}

export function ZenView() {
  const { data, error } = useZenData(4000);

  const loading = !data && !error;
  const equity = data?.liveEquityUsd ?? 0;
  const netPnl = data?.netPnlUsd ?? 0;
  const starting = data?.startingBudgetUsd ?? 0;
  const positive = netPnl >= 0;
  const pct = starting > 0 ? (netPnl / starting) * 100 : 0;

  const animEquity = useAnimatedValue(data ? equity : 0, 0.06);
  const animPnl = useAnimatedValue(data ? netPnl : 0, 0.07);
  const animPct = useAnimatedValue(data ? pct : 0, 0.07);


  const points = data?.points ?? [];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#030305] text-zinc-100 select-none">
      <AmbientField positive={positive} />
      {points.length >= 2 && (
        <div className="absolute inset-0 opacity-90">
          <EquityRiver points={points} startingBudget={starting} positive={positive} />
        </div>
      )}
      <GrowthArc pct={animPct} positive={positive} />
      <MomentumBars points={points} positive={positive} />
      <PulseRing positive={positive} />

      <div className="relative z-10 flex flex-col h-full">
        <header className="flex items-center justify-between px-6 py-5">
          <Link
            href="/dashboard"
            className="text-[11px] uppercase tracking-[0.25em] text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            ← exit zen
          </Link>
          <div className="text-[11px] uppercase tracking-[0.35em] text-zinc-600">paper equity</div>
          <div className="w-16" />
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
          {loading && (
            <p className="text-sm text-zinc-500 mb-8 font-mono animate-pulse">Loading paper equity…</p>
          )}
          {error && !data && (
            <p className="text-sm text-red-400/80 mb-8 font-mono">{error}</p>
          )}

          {data && (
          <div className="text-center mb-2">
            <div className="text-xs uppercase tracking-[0.4em] text-zinc-500 mb-4 zen-fade-in">
              total equity
            </div>
            <div
              className={`font-mono font-light tabular-nums tracking-tight zen-hero-number ${
                positive ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              ${formatUsd(animEquity)}
            </div>
            <div
              className={`mt-3 font-mono text-xl sm:text-2xl tabular-nums zen-fade-in-delay ${
                positive ? 'text-emerald-400/90' : 'text-red-400/90'
              }`}
            >
              {formatSignedUsd(animPnl)}
              <span className="text-zinc-500 mx-2">·</span>
              <span>
                {animPct >= 0 ? '+' : ''}
                {animPct.toFixed(2)}%
              </span>
            </div>
          </div>
          )}
        </main>

        <footer className="relative px-6 pb-10">
          <div className="mx-auto max-w-3xl grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <StatOrb
              label="Realized"
              value={formatSignedUsd(data?.realizedPnLUsd ?? 0)}
              positive={(data?.realizedPnLUsd ?? 0) >= 0}
              delay="0ms"
            />
            <StatOrb
              label="Unrealized"
              value={formatSignedUsd(data?.unrealizedPnLUsd ?? 0)}
              positive={(data?.unrealizedPnLUsd ?? 0) >= 0}
              delay="120ms"
            />
            <StatOrb
              label="Starting"
              value={`$${formatUsd(starting, 0)}`}
              sub="paper budget"
              delay="240ms"
            />
            <StatOrb
              label="Fills"
              value={(data?.fillCount ?? 0).toLocaleString()}
              sub="this run"
              delay="360ms"
            />
          </div>
          <p className="text-center text-[10px] text-zinc-700 mt-6 tracking-wide">
            Live mark-to-market · updates every few seconds
          </p>
        </footer>
      </div>
    </div>
  );
}
