import React, { useMemo, useState } from 'react'
import {
  Search,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Check
} from 'lucide-react'
import { CatalogGame, InstalledGame } from '../../shared/types'

export type NavTab = 'catalog' | 'community' | 'library' | 'downloads' | 'settings'

interface SidebarProps {
  games: CatalogGame[]
  library: InstalledGame[]
  selectedGame: CatalogGame | null
  activeTab: NavTab
  onSelectTab: (tab: NavTab) => void
  onSelectGame: (game: CatalogGame | null) => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  games,
  library,
  selectedGame,
  activeTab,
  onSelectTab,
  onSelectGame
}) => {
  const [search, setSearch] = useState('')
  const [consoleFilter, setConsoleFilter] = useState<string>('ALL')
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const installedByGameId = useMemo(() => {
    const map = new Map<string, InstalledGame>()
    for (const item of library) {
      map.set(item.gameId, item)
    }
    return map
  }, [library])

  const isGameInstalled = (g: CatalogGame): boolean => {
    if (installedByGameId.has(g.id)) return true
    if (g.ports && g.ports.some((p) => installedByGameId.has(p.id))) return true
    return false
  }

  const getInstalledForGame = (g: CatalogGame): InstalledGame | undefined => {
    const direct = installedByGameId.get(g.id)
    if (direct) return direct
    if (g.ports) {
      for (const p of g.ports) {
        const found = installedByGameId.get(p.id)
        if (found) return found
      }
    }
    return undefined
  }

  const consoles = useMemo(() => {
    const set = new Set<string>()
    for (const g of games) {
      set.add(g.consoleBadge)
    }
    return Array.from(set).sort()
  }, [games])

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase()
    return games.filter((g) => {
      const installed = isGameInstalled(g)
      if (onlyInstalled && !installed) return false
      if (consoleFilter !== 'ALL' && g.consoleBadge !== consoleFilter) return false
      if (q) {
        const portsText = g.ports
          ? g.ports.map((p) => `${p.projectName} ${p.repoFullName}`).join(' ')
          : ''
        const hay = `${g.title} ${g.projectName} ${portsText}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [games, search, consoleFilter, onlyInstalled, installedByGameId])

  const groupedGames = useMemo(() => {
    const installedList: CatalogGame[] = []
    const byConsole = new Map<string, CatalogGame[]>()

    for (const g of filteredGames) {
      if (isGameInstalled(g)) {
        installedList.push(g)
      }
      const list = byConsole.get(g.consoleBadge) || []
      list.push(g)
      byConsole.set(g.consoleBadge, list)
    }

    const sortedConsoles = Array.from(byConsole.entries()).sort(
      (a, b) => b[1].length - a[1].length
    )

    return {
      installedList,
      sortedConsoles
    }
  }, [filteredGames, installedByGameId])

  const toggleGroup = (key: string): void => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <aside className="w-[270px] shrink-0 h-full bg-[#1e2329] border-r border-[#2a313b] flex flex-col select-none">
      {/* Steam "HOME" + View Switcher Bar */}
      <div className="p-2 bg-[#171a21] border-b border-[#2a313b] space-y-1.5">
        <button
          onClick={() => {
            onSelectGame(null)
            if (activeTab !== 'catalog' && activeTab !== 'library') {
              onSelectTab('catalog')
            }
          }}
          className={`w-full flex items-center justify-between px-3 py-1.5 rounded-sm text-xs font-semibold tracking-wide transition-colors ${
            !selectedGame &&
            (activeTab === 'catalog' ||
              activeTab === 'community' ||
              activeTab === 'library')
              ? 'bg-[#2b3440] text-white'
              : 'bg-[#21262e] text-[#8f98a0] hover:bg-[#282e38] hover:text-[#dcdedf]'
          }`}
        >
          <span className="uppercase tracking-wider text-[11px]">
            Página Inicial
          </span>
          <LayoutGrid className="w-3.5 h-3.5 text-[#1a9fff]" />
        </button>

        {/* Console Dropdown + Installed Toggle */}
        <div className="flex items-center gap-1">
          <select
            value={consoleFilter}
            onChange={(e) => setConsoleFilter(e.target.value)}
            className="flex-1 bg-[#242932] hover:bg-[#2c333e] text-[#dcdedf] text-[11px] font-medium px-2 py-1 rounded-sm border border-[#323a46] focus:outline-none"
          >
            <option value="ALL">TODOS OS CONSOLES ({games.length})</option>
            {consoles.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>

          <button
            onClick={() => setOnlyInstalled(!onlyInstalled)}
            title="Mostrar apenas jogos instalados"
            className={`px-2 py-1 rounded-sm border text-[10px] font-bold uppercase flex items-center gap-1 transition-colors ${
              onlyInstalled
                ? 'bg-[#1a9fff]/20 border-[#1a9fff] text-[#1a9fff]'
                : 'bg-[#242932] border-[#323a46] text-[#8f98a0] hover:text-white'
            }`}
          >
            <Check className="w-3 h-3" />
            <span>Inst.</span>
          </button>
        </div>

        {/* Steam Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#67707b] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome..."
            className="w-full pl-8 pr-2.5 py-1 bg-[#12151a] border border-[#29303b] focus:border-[#1a9fff] rounded-sm text-xs text-[#dcdedf] placeholder-[#67707b] focus:outline-none shadow-inner"
          />
        </div>
      </div>

      {/* Scrollable Steam Game Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Installed Section */}
        {groupedGames.installedList.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => toggleGroup('__INSTALLED__')}
              className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#96a0aa] hover:text-white bg-[#232931]/60 hover:bg-[#2a313b]"
            >
              {collapsedGroups['__INSTALLED__'] ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>INSTALADOS</span>
              <span className="text-[#67707b] font-normal ml-0.5">
                ({groupedGames.installedList.length})
              </span>
            </button>

            {!collapsedGroups['__INSTALLED__'] && (
              <div className="py-0.5">
                {groupedGames.installedList.map((game) => {
                  const inst = getInstalledForGame(game)
                  const isSelected = selectedGame?.id === game.id
                  const isRunning = inst?.status === 'RUNNING'
                  const isReady = inst?.status === 'READY_TO_PLAY'

                  return (
                    <button
                      key={`inst_${game.id}`}
                      onClick={() => onSelectGame(game)}
                      className={`w-full flex items-center gap-2 px-3 py-1 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-[#323e4c] text-white font-medium'
                          : isRunning
                            ? 'text-[#6cc034] hover:bg-[#262d36]'
                            : isReady
                              ? 'text-[#dcdedf] hover:bg-[#262d36]'
                              : 'text-[#e5a93c] hover:bg-[#262d36]'
                      }`}
                    >
                      <div className="w-4 h-4 rounded-[2px] bg-[#12151a] overflow-hidden shrink-0 flex items-center justify-center">
                        {game.imageUrl ? (
                          <img
                            src={game.imageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-[8px] font-bold text-[#67707b]">
                            {game.consoleBadge.slice(0, 2)}
                          </span>
                        )}
                      </div>
                      <span className="truncate flex-1">{game.title}</span>
                      {game.ports && game.ports.length > 1 && (
                        <span className="text-[9px] px-1 py-0.2 bg-[#1b2633] border border-[#2b3e52] text-[#67c1f5] rounded font-mono shrink-0">
                          {game.ports.length}p
                        </span>
                      )}
                      {isRunning && (
                        <span className="text-[9px] uppercase font-bold text-[#6cc034]">
                          Rodando
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Console Categories */}
        {groupedGames.sortedConsoles.map(([consoleName, list]) => {
          const isCollapsed = collapsedGroups[consoleName]
          return (
            <div key={consoleName} className="mb-0.5">
              <button
                onClick={() => toggleGroup(consoleName)}
                className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#8f98a0] hover:text-white bg-[#232931]/40 hover:bg-[#2a313b]"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span className="truncate">{consoleName}</span>
                <span className="text-[#67707b] font-normal ml-0.5">
                  ({list.length})
                </span>
              </button>

              {!isCollapsed && (
                <div className="py-0.5">
                  {list.map((game) => {
                    const inst = getInstalledForGame(game)
                    const isSelected = selectedGame?.id === game.id
                    return (
                      <button
                        key={game.id}
                        onClick={() => onSelectGame(game)}
                        className={`w-full flex items-center gap-2 px-3 py-1 text-left text-[12px] transition-colors ${
                          isSelected
                            ? 'bg-[#323e4c] text-white font-medium'
                            : inst
                              ? 'text-[#dcdedf] hover:bg-[#262d36]'
                              : 'text-[#8f98a0] hover:text-[#c7d5e0] hover:bg-[#262d36]'
                        }`}
                      >
                        <div className="w-4 h-4 rounded-[2px] bg-[#12151a] overflow-hidden shrink-0 flex items-center justify-center opacity-90">
                          {game.imageUrl ? (
                            <img
                              src={game.imageUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-[8px] font-bold text-[#67707b]">
                              {game.consoleBadge.slice(0, 2)}
                            </span>
                          )}
                        </div>
                        <span className="truncate flex-1">{game.title}</span>
                        {game.ports && game.ports.length > 1 && (
                          <span className="text-[9px] px-1 py-0.2 bg-[#1b2633] border border-[#2b3e52] text-[#67c1f5] rounded font-mono shrink-0">
                            {game.ports.length}p
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
