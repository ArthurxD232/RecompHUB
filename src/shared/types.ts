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
  /** true quando a sincronização não encontrou mudanças (games vem vazio e deve ser ignorado). */
  unchanged?: boolean
}

export interface RomRequirement {
  id: string
  label: string
  /** 'folder' = pasta do jogo (dumps de PS4 etc.); 'patch' = patches/atualizações/DLC opcionais */
  type: 'rom' | 'iso' | 'bios' | 'bin_cue' | 'folder' | 'patch'
  expectedFilename: string
  sha1?: string[]
  md5?: string[]
  extensions: string[]
  optional?: boolean
  region?: string
  /** Mantém o nome original do arquivo ao parear (útil quando o formato varia: .iso, .rvz, .wbfs...). */
  keepOriginalName?: boolean
  /** Arquivo que identifica a raiz do jogo numa pasta (ex.: eboot.bin nos dumps de PS4). */
  markerFile?: string
  /** Aceita vários arquivos/pastas (patches e DLC). */
  multiple?: boolean
  /** Subpasta da instalação onde os itens são vinculados (padrão dos patches: "patches"). */
  targetSubdir?: string
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
  /**
   * Argumentos extras passados ao executável ao jogar. Aceita os marcadores
   * {ROM_PATH} (ISO/ROM pareada na pasta do jogo) e {INSTALL_DIR}.
   * Argumentos com {ROM_PATH} são omitidos se nenhuma ISO/ROM estiver pareada.
   */
  launchArgs?: string[]
  /** Página com o passo a passo para obter os arquivos do jogo (mostrada na tela do jogo). */
  helpUrl?: string
  /**
   * Atalhos extras para a pasta/arquivo de um requisito, em lugares que o port procura sozinho
   * (ex.: o launcher do Bloodborne olha a pasta "CUSA03173" ao lado da pasta do port).
   * O caminho é relativo à pasta de instalação e precisa ficar dentro da pasta de jogos do app.
   */
  aliasLinks?: { requirementId: string; path: string }[]
  requirements: RomRequirement[]
  notes?: string
}

export interface GamePortInfo {
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

  // Explanatory and comparison metadata
  toolchainType: string
  howItWorks: string
  description: string
  highlights: string[]
  differences?: string
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

  // Multi-port canonical group properties
  canonicalId?: string
  ports?: GamePortInfo[]
  selectedPortId?: string
  toolchainType?: string
  howItWorks?: string
  description?: string
  highlights?: string[]
  differences?: string

  // Community extensions
  isCommunity?: boolean
  submittedBy?: string
  approvedAt?: string
  verificationLevel?: VerificationLevel
}

export type VerificationLevel = 'verified' | 'community' | 'experimental'

export interface CommunityPort {
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
  isAiAssisted?: boolean
  platforms: OSPlatform[]
  updatedAt: string
  submittedBy?: string
  approvedAt?: string
  verificationLevel?: VerificationLevel
  toolchainType?: string
  howItWorks?: string
  description?: string
  highlights?: string[]
  differences?: string
  recipe?: GameRecipe
  inferredFamily?: RecipeFamily
  romRequirement?: RomRequirement
}

export interface CommunityResult {
  ports: CatalogGame[]
  lastUpdated: string
  source: 'live' | 'cache' | 'fallback'
  /** true quando a sincronização não encontrou mudanças (ports vem vazio e deve ser ignorado). */
  unchanged?: boolean
}

export interface InspectedGitHubRepo {
  owner: string
  repo: string
  fullName: string
  githubUrl: string
  title: string
  projectName: string
  description: string
  stars: number
  forks: number
  defaultBranch: string
  hasReleases: boolean
  latestTagName?: string
  latestReleaseName?: string
  latestReleaseUrl?: string
  publishedAt?: string
  assets: {
    name: string
    size: number
    browserDownloadUrl: string
  }[]
  detectedPlatforms: OSPlatform[]
  suggestedConsoleBadge?: string
  suggestedToolchain?: string
  avatarUrl?: string
}

export interface SubmitPortPayload {
  githubUrl: string
  title: string
  projectName: string
  console: string
  consoleBadge: string
  description: string
  toolchainType: string
  howItWorks?: string
  highlights?: string[]
  romExtension?: string
  submittedBy?: string
  notes?: string
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
  /** O item é uma pasta (dump do jogo, DLC...). Não é copiado nem apagado fora do cofre. */
  isDirectory?: boolean
  /** Patches/atualizações nunca contam como o arquivo principal do jogo. */
  kind?: 'main' | 'patch'
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
  | 'CANCELLED'

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
  pairedPatchPaths?: string[]
  aliasLinkPaths?: string[]
  launchFullscreen?: boolean
  launchArgs?: string[]
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
  /** Arquivo de chaves (keys.json, formato do shadPS4) para extrair PKGs do PS4. Vazio = procurar sozinho. */
  pkgKeysPath: string
  /** PKG Extractor (ShadPs4Plus) que o usuário já tem instalado. Vazio = procurar sozinho. */
  pkgExtractorPath: string
  preferNativeLinuxBuild: boolean
  createPortableTxtByDefault: boolean
  linkStrategy: 'symlink' | 'hardlink' | 'copy'
}

export interface PkgKeysStatus {
  /** Arquivo de chaves em uso (escolhido por você ou encontrado do shadPS4), se houver */
  path: string | null
  source: 'config' | 'detected' | 'none'
  valid: boolean
  error?: string
}

export interface PkgExtractorStatus {
  /** Executável do PKG Extractor em uso (escolhido por você ou encontrado no computador), se houver */
  path: string | null
  source: 'config' | 'detected' | 'none'
  /** Abre e responde como o PKG Extractor neste sistema */
  valid: boolean
  error?: string
}

export interface RomAvailabilityStatus {
  ready: boolean
  source: 'local_vault' | 'missing'
  matchedRequirements: {
    requirement: RomRequirement
    status: 'local_vault' | 'missing'
    localEntry?: RomVaultEntry
    /** Todos os itens vinculados (requisitos com `multiple`, como os patches). */
    localEntries?: RomVaultEntry[]
    /** O item registrado existe, mas não serve (ex.: a pasta não tem o eboot.bin). */
    problem?: string
  }[]
}

export interface SteamShortcutResult {
  success: boolean
  alreadyAdded?: boolean
  steamRunning?: boolean
  userCount?: number
  message?: string
  error?: string
}

export interface RecompHubAPI {
  // Catalog
  getCatalog: (forceRefresh?: boolean) => Promise<CatalogResult>
  onCatalogUpdated: (callback: (result: CatalogResult) => void) => () => void
  resolveRelease: (gameId: string) => Promise<ResolvedReleaseInfo>

  // Community Ports & Submissions
  getCommunityPorts: (forceRefresh?: boolean) => Promise<CommunityResult>
  onCommunityUpdated: (callback: (result: CommunityResult) => void) => () => void
  inspectGitHubRepoForPort: (githubUrl: string) => Promise<InspectedGitHubRepo>
  generateCommunityIssueUrl: (payload: SubmitPortPayload) => Promise<string>

  // Local ROM/ISO Vault & Selection (supports raw ISO/ROM or .zip/.7z/.rar/.tar.gz)
  getVaultEntries: () => Promise<RomVaultEntry[]>
  scanRomVault: (customDir?: string) => Promise<{
    entries: RomVaultEntry[]
    scannedCount: number
  }>
  checkRomAvailability: (gameId: string) => Promise<RomAvailabilityStatus>
  pickRomFileForGame: (gameId: string, requirementId?: string) => Promise<string | null>
  pickPatchesForGame: (
    gameId: string,
    requirementId: string | undefined,
    mode: 'files' | 'folder'
  ) => Promise<string[]>
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
  cancelDownload: (taskId: string) => Promise<boolean>
  clearFinishedDownloads: () => Promise<DownloadTaskProgress[]>
  clearDownloadTask: (taskId: string) => Promise<DownloadTaskProgress[]>

  // Library & Runner
  getLibrary: () => Promise<InstalledGame[]>
  launchGame: (gameId: string) => Promise<{ pid?: number; command: string }>
  stopGame: (gameId: string) => Promise<void>
  openGameFolder: (gameId: string) => Promise<void>
  selectExecutableManually: (gameId: string) => Promise<InstalledGame | null>
  addGameToSteam: (gameId: string) => Promise<SteamShortcutResult>
  removeGameFromSteam: (gameId: string) => Promise<{ success: boolean; removedCount: number }>
  isGameInSteam: (gameId: string) => Promise<boolean>

  // Settings & System
  getSettings: () => Promise<AppSettings>
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  selectDirectory: (title?: string) => Promise<string | null>
  selectFile: (title?: string, extensions?: string[]) => Promise<string | null>
  getPkgExtractorStatus: () => Promise<PkgExtractorStatus>
  pickPkgExtractor: () => Promise<PkgExtractorStatus>
  getPkgKeysStatus: () => Promise<PkgKeysStatus>
  pickPkgKeysFile: () => Promise<PkgKeysStatus>
  detectLinuxRunners: () => Promise<DetectedLinuxRunner[]>
  openExternalUrl: (url: string) => Promise<void>
  getHostPlatform: () => Promise<{ platform: string; arch: string }>

  // Event Subscriptions
  onDownloadProgress: (callback: (progress: DownloadTaskProgress) => void) => () => void
  onDownloadsUpdated?: (callback: (tasks: DownloadTaskProgress[]) => void) => () => void
  onLibraryUpdated: (callback: (library: InstalledGame[]) => void) => () => void
  onVaultScanProgress: (
    callback: (data: { current: number; total: number; currentFile: string }) => void
  ) => () => void
}
