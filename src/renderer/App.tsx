import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download,
  ExternalLink,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  Library as LibraryIcon,
  Settings as SettingsIcon,
  Users
} from 'lucide-react'
import { Sidebar, NavTab } from './components/Sidebar'
import { Catalog } from './pages/Catalog'
import { Community } from './pages/Community'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { DownloadManager } from './components/DownloadManager'
import { GameModal } from './components/GameModal'
import appIcon from './assets/icon.png'
import {
  AppSettings,
  CatalogGame,
  DownloadTaskProgress,
  InstalledGame,
  RomVaultEntry,
  UninstallGameOptions
} from '../shared/types'

export function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<NavTab>('catalog')
  const [catalog, setCatalog] = useState<CatalogGame[]>([])
  const [catalogSource, setCatalogSource] = useState<
    'live' | 'cache' | 'fallback'
  >('cache')
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  // Community Ports State
  const [communityPorts, setCommunityPorts] = useState<CatalogGame[]>([])
  const [communitySource, setCommunitySource] = useState<
    'live' | 'cache' | 'fallback'
  >('cache')
  const [communityLastUpdated, setCommunityLastUpdated] = useState<string>('')
  const [isCommunityRefreshing, setIsCommunityRefreshing] = useState<boolean>(false)

  const [library, setLibrary] = useState<InstalledGame[]>([])
  const [downloads, setDownloads] = useState<DownloadTaskProgress[]>([])
  const [vaultEntries, setVaultEntries] = useState<RomVaultEntry[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [hostPlatform, setHostPlatform] = useState<string>('linux')

  const [selectedGame, setSelectedGame] = useState<CatalogGame | null>(null)
  const [scanProgress, setScanProgress] = useState<{
    current: number
    total: number
    currentFile: string
  } | null>(null)

  const loadInitialData = async (): Promise<void> => {
    setIsRefreshing(true)
    try {
      const [catRes, comRes, libRes, dlRes, vaultRes, setRes, hostRes] =
        await Promise.all([
          window.api.getCatalog(false),
          window.api.getCommunityPorts(false),
          window.api.getLibrary(),
          window.api.getActiveDownloads(),
          window.api.getVaultEntries(),
          window.api.getSettings(),
          window.api.getHostPlatform()
        ])

      setCatalog(catRes.games)
      setCatalogSource(catRes.source)
      setLastUpdated(catRes.lastUpdated)

      setCommunityPorts(comRes.ports)
      setCommunitySource(comRes.source)
      setCommunityLastUpdated(comRes.lastUpdated)

      setLibrary(libRes)
      setDownloads(dlRes)
      setVaultEntries(vaultRes)
      setSettings(setRes)
      setHostPlatform(hostRes.platform)
      console.log(`[startup] data-loaded epoch=${Date.now()}`)
    } catch (err) {
      console.error('[App] Failed to load initial data:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    loadInitialData()

    const unsubDl = window.api.onDownloadProgress((progress) => {
      setDownloads((prev) => {
        const idx = prev.findIndex((t) => t.taskId === progress.taskId)
        if (idx >= 0) {
          const copy = [...prev]
          copy[idx] = progress
          return copy
        }
        return [...prev, progress]
      })

      if (progress.stage === 'READY_TO_PLAY' || progress.stage === 'NEEDS_ROM') {
        window.api.getVaultEntries().then(setVaultEntries).catch(() => {})
      }
    })

    const unsubCatalog = window.api.onCatalogUpdated((result) => {
      if (!result.unchanged) setCatalog(result.games)
      setCatalogSource(result.source)
      setLastUpdated(result.lastUpdated)
    })

    const unsubCommunity = window.api.onCommunityUpdated((result) => {
      if (!result.unchanged) setCommunityPorts(result.ports)
      setCommunitySource(result.source)
      setCommunityLastUpdated(result.lastUpdated)
    })

    const unsubLib = window.api.onLibraryUpdated((updatedLib) => {
      setLibrary(updatedLib)
    })

    const unsubScan = window.api.onVaultScanProgress((data) => {
      setScanProgress(data)
    })

    return () => {
      unsubDl()
      unsubCatalog()
      unsubCommunity()
      unsubLib()
      unsubScan()
    }
  }, [])

  const handleRefreshCatalog = async (): Promise<void> => {
    setIsRefreshing(true)
    try {
      const res = await window.api.getCatalog(true)
      setCatalog(res.games)
      setCatalogSource(res.source)
      setLastUpdated(res.lastUpdated)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleRefreshCommunity = async (): Promise<void> => {
    setIsCommunityRefreshing(true)
    try {
      const res = await window.api.getCommunityPorts(true)
      setCommunityPorts(res.ports)
      setCommunitySource(res.source)
      setCommunityLastUpdated(res.lastUpdated)
    } finally {
      setIsCommunityRefreshing(false)
    }
  }

  const handleInstallGame = async (
    game: CatalogGame,
    pickedRomPath?: string,
    requirementId?: string
  ): Promise<void> => {
    await window.api.installGame(game.id, pickedRomPath, requirementId)
  }

  // Referência estável: os cards (React.memo) não precisam renderizar de novo a cada atualização de download
  const libraryRef = useRef(library)
  libraryRef.current = library

  const handleQuickAction = useCallback(
    async (game: CatalogGame, e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      const inst = libraryRef.current.find((i) => i.gameId === game.id)
      if (inst && inst.status === 'READY_TO_PLAY') {
        try {
          await window.api.launchGame(game.id)
        } catch {
          setSelectedGame(game)
        }
      } else {
        setSelectedGame(game)
      }
    },
    []
  )

  const handleLaunchGame = async (gameId: string): Promise<void> => {
    await window.api.launchGame(gameId)
  }

  const handleStopGame = async (gameId: string): Promise<void> => {
    await window.api.stopGame(gameId)
  }

  const handleReapplyRecipe = async (gameId: string): Promise<void> => {
    await window.api.reapplyRecipe(gameId)
    const updatedLib = await window.api.getLibrary()
    setLibrary(updatedLib)
  }

  const handleUninstallGame = async (
    gameId: string,
    options?: UninstallGameOptions
  ): Promise<void> => {
    await window.api.uninstallGame(gameId, options)
    const [updatedLib, updatedVault] = await Promise.all([
      window.api.getLibrary(),
      window.api.getVaultEntries()
    ])
    setLibrary(updatedLib)
    setVaultEntries(updatedVault)
  }

  const handleUpdateSettings = async (
    partial: Partial<AppSettings>
  ): Promise<void> => {
    const updated = await window.api.updateSettings(partial)
    setSettings(updated)
  }

  const handleScanVault = async (customDir?: string): Promise<void> => {
    const res = await window.api.scanRomVault(customDir)
    setVaultEntries(res.entries)
    setScanProgress(null)
  }

  const refreshVaultAndSettings = async (): Promise<void> => {
    const [v, s] = await Promise.all([
      window.api.getVaultEntries(),
      window.api.getSettings()
    ])
    setVaultEntries(v)
    setSettings(s)
  }

  const activeDownloadTasks = downloads.filter(
    (d) => !['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR'].includes(d.stage)
  )
  const activeDownloadTask = activeDownloadTasks[activeDownloadTasks.length - 1]

  const selectedInstalled = selectedGame
    ? library.find((i) => i.gameId === selectedGame.id)
    : undefined

  const selectedDownload = selectedGame
    ? [...downloads]
        .reverse()
        .find(
          (d) =>
            d.gameId === selectedGame.id &&
            !['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR'].includes(d.stage)
        )
    : undefined

  const selectedLastTask = selectedGame
    ? [...downloads].reverse().find((d) => d.gameId === selectedGame.id)
    : undefined

  const topTabs: {
    id: NavTab
    label: string
    icon: React.ReactNode
    count?: number
    badgeActive?: boolean
  }[] = [
    { id: 'catalog', label: 'Catálogo', icon: <LayoutGrid className="w-4 h-4" />, count: catalog.length },
    { id: 'community', label: 'Comunidade', icon: <Users className="w-4 h-4" />, count: communityPorts.length },
    { id: 'library', label: 'Biblioteca', icon: <LibraryIcon className="w-4 h-4" />, count: library.length },
    {
      id: 'downloads',
      label: 'Downloads',
      icon: <Download className="w-4 h-4" />,
      count: activeDownloadTasks.length > 0 ? activeDownloadTasks.length : downloads.length,
      badgeActive: activeDownloadTasks.length > 0
    },
    { id: 'settings', label: 'Configurações', icon: <SettingsIcon className="w-4 h-4" /> }
  ]

  return (
    <div className="flex flex-col h-screen w-screen bg-[#171a21] text-[#dcdedf] overflow-hidden">
      {/* 1. Barra superior */}
      <header className="h-14 shrink-0 bg-gradient-to-b from-[#1d2532] to-[#161c25] border-b border-[#28323f] px-5 flex items-center justify-between select-none">
        <div className="flex items-center gap-7 min-w-0">
          <button
            type="button"
            onClick={() => {
              setSelectedGame(null)
              setActiveTab('catalog')
            }}
            aria-label="RecompHUB — ir para o catálogo"
            className="flex items-center gap-2.5 group shrink-0"
          >
            <img
              src={appIcon}
              alt=""
              className="w-8 h-8 rounded-md object-contain shadow-md group-hover:scale-105 transition-transform"
            />
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-black tracking-wide text-white">
                Recomp<span className="text-[#1a9fff]">HUB</span>
              </span>
              <span className="px-1.5 py-0.5 rounded-[3px] bg-[#1a9fff]/15 text-[9px] font-bold uppercase tracking-wider text-[#66c0f4]">
                beta-0.2
              </span>
            </div>
          </button>

          <nav className="flex items-center gap-1" aria-label="Navegação principal">
            {topTabs.map((t) => {
              const isActive = activeTab === t.id && !selectedGame
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => {
                    setSelectedGame(null)
                    setActiveTab(t.id)
                  }}
                  className={`relative flex items-center gap-2 px-3.5 h-14 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                    isActive ? 'text-white' : 'text-[#9aa5b1] hover:text-white'
                  }`}
                >
                  <span className={isActive ? 'text-[#1a9fff]' : ''}>{t.icon}</span>
                  <span>{t.label}</span>
                  {t.count !== undefined && t.count > 0 && (
                    <span
                      className={`min-w-[20px] px-1.5 py-0.5 rounded-full text-[10px] leading-none text-center font-bold ${
                        t.badgeActive
                          ? 'bg-[#1a9fff] text-[#0e141b] animate-pulse'
                          : 'bg-white/10 text-[#b8c4d0]'
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t bg-[#1a9fff] shadow-[0_0_10px_rgba(26,159,255,0.8)]" />
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        <button
          type="button"
          onClick={() => {
            setSelectedGame(null)
            setActiveTab('settings')
          }}
          title="Arquivos de ISO/ROM guardados no cofre do RecompHUB"
          className="flex items-center gap-2 px-3 min-h-[32px] rounded-full bg-white/[0.06] hover:bg-white/10 text-[11px] text-[#9aa5b1] transition-colors shrink-0"
        >
          <HardDrive className="w-3.5 h-3.5 text-[#66c0f4]" aria-hidden="true" />
          <span>
            Cofre: <strong className="text-white">{vaultEntries.length}</strong>{' '}
            {vaultEntries.length === 1 ? 'arquivo' : 'arquivos'}
          </span>
        </button>
      </header>

      {/* 2. Middle Split Area: Left Steam Game Tree + Right Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          games={activeTab === 'community' ? communityPorts : catalog}
          library={library}
          selectedGame={selectedGame}
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setSelectedGame(null)
            setActiveTab(tab)
          }}
          onSelectGame={setSelectedGame}
        />

        <main className="flex-1 h-full overflow-y-auto bg-[#1b2838]">
          {selectedGame ? (
            <GameModal
              game={selectedGame}
              installed={selectedInstalled}
              library={library}
              downloads={downloads}
              activeDownload={selectedDownload}
              lastDownloadTask={selectedLastTask}
              onClose={() => setSelectedGame(null)}
              onInstall={handleInstallGame}
              onLaunch={handleLaunchGame}
              onStop={handleStopGame}
              onReapplyRecipe={handleReapplyRecipe}
              onUninstall={handleUninstallGame}
              onRomImported={refreshVaultAndSettings}
              onOpenDownloads={() => {
                setSelectedGame(null)
                setActiveTab('downloads')
              }}
            />
          ) : (
            <>
              {activeTab === 'catalog' && (
                <Catalog
                  games={catalog}
                  library={library}
                  downloads={downloads}
                  lastUpdated={lastUpdated}
                  source={catalogSource}
                  isRefreshing={isRefreshing}
                  hostPlatform={hostPlatform}
                  onRefresh={handleRefreshCatalog}
                  onSelectGame={setSelectedGame}
                  onQuickAction={handleQuickAction}
                />
              )}

              {activeTab === 'community' && (
                <Community
                  ports={communityPorts}
                  library={library}
                  downloads={downloads}
                  lastUpdated={communityLastUpdated}
                  source={communitySource}
                  isRefreshing={isCommunityRefreshing}
                  hostPlatform={hostPlatform}
                  onRefresh={handleRefreshCommunity}
                  onSelectGame={setSelectedGame}
                  onQuickAction={handleQuickAction}
                />
              )}

              {activeTab === 'library' && (
                <Library
                  library={library}
                  catalog={catalog}
                  onLaunch={handleLaunchGame}
                  onStop={handleStopGame}
                  onSelectGame={setSelectedGame}
                  onUninstall={handleUninstallGame}
                  onGoToCatalog={() => setActiveTab('catalog')}
                />
              )}

              {activeTab === 'downloads' && (
                <DownloadManager
                  tasks={downloads}
                  onLaunchGame={handleLaunchGame}
                />
              )}

              {activeTab === 'settings' && (
                <Settings
                  settings={settings}
                  vaultEntries={vaultEntries}
                  scanProgress={scanProgress}
                  onUpdateSettings={handleUpdateSettings}
                  onScanVault={handleScanVault}
                  onVaultChanged={refreshVaultAndSettings}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* 3. Steam Bottom Footer Bar */}
      <footer className="relative h-9 shrink-0 bg-[#141a22] border-t border-[#28303b] px-4 flex items-center justify-between text-[11px] text-[#8f98a0] select-none">
        {activeDownloadTask && (
          <span
            className="rh-progress-line"
            style={{ width: `${activeDownloadTask.overallProgress}%` }}
            aria-hidden="true"
          />
        )}
        <button
          onClick={() => {
            setSelectedGame(null)
            setActiveTab('settings')
          }}
          className="hover:text-white flex items-center gap-1.5 font-semibold uppercase tracking-wider"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[#67c1f5]" />
          <span>GERENCIAR COFRE DE ISOs / ROMs</span>
        </button>

        <button
          onClick={() => {
            setSelectedGame(null)
            setActiveTab('downloads')
          }}
          className="hover:text-white flex items-center gap-2 font-semibold uppercase tracking-wider"
        >
          <Download className="w-3.5 h-3.5 text-[#1a9fff]" />
          {activeDownloadTask ? (
            <span className="text-[#1a9fff]">
              {activeDownloadTask.stage === 'EXTRACTING_ISO'
                ? 'DESCOMPACTANDO ISO'
                : 'INSTALANDO'}
              : {activeDownloadTask.gameTitle} ({activeDownloadTask.overallProgress}%)
            </span>
          ) : (
            <span>GERENCIAR DOWNLOADS</span>
          )}
        </button>

        <div className="flex items-center gap-4 uppercase tracking-wider text-[10px]">
          <button
            onClick={() => window.api.openExternalUrl('https://portsdr.com/')}
            className="hover:text-[#67c1f5] flex items-center gap-1 transition-colors"
            title="Catálogo alimentado por PortsDR.com (criado por TinSoldier97)"
          >
            <span>CATÁLOGO:</span>
            <strong className="text-[#c7d5e0]">PORTSDR.COM (TINSOLDIER97)</strong>
            <ExternalLink className="w-2.5 h-2.5 text-[#67c1f5]" />
          </button>
          <span className="text-[#28303b]">|</span>
          <div>
            RUNTIME:{' '}
            <strong className="text-[#c7d5e0]">
              {hostPlatform === 'linux' ? 'LINUX (PROTON / UMU-RUN)' : 'WINDOWS NATIVO'}
            </strong>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
