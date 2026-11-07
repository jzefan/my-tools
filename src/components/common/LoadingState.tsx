import React, { useState, useEffect } from 'react';

export type PixelGridVariant = 'Drive' | 'Dots' | 'Orbit';
export type AccentColor = 'indigo' | 'blue' | 'emerald' | 'amber' | 'slate';

interface PixelGridProps {
  variant?: PixelGridVariant;
  color?: AccentColor;
  className?: string;
  size?: 'sm' | 'md';
}

// Pixel delays calculation matching beautifului.dev
// Drive & Dots: diamond wave traveling from left to right
const driveDelays = Array.from({ length: 9 }, (_, t) => {
  const n = Math.floor(t / 3);
  return (t % 3 + Math.abs(n - 1)) * 90;
});

// Orbit: counter-clockwise ring around center
const orbitRingIndices = [0, 1, 2, 5, 8, 7, 6, 3];
const orbitDelays = Array.from({ length: 9 }, (_, t) => {
  const n = orbitRingIndices.indexOf(t);
  return n === -1 ? null : 110 * n;
});

const variantConfigs: Record<PixelGridVariant, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: driveDelays, dur: 650, round: false },
  Dots: { delays: driveDelays, dur: 650, round: true },
  Orbit: { delays: orbitDelays, dur: 950, round: false },
};

const colorClasses: Record<AccentColor, string> = {
  indigo: 'bg-indigo-600 dark:bg-indigo-400',
  blue: 'bg-blue-600 dark:bg-blue-400',
  emerald: 'bg-emerald-600 dark:bg-emerald-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  slate: 'bg-slate-800 dark:bg-slate-200',
};

const shimmerClassMap: Record<AccentColor, string> = {
  indigo: 'shimmer-text-indigo',
  blue: 'shimmer-text-blue',
  emerald: 'shimmer-text-emerald',
  amber: 'shimmer-text-amber',
  slate: 'shimmer-text',
};

const fallbackColorMap: Record<AccentColor, string> = {
  indigo: '#4f46e5',
  blue: '#2563eb',
  emerald: '#059669',
  amber: '#d97706',
  slate: '#334155',
};

export const PixelGrid: React.FC<PixelGridProps> = ({
  variant = 'Drive',
  color = 'indigo',
  className = '',
  size = 'md',
}) => {
  const config = variantConfigs[variant] || variantConfigs.Drive;
  const isSm = size === 'sm';

  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 ${
        isSm ? 'grid-cols-[repeat(3,4px)] gap-[1.5px]' : 'grid-cols-[repeat(3,5px)] gap-[2px]'
      } ${className}`}
    >
      {config.delays.map((delay, idx) => (
        <span
          key={idx}
          className={`${isSm ? 'size-[4px]' : 'size-[5px]'} ${colorClasses[color]} ${
            config.round ? 'rounded-full' : 'rounded-[1.5px]'
          } inline-block`}
          style={{
            opacity: delay === null ? 0.15 : 0.22,
            animation: delay === null ? 'none' : `pixel-on ${config.dur}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
};

export interface LoadingStateProps {
  label?: string;
  sublabel?: string;
  variant?: PixelGridVariant;
  color?: AccentColor;
  className?: string;
  size?: 'sm' | 'md';
  elapsedSeconds?: number;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  label = '处理中...',
  sublabel,
  variant = 'Drive',
  color = 'indigo',
  className = '',
  size = 'md',
  elapsedSeconds,
}) => {
  const [ticks, setTicks] = useState(0);

  // If elapsedSeconds is not provided externally, maintain internal 100ms timer
  useEffect(() => {
    if (elapsedSeconds !== undefined) return;
    const timer = setInterval(() => setTicks((t) => t + 1), 100);
    return () => clearInterval(timer);
  }, [elapsedSeconds]);

  const sec = elapsedSeconds !== undefined ? elapsedSeconds : ticks / 10;
  const formattedTime =
    sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${(sec % 60).toFixed(1)}s`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col gap-1 ${className}`}
    >
      <div className="flex w-fit items-center gap-2.5">
        <PixelGrid variant={variant} color={color} size={size} />

        <span
          className={`font-semibold tracking-tight inline-block ${
            size === 'sm' ? 'text-xs' : 'text-[13px]'
          } ${shimmerClassMap[color] || 'shimmer-text-indigo'}`}
          style={{
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: fallbackColorMap[color] || '#4f46e5',
          }}
        >
          {label}
        </span>

        <span
          className={`font-mono text-slate-400 dark:text-slate-500 tabular-nums shrink-0 font-medium ${
            size === 'sm' ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {formattedTime}
        </span>
      </div>

      {sublabel && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-[24px]">
          {sublabel}
        </div>
      )}
    </div>
  );
};
