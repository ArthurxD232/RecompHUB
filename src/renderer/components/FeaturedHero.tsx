import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Info, Play, Sparkles } from 'lucide-react'
import { CatalogGame, InstalledGame } from '../../shared/types'
import { consoleColor, familyLabel, formatDateShort } from '../lib/ui'
import { CoverFallback } from './CoverFallback'

interface FeaturedHeroProps {
  games: CatalogGame[]
  installedById: Map<string, InstalledGame>
  onSelectGame: (game: CatalogGame) => void
  onQuickAction: (game: CatalogGame, e: React.MouseEvent) => void
  label?: string
}

export const FeaturedHero: React.FC<FeaturedHeroProps> = ({
  games,
  installedById,
  onSelectGame,
  onQuickAction,
  label = 'Atualizado recentemente'
}) => {
  const [index, setIndex] = useState(0)
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    if (index >= games.length) setIndex(0)
  }, [games.length, index])

  useEffect(() => {
    setImgFailed(false)
  }, [index, games])

  if (games.length === 0) return null

  const game = games[Math.min(index, games.length - 1)]
  const installed = installedById.get(game.id) || game.ports?.map((p) => installedById.get(p.id)).find(Boolean)
  const accent = consoleColor(game.consoleBadge)
  const isPlayable = installed?.status === 'READY_TO_PLAY' || installed?.status === 'RUNNING'
  const showImage = Boolean(game.imageUrl) && !imgFailed

  const go = (delta: number): void => setIndex((i) => (i + delta + games.length) % games.length)

  return (
    <section
      aria-roledescription="carrossel"
      aria-label="Jogos em destaque"
      className="relative overflow-hidden border-b border-[#223245] bg-[#10161e]"
    >
      {showImage && (
        <div
          className="rh-hero-backdrop"
          style={{ backgroundImage: `url("${game.imageUrl}")` }}
          aria-hidden="true"
        />
      )}
      <div className="rh-hero-fade" aria-hidden="true" />

      <div className="relative z-10 px-8 pt-7 pb-4 flex items-center gap-8">
        <div
          className="hidden sm:flex shrink-0 w-[188px] h-[188px] rounded-xl bg-[#0b1017]/80 ring-1 ring-white/10 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] items-center justify-center overflow-hidden"
          style={{ boxShadow: `0 18px 40px -12px rgba(0,0,0,.8), 0 0 0 1px ${accent}33` }}
        >
          {showImage ? (
            <img
              src={game.imageUrl}
              alt={game.title}
              onError={() => setImgFailed(true)}
              className="max-w-[88%] max-h-[88%] object-contain"
            />
          ) : (
            <CoverFallback title={game.title} consoleBadge={game.consoleBadge} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] bg-[#1a9fff]/20 text-[#66c0f4] text-[10px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {label}
              {game.updatedAt ? ` · ${formatDateShort(game.updatedAt)}` : ''}
            </span>
            <span
              className="px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider text-white"
              style={{ background: `${accent}55` }}
            >
              {game.consoleBadge}
            </span>
            <span className="px-2 py-0.5 rounded-[3px] bg-white/10 text-[#c7d5e0] text-[10px] font-semibold uppercase tracking-wider">
              {familyLabel(game.inferredFamily)}
            </span>
            {game.platforms
              .filter((p) => p !== 'Android')
              .map((p) => (
                <span key={p} className="text-[10px] font-semibold text-[#8f98a0] uppercase tracking-wider">
                  {p}
                </span>
              ))}
          </div>

          <h2 className="text-[28px] leading-tight font-black text-white tracking-tight line-clamp-2">
            {game.title}
          </h2>
          <p className="text-xs text-[#8f98a0] mt-1">
            {game.projectName}
            {game.ports && game.ports.length > 1 ? ` e mais ${game.ports.length - 1} port(s)` : ''}
            {' · '}
            <span className="font-mono">{game.version}</span>
          </p>
          {game.description && (
            <p className="text-[13px] text-[#b8c4d0] leading-relaxed mt-3 max-w-2xl line-clamp-2">
              {game.description}
            </p>
          )}

          <div className="flex items-center gap-2.5 mt-5">
            <button
              type="button"
              onClick={(e) => onQuickAction(game, e)}
              className={`rh-btn px-6 min-h-[38px] text-xs ${isPlayable ? 'rh-btn-play' : 'rh-btn-install'}`}
            >
              {isPlayable ? (
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              ) : (
                <Download className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{isPlayable ? 'Jogar' : installed ? 'Vincular ISO' : 'Instalar'}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectGame(game)}
              className="rh-btn rh-btn-ghost px-5 min-h-[38px] text-xs"
            >
              <Info className="w-4 h-4" aria-hidden="true" />
              <span>Ver detalhes</span>
            </button>
          </div>
        </div>

        {games.length > 1 && (
          <div className="hidden md:flex flex-col gap-2 self-start">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Destaque anterior"
              className="w-8 h-8 rounded-full bg-black/35 hover:bg-black/60 ring-1 ring-white/10 flex items-center justify-center text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Próximo destaque"
              className="w-8 h-8 rounded-full bg-black/35 hover:bg-black/60 ring-1 ring-white/10 flex items-center justify-center text-white transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {games.length > 1 && (
        <div className="relative z-10 px-8 pb-3 flex items-center" role="tablist" aria-label="Escolher destaque">
          {games.map((g, i) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={g.title}
              title={g.title}
              onClick={() => setIndex(i)}
              className="group py-2.5 px-[3px]"
            >
              <span
                className={`block h-1.5 rounded-full transition-all duration-200 ${
                  i === index ? 'w-8 bg-[#1a9fff]' : 'w-3 bg-white/25 group-hover:bg-white/50'
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
