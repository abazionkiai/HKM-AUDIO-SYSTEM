import React from 'react';

interface AppLogoProps {
  className?: string;
  size?: number;
}

export const AppLogo: React.FC<AppLogoProps> = ({ className = 'w-6 h-6', size }) => {
  const style = size ? { width: size, height: size } : undefined;

  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="Church Audio Intelligence Logo"
    >
      <defs>
        <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1E293B" />
          <stop offset="100%" stopColor="#0B0F19" />
        </linearGradient>
        <linearGradient id="logoAccentGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
      </defs>

      {/* Rounded Squircle Shield */}
      <rect
        x="24"
        y="24"
        width="464"
        height="464"
        rx="105"
        fill="url(#logoBgGrad)"
        stroke="#38BDF8"
        strokeWidth="12"
        strokeOpacity="0.5"
      />

      {/* Upper & Lower Acoustic Resonance Arches */}
      <path
        d="M 120 185 A 180 170 0 0 1 392 185"
        stroke="#38BDF8"
        strokeWidth="16"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />
      <path
        d="M 145 325 A 160 160 0 0 0 367 325"
        stroke="#10B981"
        strokeWidth="14"
        strokeLinecap="round"
        strokeOpacity="0.8"
      />

      {/* Left Equalizer Spectrum Waveform */}
      <line x1="90" y1="225" x2="90" y2="280" stroke="#38BDF8" strokeWidth="18" strokeLinecap="round" strokeOpacity="0.6" />
      <line x1="135" y1="200" x2="135" y2="305" stroke="#38BDF8" strokeWidth="20" strokeLinecap="round" strokeOpacity="0.8" />
      <line x1="186" y1="175" x2="186" y2="330" stroke="#38BDF8" strokeWidth="22" strokeLinecap="round" strokeOpacity="0.95" />

      {/* Right Equalizer Spectrum Waveform */}
      <line x1="326" y1="175" x2="326" y2="330" stroke="#10B981" strokeWidth="22" strokeLinecap="round" strokeOpacity="0.95" />
      <line x1="377" y1="200" x2="377" y2="305" stroke="#10B981" strokeWidth="20" strokeLinecap="round" strokeOpacity="0.8" />
      <line x1="422" y1="225" x2="422" y2="280" stroke="#10B981" strokeWidth="18" strokeLinecap="round" strokeOpacity="0.6" />

      {/* Cathedral Acoustic Cross Motif */}
      <line
        x1="256"
        y1="120"
        x2="256"
        y2="390"
        stroke="url(#logoAccentGrad)"
        strokeWidth="40"
        strokeLinecap="round"
      />
      <line
        x1="140"
        y1="210"
        x2="372"
        y2="210"
        stroke="url(#logoAccentGrad)"
        strokeWidth="36"
        strokeLinecap="round"
      />
    </svg>
  );
};
