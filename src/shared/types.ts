export type OSPlatform = 'Windows' | 'Linux' | 'macOS' | 'Android'

export type RecipeFamily =
  | 'N64Recomp'
  | 'PSXRecomp'
  | 'XenonRecomp'
  | 'AssetExtractor'
  | 'GenericNative'

export type ReleaseStatus = 'Latest' | 'Pre-release' | 'Source Only'

export interface CatalogResult {
  games: CatalogGame[]
  lastUpdated: string
  source: 'live' | 'cache' | 'fallback'
}

export interface RomRequirement {
  id: string
  label: string
  type: 'rom' | 'iso' | 'bios' | 'bin_cue'
  expectedFilename: string
  sha1?: string[]
  md5?: string[]
  extensions: string[]
  optional?: boolean
  region?: string
}

export interface GameRecipe {
  id: string
  repoFullName: string
  aliases?: string[]
  title: string
  console: string
  family: RecipeFamily
  createPortableTxt?: boolean
  configFileToPatch?: {
    filename: string
    romKey: string
  }
  extractorConfig?: {
    binaryPatterns: string[]
    cliArgs: string[]
    expectedOutputFiles: string[]
  }
  xenonConfig?: {
    extractXisoArgs?: string[]
    targetSubdir?: string
  }
  executableHints?: string[]
  requirements: RomRequirement[]
  notes?: string
}

export interface CatalogGame {
  id: string
  title: string
  projectName: string
  repoFullName: string
  releaseRepoFullName?: string
  githubUrl: string
  releaseUrl?: string
  websiteUrl?: string
  imageUrl?: string
  console: string
  consoleBadge: string
  version: string
  releaseStatus: ReleaseStatus
  isAiAssisted: boolean
  platforms: OSPlatform[]
  updatedAt: string
  recipe?: GameRecipe
  inferredFamily: RecipeFamily
}

export interface GitHubAsset {
  name: string
  browserDownloadUrl: string
  size: number
  contentType: string
}

export interface ResolvedReleaseInfo {
  repoFullName: string
  tagName: string
  name: string
  publishedAt: string
  isPrerelease: boolean
  htmlUrl: string
  selectedAsset: GitHubAsset | null
  allAssets: GitHubAsset[]
  targetOs: 'linux' | 'windows' | 'macos'
  requiresCompatibilityLayer: boolean
  selectionReason: string
}

export interface RomVaultEntry {
  filePath: string
  fileName: string
  size: number
  fileModifiedAt?: number
  sha1: string
  md5: string
  extension: string
  scannedAt: string
  assignedGameIds?: string[]
  assignedRequirementIds?: string[]
  extractedFromArchive?: string
}

export type InstallStage =
  | 'QUEUED'
  | 'EXTRACTING_ISO'
  | 'RESOLVING_RELEASE'
  | 'DOWNLOADING_PORT'
  | 'EXTRACTING_ARCHIVE'
  | 'APPLYING_RECIPE'
  | 'EXTRACTING_ASSETS'
  | 'READY_TO_PLAY'
  | 'NEEDS_ROM'
  | 'RUNNING'
  | 'ERROR'

export interface DownloadTaskProgress {
  taskId: string
  gameId: string
  gameTitle: string
  projectName: string
  consoleBadge: string
  imageUrl?: string
  stage: InstallStage
  stageLabel: string
  portProgress: number
  overallProgress: number
  downloadedBytes: number
  totalBytes: number
  speedBytesPerSec: number
  logs: string[]
  error?: string
  startedAt: string
  completedAt?: string
}

export interface UninstallGameOptions {
  deleteRomFromVault?: boolean
  deleteOriginalArchive?: boolean
}

export interface InstalledGame {
  id: string
  gameId: string
  title: string
  projectName: string
  repoFullName: string
  console: string
  consoleBadge: string
  version: string
  imageUrl?: string
  installDir: string
  executablePath: string
  requiresCompatibilityLayer: boolean
  recipeFamily: RecipeFamily
  status: 'READY_TO_PLAY' | 'NEEDS_ROM' | 'RUNNING' | 'ERROR'
  romPaired: boolean
  pairedRomPaths: string[]
  portableMode: boolean
  launchFullscreen?: boolean
  playTimeSeconds: number
  lastPlayedAt?: string
  installedAt: string
  recipeLogs: string[]
}

export type LinuxRunnerType = 'auto' | 'umu-run' | 'proton' | 'wine'

export interface DetectedLinuxRunner {
  type: 'umu-run' | 'proton' | 'wine'
  name: string
  path: string
}

export interface AppSettings {
  romVaultPath: string
  installRootPath: string
  linuxRunnerType: LinuxRunnerType
  customProtonPath: string
  umuRunPath: string
  extractXisoPath: string
  githubToken: string
  preferNativeLinuxBuild: boolean
  createPortableTxtByDefault: boolean
  linkStrategy: 'symlink' | 'hardlink' | 'copy'
}

export interface RomAvailabilityStatus {
  ready: boolean
  source: 'local_vault' | 'missing'
  matchedRequirements: {
    requirement: RomRequirement
    status: 'local_vault' | 'missing'
    localEntry?: RomVaultEntry
  }[]
}

export interface RecompHubAPI {
  // Catalog
  getCatalog: (forceRefresh?: boolean) => Promise<CatalogResult>
  onCatalogUpdated: (callback: (result: CatalogResult) => void) => () => void
  resolveRelease: (gameId: string) => Promise<ResolvedReleaseInfo>

  // Local ROM/ISO Vault & Selection (supports raw ISO/ROM or .zip/.7z/.rar/.tar.gz)
  getVaultEntries: () => Promise<RomVaultEntry[]>
  scanRomVault: (customDir?: string) => Promise<{
    entries: RomVaultEntry[]
    scannedCount: number
  }>
  checkRomAvailability: (gameId: string) => Promise<RomAvailabilityStatus>
  pickRomFileForGame: (gameId: string, requirementId?: string) => Promise<string | null>
  importRomFileManually: (
    gameId: string,
    requirementId?: string,
    preselectedPath?: string
  ) => Promise<RomVaultEntry | null>

  // Installation & Recipe Engine
  installGame: (gameId: string, pickedRomPath?: string, requirementId?: string) => Promise<{ taskId: string }>
  reapplyRecipe: (gameId: string) => Promise<InstalledGame>
  uninstallGame: (gameId: string, options?: UninstallGameOptions) => Promise<void>
  removeRomVaultEntry: (filePath: string, deleteFromDisk?: boolean) => Promise<RomVaultEntry[]>
  setGameFullscreen: (gameId: string, fullscreen: boolean) => Promise<InstalledGame | null>
  getActiveDownloads: () => Promise<DownloadTaskProgress[]>

  // Library & Runner
  getLibrary: () => Promise<InstalledGame[]>
  launchGame: (gameId: string) => Promise<{ pid?: number; command: string }>
  stopGame: (gameId: string) => Promise<void>
  openGameFolder: (gameId: string) => Promise<void>
  selectExecutableManually: (gameId: string) => Promise<InstalledGame | null>

  // Settings & System
  getSettings: () => Promise<AppSettings>
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  selectDirectory: (title?: string) => Promise<string | null>
  selectFile: (title?: string, extensions?: string[]) => Promise<string | null>
  detectLinuxRunners: () => Promise<DetectedLinuxRunner[]>
  openExternalUrl: (url: string) => Promise<void>
  getHostPlatform: () => Promise<{ platform: string; arch: string }>

  // Event Subscriptions
  onDownloadProgress: (callback: (progress: DownloadTaskProgress) => void) => () => void
  onLibraryUpdated: (callback: (library: InstalledGame[]) => void) => () => void
  onVaultScanProgress: (
    callback: (data: { current: number; total: number; currentFile: string }) => void
  ) => () => void
}
