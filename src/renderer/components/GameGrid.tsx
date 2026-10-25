import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CatalogGame, DownloadTaskProgress, InstalledGame } from '../../shared/types'
import { findActiveDownload, findInstalled, isInProgress } from '../lib/ui'
import { GameCard } from './GameCard'

interface GameGridProps {
  games: CatalogGame[]
  library: InstalledGame[]
  downloads: DownloadTaskProgress[]
  hostPlatform: string
  onSelectGame: (game: CatalogGame) => void
  onQuickAction: (game: CatalogGame, e: React.MouseEvent) => void
  emptyState: React.ReactNode
}

// Renderiza a grade aos poucos: abrir o catálogo não cria centenas de cards de uma vez
const BATCH_SIZE = 60

export const GameGrid: React.FC<GameGridProps> = ({
  games,
  library,
  downloads,
  hostPlatform,
  onSelectGame,
  onQuickAction,
  emptyState
}) => {
  const [limit, setLimit] = useState(BATCH_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLimit(BATCH_SIZE)
  }, [games])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || limit >= games.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((prev) => Math.min(prev + BATCH_SIZE, games.length))
        }
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [limit, games.length])

  const installedById = useMemo(() => {
    const map = new Map<string, InstalledGame>()
    for (const item of library) map.set(item.gameId, item)
    return map
  }, [library])

  const downloadById = useMemo(() => {
    const map = new Map<string, DownloadTaskProgress>()
    for (const d of downloads) {
      if (isInProgress(d)) map.set(d.gameId, d)
    }
    return map
  }, [downloads])

  if (games.length === 0) return <>{emptyState}</>

  return (
    <>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))' }}
      >
        {games.slice(0, limit).map((game) => {
          const download = findActiveDownload(game, downloadById)
          return (
            <GameCard
              key={game.id}
              game={game}
              installed={findInstalled(game, installedById)}
              isDownloading={Boolean(download)}
              downloadProgress={download?.overallProgress}
              hostPlatform={hostPlatform}
              onSelect={onSelectGame}
              onQuickAction={onQuickAction}
            />
          )
        })}
      </div>
      {limit < games.length && <div ref={sentinelRef} className="h-10" aria-hidden="true" />}
    </>
  )
}
