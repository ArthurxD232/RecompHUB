import { contextBridge, ipcRenderer } from 'electron'
import {
  AppSettings,
  CatalogResult,
  CommunityResult,
  DownloadTaskProgress,
  InstalledGame,
  RecompHubAPI,
  SubmitPortPayload,
  UninstallGameOptions
} from '../shared/types'

const api: RecompHubAPI = {
  // Catalog
  getCatalog: (forceRefresh?: boolean) =>
    ipcRenderer.invoke('catalog:get', forceRefresh),
  onCatalogUpdated: (callback: (result: CatalogResult) => void) => {
    const handler = (_e: any, data: CatalogResult): void => callback(data)
    ipcRenderer.on('event:catalogUpdated', handler)
    return () => ipcRenderer.removeListener('event:catalogUpdated', handler)
  },
  resolveRelease: (gameId: string) =>
    ipcRenderer.invoke('catalog:resolveRelease', gameId),

  // Community Ports & Submissions
  getCommunityPorts: (forceRefresh?: boolean) =>
    ipcRenderer.invoke('community:get', forceRefresh),
  onCommunityUpdated: (callback: (result: CommunityResult) => void) => {
    const handler = (_e: any, data: CommunityResult): void => callback(data)
    ipcRenderer.on('event:communityUpdated', handler)
    return () => ipcRenderer.removeListener('event:communityUpdated', handler)
  },
  inspectGitHubRepoForPort: (githubUrl: string) =>
    ipcRenderer.invoke('community:inspectRepo', githubUrl),
  generateCommunityIssueUrl: (payload: SubmitPortPayload) =>
    ipcRenderer.invoke('community:generateIssueUrl', payload),

  // ROM Vault & Selection
  getVaultEntries: () => ipcRenderer.invoke('vault:getEntries'),
  scanRomVault: (customDir?: string) =>
    ipcRenderer.invoke('vault:scan', customDir),
  checkRomAvailability: (gameId: string) =>
    ipcRenderer.invoke('vault:checkAvailability', gameId),
  pickRomFileForGame: (gameId: string, requirementId?: string) =>
    ipcRenderer.invoke('vault:pickFile', gameId, requirementId),
  pickPatchesForGame: (
    gameId: string,
    requirementId: string | undefined,
    mode: 'files' | 'folder'
  ) => ipcRenderer.invoke('vault:pickPatches', gameId, requirementId, mode),
  importRomFileManually: (
    gameId: string,
    requirementId?: string,
    pickedPath?: string
  ) =>
    ipcRenderer.invoke(
      'vault:importRomManually',
      gameId,
      requirementId,
      pickedPath
    ),

  // Installation & Recipe Engine
  installGame: (
    gameId: string,
    pickedRomPath?: string,
    requirementId?: string
  ) =>
    ipcRenderer.invoke(
      'installer:install',
      gameId,
      pickedRomPath,
      requirementId
    ),
  reapplyRecipe: (gameId: string) =>
    ipcRenderer.invoke('installer:reapplyRecipe', gameId),
  uninstallGame: (gameId: string, options?: UninstallGameOptions) =>
    ipcRenderer.invoke('installer:uninstall', gameId, options),
  removeRomVaultEntry: (filePath: string, deleteFromDisk?: boolean) =>
    ipcRenderer.invoke('vault:removeEntry', filePath, deleteFromDisk),
  setGameFullscreen: (gameId: string, fullscreen: boolean) =>
    ipcRenderer.invoke('library:setFullscreen', gameId, fullscreen),
  getActiveDownloads: () => ipcRenderer.invoke('installer:getActiveDownloads'),
  cancelDownload: (taskId: string) =>
    ipcRenderer.invoke('installer:cancelDownload', taskId),
  clearFinishedDownloads: () =>
    ipcRenderer.invoke('installer:clearFinishedDownloads'),
  clearDownloadTask: (taskId: string) =>
    ipcRenderer.invoke('installer:clearDownloadTask', taskId),

  // Library & Runner
  getLibrary: () => ipcRenderer.invoke('library:get'),
  launchGame: (gameId: string) => ipcRenderer.invoke('library:launch', gameId),
  stopGame: (gameId: string) => ipcRenderer.invoke('library:stop', gameId),
  openGameFolder: (gameId: string) =>
    ipcRenderer.invoke('library:openFolder', gameId),
  selectExecutableManually: (gameId: string) =>
    ipcRenderer.invoke('library:selectExecutable', gameId),
  addGameToSteam: (gameId: string) =>
    ipcRenderer.invoke('steam:addGame', gameId),
  removeGameFromSteam: (gameId: string) =>
    ipcRenderer.invoke('steam:removeGame', gameId),
  isGameInSteam: (gameId: string) =>
    ipcRenderer.invoke('steam:isGameAdded', gameId),

  // Settings & System
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', partial),
  selectDirectory: (title?: string) =>
    ipcRenderer.invoke('system:selectDirectory', title),
  selectFile: (title?: string, extensions?: string[]) =>
    ipcRenderer.invoke('system:selectFile', title, extensions),
  getPkgExtractorStatus: () => ipcRenderer.invoke('pkg:extractorStatus'),
  pickPkgExtractor: () => ipcRenderer.invoke('pkg:pickExtractor'),
  getPkgKeysStatus: () => ipcRenderer.invoke('pkg:keysStatus'),
  pickPkgKeysFile: () => ipcRenderer.invoke('pkg:pickKeysFile'),
  detectLinuxRunners: () => ipcRenderer.invoke('system:detectLinuxRunners'),
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('system:openExternal', url),
  getHostPlatform: () => ipcRenderer.invoke('system:getHostPlatform'),

  // Event Subscriptions
  onDownloadProgress: (callback: (progress: DownloadTaskProgress) => void) => {
    const handler = (_e: any, data: DownloadTaskProgress): void =>
      callback(data)
    ipcRenderer.on('event:downloadProgress', handler)
    return () => ipcRenderer.removeListener('event:downloadProgress', handler)
  },
  onDownloadsUpdated: (callback: (tasks: DownloadTaskProgress[]) => void) => {
    const handler = (_e: any, data: DownloadTaskProgress[]): void =>
      callback(data)
    ipcRenderer.on('event:downloadsUpdated', handler)
    return () => ipcRenderer.removeListener('event:downloadsUpdated', handler)
  },
  onLibraryUpdated: (callback: (library: InstalledGame[]) => void) => {
    const handler = (_e: any, data: InstalledGame[]): void => callback(data)
    ipcRenderer.on('event:libraryUpdated', handler)
    return () => ipcRenderer.removeListener('event:libraryUpdated', handler)
  },
  onVaultScanProgress: (
    callback: (data: {
      current: number
      total: number
      currentFile: string
    }) => void
  ) => {
    const handler = (
      _e: any,
      data: { current: number; total: number; currentFile: string }
    ): void => callback(data)
    ipcRenderer.on('event:vaultScanProgress', handler)
    return () => ipcRenderer.removeListener('event:vaultScanProgress', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
