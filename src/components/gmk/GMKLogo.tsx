import React from 'react';

interface GMKLogoProps {
  size?: number | string;
  className?: string;
  id?: string;
}

/**
 * Official GMK Community Logo:
 * Forest Green rounded-square emblem with three gold/champagne sparkle stars.
 * Matches /public/favicon.svg and /public/pwa-192x192.png.
 */
export const GMKLogo: React.FC<GMKLogoProps> = ({ 
  size = 48, 
  className = '', 
  id = 'gmk-official-logo' 
}) => {
  return (
    <svg 
      id={id}
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 64 64" 
      width={size} 
      height={size}
      className={`inline-block shrink-0 ${className}`}
      aria-label="Greens Malayalee Kootayama Official Logo"
    >
      <defs>
        <linearGradient id="gmkGradLogo" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f4c2a" />
          <stop offset="100%" stopColor="#125831" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="18" fill="url(#gmkGradLogo)" />
      {/* Primary Gold Sparkle Star */}
      <path fill="#d4af37" d="M32 10 L35.8 24.2 L50 28 L35.8 31.8 L32 46 L28.2 31.8 L14 28 L28.2 24.2 Z" />
      {/* Secondary Light Gold Sparkle Star */}
      <path fill="#f0d375" d="M47 38 L48.8 44.2 L55 46 L48.8 47.8 L47 54 L45.2 47.8 L39 46 L45.2 44.2 Z" />
      {/* Accent Gold Sparkle Star */}
      <path fill="#d4af37" opacity="0.8" d="M18 12 L19.2 16.8 L24 18 L19.2 19.2 L18 24 L16.8 19.2 L12 18 L16.8 16.8 Z" />
    </svg>
  );
};

export default GMKLogo;
