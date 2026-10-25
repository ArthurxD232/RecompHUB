import React from 'react'
import { consoleColor } from '../lib/ui'

interface CoverFallbackProps {
  title: string
  consoleBadge: string
  className?: string
  compact?: boolean
}

/**
 * Capa gerada quando o port não tem imagem (ou ela falhou ao carregar):
 * degradê na cor do fabricante, listras discretas e o nome do jogo.
 */
export const CoverFallback: React.FC<CoverFallbackProps> = ({
  title,
  consoleBadge,
  className = '',
  compact = false
}) => {
  const accent = consoleColor(consoleBadge)
  return (
    <div
      className={`relative w-full h-full overflow-hidden flex items-center justify-center text-center ${className}`}
      style={{
        background: `linear-gradient(135deg, ${accent}40 0%, #131b26 62%, #0d1218 100%)`
      }}
      role="img"
      aria-label={`${title} (${consoleBadge})`}
    >
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          background:
            'repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 14px)'
        }}
        aria-hidden="true"
      />
      <span
        className="absolute -right-2 -bottom-4 font-black tracking-tighter select-none leading-none"
        style={{ color: accent, opacity: 0.18, fontSize: compact ? '3.2rem' : '5.5rem' }}
        aria-hidden="true"
      >
        {consoleBadge}
      </span>
      <span
        className={`relative z-10 px-3 font-black text-white/90 leading-tight tracking-tight line-clamp-3 drop-shadow ${
          compact ? 'text-[11px]' : 'text-[15px]'
        }`}
      >
        {title}
      </span>
    </div>
  )
}
