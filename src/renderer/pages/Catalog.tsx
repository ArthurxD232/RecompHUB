import React, { useMemo, useState } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import {
  CatalogGame,
  DownloadTaskProgress,
  InstalledGame
} from '../../shared/types'
import { GameCard } from '../components/GameCard'

interface CatalogProps {
  games: CatalogGame[]
  library: InstalledGame[]
  downloads: DownloadTaskProgress[]
  lastUpdated: string
  source: 'live' | 'cache' | 'fallback'
  isRefreshing: boolean
  hostPlatform: string
  onRefresh: () => void
  onSelectGame: (game: CatalogGame) => void
  onQuickAction: (game: CatalogGame, e: React.MouseEvent) => void
}

export const Catalog: React.FC<CatalogProps> = ({
  games,
  library,
  downloads,
  isRefreshing,
  hostPlatform,
  onRefresh,
  onSelectGame,
  onQuickAction
}) => {
  const [search, setSearch] = useState('')
  const [selectedConsole, setSelectedConsole] = useState<string>('ALL')
  const [selectedFamily, setSelectedFamily] = useState<string>('ALL')
  const [onlyDesktopReady, setOnlyDesktopReady] = useState<boolean>(true)

  const consoles = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of games) {
      counts.set(g.consoleBadge, (counts.get(g.consoleBadge) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [games])

  const installedByGameId = useMemo(() => {
    const map = new Map<string, InstalledGame>()
    for (const item of library) {
      map.set(item.gameId, item)
    }
    return map
  }, [library])

  const activeDownloadByGameId = useMemo(() => {
    const map = new Map<string, DownloadTaskProgress>()
    for (const d of downloads) {
      if (!['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR'].includes(d.stage)) {
        map.set(d.gameId, d)
      }
    }
    return map
  }, [downloads])

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase()
    return games.filter((g) => {
      if (onlyDesktopReady) {
        const hasDesktop =
          g.platforms.includes('Windows') ||
          g.platforms.includes('Linux') ||
          g.platforms.includes('macOS')
        if (!hasDesktop) return false
      }

      if (selectedConsole !== 'ALL' && g.consoleBadge !== selectedConsole) {
        return false
      }

      if (selectedFamily !== 'ALL' && g.inferredFamily !== selectedFamily) {
        return false
      }

      if (q) {
        const portsKeywords = g.ports
          ? g.ports.map((p) => `${p.projectName} ${p.repoFullName}`).join(' ')
          : ''
        const hay =
          `${g.title} ${g.projectName} ${g.repoFullName} ${g.console} ${g.consoleBadge} ${portsKeywords}`.toLowerCase()
        if (!hay.includes(q)) return false
      }

      return true
    })
  }, [games, search, selectedConsole, selectedFamily, onlyDesktopReady])

  const families: { id: string; label: string }[] = [
    { id: 'ALL', label: 'TODAS AS TOOLCHAINS' },
    { id: 'N64Recomp', label: 'N64RECOMP' },
    { id: 'PSXRecomp', label: 'PSXRECOMP' },
    { id: 'XenonRecomp', label: 'XENONRECOMP (X360)' },
    { id: 'AssetExtractor', label: 'EXTRATORES DE ASSETS' }
  ]

  return (
    <div className="min-h-full steam-main-gradient">
      {/* Steam Subheader Filter Bar */}
      <div className="sticky top-0 z-30 bg-[#171d25]/95 backdrop-blur-sm border-b border-[#2a3846] px-6 py-3 space-y-2.5 shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">
              CATÁLOGO PORTSDR
            </h2>
            <span className="text-xs text-[#67c1f5] font-mono">
              ({filteredGames.length} títulos)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-[#67707b] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar catálogo..."
                className="w-full pl-8 pr-3 py-1 bg-[#10151c] border border-[#2c3b4d] focus:border-[#1a9fff] rounded-[2px] text-xs text-white placeholder-[#67707b] focus:outline-none"
              />
            </div>

            <button
              onClick={() => setOnlyDesktopReady(!onlyDesktopReady)}
              className={`px-2.5 py-1 rounded-[2px] text-[11px] font-bold uppercase border transition-colors ${
                onlyDesktopReady
                  ? 'bg-[#2a475e] border-[#416b8c] text-[#67c1f5]'
                  : 'bg-[#1f2732] border-[#2c3847] text-[#8f98a0]'
              }`}
            >
              PC (WIN / LINUX)
            </button>

            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Atualizar catálogo de https://portsdr.com/"
              className="px-2.5 py-1 rounded-[2px] bg-[#24313f] hover:bg-[#2f4052] border border-[#35485c] text-[11px] font-bold uppercase text-[#c7d5e0] flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-[#1a9fff]' : ''}`}
              />
              <span>Atualizar</span>
            </button>
          </div>
        </div>

        {/* Console Tabs Row */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          <button
            onClick={() => setSelectedConsole('ALL')}
            className={`px-2.5 py-1 rounded-[2px] text-[11px] font-bold uppercase tracking-wide shrink-0 transition-colors ${
              selectedConsole === 'ALL'
                ? 'bg-[#1a9fff] text-white'
                : 'bg-[#212b36] text-[#8f98a0] hover:bg-[#2a3846] hover:text-white'
            }`}
          >
            TODOS ({games.length})
          </button>
          {consoles.map((c) => (
            <button
              key={c.name}
              onClick={() => setSelectedConsole(c.name)}
              className={`px-2.5 py-1 rounded-[2px] text-[11px] font-bold uppercase tracking-wide shrink-0 transition-colors ${
                selectedConsole === c.name
                  ? 'bg-[#1a9fff] text-white'
                  : 'bg-[#212b36] text-[#8f98a0] hover:bg-[#2a3846] hover:text-white'
              }`}
            >
              {c.name}{' '}
              <span className="text-[10px] opacity-75 font-normal">
                ({c.count})
              </span>
            </button>
          ))}
        </div>

        {/* Toolchain Sub-tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#222d3a]">
          {families.map((fam) => (
            <button
              key={fam.id}
              onClick={() => setSelectedFamily(fam.id)}
              className={`px-2 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider transition-colors ${
                selectedFamily === fam.id
                  ? 'bg-[#2a475e] text-[#67c1f5] border border-[#3e6688]'
                  : 'text-[#8f98a0] hover:text-white'
              }`}
            >
              {fam.label}
            </button>
          ))}
        </div>
      </div>

      {/* Steam Shelf Grid */}
      <div className="p-6">
        {filteredGames.length === 0 ? (
          <div className="p-10 bg-[#16202d] border border-[#263649] rounded-[3px] text-center space-y-2">
            <p className="text-xs font-semibold text-[#c7d5e0]">
              Nenhum título corresponde aos filtros selecionados.
            </p>
            <button
              onClick={() => {
                setSearch('')
                setSelectedConsole('ALL')
                setSelectedFamily('ALL')
              }}
              className="text-xs text-[#67c1f5] hover:underline"
            >
              Redefinir filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
            {filteredGames.map((game) => {
              const inst =
                installedByGameId.get(game.id) ||
                game.ports?.map((p) => installedByGameId.get(p.id)).find(Boolean)
              const dl =
                activeDownloadByGameId.get(game.id) ||
                game.ports?.map((p) => activeDownloadByGameId.get(p.id)).find(Boolean)
              return (
                <GameCard
                  key={game.id}
                  game={game}
                  installed={inst}
                  isDownloading={Boolean(dl)}
                  downloadProgress={dl?.overallProgress}
                  hostPlatform={hostPlatform}
                  onSelect={onSelectGame}
                  onQuickAction={onQuickAction}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
