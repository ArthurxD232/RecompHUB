import React, { useMemo, useState } from 'react'
import { Search, ChevronDown, ChevronRight, Check, X, Home } from 'lucide-react'
import { CatalogGame, InstalledGame } from '../../shared/types'
import { badgeAbbr, consoleColor } from '../lib/ui'

export type NavTab = 'catalog' | 'community' | 'library' | 'downloads' | 'settings'

interface SidebarProps {
  games: CatalogGame[]
  library: InstalledGame[]
  selectedGame: CatalogGame | null
  activeTab: NavTab
  onSelectTab: (tab: NavTab) => void
  onSelectGame: (game: CatalogGame | null) => void
}

interface GameRowProps {
  game: CatalogGame
  installed?: InstalledGame
  isSelected: boolean
  onSelect: (game: CatalogGame) => void
}

const GameRow = React.memo(function GameRow({ game, installed, isSelected, onSelect }: GameRowProps) {
  const isRunning = installed?.status === 'RUNNING'
  const needsRom = installed?.status === 'NEEDS_ROM'
  const accent = consoleColor(game.consoleBadge)

  return (
    <button
      type="button"
      onClick={() => onSelect(game)}
      aria-current={isSelected ? 'true' : undefined}
      className={`relative w-full flex items-center gap-2.5 pl-4 pr-3 py-1.5 text-left text-[12.5px] transition-colors ${
        isSelected
          ? 'bg-[#2a475e]/60 text-white'
          : installed
            ? 'text-[#dcdedf] hover:bg-white/[0.05]'
            : 'text-[#8f98a0] hover:text-[#dcdedf] hover:bg-white/[0.05]'
      }`}
    >
      {isSelected && <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-[#1a9fff]" />}
      <span className="w-6 h-6 rounded-[4px] bg-[#0e141b] overflow-hidden shrink-0 flex items-center justify-center ring-1 ring-white/[0.06]">
        {game.imageUrl ? (
          <img
            src={game.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[8px] font-bold" style={{ color: accent }}>
            {badgeAbbr(game.consoleBadge)}
          </span>
        )}
      </span>
      <span className="truncate flex-1">{game.title}</span>
      {game.ports && game.ports.length > 1 && (
        <span
          className="text-[9px] px-1 rounded bg-[#1b2a3b] text-[#66c0f4] font-mono shrink-0"
          title={`${game.ports.length} ports`}
        >
          {game.ports.length}
        </span>
      )}
      {isRunning ? (
        <span className="text-[9px] uppercase font-bold text-[#75b022] shrink-0">Rodando</span>
      ) : installed ? (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${needsRom ? 'bg-[#e5a93c]' : 'bg-[#75b022]'}`}
          title={needsRom ? 'Instalado — falta a ISO/ROM' : 'Instalado'}
          role="img"
          aria-label={needsRom ? 'Instalado, falta a ISO ou ROM' : 'Instalado'}
        />
      ) : null}
    </button>
  )
})

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
    for (const item of library) map.set(item.gameId, item)
    return map
  }, [library])

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
    for (const g of games) set.add(g.consoleBadge)
    return Array.from(set).sort()
  }, [games])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const installedList: { game: CatalogGame; installed: InstalledGame }[] = []
    const byConsole = new Map<string, { game: CatalogGame; installed?: InstalledGame }[]>()

    for (const g of games) {
      const installed = getInstalledForGame(g)
      if (onlyInstalled && !installed) continue
      if (consoleFilter !== 'ALL' && g.consoleBadge !== consoleFilter) continue
      if (q) {
        const portsText = g.ports ? g.ports.map((p) => `${p.projectName} ${p.repoFullName}`).join(' ') : ''
        const hay = `${g.title} ${g.projectName} ${portsText}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      if (installed) installedList.push({ game: g, installed })
      const list = byConsole.get(g.consoleBadge) || []
      list.push({ game: g, installed })
      byConsole.set(g.consoleBadge, list)
    }

    return {
      installedList,
      sortedConsoles: Array.from(byConsole.entries()).sort((a, b) => b[1].length - a[1].length)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, search, consoleFilter, onlyInstalled, installedByGameId])

  const toggleGroup = (key: string): void => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const isHomeActive =
    !selectedGame && (activeTab === 'catalog' || activeTab === 'community' || activeTab === 'library')

  const renderGroupHeader = (key: string, title: string, count: number): React.ReactNode => {
    const collapsed = Boolean(collapsedGroups[key])
    return (
      <button
        type="button"
        onClick={() => toggleGroup(key)}
        aria-expanded={!collapsed}
        className="sticky top-0 z-10 w-full flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#8f98a0] hover:text-white bg-[#1a212b]/95 backdrop-blur-sm border-y border-white/[0.04]"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <span className="truncate">{title}</span>
        <span className="text-[#5f6b78] font-medium">{count}</span>
      </button>
    )
  }

  return (
    <aside className="w-[272px] shrink-0 h-full bg-[#1a212b] border-r border-[#27323f] flex flex-col select-none">
      <div className="p-3 bg-[#161b23] border-b border-[#27323f] space-y-2">
        <button
          type="button"
          onClick={() => {
            onSelectGame(null)
            if (activeTab !== 'catalog' && activeTab !== 'library' && activeTab !== 'community') {
              onSelectTab('catalog')
            }
          }}
          className={`w-full flex items-center gap-2 px-3 min-h-[34px] rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors ${
            isHomeActive
              ? 'bg-[#2a475e]/70 text-white'
              : 'bg-white/[0.05] text-[#9aa5b1] hover:bg-white/[0.09] hover:text-white'
          }`}
        >
          <Home className="w-3.5 h-3.5 text-[#1a9fff]" aria-hidden="true" />
          Página inicial
        </button>

        <div className="flex items-center gap-1.5">
          <label className="flex-1 min-w-0">
            <span className="sr-only">Filtrar por console</span>
            <select
              value={consoleFilter}
              onChange={(e) => setConsoleFilter(e.target.value)}
              className="w-full min-h-[30px] bg-[#222b37] hover:bg-[#2a3441] text-[#dcdedf] text-[11px] font-medium px-2 rounded-md border border-[#2f3a48] outline-none focus:border-[#1a9fff]"
            >
              <option value="ALL">Todos os consoles ({games.length})</option>
              {consoles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            aria-pressed={onlyInstalled}
            onClick={() => setOnlyInstalled(!onlyInstalled)}
            title="Mostrar apenas jogos instalados"
            className={`px-2 min-h-[30px] rounded-md border text-[10px] font-bold uppercase flex items-center gap-1 transition-colors ${
              onlyInstalled
                ? 'bg-[#1a9fff]/20 border-[#1a9fff] text-[#66c0f4]'
                : 'bg-[#222b37] border-[#2f3a48] text-[#8f98a0] hover:text-white'
            }`}
          >
            <Check className="w-3 h-3" aria-hidden="true" />
            Inst.
          </button>
        </div>

        <div className="relative">
          <Search
            className="w-3.5 h-3.5 text-[#67707b] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar na biblioteca…"
            aria-label="Buscar jogo na lista"
            className="w-full pl-8 pr-7 min-h-[30px] bg-[#10151b] border border-[#2a3541] focus:border-[#1a9fff] rounded-md text-xs text-[#dcdedf] placeholder-[#67707b] outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-[#8f98a0] hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto pb-2" aria-label="Lista de jogos">
        {groups.installedList.length > 0 && (
          <div>
            {renderGroupHeader('__INSTALLED__', 'Instalados', groups.installedList.length)}
            {!collapsedGroups['__INSTALLED__'] &&
              groups.installedList.map(({ game, installed }) => (
                <GameRow
                  key={`inst_${game.id}`}
                  game={game}
                  installed={installed}
                  isSelected={selectedGame?.id === game.id}
                  onSelect={onSelectGame}
                />
              ))}
          </div>
        )}

        {groups.sortedConsoles.map(([consoleName, list]) => (
          <div key={consoleName}>
            {renderGroupHeader(consoleName, consoleName, list.length)}
            {!collapsedGroups[consoleName] &&
              list.map(({ game, installed }) => (
                <GameRow
                  key={game.id}
                  game={game}
                  installed={installed}
                  isSelected={selectedGame?.id === game.id}
                  onSelect={onSelectGame}
                />
              ))}
          </div>
        ))}

        {groups.installedList.length === 0 && groups.sortedConsoles.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-[#67707b]">Nenhum jogo encontrado.</p>
        )}
      </nav>
    </aside>
  )
}
