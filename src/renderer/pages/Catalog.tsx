import React, { useMemo, useState } from 'react'
import { Search, RefreshCw, SearchX, X, Monitor, ArrowDownUp } from 'lucide-react'
import { CatalogGame, DownloadTaskProgress, InstalledGame } from '../../shared/types'
import { GameGrid } from '../components/GameGrid'
import { FeaturedHero } from '../components/FeaturedHero'

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

type SortMode = 'recent' | 'az' | 'console'

const FAMILIES: { id: string; label: string }[] = [
  { id: 'ALL', label: 'Todas as toolchains' },
  { id: 'N64Recomp', label: 'N64Recomp' },
  { id: 'PSXRecomp', label: 'PSXRecomp' },
  { id: 'XenonRecomp', label: 'XenonRecomp (X360)' },
  { id: 'AssetExtractor', label: 'Extratores de assets' }
]

const SOURCE_LABEL: Record<CatalogProps['source'], string> = {
  live: 'Sincronizado com o PortsDR',
  cache: 'Mostrando o cache local',
  fallback: 'Lista offline básica'
}

export const Catalog: React.FC<CatalogProps> = ({
  games,
  library,
  downloads,
  source,
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
  const [sortMode, setSortMode] = useState<SortMode>('recent')

  const consoles = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of games) {
      counts.set(g.consoleBadge, (counts.get(g.consoleBadge) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [games])

  const installedById = useMemo(() => {
    const map = new Map<string, InstalledGame>()
    for (const item of library) map.set(item.gameId, item)
    return map
  }, [library])

  const featured = useMemo(
    () =>
      games
        .filter((g) => g.imageUrl && g.platforms.some((p) => p === 'Windows' || p === 'Linux'))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5),
    [games]
  )

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = games.filter((g) => {
      if (onlyDesktopReady) {
        const hasDesktop =
          g.platforms.includes('Windows') ||
          g.platforms.includes('Linux') ||
          g.platforms.includes('macOS')
        if (!hasDesktop) return false
      }
      if (selectedConsole !== 'ALL' && g.consoleBadge !== selectedConsole) return false
      if (selectedFamily !== 'ALL' && g.inferredFamily !== selectedFamily) return false
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

    const sorted = [...list]
    if (sortMode === 'recent') {
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    } else if (sortMode === 'console') {
      sorted.sort(
        (a, b) => a.consoleBadge.localeCompare(b.consoleBadge) || a.title.localeCompare(b.title)
      )
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    }
    return sorted
  }, [games, search, selectedConsole, selectedFamily, onlyDesktopReady, sortMode])

  const hasActiveFilters = search !== '' || selectedConsole !== 'ALL' || selectedFamily !== 'ALL'
  const showHero = !hasActiveFilters && featured.length > 0

  const resetFilters = (): void => {
    setSearch('')
    setSelectedConsole('ALL')
    setSelectedFamily('ALL')
  }

  return (
    <div className="min-h-full steam-main-gradient">
      {showHero && (
        <FeaturedHero
          games={featured}
          installedById={installedById}
          onSelectGame={onSelectGame}
          onQuickAction={onQuickAction}
        />
      )}

      {/* Barra de filtros fixa */}
      <div className="sticky top-0 z-30 bg-[#141b24]/95 backdrop-blur border-b border-[#243448] px-6 py-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-bold text-white tracking-tight">Catálogo PortsDR</h2>
            <span className="text-xs text-[#8f98a0]" aria-live="polite">
              {filteredGames.length} {filteredGames.length === 1 ? 'jogo' : 'jogos'}
            </span>
            <span
              className="hidden lg:inline text-[11px] text-[#67707b]"
              title="De onde vem a lista que você está vendo"
            >
              · {SOURCE_LABEL[source]}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search
                className="w-4 h-4 text-[#67707b] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar jogo, projeto ou console…"
                aria-label="Buscar no catálogo"
                className="w-full pl-9 pr-8 min-h-[34px] bg-[#0e141b] border border-[#2c3b4d] focus:border-[#1a9fff] rounded-md text-xs text-white placeholder-[#67707b] outline-none transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8f98a0] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <label className="relative flex items-center">
              <ArrowDownUp
                className="w-3.5 h-3.5 text-[#67707b] absolute left-2.5 pointer-events-none"
                aria-hidden="true"
              />
              <span className="sr-only">Ordenar por</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="pl-8 pr-2 min-h-[34px] bg-[#0e141b] border border-[#2c3b4d] rounded-md text-xs text-[#dcdedf] outline-none focus:border-[#1a9fff]"
              >
                <option value="recent">Mais recentes</option>
                <option value="az">A–Z</option>
                <option value="console">Por console</option>
              </select>
            </label>

            <button
              type="button"
              aria-pressed={onlyDesktopReady}
              onClick={() => setOnlyDesktopReady(!onlyDesktopReady)}
              className="rh-chip min-h-[34px]"
              title="Mostrar só ports com build para Windows, Linux ou macOS"
            >
              <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
              PC
            </button>

            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Atualizar catálogo de https://portsdr.com/"
              aria-label="Atualizar catálogo"
              className="rh-btn rh-btn-ghost px-3 min-h-[34px] text-[11px] disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#1a9fff]' : ''}`}
                aria-hidden="true"
              />
              <span>Atualizar</span>
            </button>
          </div>
        </div>

        {/* Consoles */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1" role="group" aria-label="Filtrar por console">
          <button
            type="button"
            aria-pressed={selectedConsole === 'ALL'}
            onClick={() => setSelectedConsole('ALL')}
            className="rh-chip"
          >
            Todos <span className="rh-chip-count">{games.length}</span>
          </button>
          {consoles.map((c) => (
            <button
              key={c.name}
              type="button"
              aria-pressed={selectedConsole === c.name}
              onClick={() => setSelectedConsole(c.name)}
              className="rh-chip"
            >
              {c.name} <span className="rh-chip-count">{c.count}</span>
            </button>
          ))}
        </div>

        {/* Toolchains */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" role="group" aria-label="Filtrar por toolchain">
          <span className="text-[#67707b] uppercase tracking-wider font-semibold">Toolchain</span>
          {FAMILIES.map((fam) => (
            <button
              key={fam.id}
              type="button"
              aria-pressed={selectedFamily === fam.id}
              onClick={() => setSelectedFamily(fam.id)}
              className={`pb-0.5 font-semibold border-b-2 transition-colors ${
                selectedFamily === fam.id
                  ? 'text-[#66c0f4] border-[#1a9fff]'
                  : 'text-[#8f98a0] border-transparent hover:text-white'
              }`}
            >
              {fam.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grade */}
      <div className="p-6">
        <GameGrid
          games={filteredGames}
          library={library}
          downloads={downloads}
          hostPlatform={hostPlatform}
          onSelectGame={onSelectGame}
          onQuickAction={onQuickAction}
          emptyState={
            <div className="py-16 px-6 bg-[#16202d] border border-[#263649] rounded-lg text-center space-y-3">
              <SearchX className="w-10 h-10 text-[#66c0f4]/40 mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#dcdedf]">
                Nenhum jogo corresponde aos filtros escolhidos.
              </p>
              <p className="text-xs text-[#8f98a0]">Tente outro nome ou limpe os filtros.</p>
              <button
                type="button"
                onClick={resetFilters}
                className="rh-btn rh-btn-install px-5 min-h-[34px] text-xs"
              >
                Limpar filtros
              </button>
            </div>
          }
        />
      </div>
    </div>
  )
}
