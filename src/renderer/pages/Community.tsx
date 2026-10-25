import React, { useMemo, useState } from 'react'
import {
  Users,
  Search,
  RefreshCw,
  PlusCircle,
  ShieldCheck,
  X,
  GitBranch,
  HardDrive,
  Lightbulb
} from 'lucide-react'
import { CatalogGame, DownloadTaskProgress, InstalledGame } from '../../shared/types'
import { GameGrid } from '../components/GameGrid'
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

const STEPS: { icon: React.ReactNode; title: string; text: string }[] = [
  {
    icon: <GitBranch className="w-4 h-4" aria-hidden="true" />,
    title: 'Ports reais do GitHub',
    text: 'Só entram recompilações, descompilações e ports nativos de jogos, com release pronta para Windows ou Linux.'
  },
  {
    icon: <HardDrive className="w-4 h-4" aria-hidden="true" />,
    title: 'A ISO/ROM é sua',
    text: 'Nada de jogo é baixado. Você aponta o seu arquivo e o RecompHUB cuida do resto, igual ao catálogo do PortsDR.'
  },
  {
    icon: <Lightbulb className="w-4 h-4" aria-hidden="true" />,
    title: 'Sugira o próximo',
    text: 'Achou um port que ainda não está aqui? Cole o link do repositório e ele vai para a fila de aprovação.'
  }
]

export const Community: React.FC<CommunityProps> = ({
  ports,
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

  const hasVerified = useMemo(() => ports.some((p) => p.verificationLevel === 'verified'), [ports])

  const filteredPorts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ports.filter((p) => {
      if (selectedConsole !== 'ALL' && p.consoleBadge !== selectedConsole) return false
      if (selectedLevel !== 'ALL' && p.verificationLevel !== selectedLevel) return false
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

  return (
    <div className="min-h-full steam-main-gradient flex flex-col">
      {/* Cabeçalho */}
      <div className="relative overflow-hidden border-b border-[#243448] px-8 py-8">
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(26,159,255,0.22),transparent_60%),linear-gradient(90deg,#142334,#17202b)]"
          aria-hidden="true"
        />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] bg-[#1a9fff]/20 text-[#66c0f4] text-[10px] font-bold uppercase tracking-wider">
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              Central da comunidade · {ports.length} {ports.length === 1 ? 'jogo' : 'jogos'}
            </span>
            <h1 className="text-2xl font-black text-white tracking-tight">Ports da comunidade</h1>
            <p className="text-[13px] text-[#a9bacb] leading-relaxed">
              Ports, recompilações e descompilações do GitHub que ainda não estão no PortsDR. Qualquer
              pessoa pode sugerir um link; depois de aprovado, o jogo aparece aqui para todo mundo.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsSubmitModalOpen(true)}
              className="rh-btn rh-btn-install px-5 min-h-[40px] text-xs"
            >
              <PlusCircle className="w-4 h-4" aria-hidden="true" />
              <span>Sugerir novo port</span>
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Sincronizar ports da comunidade"
              title="Sincronizar ports da comunidade com o GitHub"
              className="rh-btn rh-btn-ghost w-10 min-h-[40px] disabled:opacity-60"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#1a9fff]' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        <ol className="relative grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-3 p-3.5 rounded-lg bg-[#0e141b]/55 ring-1 ring-white/[0.06]"
            >
              <span className="shrink-0 w-8 h-8 rounded-full bg-[#1a9fff]/15 text-[#66c0f4] flex items-center justify-center">
                {step.icon}
              </span>
              <div className="min-w-0">
                <h2 className="text-[12px] font-bold text-white">
                  {i + 1}. {step.title}
                </h2>
                <p className="text-[11.5px] text-[#8f98a0] leading-snug mt-0.5">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Filtros */}
      <div className="sticky top-0 z-30 bg-[#141b24]/95 backdrop-blur border-b border-[#243448] px-6 py-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-[#67707b] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por jogo, projeto ou autor…"
              aria-label="Buscar nos ports da comunidade"
              className="w-full pl-9 pr-8 min-h-[34px] bg-[#0e141b] border border-[#2c3b4d] focus:border-[#1a9fff] rounded-md text-xs text-[#dcdedf] placeholder-[#67707b] outline-none transition-colors"
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

          <span className="text-xs text-[#8f98a0]" aria-live="polite">
            Exibindo <strong className="text-white">{filteredPorts.length}</strong> de {ports.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por console">
          <button
            type="button"
            aria-pressed={selectedConsole === 'ALL'}
            onClick={() => setSelectedConsole('ALL')}
            className="rh-chip"
          >
            Todos <span className="rh-chip-count">{ports.length}</span>
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

          {hasVerified && (
            <button
              type="button"
              aria-pressed={selectedLevel === 'verified'}
              onClick={() => setSelectedLevel(selectedLevel === 'verified' ? 'ALL' : 'verified')}
              className="rh-chip ml-auto"
              title="Mostrar só ports já testados pela equipe"
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Verificados
            </button>
          )}
        </div>
      </div>

      {/* Grade */}
      <div className="p-6 flex-1">
        <GameGrid
          games={filteredPorts}
          library={library}
          downloads={downloads}
          hostPlatform={hostPlatform}
          onSelectGame={onSelectGame}
          onQuickAction={onQuickAction}
          emptyState={
            <div className="py-14 px-6 bg-[#16202d] border border-[#263649] rounded-lg text-center space-y-3">
              <Users className="w-10 h-10 text-[#66c0f4]/40 mx-auto" aria-hidden="true" />
              <h3 className="text-sm font-bold text-white">Nenhum port da comunidade encontrado</h3>
              <p className="text-xs text-[#8f98a0] max-w-md mx-auto">
                Nenhum título corresponde aos filtros atuais. Que tal sugerir o primeiro port para esta plataforma?
              </p>
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(true)}
                className="rh-btn rh-btn-install px-5 min-h-[36px] text-xs"
              >
                <PlusCircle className="w-4 h-4" aria-hidden="true" />
                <span>Sugerir novo port</span>
              </button>
            </div>
          }
        />
      </div>

      <SubmitPortModal isOpen={isSubmitModalOpen} onClose={() => setIsSubmitModalOpen(false)} />
    </div>
  )
}
