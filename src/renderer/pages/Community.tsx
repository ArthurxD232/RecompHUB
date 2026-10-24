import React, { useMemo, useState } from 'react'
import {
  Users,
  Search,
  RefreshCw,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  ExternalLink
} from 'lucide-react'
import {
  CatalogGame,
  DownloadTaskProgress,
  InstalledGame
} from '../../shared/types'
import { GameCard } from '../components/GameCard'
import { SubmitPortModal } from '../components/SubmitPortModal'

interface CommunityProps {
  ports: CatalogGame[]
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

export const Community: React.FC<CommunityProps> = ({
  ports,
  library,
  downloads,
  lastUpdated,
  source,
  isRefreshing,
  hostPlatform,
  onRefresh,
  onSelectGame,
  onQuickAction
}) => {
  const [search, setSearch] = useState('')
  const [selectedConsole, setSelectedConsole] = useState<string>('ALL')
  const [selectedLevel, setSelectedLevel] = useState<string>('ALL')
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false)

  const consoles = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of ports) {
      counts.set(p.consoleBadge, (counts.get(p.consoleBadge) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [ports])

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

  const filteredPorts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ports.filter((p) => {
      if (selectedConsole !== 'ALL' && p.consoleBadge !== selectedConsole) {
        return false
      }

      if (selectedLevel !== 'ALL' && p.verificationLevel !== selectedLevel) {
        return false
      }

      if (q) {
        const portsKeywords = p.ports
          ? p.ports.map((item) => `${item.projectName} ${item.repoFullName}`).join(' ')
          : ''
        const hay =
          `${p.title} ${p.projectName} ${p.repoFullName} ${p.console} ${p.consoleBadge} ${p.submittedBy || ''} ${portsKeywords}`.toLowerCase()
        if (!hay.includes(q)) return false
      }

      return true
    })
  }, [ports, search, selectedConsole, selectedLevel])

  const levelOptions: { id: string; label: string }[] = [
    { id: 'ALL', label: 'TODOS OS SELOS' },
    { id: 'verified', label: '🛡️ VERIFICADOS' },
    { id: 'community', label: '👥 COMUNIDADE' }
  ]

  return (
    <div className="min-h-full steam-main-gradient flex flex-col">
      {/* 1. Steam Hero Artwork Header for Community */}
      <div className="bg-gradient-to-r from-[#142334] via-[#1b2b3d] to-[#121c27] border-b border-[#293d54] px-6 py-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-[2px] bg-[#1a9fff]/20 border border-[#1a9fff]/40 text-[#67c1f5] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                CENTRAL DA COMUNIDADE
              </span>
              <span className="text-[11px] text-[#8f98a0]">
                {ports.length} ports aprovados pela moderação
              </span>
            </div>

            <h1 className="text-xl font-bold uppercase tracking-wide text-white flex items-center gap-2">
              <span>JOGOS &amp; PORTS DA COMUNIDADE</span>
            </h1>

            <p className="text-xs text-[#9eb5ce] max-w-2xl leading-relaxed">
              Ports do GitHub sugeridos pela comunidade para incluir jogos que ainda não estão no catálogo do PortsDR. Qualquer pessoa pode indicar o link do GitHub de um novo port; após a nossa aprovação, o jogo entra automaticamente para todos os usuários do RecompHUB.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setIsSubmitModalOpen(true)}
              className="steam-btn-blue px-4 py-2.5 rounded-[2px] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Sugerir Novo Port</span>
            </button>

            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-2.5 rounded-[2px] bg-[#212f3f] hover:bg-[#2c3d52] border border-[#334b66] text-[#c7d5e0] disabled:opacity-50"
              title="Sincronizar ports da comunidade com o GitHub"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#1a9fff]' : ''}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Steam Shelf Filters Bar */}
      <div className="bg-[#17202c] border-b border-[#253446] px-6 py-2.5 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-[#67707b] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, autor (@) ou projeto..."
              className="w-full pl-9 pr-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-xs text-[#dcdedf] placeholder-[#67707b] outline-none shadow-inner"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-[#8f98a0]">
            <span>Exibindo:</span>
            <strong className="text-white">{filteredPorts.length}</strong>
            <span>de {ports.length} ports</span>
          </div>
        </div>

        {/* Console Filter Sub-tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#222d3a]">
          <button
            onClick={() => setSelectedConsole('ALL')}
            className={`px-2.5 py-1 rounded-[2px] text-[11px] font-bold uppercase tracking-wider transition-colors ${
              selectedConsole === 'ALL'
                ? 'bg-[#1a9fff] text-white shadow-sm'
                : 'bg-[#1e2835] hover:bg-[#273546] text-[#8f98a0] hover:text-white'
            }`}
          >
            Todos ({ports.length})
          </button>

          {consoles.map((c) => (
            <button
              key={c.name}
              onClick={() => setSelectedConsole(c.name)}
              className={`px-2 py-1 rounded-[2px] text-[10px] font-bold uppercase tracking-wider transition-colors ${
                selectedConsole === c.name
                  ? 'bg-[#2a475e] text-[#67c1f5] border border-[#3e6688]'
                  : 'bg-[#1e2835] hover:bg-[#273546] text-[#8f98a0] hover:text-white'
              }`}
            >
              {c.name} ({c.count})
            </button>
          ))}

          {/* Level Filter */}
          <div className="ml-auto flex items-center gap-1">
            {levelOptions.map((lvl) => (
              <button
                key={lvl.id}
                onClick={() => setSelectedLevel(lvl.id)}
                className={`px-2 py-0.5 rounded-[2px] text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  selectedLevel === lvl.id
                    ? 'bg-[#2b4461] text-[#7ebaf5] border border-[#436994]'
                    : 'text-[#8f98a0] hover:text-white'
                }`}
              >
                {lvl.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Community Games Grid */}
      <div className="p-6 flex-1">
        {filteredPorts.length === 0 ? (
          <div className="p-12 bg-[#16202d] border border-[#263649] rounded-[3px] text-center space-y-3">
            <Users className="w-10 h-10 text-[#67c1f5]/40 mx-auto" />
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">
              Nenhum port da comunidade encontrado
            </h3>
            <p className="text-xs text-[#8f98a0] max-w-md mx-auto">
              Nenhum título corresponde aos filtros atuais. Que tal sugerir o primeiro port para esta plataforma?
            </p>
            <div className="pt-2">
              <button
                onClick={() => setIsSubmitModalOpen(true)}
                className="steam-btn-blue px-4 py-2 rounded-[2px] text-white text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 shadow"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Sugerir Novo Port</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
            {filteredPorts.map((game) => {
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

      {/* 4. Submission Modal */}
      <SubmitPortModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
      />
    </div>
  )
}
