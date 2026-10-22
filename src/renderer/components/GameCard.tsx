import React, { useState } from 'react'
import { Play, Download } from 'lucide-react'
import { CatalogGame, InstalledGame } from '../../shared/types'

interface GameCardProps {
  game: CatalogGame
  installed?: InstalledGame
  isDownloading?: boolean
  downloadProgress?: number
  hostPlatform: string
  onSelect: (game: CatalogGame) => void
  onQuickAction: (game: CatalogGame, e: React.MouseEvent) => void
}

export const GameCard: React.FC<GameCardProps> = ({
  game,
  installed,
  isDownloading,
  downloadProgress,
  hostPlatform,
  onSelect,
  onQuickAction
}) => {
  const [imgError, setImgError] = useState(false)

  const hasNativeLinux = game.platforms.includes('Linux')
  const hasWindows = game.platforms.includes('Windows')
  const usesProton = hostPlatform === 'linux' && !hasNativeLinux && hasWindows

  return (
    <div
      onClick={() => onSelect(game)}
      className="group bg-[#16202d] hover:bg-[#1e2c3d] border border-[#263649] hover:border-[#4b6b8f] rounded-[3px] overflow-hidden flex flex-col justify-between cursor-pointer transition-all duration-150 shadow-md"
    >
      {/* Top Capsule Artwork Area */}
      <div className="relative h-32 w-full bg-[#0e141b] overflow-hidden flex items-center justify-center border-b border-[#223041]">
        {game.imageUrl && !imgError ? (
          <>
            {/* Blurred ambient background fill so icons/squares fill the Steam capsule nicely */}
            <img
              src={game.imageUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover blur-md opacity-35 scale-125 pointer-events-none"
            />
            <img
              src={game.imageUrl}
              alt={game.title}
              onError={() => setImgError(true)}
              className="relative z-10 max-h-24 max-w-[80%] object-contain rounded-[2px] shadow-lg group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
            />
          </>
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-[#1b2838] to-[#101822] flex flex-col items-center justify-center px-3 text-center">
            <span className="text-sm font-bold text-[#67c1f5]/60 uppercase tracking-widest">
              {game.consoleBadge}
            </span>
            <span className="text-[11px] text-[#8f98a0] mt-1 line-clamp-1">
              {game.projectName}
            </span>
          </div>
        )}

        {/* Top-left Console Tag */}
        <span className="absolute top-2 left-2 z-20 px-1.5 py-0.5 bg-[#171a21]/90 border border-[#324458] text-[#67c1f5] text-[10px] font-bold uppercase tracking-wider rounded-[2px]">
          {game.consoleBadge}
        </span>

        {/* Top-right Installed / Proton Indicator */}
        {installed ? (
          <span
            className={`absolute top-2 right-2 z-20 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded-[2px] ${
              installed.status === 'READY_TO_PLAY' || installed.status === 'RUNNING'
                ? 'bg-[#5c7e10] text-white'
                : 'bg-[#b87d14] text-white'
            }`}
          >
            {installed.status === 'RUNNING'
              ? 'RODANDO'
              : installed.status === 'READY_TO_PLAY'
                ? 'PRONTO'
                : 'REQUER ISO'}
          </span>
        ) : usesProton ? (
          <span className="absolute top-2 right-2 z-20 px-1.5 py-0.5 bg-[#171a21]/90 border border-[#3d4c5c] text-[#8f98a0] text-[9px] font-semibold uppercase rounded-[2px]">
            PROTON
          </span>
        ) : null}
      </div>

      {/* Bottom Info & Action Strip */}
      <div className="p-3 flex-1 flex flex-col justify-between bg-[#16202d] group-hover:bg-[#1e2c3d] transition-colors">
        <div>
          <h3 className="text-[13px] font-bold text-[#dcdedf] group-hover:text-white line-clamp-1 leading-tight">
            {game.title}
          </h3>
          <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-[#8f98a0]">
            <span className="truncate">{game.projectName}</span>
            <span className="font-mono text-[10px] text-[#67707b] shrink-0">
              {game.version}
            </span>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-[#233244] flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[#67c1f5] font-semibold truncate">
            {game.inferredFamily}
          </span>

          <button
            onClick={(e) => onQuickAction(game, e)}
            disabled={isDownloading}
            className={`px-2.5 py-1 rounded-[2px] text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 text-white transition-all ${
              isDownloading
                ? 'bg-[#2a475e] text-[#67c1f5] cursor-wait'
                : installed?.status === 'READY_TO_PLAY'
                  ? 'steam-btn-green shadow-sm'
                  : installed?.status === 'NEEDS_ROM'
                    ? 'bg-[#b87d14] hover:bg-[#cf8e19]'
                    : 'steam-btn-blue shadow-sm'
            }`}
          >
            {isDownloading ? (
              <span>{downloadProgress ?? 0}%</span>
            ) : installed ? (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>{installed.status === 'NEEDS_ROM' ? 'ISO' : 'Jogar'}</span>
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                <span>Instalar</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
