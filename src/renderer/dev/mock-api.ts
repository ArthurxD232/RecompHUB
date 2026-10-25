// Ambiente de desenvolvimento no navegador (sem Electron): `npm run dev:web`.
// Instala um `window.api` falso com dados de exemplo para iterar na interface com recarga rápida.
// Este arquivo só é carregado quando import.meta.env.DEV e window.api não existe; não vai para o build final.
import { withPatchRequirement } from '../../shared/requirements'
import {
  AppSettings,
  CatalogGame,
  CommunityPort,
  DownloadTaskProgress,
  InstalledGame,
  RecompHubAPI,
  RomAvailabilityStatus,
  RomVaultEntry
} from '../../shared/types'
import sample from './catalog-sample.json'
import communityRaw from '../../main/data/community-ports.json'

interface SampleEntry {
  t: string
  p: string
  r: string
  c: string
  pl: string[]
  i: string
  v: string
  u: string
}

const BADGES: Record<string, string> = {
  'Nintendo 64': 'N64',
  PlayStation: 'PS1',
  'PlayStation 2': 'PS2',
  'PlayStation 3': 'PS3',
  'PlayStation 4': 'PS4',
  'PlayStation Portable': 'PSP',
  GameCube: 'GameCube',
  'Game Boy Advance': 'GBA',
  'Game Boy Color': 'GBC',
  'Game Boy': 'GB',
  'Nintendo DS': 'NDS',
  'Nintendo 3DS': '3DS',
  Others: 'PC / Outros'
}

function familyFor(badge: string, name: string): CatalogGame['inferredFamily'] {
  const n = name.toLowerCase()
  if (badge === 'Xbox 360' || n.includes('xenon')) return 'XenonRecomp'
  if (badge === 'PS1') return 'PSXRecomp'
  if (badge === 'N64') return n.includes('ship') || n.includes('kart') ? 'AssetExtractor' : 'N64Recomp'
  return 'GenericNative'
}

function normalize(title: string): string {
  return title.replace(/[’']/g, "'").replace(/\(.*?\)/g, '').trim().toLowerCase()
}

function toGame(raw: Partial<CatalogGame> & { id: string; title: string }): CatalogGame {
  const badge = raw.consoleBadge || 'PC / Outros'
  const family = raw.inferredFamily || familyFor(badge, raw.projectName || '')
  return {
    projectName: '',
    repoFullName: '',
    githubUrl: '',
    console: badge,
    consoleBadge: badge,
    version: 'Latest',
    releaseStatus: 'Latest',
    isAiAssisted: false,
    platforms: ['Windows', 'Linux'],
    updatedAt: new Date().toISOString(),
    inferredFamily: family,
    ...raw,
    recipe: raw.recipe || {
      id: `mock_${raw.id}`,
      repoFullName: raw.repoFullName || '',
      title: raw.title,
      console: badge,
      family,
      requirements: [
        badge === 'PS4'
          ? {
              id: `${raw.id}_dump`,
              label: `${raw.title} — Dump do jogo PlayStation 4 (pasta com eboot.bin, ou .zip / .7z / .rar / .pkg)`,
              type: 'folder',
              expectedFilename: 'game_dump',
              extensions: ['.pkg', '.iso']
            }
          : {
              id: `${raw.id}_rom`,
              label: `${raw.title} — ISO / ROM original`,
              type: 'rom',
              expectedFilename: 'game.z64',
              extensions: ['.z64', '.iso']
            }
      ]
    }
  } as CatalogGame
}

/** Agrupa ports do mesmo jogo, como o groupCatalogGames do processo principal. */
function group(games: CatalogGame[]): CatalogGame[] {
  const map = new Map<string, CatalogGame[]>()
  for (const g of games) {
    const key = `${normalize(g.title)}::${g.consoleBadge.toLowerCase()}`
    map.set(key, [...(map.get(key) || []), g])
  }
  const out: CatalogGame[] = []
  for (const list of map.values()) {
    const primary = list[0]
    const ports = list.map((p) => ({
      id: p.id,
      title: p.title,
      projectName: p.projectName,
      repoFullName: p.repoFullName,
      githubUrl: p.githubUrl,
      imageUrl: p.imageUrl,
      console: p.console,
      consoleBadge: p.consoleBadge,
      version: p.version,
      releaseStatus: p.releaseStatus,
      isAiAssisted: p.isAiAssisted,
      platforms: p.platforms,
      updatedAt: p.updatedAt,
      recipe: p.recipe,
      inferredFamily: p.inferredFamily,
      toolchainType: p.toolchainType || 'Recompilação / Port nativo',
      howItWorks: p.howItWorks || 'Port nativo criado a partir do código original do jogo.',
      description: p.description || `Port nativo de ${p.title} para PC.`,
      highlights: p.highlights?.length ? p.highlights : ['Execução nativa', 'Controles modernos'],
      differences: p.differences
    }))
    out.push({
      ...primary,
      title: primary.title.replace(/\s*\([^)]*\)\s*$/, '').trim() || primary.title,
      canonicalId: `canonical_${primary.id}`,
      ports,
      selectedPortId: primary.id,
      toolchainType: ports[0].toolchainType,
      howItWorks: ports[0].howItWorks,
      description: ports[0].description,
      highlights: ports[0].highlights,
      differences: ports[0].differences
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

const catalogGames = group(
  (sample as SampleEntry[]).map((s, idx) =>
    toGame({
      id: `${s.r.toLowerCase().replace('/', '__')}__${idx}`,
      title: s.t,
      projectName: s.p || s.t,
      repoFullName: s.r,
      githubUrl: `https://github.com/${s.r}`,
      imageUrl: s.i || undefined,
      consoleBadge: BADGES[s.c] || s.c,
      console: s.c,
      version: s.v,
      platforms: s.pl as CatalogGame['platforms'],
      updatedAt: s.u
    })
  )
)

const communityGames = group(
  (communityRaw as unknown as CommunityPort[]).map((c) =>
    toGame({
      ...(c as unknown as CatalogGame),
      isAiAssisted: false,
      isCommunity: true,
      inferredFamily: c.inferredFamily || 'GenericNative',
      recipe: c.recipe,
      highlights: c.highlights || []
    })
  )
)

const settings: AppSettings = {
  romVaultPath: '/home/jogador/.config/recomphub/RomVault',
  installRootPath: '/home/jogador/.config/recomphub/Games',
  linuxRunnerType: 'auto',
  customProtonPath: '',
  umuRunPath: 'umu-run',
  extractXisoPath: 'extract-xiso',
  githubToken: '',
  preferNativeLinuxBuild: true,
  createPortableTxtByDefault: true,
  linkStrategy: 'symlink'
}

function installedFrom(game: CatalogGame, status: InstalledGame['status'], playTime: number): InstalledGame {
  return {
    id: game.id,
    gameId: game.id,
    title: game.title,
    projectName: game.projectName,
    repoFullName: game.repoFullName,
    console: game.console,
    consoleBadge: game.consoleBadge,
    version: game.version,
    imageUrl: game.imageUrl,
    installDir: `/home/jogador/Games/${game.projectName}`,
    executablePath: `/home/jogador/Games/${game.projectName}/game`,
    requiresCompatibilityLayer: false,
    recipeFamily: game.inferredFamily,
    status,
    romPaired: status !== 'NEEDS_ROM',
    pairedRomPaths: [],
    portableMode: true,
    playTimeSeconds: playTime,
    installedAt: new Date().toISOString(),
    recipeLogs: []
  }
}

let library: InstalledGame[] = [
  installedFrom(catalogGames[3], 'READY_TO_PLAY', 5400),
  installedFrom(catalogGames[11], 'READY_TO_PLAY', 780),
  installedFrom(catalogGames[24], 'NEEDS_ROM', 0)
]

const downloads: DownloadTaskProgress[] = [
  {
    taskId: 'mock_dl_1',
    gameId: catalogGames[40].id,
    gameTitle: catalogGames[40].title,
    projectName: catalogGames[40].projectName,
    consoleBadge: catalogGames[40].consoleBadge,
    imageUrl: catalogGames[40].imageUrl,
    stage: 'DOWNLOADING_PORT',
    stageLabel: 'Baixando port: exemplo-windows-x64.zip...',
    portProgress: 62,
    overallProgress: 48,
    downloadedBytes: 62 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    speedBytesPerSec: 6.2 * 1024 * 1024,
    logs: ['Iniciando instalação', 'Release localizada: v1.0.0 — Build nativa para Linux selecionada'],
    startedAt: new Date().toISOString()
  },
  {
    taskId: 'mock_dl_2',
    gameId: library[0].gameId,
    gameTitle: library[0].title,
    projectName: library[0].projectName,
    consoleBadge: library[0].consoleBadge,
    imageUrl: library[0].imageUrl,
    stage: 'READY_TO_PLAY',
    stageLabel: 'Pronto para Jogar (ISO/ROM Pareada)!',
    portProgress: 100,
    overallProgress: 100,
    downloadedBytes: 0,
    totalBytes: 0,
    speedBytesPerSec: 0,
    logs: ['Instalação concluída'],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  }
]

// Patches adicionados durante a sessão de pré-visualização
const mockPatches: Record<string, RomVaultEntry[]> = {}

const findGame = (id: string): CatalogGame | undefined =>
  [...catalogGames, ...communityGames].flatMap((g) => [g, ...(g.ports || []).map((p) => ({ ...g, ...p }))]).find((g) => g.id === id)

const noop = async (): Promise<void> => undefined
const subscribe = () => () => undefined

export function installMockApi(): void {
  const api: RecompHubAPI = {
    getCatalog: async () => ({ games: catalogGames, lastUpdated: new Date().toISOString(), source: 'live' }),
    onCatalogUpdated: subscribe,
    resolveRelease: async (gameId) => ({
      repoFullName: findGame(gameId)?.repoFullName || '',
      tagName: 'v1.0.0',
      name: 'v1.0.0',
      publishedAt: new Date().toISOString(),
      isPrerelease: false,
      htmlUrl: '',
      selectedAsset: { name: 'exemplo-linux-x86_64.tar.gz', browserDownloadUrl: '', size: 84 * 1024 * 1024, contentType: '' },
      allAssets: [],
      targetOs: 'linux',
      requiresCompatibilityLayer: false,
      selectionReason: 'Build nativa para Linux selecionada (exemplo-linux-x86_64.tar.gz)'
    }),
    getCommunityPorts: async () => ({ ports: communityGames, lastUpdated: new Date().toISOString(), source: 'live' }),
    onCommunityUpdated: subscribe,
    inspectGitHubRepoForPort: async () => {
      throw new Error('Indisponível no modo navegador')
    },
    generateCommunityIssueUrl: async () => 'https://github.com/ArthurxD232/RecompHUB/issues/new',
    getVaultEntries: async () => [],
    scanRomVault: async () => ({ entries: [], scannedCount: 0 }),
    checkRomAvailability: async (gameId): Promise<RomAvailabilityStatus> => {
      const game = findGame(gameId)
      const requirements = withPatchRequirement(game?.recipe?.requirements || [])
      return {
        ready: false,
        source: 'missing',
        matchedRequirements: requirements.map((requirement) => {
          if (requirement.type === 'patch') {
            const entries = mockPatches[gameId] || []
            return {
              requirement,
              status: entries.length ? ('local_vault' as const) : ('missing' as const),
              localEntry: entries[0],
              localEntries: entries
            }
          }
          return { requirement, status: 'missing' as const }
        })
      }
    },
    pickRomFileForGame: async () => null,
    pickPatchesForGame: async (_id, _req, mode) =>
      mode === 'folder'
        ? ['/home/jogador/dumps/SPEXPANSIONDLC03']
        : ['/home/jogador/dumps/CUSA03173-update-1.09.pkg', '/home/jogador/dumps/community-patch-60fps.zip'],
    importRomFileManually: async (gameId, _req, picked) => {
      const isDir = !/\.[a-z0-9]+$/i.test(picked || '')
      const entry: RomVaultEntry = {
        filePath: picked || '',
        fileName: (picked || '').split('/').pop() || '',
        size: isDir ? 412 * 1024 * 1024 : 3.4 * 1024 * 1024 * 1024,
        sha1: 'mock',
        md5: 'mock',
        extension: '',
        scannedAt: new Date().toISOString(),
        isDirectory: isDir,
        kind: 'patch'
      }
      mockPatches[gameId] = [...(mockPatches[gameId] || []), entry]
      return entry
    },
    installGame: async () => ({ taskId: 'mock' }),
    reapplyRecipe: async (gameId) => library.find((l) => l.gameId === gameId) || library[0],
    uninstallGame: async (gameId) => {
      library = library.filter((l) => l.gameId !== gameId)
    },
    removeRomVaultEntry: async (filePath) => {
      for (const id of Object.keys(mockPatches)) {
        mockPatches[id] = mockPatches[id].filter((e) => e.filePath !== filePath)
      }
      return []
    },
    setGameFullscreen: async () => null,
    getActiveDownloads: async () => downloads,
    getLibrary: async () => library,
    launchGame: async () => ({ command: 'mock' }),
    stopGame: noop,
    openGameFolder: noop,
    selectExecutableManually: async () => null,
    getSettings: async () => settings,
    updateSettings: async (partial) => Object.assign(settings, partial),
    selectDirectory: async () => null,
    selectFile: async () => null,
    detectLinuxRunners: async () => [{ type: 'umu-run', name: 'UMU Launcher (umu-run)', path: '/usr/bin/umu-run' }],
    openExternalUrl: async (url) => {
      window.open(url, '_blank')
    },
    getHostPlatform: async () => ({ platform: 'linux', arch: 'x64' }),
    onDownloadProgress: subscribe,
    onLibraryUpdated: subscribe,
    onVaultScanProgress: subscribe
  }
  window.api = api
}
