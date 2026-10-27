import React, { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Download,
  Play,
  Square,
  FolderOpen,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  RefreshCw,
  Trash2,
  FolderSearch,
  Archive,
  Settings2,
  Maximize2,
  Minimize2,
  X,
  Layers,
  Cpu,
  Sparkles,
  AlertCircle,
  XCircle,
  Package,
  FilePlus2,
  FolderPlus,
  Folder
} from 'lucide-react'
import { CoverFallback } from './CoverFallback'
import { familyLabel } from '../lib/ui'
import { genericIsoRequirement } from '../../shared/requirements'
import {
  CatalogGame,
  DownloadTaskProgress,
  InstalledGame,
  ResolvedReleaseInfo,
  RomAvailabilityStatus,
  RomRequirement,
  RomVaultEntry,
  UninstallGameOptions
} from '../../shared/types'

/** `file` está dentro de `folder`? (compara sem diferenciar \ de /, e sem maiúsculas no Windows) */
function isInsideFolder(file: string, folder: string): boolean {
  if (!folder) return false
  const norm = (p: string): string => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[a-z]:/i.test(s) ? s.toLowerCase() : s
  }
  return norm(file).startsWith(norm(folder) + '/')
}

interface GameModalProps {
  game: CatalogGame
  installed?: InstalledGame
  library?: InstalledGame[]
  downloads?: DownloadTaskProgress[]
  activeDownload?: DownloadTaskProgress
  lastDownloadTask?: DownloadTaskProgress
  onClose: () => void
  onInstall: (
    game: CatalogGame,
    pickedRomPath?: string,
    requirementId?: string
  ) => void
  onLaunch: (gameId: string) => void
  onStop: (gameId: string) => void
  onReapplyRecipe: (gameId: string) => Promise<InstalledGame | void>
  onUninstall: (gameId: string, options?: UninstallGameOptions) => Promise<void>
  onRomImported: () => void
  onCancelDownload?: (taskId: string) => void
  onOpenDownloads?: () => void
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function formatPlayTime(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'Nunca jogado'
  if (seconds < 60) return '< 1 min'
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} min`
  return `${(mins / 60).toFixed(1)} horas`
}

export const GameModal: React.FC<GameModalProps> = ({
  game,
  installed,
  library,
  downloads,
  activeDownload,
  lastDownloadTask,
  onClose,
  onInstall,
  onLaunch,
  onStop,
  onReapplyRecipe,
  onUninstall,
  onRomImported,
  onCancelDownload,
  onOpenDownloads
}) => {
  const ports = game.ports && game.ports.length > 0 ? game.ports : []
  const [selectedPortId, setSelectedPortId] = useState<string>(
    game.selectedPortId || (ports.length > 0 ? ports[0].id : game.id)
  )

  useEffect(() => {
    setSelectedPortId(
      game.selectedPortId || (game.ports && game.ports.length > 0 ? game.ports[0].id : game.id)
    )
  }, [game.id, game.selectedPortId])

  const currentPort = ports.find((p) => p.id === selectedPortId) || ports[0]
  const activeGame: CatalogGame = currentPort
    ? {
        ...game,
        ...currentPort,
        id: currentPort.id,
        projectName: currentPort.projectName,
        repoFullName: currentPort.repoFullName,
        releaseRepoFullName: currentPort.releaseRepoFullName,
        githubUrl: currentPort.githubUrl,
        releaseUrl: currentPort.releaseUrl,
        websiteUrl: currentPort.websiteUrl,
        imageUrl: currentPort.imageUrl || game.imageUrl,
        version: currentPort.version,
        releaseStatus: currentPort.releaseStatus,
        platforms: currentPort.platforms,
        recipe: currentPort.recipe || game.recipe,
        inferredFamily: currentPort.inferredFamily,
        toolchainType: currentPort.toolchainType,
        howItWorks: currentPort.howItWorks,
        description: currentPort.description,
        highlights: currentPort.highlights,
        differences: currentPort.differences
      }
    : game

  const activeInstalled =
    library?.find((i) => i.gameId === activeGame.id) ||
    (activeGame.id === game.id ? installed : undefined)

  const activeDownloadTask =
    downloads?.slice().reverse().find(
      (d) =>
        d.gameId === activeGame.id &&
        !['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR'].includes(d.stage)
    ) ||
    (activeGame.id === game.id ? activeDownload : undefined)

  const activeLastTask =
    downloads?.slice().reverse().find((d) => d.gameId === activeGame.id) ||
    (activeGame.id === game.id ? lastDownloadTask : undefined)

  const [releaseInfo, setReleaseInfo] = useState<ResolvedReleaseInfo | null>(null)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  const [romStatus, setRomStatus] = useState<RomAvailabilityStatus | null>(null)
  const [romLoading, setRomLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [reapplyResult, setReapplyResult] = useState<{ ok: boolean; lines: string[] } | null>(null)

  const [showUninstallModal, setShowUninstallModal] = useState(false)
  const [deleteIsoToo, setDeleteIsoToo] = useState(true)
  // Lixeira do cartão da ISO/ROM: sempre remove o caminho; apagar o arquivo do computador é opcional
  const [romRemoval, setRomRemoval] = useState<{
    entry: RomVaultEntry
    label: string
    canDeleteFile: boolean
  } | null>(null)
  const [deleteRomFile, setDeleteRomFile] = useState(false)

  const [isAddedToSteam, setIsAddedToSteam] = useState(false)
  const [steamBusy, setSteamBusy] = useState(false)
  const [steamMessage, setSteamMessage] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (activeInstalled && window.api.isGameInSteam) {
      window.api.isGameInSteam(activeGame.id).then((added) => {
        if (!cancelled) setIsAddedToSteam(added)
      }).catch(() => {
        if (!cancelled) setIsAddedToSteam(false)
      })
    } else {
      setIsAddedToSteam(false)
    }
    return () => {
      cancelled = true
    }
  }, [activeGame.id, activeInstalled])

  const handleAddToSteam = async (): Promise<void> => {
    if (!activeInstalled || steamBusy) return
    setSteamBusy(true)
    setSteamMessage(null)
    try {
      const res = await window.api.addGameToSteam(activeGame.id)
      setIsAddedToSteam(true)
      setSteamMessage({ text: res.message || 'Jogo adicionado à Steam!', ok: true })
    } catch (err: any) {
      setSteamMessage({ text: err?.message || 'Erro ao adicionar à Steam.', ok: false })
    } finally {
      setSteamBusy(false)
    }
  }

  const handleRemoveFromSteam = async (): Promise<void> => {
    if (!activeInstalled || steamBusy) return
    setSteamBusy(true)
    setSteamMessage(null)
    try {
      await window.api.removeGameFromSteam(activeGame.id)
      setIsAddedToSteam(false)
      setSteamMessage({ text: 'Jogo removido da biblioteca da Steam.', ok: true })
    } catch (err: any) {
      setSteamMessage({ text: err?.message || 'Erro ao remover da Steam.', ok: false })
    } finally {
      setSteamBusy(false)
    }
  }

  const refreshRomStatus = async (): Promise<void> => {
    try {
      const res = await window.api.checkRomAvailability(activeGame.id)
      setRomStatus(res)
    } catch {
      // Ignore
    }
  }

  const loadDetails = async (targetId: string): Promise<void> => {
    setReleaseLoading(true)
    setRomLoading(true)
    setReleaseError(null)
    setImgError(false)

    window.api
      .checkRomAvailability(targetId)
      .then((res) => setRomStatus(res))
      .catch(() => {})
      .finally(() => setRomLoading(false))

    window.api
      .resolveRelease(targetId)
      .then((res) => setReleaseInfo(res))
      .catch((err) => setReleaseError(err?.message || 'Erro ao consultar GitHub'))
      .finally(() => setReleaseLoading(false))
  }

  useEffect(() => {
    loadDetails(activeGame.id)
    setReapplyResult(null)
  }, [activeGame.id])

  useEffect(() => {
    if (
      activeLastTask &&
      (activeLastTask.stage === 'READY_TO_PLAY' ||
        activeLastTask.stage === 'NEEDS_ROM')
    ) {
      refreshRomStatus()
    }
  }, [activeLastTask?.stage, activeLastTask?.completedAt, activeInstalled?.romPaired])

  const handleImportRom = async (reqId?: string): Promise<boolean> => {
    setLaunchError(null)
    try {
      const pickedPath = await window.api.pickRomFileForGame(activeGame.id, reqId)
      if (!pickedPath) return false

      const entry = await window.api.importRomFileManually(
        activeGame.id,
        reqId,
        pickedPath
      )
      if (entry) {
        await refreshRomStatus()
        onRomImported()
        return true
      }
      return false
    } catch (err: any) {
      setLaunchError(err?.message || String(err))
      return false
    }
  }

  const handleAddPatches = async (mode: 'files' | 'folder'): Promise<void> => {
    setLaunchError(null)
    try {
      const paths = await window.api.pickPatchesForGame(activeGame.id, patchMatch?.requirement.id, mode)
      if (paths.length === 0) return
      setActionBusy(true)
      for (const picked of paths) {
        await window.api.importRomFileManually(activeGame.id, patchMatch?.requirement.id, picked)
      }
      await refreshRomStatus()
      onRomImported()
    } catch (err: any) {
      setLaunchError(err?.message || String(err))
    } finally {
      setActionBusy(false)
    }
  }

  /** Reaplica a receita e mostra o que aconteceu (antes o botão não dava nenhuma resposta). */
  const handleReapply = async (): Promise<void> => {
    setActionBusy(true)
    setLaunchError(null)
    setReapplyResult(null)
    try {
      const updated = await onReapplyRecipe(activeGame.id)
      setRomStatus(await window.api.checkRomAvailability(activeGame.id))
      const interesting = (updated?.recipeLogs ?? [])
        .map((line) => line.replace(/^\[[^\]]*\]\s*/, ''))
        .filter((line) =>
          /pendente|problema|aviso|vinculad|atalho|patch|raiz do jogo|executável principal|erro/i.test(line)
        )
      const ok = updated ? updated.status !== 'NEEDS_ROM' : true
      setReapplyResult({
        ok,
        lines: interesting.length > 0 ? interesting : ['Receita reaplicada, sem alterações.']
      })
    } catch (err: any) {
      setLaunchError(err?.message || String(err))
    } finally {
      setActionBusy(false)
    }
  }

  const handleRemovePatch = async (filePath: string): Promise<void> => {
    setActionBusy(true)
    try {
      // Só esquece o item: o arquivo/pasta original do usuário nunca é apagado
      await window.api.removeRomVaultEntry(filePath, false)
      if (activeInstalled) await onReapplyRecipe(activeGame.id)
      await refreshRomStatus()
      onRomImported()
    } finally {
      setActionBusy(false)
    }
  }

  const askRemoveRom = async (entry: RomVaultEntry, label: string): Promise<void> => {
    // Uma pasta que o usuário apontou (o dump dele) nunca é apagada: só o caminho é removido
    let canDeleteFile = true
    if (entry.isDirectory) {
      try {
        const { romVaultPath } = await window.api.getSettings()
        canDeleteFile = isInsideFolder(entry.filePath, romVaultPath)
      } catch {
        canDeleteFile = false
      }
    }
    setDeleteRomFile(false)
    setRomRemoval({ entry, label, canDeleteFile })
  }

  const handleConfirmRemoveRom = async (): Promise<void> => {
    if (!romRemoval) return
    setActionBusy(true)
    try {
      await window.api.removeRomVaultEntry(
        romRemoval.entry.filePath,
        romRemoval.canDeleteFile && deleteRomFile
      )
      // Jogo já instalado: tira os atalhos que apontavam para essa ISO/ROM (volta a "aguardando ISO/ROM")
      if (activeInstalled) await onReapplyRecipe(activeGame.id)
      await refreshRomStatus()
      onRomImported()
      setRomRemoval(null)
    } catch (err: any) {
      setRomRemoval(null)
      setLaunchError(err?.message || String(err))
    } finally {
      setActionBusy(false)
    }
  }

  const handleInstallClick = async (): Promise<void> => {
    setLaunchError(null)
    if (!romStatus?.ready) {
      const pickedPath = await window.api.pickRomFileForGame(activeGame.id)
      if (!pickedPath) return
      onInstall(activeGame, pickedPath)
      return
    }
    onInstall(activeGame)
  }

  const handleDownloadLauncher = (): void => {
    setLaunchError(null)
    onInstall(activeGame)
  }

  const handleLaunchWithoutRom = async (): Promise<void> => {
    setLaunchError(null)
    try {
      await onLaunch(activeGame.id)
    } catch (err: any) {
      setLaunchError(err?.message || String(err))
    }
  }

  const handleLaunchClick = async (): Promise<void> => {
    setLaunchError(null)
    if (!romStatus?.ready) {
      const imported = await handleImportRom()
      if (!imported) {
        setLaunchError(
          'Selecione o arquivo da ISO/ROM (ou arquivo .zip/.7z/.rar com a ISO dentro) antes de iniciar.'
        )
        return
      }
    }

    try {
      await onLaunch(activeGame.id)
    } catch (err: any) {
      setLaunchError(err?.message || String(err))
    }
  }

  const handleToggleFullscreen = async (): Promise<void> => {
    if (!activeInstalled) return
    const nextVal = activeInstalled.launchFullscreen === false
    await window.api.setGameFullscreen(activeGame.id, nextVal)
  }

  const recipe = activeGame.recipe
  const requirements: RomRequirement[] = (
    recipe
      ? recipe.requirements.length > 0
        ? recipe.requirements
        : [genericIsoRequirement(activeGame.id, activeGame.title, true)]
      : [genericIsoRequirement(activeGame.id, activeGame.title)]
  ).filter((r) => r.type !== 'patch')
  const hasFolderRequirement = requirements.some((r) => r.type === 'folder')
  const hasOptionalRomRequirement = requirements.some((r) => r.optional)
  const hasPairedRom = romStatus?.matchedRequirements.some(
    (match) =>
      match.requirement.type !== 'patch' && match.status === 'local_vault'
  )

  const patchMatch = romStatus?.matchedRequirements.find((m) => m.requirement.type === 'patch')
  const patchEntries = patchMatch?.localEntries ?? []

  const isDownloading = Boolean(
    activeDownloadTask &&
      !['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR'].includes(activeDownloadTask.stage)
  )

  const isFullscreenEnabled = activeInstalled?.launchFullscreen !== false
  const pairedLocalEntries =
    romStatus?.matchedRequirements
      .map((m) => m.localEntry)
      .filter((e): e is NonNullable<typeof e> => Boolean(e)) || []

  const hasMultiPorts = ports.length > 1

  return (
    <div className="min-h-full steam-main-gradient text-[#dcdedf] flex flex-col">
      {/* 1. Cabeçalho com arte */}
      <div className="relative w-full min-h-[15rem] bg-[#0e141c] overflow-hidden border-b border-[#283444] shrink-0">
        {activeGame.imageUrl && !imgError && (
          <div
            className="rh-hero-backdrop"
            style={{ backgroundImage: `url("${activeGame.imageUrl}")` }}
            aria-hidden="true"
          />
        )}
        <div className="rh-hero-fade" aria-hidden="true" />

        <div className="relative z-10 px-6 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rh-btn rh-btn-ghost px-3 min-h-[32px] text-[11px] bg-black/30"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Voltar</span>
          </button>
        </div>

        <div className="relative z-10 px-6 pt-5 pb-6 flex items-end gap-6">
          <div className="w-[132px] h-[132px] rounded-xl bg-[#0b1017]/80 ring-1 ring-white/10 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] overflow-hidden shrink-0 flex items-center justify-center">
            {activeGame.imageUrl && !imgError ? (
              <img
                src={activeGame.imageUrl}
                alt={activeGame.title}
                onError={() => setImgError(true)}
                className="max-w-[90%] max-h-[90%] object-contain"
              />
            ) : (
              <CoverFallback title={activeGame.title} consoleBadge={activeGame.consoleBadge} />
            )}
          </div>

          <div className="min-w-0 pb-0.5">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-2 py-0.5 bg-[#1a9fff]/20 text-[#66c0f4] text-[10px] font-bold uppercase tracking-wider rounded-lg">
                {activeGame.console}
              </span>
              <span className="px-2 py-0.5 bg-white/10 text-[#c7d5e0] text-[10px] font-semibold uppercase tracking-wider rounded-lg">
                {familyLabel(recipe?.family || activeGame.inferredFamily)}
              </span>
              {activeGame.isCommunity && (
                <span className="px-2 py-0.5 bg-[#142a40] text-[#7ebaf5] text-[10px] font-bold uppercase tracking-wider rounded-lg">
                  Comunidade
                </span>
              )}
              {hasMultiPorts && (
                <span className="px-2 py-0.5 bg-[#172e44] text-[#66c0f4] text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1">
                  <Layers className="w-3 h-3" aria-hidden="true" />
                  <span>{ports.length} ports disponíveis</span>
                </span>
              )}
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight leading-tight drop-shadow line-clamp-2">
              {game.title}
            </h1>
            <p className="text-xs text-[#8f98a0] mt-1.5">
              Port ativo: <strong className="text-[#c7d5e0]">{activeGame.projectName}</strong>
              {' · '}
              <span className="font-mono text-[#66c0f4]">{activeGame.repoFullName}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Multi-Port Selector Section (Shown when this game has > 1 port available) */}
      {hasMultiPorts && (
        <div className="bg-[#141d27] border-b border-[#253547] px-6 py-4 shadow-inner">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#1a9fff]/20 border border-[#1a9fff]/40 text-[#67c1f5] text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                VERSÕES &amp; PORTS DISPONÍVEIS NO GITHUB ({ports.length})
              </span>
              <span className="text-[11px] text-[#8f98a0]">
                Clique no port que você deseja selecionar para jogar ou instalar:
              </span>
            </div>
          </div>

          {/* Grid of Available Ports */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ports.map((port) => {
              const isSelected = port.id === activeGame.id
              const portInstData = library?.find((i) => i.gameId === port.id)
              const isPortInstalled = Boolean(portInstData)
              const isRunning = portInstData?.status === 'RUNNING'

              return (
                <div
                  key={port.id}
                  onClick={() => setSelectedPortId(port.id)}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all duration-150 flex flex-col justify-between ${
                    isSelected
                      ? 'bg-[#1b2b3d] border-[#1a9fff] shadow-[0_0_14px_rgba(26,159,255,0.25)] ring-1 ring-[#1a9fff]/60'
                      : 'bg-[#16202c] hover:bg-[#1a2634] border-[#26374a] hover:border-[#3d5775]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3
                            className={`text-[13px] font-bold truncate ${
                              isSelected ? 'text-white' : 'text-[#c7d5e0]'
                            }`}
                          >
                            {port.projectName}
                          </h3>
                          {isPortInstalled && (
                            <span
                              className={`px-1.5 py-0.2 rounded-md text-[9px] font-bold uppercase ${
                                isRunning
                                  ? 'bg-[#5c7e10] text-white animate-pulse'
                                  : 'bg-[#2b4c1c] text-[#a3e635] border border-[#3b6b25]'
                              }`}
                            >
                              {isRunning ? 'Rodando' : 'Instalado'}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-[#67c1f5] truncate block mt-0.5">
                          {port.repoFullName}
                        </span>
                      </div>

                      <div className="shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                            isSelected
                              ? 'bg-[#1a9fff] text-white shadow-sm'
                              : 'bg-[#212f3f] text-[#8f98a0] border border-[#2f4258]'
                          }`}
                        >
                          {isSelected ? '✓ Selecionado' : 'Selecionar'}
                        </span>
                      </div>
                    </div>

                    {/* Toolchain Badge */}
                    <div className="mb-2">
                      <span className="inline-block px-1.5 py-0.5 rounded-md bg-[#111720] border border-[#233345] text-[#8fa7c0] text-[10px] font-semibold">
                        {port.toolchainType}
                      </span>
                    </div>

                    {/* Short Description */}
                    <p className="text-xs text-[#9eb0c2] leading-relaxed line-clamp-2 mb-2">
                      {port.description}
                    </p>
                  </div>

                  {/* Highlights pills */}
                  {port.highlights && port.highlights.length > 0 && (
                    <div className="pt-2 border-t border-[#233345] flex flex-wrap gap-1">
                      {port.highlights.slice(0, 3).map((hl, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.2 rounded-md bg-[#111822] text-[#67c1f5] text-[9.5px]"
                        >
                          • {hl}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 2. Iconic Steam Play / Install Action Bar */}
      <div className="bg-[#1e2833] border-b border-[#2c3b4b] px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div className="flex flex-wrap items-center gap-6">
          {/* Primary Play / Install / Stop Button */}
          {activeInstalled ? (
            activeInstalled.status === 'RUNNING' ? (
              <button
                onClick={() => onStop(activeGame.id)}
                className="px-8 py-2.5 rounded-md bg-[#c93838] hover:bg-[#e04343] text-white text-sm font-bold uppercase tracking-wider flex items-center gap-2.5 shadow"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>PARAR</span>
              </button>
            ) : (
              <>
                <button
                  onClick={handleLaunchClick}
                  disabled={actionBusy}
                  className="steam-btn-green px-9 py-2.5 rounded-md text-white text-sm font-bold uppercase tracking-wider flex items-center gap-2.5 shadow-md"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {romStatus?.ready ? 'JOGAR' : 'ESCOLHER ISO E JOGAR'}
                  </span>
                </button>
                {!romStatus?.ready && (
                  <button
                    onClick={handleLaunchWithoutRom}
                    disabled={actionBusy || !activeInstalled.executablePath}
                    title="Abrir o launcher sem selecionar uma ISO/ROM"
                    className="px-5 py-2.5 rounded-md bg-[#2a3846] hover:bg-[#36495c] border border-[#3a4d63] text-[#dcdedf] text-xs font-bold uppercase tracking-wider flex items-center gap-2 disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>ABRIR LAUNCHER</span>
                  </button>
                )}
              </>
            )
          ) : isDownloading && activeDownloadTask ? (
            <div className="flex items-center gap-2">
              <button
                disabled
                className="steam-btn-blue px-7 py-2.5 rounded-md text-white text-sm font-bold uppercase tracking-wider flex items-center gap-2.5 shadow-md opacity-80 cursor-wait"
              >
                <Download className="w-4 h-4 animate-bounce" />
                <span>
                  {activeDownloadTask?.stage === 'EXTRACTING_ISO' ? 'DESCOMPACTANDO ISO' : 'INSTALANDO'} ({activeDownloadTask?.overallProgress ?? 0}%)
                </span>
              </button>
              {onCancelDownload && (
                <button
                  onClick={() => onCancelDownload(activeDownloadTask.taskId)}
                  className="px-4 py-2.5 bg-[#2b1717] hover:bg-[#451f1f] border border-[#6b2c2c] hover:border-red-500 rounded-md text-red-300 hover:text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow"
                  title="Cancelar download e instalação deste jogo"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Cancelar</span>
                </button>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={handleInstallClick}
                disabled={actionBusy || Boolean(releaseError)}
                className="steam-btn-blue px-8 py-2.5 rounded-md text-white text-sm font-bold uppercase tracking-wider flex items-center gap-2.5 shadow-md disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>
                  {releaseError
                    ? 'RELEASE INDISPONÍVEL NO GITHUB'
                    : romStatus?.ready
                      ? 'INSTALAR'
                      : 'ESCOLHER ISO E INSTALAR'}
                </span>
              </button>
              <button
                onClick={handleDownloadLauncher}
                disabled={actionBusy || Boolean(releaseError)}
                title="Baixar e preparar o launcher sem selecionar uma ISO/ROM"
                className="px-5 py-2.5 rounded-md bg-[#2a3846] hover:bg-[#36495c] border border-[#3a4d63] text-[#dcdedf] text-xs font-bold uppercase tracking-wider flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>BAIXAR SÓ O LAUNCHER</span>
              </button>
            </>
          )}

          {/* Steam Uppercase Metadata Columns */}
          <div className="flex items-center gap-6 text-xs border-l border-[#314152] pl-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#67707b]">
                STATUS DA ISO / ROM
              </div>
              <div className="font-semibold mt-0.5">
                {romLoading ? (
                  <span className="text-[#8f98a0]">Verificando...</span>
                ) : hasPairedRom ? (
                  <span className="text-[#6cc034] flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pareada e Pronta
                  </span>
                ) : romStatus?.ready && hasOptionalRomRequirement ? (
                  <span className="text-[#8f98a0] flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Opcional — não selecionada
                  </span>
                ) : romStatus?.ready ? (
                  <span className="text-[#6cc034] flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pareada e Pronta
                  </span>
                ) : (
                  <span className="text-[#e5a93c] flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Aguardando Seleção
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#67707b]">
                MODO DE TELA
              </div>
              <div className="text-[#c7d5e0] font-medium mt-0.5">
                {isFullscreenEnabled
                  ? 'Tela Cheia (F11 / Maximizar)'
                  : 'Modo Janela'}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#67707b]">
                TEMPO DE JOGO
              </div>
              <div className="text-[#c7d5e0] font-medium mt-0.5">
                {formatPlayTime(activeInstalled?.playTimeSeconds)}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#67707b]">
                EXECUÇÃO
              </div>
              <div className="text-[#c7d5e0] font-medium mt-0.5">
                {activeInstalled?.requiresCompatibilityLayer ||
                releaseInfo?.requiresCompatibilityLayer
                  ? 'Proton / umu-run'
                  : 'Nativo'}
              </div>
            </div>
          </div>
        </div>

        {/* Right Utility Icons (Steam Gear / Folder / Reapply / Delete) */}
        <div className="flex items-center gap-1.5">
          {activeInstalled && (
            <button
              onClick={handleToggleFullscreen}
              title="Alternar entre Iniciar em Tela Cheia (Borderless) ou Modo Janela"
              className={`px-3 py-2 rounded-md border text-xs font-semibold flex items-center gap-1.5 ${
                isFullscreenEnabled
                  ? 'bg-[#1d354d] hover:bg-[#254463] border-[#35638f] text-[#67c1f5]'
                  : 'bg-[#2a3846] hover:bg-[#36495c] border-[#3a4d63] text-[#dcdedf]'
              }`}
            >
              {isFullscreenEnabled ? (
                <Maximize2 className="w-3.5 h-3.5" />
              ) : (
                <Minimize2 className="w-3.5 h-3.5" />
              )}
              <span>{isFullscreenEnabled ? 'Tela Cheia: ON' : 'Janela'}</span>
            </button>
          )}

          <button
            onClick={() => handleImportRom()}
            disabled={actionBusy}
            title="Escolher ou alterar arquivo da ISO / ROM (.iso, .z64, .bin, .zip, .7z, .rar)"
            className="px-3 py-2 rounded-md bg-[#2a3846] hover:bg-[#36495c] border border-[#3a4d63] text-xs font-semibold text-[#dcdedf] flex items-center gap-1.5"
          >
            <FolderSearch className="w-3.5 h-3.5 text-[#67c1f5]" />
            <span>Definir ISO / ROM</span>
          </button>

          {activeInstalled && (
            <>
              <button
                onClick={handleAddToSteam}
                disabled={steamBusy}
                title={
                  isAddedToSteam
                    ? 'Este jogo já está adicionado na Steam (clique para sincronizar/atualizar atalho e artes)'
                    : 'Adicionar este jogo como atalho na sua biblioteca da Steam (com capa e ícone)'
                }
                className={`px-3 py-2 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
                  isAddedToSteam
                    ? 'bg-[#1b2838] hover:bg-[#2a475e] border-[#66c0f4] text-[#66c0f4]'
                    : 'bg-[#2a3846] hover:bg-[#36495c] border-[#3a4d63] text-[#dcdedf]'
                }`}
              >
                <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24">
                  <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.005.105.005.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 12-5.373 12-12s-5.373-12-12-12z" />
                </svg>
                <span>{steamBusy ? 'Sincronizando...' : isAddedToSteam ? 'Na Steam' : 'Adicionar à Steam'}</span>
              </button>

              <button
                onClick={() => window.api.openGameFolder(activeGame.id)}
                title="Explorar arquivos locais instalados"
                className="p-2 rounded-md bg-[#2a3846] hover:bg-[#36495c] border border-[#3a4d63] text-[#c7d5e0]"
              >
                <FolderOpen className="w-4 h-4" />
              </button>

              <button
                onClick={handleReapply}
                disabled={actionBusy}
                title="Reaplicar receita pós-instalação"
                className="p-2 rounded-md bg-[#2a3846] hover:bg-[#36495c] border border-[#3a4d63] text-[#c7d5e0]"
              >
                <RefreshCw
                  className={`w-4 h-4 ${actionBusy ? 'animate-spin' : ''}`}
                />
              </button>

              <button
                onClick={() => window.api.selectExecutableManually(activeGame.id)}
                title="Selecionar executável manualmente"
                className="p-2 rounded-md bg-[#2a3846] hover:bg-[#36495c] border border-[#3a4d63] text-[#c7d5e0]"
              >
                <Settings2 className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setDeleteIsoToo(true)
                  setShowUninstallModal(true)
                }}
                disabled={actionBusy}
                title="Desinstalar jogo e/ou excluir ISO do computador"
                className="p-2 rounded-md bg-[#2a3846] hover:bg-[#7a2828] border border-[#3a4d63] text-[#c7d5e0] hover:text-white"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Active Download Progress Bar */}
      {isDownloading && activeDownloadTask && (
        <div className="bg-[#142230] border-b border-[#264663] px-6 py-3">
          <div className="flex items-center justify-between text-xs mb-1.5 gap-4">
            <span className="font-bold uppercase tracking-wider text-[#67c1f5] truncate">
              {activeDownloadTask.stageLabel}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              {onOpenDownloads && (
                <button
                  onClick={onOpenDownloads}
                  className="text-[11px] font-semibold uppercase tracking-wider text-[#1a9fff] hover:text-white underline"
                >
                  Ver em Downloads
                </button>
              )}
              <span className="font-mono font-bold text-white">
                {activeDownloadTask.overallProgress}%
              </span>
            </div>
          </div>
          <div className="w-full h-2 bg-[#0d151d] rounded-[1px] overflow-hidden">
            <div
              className="h-full bg-[#1a9fff] transition-all duration-200"
              style={{ width: `${activeDownloadTask.overallProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Alerts */}
      <div className="px-6 pt-4 space-y-3">
        {steamMessage && (
          <div
            className={`p-3 rounded-md border text-xs flex items-center justify-between gap-3 ${
              steamMessage.ok
                ? 'bg-[#162738] border-[#316896] text-[#dcdedf]'
                : 'bg-[#4c1d1d] border-[#8c3232] text-red-100'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {steamMessage.ok ? (
                <CheckCircle2 className="w-4 h-4 text-[#66c0f4] shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" />
              )}
              <span className="break-words">{steamMessage.text}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {isAddedToSteam && steamMessage.ok && (
                <button
                  type="button"
                  onClick={handleRemoveFromSteam}
                  disabled={steamBusy}
                  className="text-[11px] font-semibold text-[#8f98a0] hover:text-red-300 underline"
                >
                  Remover da Steam
                </button>
              )}
              <button
                type="button"
                onClick={() => setSteamMessage(null)}
                aria-label="Fechar aviso"
                className="text-current opacity-70 hover:opacity-100 text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {(launchError || activeLastTask?.stage === 'ERROR') && (
          <div className="p-3 rounded-md bg-[#4c1d1d] border border-[#8c3232] text-xs text-red-100 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" />
            <span>{launchError || activeLastTask?.error}</span>
          </div>
        )}

        {reapplyResult && (
          <div
            role="status"
            className={`p-3 rounded-md border text-xs flex items-start gap-2.5 ${
              reapplyResult.ok
                ? 'bg-[#16301f] border-[#2f6b42] text-[#d3f0dc]'
                : 'bg-[#33250f] border-[#7a5a1c] text-[#f4dfb4]'
            }`}
          >
            {reapplyResult.ok ? (
              <CheckCircle2 className="w-4 h-4 text-[#6cc034] shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-[#e5a93c] shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="font-bold">
                {reapplyResult.ok ? 'Receita reaplicada' : 'Receita reaplicada, mas ainda falta algo'}
              </div>
              {reapplyResult.lines.map((line, i) => (
                <div key={i} className="break-words">
                  {line}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setReapplyResult(null)}
              aria-label="Fechar aviso"
              className="text-current opacity-70 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {busyMessage && (
          <div className="p-3 rounded-md bg-[#1b334b] border border-[#2f5d8a] text-xs text-[#c7d5e0] flex items-center gap-2.5">
            <RefreshCw className="w-4 h-4 text-[#1a9fff] animate-spin shrink-0" />
            <span>{busyMessage}</span>
          </div>
        )}
      </div>

      {/* 3. Main Two-Column Steam Page Content */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left 2 Columns: Port Details, ISO/ROM Configuration & Recipe Logs */}
        <div className="lg:col-span-2 space-y-5">
          {/* ISO / ROM Path Configuration Box */}
          <div className="bg-[#161f29] border border-[#263545] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#253342] pb-2.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#67c1f5] flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                ARQUIVO DA ISO / ROM ORIGINAL DO JOGO
              </h2>
              <span className="text-[11px] text-[#8f98a0]">
                Aceita ISO/ROM direta ou .zip / .7z / .rar
              </span>
            </div>

            {hasFolderRequirement && (
              <div className="p-3 rounded-md bg-[#121c27] border border-[#1e3248] text-[11.5px] text-[#b8c4d0] leading-relaxed">
                <strong className="text-[#66c0f4]">Jogos grandes (ex.: PS4, 25 GB ou mais):</strong> escolha a{' '}
                <strong>pasta do jogo já extraída</strong> (a que tem o <span className="font-mono">eboot.bin</span>{' '}
                dentro). Ela fica registrada onde já está, sem copiar nada, e a pasta de instalação recebe um
                atalho. Se você só tem os arquivos <span className="font-mono">.pkg</span>, escolha a pasta onde
                eles estão: o RecompHUB extrai o jogo, os patches e os DLC sozinho (precisa do arquivo de chaves em
                Configurações e de espaço livre para o jogo extraído). Arquivos compactados (.zip, .7z, .rar)
                também funcionam, mas são extraídos para o Cofre antes.
                {recipe?.helpUrl && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => window.api.openExternalUrl(recipe.helpUrl!)}
                      className="text-[#66c0f4] underline hover:text-white"
                    >
                      Ver o passo a passo do port
                    </button>
                    .
                  </>
                )}
              </div>
            )}

            <p className="text-xs text-[#96a0aa] leading-relaxed">
              Escolha onde está a ISO ou ROM deste jogo no seu computador. Caso ela esteja compactada (
              <span className="text-[#dcdedf] font-mono">.zip, .7z, .rar, .tar.gz</span>
              ), o RecompHUB extrai a ISO de dentro do arquivo compactado automaticamente e a posiciona na pasta do jogo antes de iniciar.
            </p>

            <div className="space-y-2.5">
              {requirements.map((req) => {
                const match = romStatus?.matchedRequirements.find(
                  (m) => m.requirement.id === req.id
                )
                const isReady =
                  match?.status === 'local_vault' && Boolean(match.localEntry)

                return (
                  <div
                    key={req.id}
                    className={`p-3.5 rounded-md border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isReady
                        ? 'bg-[#1a2923] border-[#315941]'
                        : 'bg-[#211f1a] border-[#614a21]'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {req.label}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-black/30 text-[#8f98a0] rounded-md">
                          {req.type === 'folder'
                            ? `pasta | ${req.extensions.join(' ')}`
                            : `${req.extensions.join(' ')} | .zip .7z .rar`}
                        </span>
                      </div>

                      {isReady && match?.localEntry ? (
                        <div className="space-y-0.5 text-[11px]">
                          <div className="text-[#6cc034] font-semibold flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">
                              {match.localEntry.isDirectory ? 'Pasta: ' : ''}
                              {match.localEntry.fileName} (
                              {formatBytes(match.localEntry.size)})
                            </span>
                          </div>
                          {match.localEntry.extractedFromArchive && (
                            <div className="text-[#67c1f5] flex items-center gap-1 text-[10px]">
                              <Archive className="w-3 h-3 shrink-0" />
                              <span>
                                Extraída de: {match.localEntry.extractedFromArchive}
                              </span>
                            </div>
                          )}
                          <div className="font-mono text-[10px] text-[#8f98a0] truncate">
                            Local: {match.localEntry.filePath}
                          </div>
                          {!match.localEntry.isDirectory && (
                            <div className="font-mono text-[10px] text-[#67707b] truncate">
                              SHA-1: {match.localEntry.sha1}
                            </div>
                          )}
                        </div>
                      ) : match?.problem ? (
                        <div className="text-[11px] text-[#ffb4a8] leading-relaxed flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{match.problem}</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-[#e5a93c]">
                          {req.type === 'folder'
                            ? 'Nenhuma pasta selecionada. Clique no botão ao lado e escolha a pasta do dump do jogo (ou um arquivo compactado).'
                            : 'Nenhum arquivo selecionado para este jogo. Clique no botão ao lado para localizar a ISO/ROM ou arquivo compactado.'}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleImportRom(req.id)}
                        disabled={actionBusy}
                        className={`px-3.5 py-2 rounded-md text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${
                          isReady
                            ? 'bg-[#2a3846] hover:bg-[#384b5e] text-[#dcdedf] border border-[#3e5268]'
                            : 'steam-btn-blue text-white shadow'
                        }`}
                      >
                        <FolderSearch className="w-3.5 h-3.5" />
                        <span>
                          {isReady
                            ? req.type === 'folder'
                              ? 'Alterar'
                              : 'Alterar Arquivo'
                            : req.type === 'folder'
                              ? 'Selecionar pasta / ZIP'
                              : 'Selecionar ISO / ZIP'}
                        </span>
                      </button>

                      {isReady && match?.localEntry && (
                        <button
                          onClick={() => askRemoveRom(match.localEntry!, req.label)}
                          disabled={actionBusy}
                          aria-label="Remover esta ISO/ROM do jogo"
                          title="Remover esta ISO/ROM do jogo"
                          className="p-2 rounded-md bg-[#362020] hover:bg-[#7a2828] border border-[#5e3232] text-red-200 hover:text-white"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Patches, atualizações e DLC (destaque superior) */}
          <div className="bg-[#161f29] border border-[#263545] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#253342] pb-2.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#67c1f5] flex items-center gap-2">
                <Package className="w-4 h-4 text-[#1a9fff]" />
                PATCHES, ATUALIZAÇÕES E DLC
              </h2>
              {patchEntries.length > 0 ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#21432e] text-[#6cc034] border border-[#2f6343] flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {patchEntries.length} {patchEntries.length === 1 ? 'patch ativo' : 'patches ativos'}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider bg-[#1c2733] text-[#8fa7c0] border border-[#263747]">
                  Opcional
                </span>
              )}
            </div>

            <p className="text-xs text-[#96a0aa] leading-relaxed">
              Tem uma atualização, patch ou DLC do jogo (por exemplo atualização .pkg do PS4, update 1.09 do Bloodborne, pastas de DLC ou patches da comunidade)? Adicione aqui. Os arquivos ficam onde estão e o RecompHUB cria atalhos na subpasta <span className="font-mono text-[#dcdedf]">{patchMatch?.requirement.targetSubdir || 'patches'}/</span> do jogo, sem copiar nada pesado.
              {activeInstalled
                ? ' Os novos itens são vinculados na hora.'
                : ' Serão vinculados quando o jogo for instalado.'}
            </p>

            {patchEntries.length > 0 ? (
              <div className="space-y-1.5">
                {patchEntries.map((entry) => (
                  <div
                    key={entry.filePath}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[#111922] border border-[#223040]"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white flex items-center gap-1.5 truncate">
                        {entry.isDirectory ? (
                          <Folder className="w-3.5 h-3.5 text-[#66c0f4] shrink-0" />
                        ) : (
                          <Archive className="w-3.5 h-3.5 text-[#66c0f4] shrink-0" />
                        )}
                        <span className="truncate">{entry.fileName}</span>
                        <span className="text-[10px] font-normal text-[#8f98a0] shrink-0">
                          {formatBytes(entry.size)}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[#67707b] truncate">{entry.filePath}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePatch(entry.filePath)}
                      disabled={actionBusy}
                      title="Remover da lista (o arquivo original não é apagado)"
                      aria-label={`Remover ${entry.fileName}`}
                      className="p-1.5 rounded-md text-[#8f98a0] hover:text-white hover:bg-[#7a2828]/60 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-[#67707b] px-1">Nenhum patch ou atualização adicionado ainda.</div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleAddPatches('files')}
                disabled={actionBusy}
                className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-[#2a3846] hover:bg-[#384b5e] border border-[#3e5268] text-white flex items-center gap-1.5 transition-all shadow-sm"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-[#67c1f5]" aria-hidden="true" />
                <span>Adicionar arquivos (.pkg / .zip)</span>
              </button>
              <button
                type="button"
                onClick={() => handleAddPatches('folder')}
                disabled={actionBusy}
                className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-[#212d3b] hover:bg-[#2c3c4f] border border-[#2f4258] text-[#c7d5e0] flex items-center gap-1.5 transition-all"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[#67c1f5]" aria-hidden="true" />
                <span>Adicionar pasta (DLC)</span>
              </button>
              {activeInstalled && patchEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => window.api.openGameFolder(activeGame.id)}
                  className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-[#212d3b] hover:bg-[#2c3c4f] border border-[#2f4258] text-[#c7d5e0] flex items-center gap-1.5 transition-all"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#67c1f5]" aria-hidden="true" />
                  <span>Abrir pasta do jogo</span>
                </button>
              )}
            </div>
          </div>

          {/* Detailed Port Explanation & Differences Card */}
          <div className="bg-[#161f29] border border-[#263545] rounded-lg p-4 space-y-3.5 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#253342] pb-2.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#67c1f5] flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                SOBRE ESTE PORT: {activeGame.projectName}
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#111720] border border-[#243447] text-[#8fa7c0]">
                {activeGame.toolchainType}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#67707b] block mb-0.5">
                  O QUE É
                </span>
                <p className="text-[#c7d5e0] leading-relaxed">
                  {activeGame.description}
                </p>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#67707b] block mb-0.5">
                  COMO É FEITO (ARQUITETURA &amp; MÉTODO)
                </span>
                <p className="text-[#96a0aa] leading-relaxed">
                  {activeGame.howItWorks}
                </p>
              </div>

              {activeGame.differences && (
                <div className="p-3 rounded-md bg-[#121c27] border border-[#1e3248] space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#67c1f5] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#1a9fff]" />
                    DIFERENÇAS &amp; PONTOS FORTES DESTE PORT
                  </span>
                  <p className="text-[#c7d5e0] leading-relaxed">
                    {activeGame.differences}
                  </p>
                </div>
              )}

              {activeGame.highlights && activeGame.highlights.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#67707b] block mb-1.5">
                    DESTAQUES &amp; RECURSOS PRINCIPAIS
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeGame.highlights.map((hl, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-[#dcdedf] bg-[#111720] px-3 py-2 rounded-md border border-[#202c3b]"
                      >
                        <span className="text-[#1a9fff] font-bold">✓</span>
                        <span className="text-[11.5px] leading-tight">{hl}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recipe & Post-Install Log Box */}
          <div className="bg-[#161f29] border border-[#263545] rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#67c1f5] border-b border-[#253342] pb-2">
              AUTOMAÇÃO DE RECEITA ({recipe?.family || activeGame.inferredFamily})
            </h2>
            <p className="text-xs text-[#c7d5e0] leading-relaxed">
              {recipe?.notes}
            </p>
            <div className="text-[11px] text-[#8f98a0] bg-[#111922] border border-[#223040] px-3 py-2 rounded-md">
              <strong className="text-[#67c1f5]">Atalhos durante o jogo:</strong>{' '}
              Clique no botão <strong>Maximizar</strong> da janela ou pressione{' '}
              <kbd className="px-1.5 py-0.5 bg-[#1e2b3a] text-white rounded text-[10px]">
                F11
              </kbd>{' '}
              /{' '}
              <kbd className="px-1.5 py-0.5 bg-[#1e2b3a] text-white rounded text-[10px]">
                Alt+Enter
              </kbd>{' '}
              para alternar Tela Cheia. Pressione{' '}
              <kbd className="px-1.5 py-0.5 bg-[#1e2b3a] text-white rounded text-[10px]">
                F4
              </kbd>{' '}
              (nos ports PS2/N64 compatíveis) para abrir o menu gráfico interno.
            </div>

            {activeInstalled && activeInstalled.recipeLogs.length > 0 && (
              <div className="p-3 bg-[#0e141b] border border-[#223040] rounded-md font-mono text-[11px] text-[#8f98a0] max-h-44 overflow-y-auto space-y-1">
                {activeInstalled.recipeLogs.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Release & System Metadata */}
        <div className="space-y-5">
          <div className="bg-[#161f29] border border-[#263545] rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#67c1f5] border-b border-[#253342] pb-2">
              INFORMAÇÕES DO PACOTE (GITHUB)
            </h2>

            {releaseLoading ? (
              <p className="text-xs text-[#8f98a0]">
                Consultando última release no GitHub...
              </p>
            ) : releaseError ? (
              <div className="space-y-2 p-3 bg-[#241a12] border border-[#6b4718] rounded-md">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#ffc875]">
                  <AlertCircle className="w-4 h-4 text-[#ffc875] shrink-0" />
                  <span>Releases não encontradas no GitHub</span>
                </div>
                <p className="text-[11px] text-[#decab0] leading-relaxed">
                  Este repositório ainda não possui arquivos executáveis (.zip / .exe / .AppImage) publicados na aba Releases pelos autores no GitHub.
                </p>
                <a
                  href={activeGame.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-[#67c1f5] hover:underline pt-0.5"
                >
                  Abrir repositório no GitHub <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : releaseInfo ? (
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-[#67707b] block text-[10px] uppercase font-bold">
                    ARQUIVO SELECIONADO
                  </span>
                  <span className="font-mono text-white break-all">
                    {releaseInfo.selectedAsset?.name || 'Nenhum binário'}
                  </span>
                </div>

                <div className="flex justify-between border-t border-[#223040] pt-2">
                  <span className="text-[#8f98a0]">Tamanho do Download:</span>
                  <span className="font-mono text-white">
                    {formatBytes(releaseInfo.selectedAsset?.size || 0)}
                  </span>
                </div>

                <div className="flex justify-between border-t border-[#223040] pt-2">
                  <span className="text-[#8f98a0]">Versão / Tag:</span>
                  <span className="font-mono text-white">
                    {releaseInfo.tagName}
                  </span>
                </div>

                <div className="border-t border-[#223040] pt-2 text-[11px] text-[#8f98a0]">
                  {releaseInfo.selectionReason}
                </div>
              </div>
            ) : null}

            <div className="pt-2 border-t border-[#253342] flex flex-col gap-1.5">
              <button
                onClick={() => window.api.openExternalUrl(activeGame.githubUrl)}
                className="w-full px-3 py-1.5 bg-[#212d3b] hover:bg-[#2c3c4f] text-[#67c1f5] text-xs font-medium rounded-md flex items-center justify-between"
              >
                <span>Ver Repositório no GitHub</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>

              {activeGame.websiteUrl && (
                <button
                  onClick={() => window.api.openExternalUrl(activeGame.websiteUrl!)}
                  className="w-full px-3 py-1.5 bg-[#212d3b] hover:bg-[#2c3c4f] text-[#67c1f5] text-xs font-medium rounded-md flex items-center justify-between"
                >
                  <span>Site Oficial do Projeto</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Steam Uninstall Confirmation Modal */}
      {showUninstallModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#1b2838] border border-[#354c66] rounded-lg shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-[#171d25] border-b border-[#2a3846] flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>DESINSTALAR — {activeGame.title} ({activeGame.projectName})</span>
              </div>
              <button
                onClick={() => setShowUninstallModal(false)}
                className="text-[#8f98a0] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-[#c7d5e0]">
              <p className="leading-relaxed">
                Você está prestes a remover a instalação de{' '}
                <strong className="text-white">{activeGame.title} ({activeGame.projectName})</strong> do seu computador.
              </p>

              <label className="p-3.5 rounded-md bg-[#131c27] border border-[#2a3c52] flex items-start gap-3 cursor-pointer select-none hover:border-[#416082]">
                <input
                  type="checkbox"
                  checked={deleteIsoToo}
                  onChange={(e) => setDeleteIsoToo(e.target.checked)}
                  className="mt-0.5 accent-[#1a9fff]"
                />
                <div className="space-y-1 min-w-0">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-[#67c1f5] shrink-0" />
                    <span>Excluir também a ISO / ROM vinculada do computador</span>
                  </div>
                  {pairedLocalEntries.length > 0 ? (
                    <p className="text-[11px] text-[#6cc034] truncate">
                      Arquivo: {pairedLocalEntries[0].fileName} (
                      {formatBytes(pairedLocalEntries[0].size)})
                    </p>
                  ) : null}
                  <p className="text-[11px] text-[#8f98a0] leading-relaxed">
                    Remove o arquivo da ISO/ROM extraída armazenada no Cofre do RecompHUB para liberar todo o espaço em disco ocupado.
                  </p>
                </div>
              </label>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#263649]">
                <button
                  onClick={() => setShowUninstallModal(false)}
                  disabled={actionBusy}
                  className="px-4 py-2 rounded-md bg-[#2a3846] hover:bg-[#37495b] text-xs font-bold uppercase tracking-wider text-[#dcdedf]"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    setActionBusy(true)
                    try {
                      await onUninstall(activeGame.id, {
                        deleteRomFromVault: deleteIsoToo,
                        deleteOriginalArchive: false
                      })
                      setShowUninstallModal(false)
                      onClose()
                    } finally {
                      setActionBusy(false)
                    }
                  }}
                  disabled={actionBusy}
                  className="px-5 py-2 rounded-md bg-[#b83232] hover:bg-[#d43b3b] text-xs font-bold uppercase tracking-wider text-white shadow"
                >
                  {actionBusy ? 'Excluindo...' : 'Confirmar Exclusão'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Remover a ISO/ROM vinculada (o caminho sai sempre; apagar o arquivo é opcional) */}
      {romRemoval && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rom-removal-title"
            className="w-full max-w-md bg-[#1b2838] border border-[#354c66] rounded-lg shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-3.5 bg-[#171d25] border-b border-[#2a3846] flex items-center justify-between">
              <div
                id="rom-removal-title"
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>REMOVER ISO / ROM — {activeGame.title}</span>
              </div>
              <button
                onClick={() => setRomRemoval(null)}
                disabled={actionBusy}
                aria-label="Fechar"
                className="text-[#8f98a0] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-[#c7d5e0]">
              <p className="leading-relaxed">
                O caminho de <strong className="text-white">{romRemoval.label}</strong> será removido deste jogo
                {activeInstalled
                  ? ', inclusive o atalho na pasta de instalação (o jogo volta a pedir a ISO/ROM).'
                  : '.'}
              </p>

              <div className="p-3 rounded-md bg-[#131c27] border border-[#2a3c52] space-y-1 min-w-0">
                <div className="font-bold text-white truncate">{romRemoval.entry.fileName}</div>
                <div className="text-[11px] text-[#6cc034]">{formatBytes(romRemoval.entry.size)}</div>
                <div className="font-mono text-[10px] text-[#8f98a0] break-all">{romRemoval.entry.filePath}</div>
              </div>

              {romRemoval.canDeleteFile ? (
                <label className="p-3.5 rounded-md bg-[#131c27] border border-[#2a3c52] flex items-start gap-3 cursor-pointer select-none hover:border-[#416082]">
                  <input
                    type="checkbox"
                    checked={deleteRomFile}
                    onChange={(e) => setDeleteRomFile(e.target.checked)}
                    className="mt-0.5 accent-[#1a9fff]"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-[#67c1f5] shrink-0" />
                      <span>Excluir também o arquivo do computador</span>
                    </div>
                    <p className="text-[11px] text-[#8f98a0] leading-relaxed">
                      Apaga o arquivo de verdade e libera {formatBytes(romRemoval.entry.size)}. Sem marcar, o
                      arquivo continua no computador e só sai da lista do RecompHUB (se ele estiver na pasta do
                      Cofre, uma nova varredura em Configurações pode registrá-lo de novo).
                    </p>
                  </div>
                </label>
              ) : (
                <p className="text-[11px] text-[#8f98a0] leading-relaxed">
                  Esta pasta é sua e fica onde está no computador: o RecompHUB só remove o caminho e nunca apaga
                  pastas que você escolheu.
                </p>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#263649]">
                <button
                  onClick={() => setRomRemoval(null)}
                  disabled={actionBusy}
                  autoFocus
                  className="px-4 py-2 rounded-md bg-[#2a3846] hover:bg-[#37495b] text-xs font-bold uppercase tracking-wider text-[#dcdedf]"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmRemoveRom}
                  disabled={actionBusy}
                  className={`px-5 py-2 rounded-md text-xs font-bold uppercase tracking-wider text-white shadow ${
                    romRemoval.canDeleteFile && deleteRomFile
                      ? 'bg-[#b83232] hover:bg-[#d43b3b]'
                      : 'steam-btn-blue'
                  }`}
                >
                  {actionBusy
                    ? 'Removendo...'
                    : romRemoval.canDeleteFile && deleteRomFile
                      ? 'Remover e excluir arquivo'
                      : 'Remover caminho'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
