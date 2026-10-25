import React, { useState } from 'react'
import { Play, Download, Layers, Users, Loader2, AlertTriangle, Circle } from 'lucide-react'
import { CatalogGame, InstalledGame } from '../../shared/types'
import { consoleColor, familyLabel } from '../lib/ui'
import { CoverFallback } from './CoverFallback'

interface GameCardProps {
  game: CatalogGame
  installed?: InstalledGame
  isDownloading?: boolean
  downloadProgress?: number
  hostPlatform: string
  onSelect: (game: CatalogGame) => void
  onQuickAction: (game: CatalogGame, e: React.MouseEvent) => void
}

function GameCardImpl({
  game,
  installed,
  isDownloading,
  downloadProgress,
  hostPlatform,
  onSelect,
  onQuickAction
}: GameCardProps): React.ReactElement {
  const [imgError, setImgError] = useState(false)

  const hasNativeLinux = game.platforms.includes('Linux')
  const hasWindows = game.platforms.includes('Windows')
  const usesProton = hostPlatform === 'linux' && !hasNativeLinux && hasWindows
  const portCount = game.ports?.length ?? 1
  const hasMultiPorts = portCount > 1
  const accent = consoleColor(game.consoleBadge)

  const isPlayable = installed?.status === 'READY_TO_PLAY' || installed?.status === 'RUNNING'
  const needsRom = installed?.status === 'NEEDS_ROM'

  return (
    <article
      onClick={() => onSelect(game)}
      className="rh-capsule group cursor-pointer"
      style={{ ['--accent' as string]: accent }}
    >
      {/* Arte da cápsula */}
      <div className="rh-capsule-art flex items-center justify-center">
        {game.imageUrl && !imgError ? (
          <>
            <img
              src={game.imageUrl}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover blur-xl opacity-40 scale-125 pointer-events-none"
            />
            <img
              src={game.imageUrl}
              alt={game.title}
              onError={() => setImgError(true)}
              loading="lazy"
              decoding="async"
              className="relative z-10 max-h-[6.5rem] max-w-[78%] object-contain rounded-[3px] drop-shadow-[0_6px_14px_rgba(0,0,0,0.55)] transition-transform duration-200 group-hover:scale-105"
            />
          </>
        ) : (
          <CoverFallback title={game.title} consoleBadge={game.consoleBadge} />
        )}

        {/* Faixa de cor do fabricante */}
        <span className="absolute left-0 top-0 bottom-0 w-[3px] z-20" style={{ background: accent }} />

        {/* Console */}
        <span className="absolute top-2 left-3 z-20 px-1.5 py-0.5 rounded-[3px] bg-[#0d1218]/85 text-[10px] font-bold uppercase tracking-wider text-[#c7d5e0] backdrop-blur-[2px]">
          {game.consoleBadge}
        </span>

        {/* Estado */}
        {installed ? (
          <span
            className={`absolute top-2 right-2 z-20 px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${
              isPlayable ? 'bg-[#4a6b12] text-white' : 'bg-[#a8710f] text-white'
            }`}
          >
            {isPlayable ? (
              <Circle className="w-2 h-2 fill-current" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
            )}
            {installed.status === 'RUNNING' ? 'Rodando' : isPlayable ? 'Instalado' : 'Requer ISO'}
          </span>
        ) : usesProton ? (
          <span
            title="Só tem build Windows: roda no Linux via Proton / umu-run"
            className="absolute top-2 right-2 z-20 px-1.5 py-0.5 rounded-[3px] bg-[#0d1218]/85 text-[9px] font-semibold uppercase text-[#8f98a0]"
          >
            Proton
          </span>
        ) : null}

        {/* Comunidade / vários ports */}
        {(game.isCommunity || hasMultiPorts) && (
          <div className="absolute bottom-2 left-3 z-20 flex items-center gap-1.5">
            {game.isCommunity && (
              <span
                className="px-1.5 py-0.5 rounded-[3px] bg-[#142a40]/90 text-[#7ebaf5] text-[9px] font-bold uppercase tracking-wider flex items-center gap-1"
                title={`Port da comunidade${game.submittedBy ? ` — ${game.submittedBy}` : ''}`}
              >
                <Users className="w-2.5 h-2.5" aria-hidden="true" />
                Comunidade
              </span>
            )}
            {hasMultiPorts && (
              <span
                className="px-1.5 py-0.5 rounded-[3px] bg-[#142a40]/90 text-[#66c0f4] text-[9px] font-bold uppercase tracking-wider flex items-center gap-1"
                title={`${portCount} ports diferentes deste jogo`}
              >
                <Layers className="w-2.5 h-2.5" aria-hidden="true" />
                {portCount} ports
              </span>
            )}
          </div>
        )}

        {/* Ícone que aparece ao passar o mouse */}
        <div className="rh-capsule-play" aria-hidden="true">
          <span className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/30 flex items-center justify-center text-white">
            {isPlayable ? (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            ) : (
              <Download className="w-5 h-5" />
            )}
          </span>
        </div>

        {/* Progresso da instalação */}
        {isDownloading && (
          <div className="absolute bottom-0 left-0 right-0 h-1 z-30 bg-black/50">
            <div
              className="h-full bg-[#1a9fff] transition-[width] duration-200"
              style={{ width: `${downloadProgress ?? 0}%` }}
            />
          </div>
        )}
      </div>

      {/* Informações + ação */}
      <div className="p-3 flex-1 flex flex-col justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold text-[#e6e9ec] leading-snug line-clamp-2 min-h-[2.15rem]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSelect(game)
              }}
              className="text-left focus-visible:underline"
            >
              {game.title}
            </button>
          </h3>
          <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-[#8f98a0]">
            <span className="truncate">
              {game.projectName}
              {hasMultiPorts ? ` (+${portCount - 1})` : ''}
            </span>
            <span className="font-mono text-[10px] text-[#67707b] shrink-0">{game.version}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[#66c0f4]/80 font-semibold truncate">
            {familyLabel(game.inferredFamily)}
          </span>

          <button
            type="button"
            onClick={(e) => onQuickAction(game, e)}
            disabled={isDownloading}
            aria-label={
              isDownloading
                ? `Instalando ${game.title}`
                : isPlayable
                  ? `Jogar ${game.title}`
                  : needsRom
                    ? `Escolher ISO de ${game.title}`
                    : `Instalar ${game.title}`
            }
            className={`rh-btn px-3 min-h-[28px] text-[11px] ${
              isDownloading
                ? 'bg-[#2a475e] !text-[#66c0f4] cursor-wait'
                : isPlayable
                  ? 'rh-btn-play'
                  : needsRom
                    ? 'rh-btn-warn'
                    : 'rh-btn-install'
            }`}
          >
            {isDownloading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                <span>{downloadProgress ?? 0}%</span>
              </>
            ) : installed ? (
              <>
                <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                <span>{needsRom ? 'ISO' : 'Jogar'}</span>
              </>
            ) : (
              <>
                <Download className="w-3 h-3" aria-hidden="true" />
                <span>Instalar</span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  )
}

// Atualizações de progresso de download (várias por segundo) só renderizam o card afetado
export const GameCard = React.memo(GameCardImpl)
