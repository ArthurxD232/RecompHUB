import React, { useEffect, useState } from 'react'
import { Download, ExternalLink, FolderPlus } from 'lucide-react'
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
      setCatalog(result.games)
      setCatalogSource(result.source)
      setLastUpdated(result.lastUpdated)
    })

    const unsubCommunity = window.api.onCommunityUpdated((result) => {
      setCommunityPorts(result.ports)
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

  const handleQuickAction = async (
    game: CatalogGame,
    e: React.MouseEvent
  ): Promise<void> => {
    e.stopPropagation()
    const inst = library.find((i) => i.gameId === game.id)
    if (inst && inst.status === 'READY_TO_PLAY') {
      try {
        await window.api.launchGame(game.id)
      } catch {
        setSelectedGame(game)
      }
    } else {
      setSelectedGame(game)
    }
  }

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

  const topTabs: { id: NavTab; label: string; count?: number; badgeActive?: boolean }[] = [
    { id: 'catalog', label: 'CATÁLOGO', count: catalog.length },
    { id: 'community', label: 'COMUNIDADE', count: communityPorts.length },
    { id: 'library', label: 'BIBLIOTECA', count: library.length },
    {
      id: 'downloads',
      label: 'DOWNLOADS',
      count: activeDownloadTasks.length > 0 ? activeDownloadTasks.length : downloads.length,
      badgeActive: activeDownloadTasks.length > 0
    },
    { id: 'settings', label: 'CONFIGURAÇÕES' }
  ]

  return (
    <div className="flex flex-col h-screen w-screen bg-[#171a21] text-[#dcdedf] overflow-hidden">
      {/* 1. Steam Top Global Navigation Bar */}
      <header className="h-12 shrink-0 bg-[#171d25] border-b border-[#28303b] px-5 flex items-center justify-between select-none">
        <div className="flex items-center gap-8">
          {/* Brand Logo */}
          <div
            onClick={() => {
              setSelectedGame(null)
              setActiveTab('catalog')
            }}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <img
              src={appIcon}
              alt="RecompHUB"
              className="w-8 h-8 rounded-[4px] object-contain shadow-sm group-hover:scale-105 transition-transform"
            />
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-black tracking-wider text-white">
                Recomp<span className="text-[#1a9fff]">HUB</span>
              </span>
              <span className="px-1.5 py-0.5 rounded-[2px] bg-[#212934] border border-[#2f3b4a] text-[9px] font-bold uppercase tracking-wider text-[#67c1f5]">
                beta-0.1
              </span>
            </div>
          </div>

          {/* Steam Uppercase Navigation Links */}
          <nav className="flex items-center gap-6">
            {topTabs.map((t) => {
              const isActive = activeTab === t.id && !selectedGame
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedGame(null)
                    setActiveTab(t.id)
                  }}
                  className={`relative py-3 text-[13px] font-bold uppercase tracking-wider transition-colors ${
                    isActive
                      ? 'text-[#1a9fff]'
                      : 'text-[#b8bcbf] hover:text-white'
                  }`}
                >
                  <span>{t.label}</span>
                  {t.count !== undefined && t.count > 0 && (
                    <span
                      className={`ml-1.5 text-[11px] font-normal ${
                        t.badgeActive
                          ? 'px-1.5 py-0.5 rounded-[2px] bg-[#1a9fff] text-[#171d25] font-bold animate-pulse'
                          : 'opacity-75'
                      }`}
                    >
                      {t.badgeActive ? t.count : `(${t.count})`}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#1a9fff]" />
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Right Top Status */}
        <div className="flex items-center gap-3 text-xs text-[#8f98a0]">
          <span className="px-2 py-0.5 bg-[#212934] border border-[#2f3b4a] rounded-[2px] text-[11px]">
            ISOs/ROMs no Cofre: <strong className="text-white">{vaultEntries.length}</strong>
          </span>
        </div>
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
          onSelectGame={(game) => setSelectedGame(game)}
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
      <footer className="h-9 shrink-0 bg-[#171d25] border-t border-[#28303b] px-4 flex items-center justify-between text-[11px] text-[#8f98a0] select-none">
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
