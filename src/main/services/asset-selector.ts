import { GitHubAsset } from '../../shared/types'

export type AssetOs = 'linux' | 'windows' | 'macos'

export interface AssetSelection {
  asset: GitHubAsset | null
  targetOs: AssetOs
  requiresCompatibilityLayer: boolean
  reason: string
}

export interface AssetSelectorHost {
  platform: string
  arch: string
  preferNativeLinux: boolean
}

type AssetOsTag = 'linux' | 'windows' | 'macos' | 'other-platform' | 'unknown'

/** Arquivos que nunca servem como port de PC (somas, símbolos, código-fonte, apps mobile/console...). */
const UNUSABLE_SUFFIXES = [
  '.sha256', '.sha512', '.sha1', '.md5', '.sig', '.asc', '.sbom', '.sum', '.sums',
  '.txt', '.md', '.yml', '.yaml', '.json', '.blockmap', '.pdb', '.pem',
  '.apk', '.aab', '.ipa', '.dmg', '.pkg', '.deb', '.rpm', '.flatpak', '.snap',
  '.msi', '.msi.zip', '.msix', '.nro', '.nsp', '.xci', '.vpk', '.3dsx', '.cia', '.rpx', '.wuhb',
  '.ps3', '.pup', '.app.tar.gz', '.app.zip', '.rtz'
]

// Pacotes que acompanham o jogo mas não são o jogo: código-fonte, licenças, atualizações parciais...
const UNUSABLE_TOKENS = [
  'symbols', 'sha256sums', 'checksums', 'source', 'src', 'sourcecode', 'debuginfo', 'pdbs',
  'notices', 'notice', 'lgpl', 'compliance', 'licenses', 'license', 'docs', 'manifest',
  'update', 'patch'
]

const OTHER_PLATFORM_TOKENS = [
  'android', 'ios', 'iphone', 'ipad', 'tvos', 'switch', 'vita', 'psvita', '3ds', 'wiiu',
  'psp', 'web', 'wasm', 'emscripten'
]

const MAC_TOKENS = ['macos', 'osx', 'darwin', 'apple', 'universal-mac', 'mac']

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function hasToken(tokens: string[], candidates: string[]): boolean {
  return candidates.some((c) => tokens.includes(c))
}

/** O arquivo parece ser um instalador próprio do port (Setup.exe, installer...), não o jogo pronto. */
export function isInstallerAsset(name: string): boolean {
  return /(^|[^a-z])(setup|installer|install)([^a-z]|$)/i.test(name)
}

export function isUnusableAsset(name: string): boolean {
  const n = name.toLowerCase()
  if (UNUSABLE_SUFFIXES.some((s) => n.endsWith(s))) return true
  return hasToken(tokenize(n), UNUSABLE_TOKENS)
}

export function classifyAssetOs(name: string): AssetOsTag {
  const n = name.toLowerCase()
  const tokens = tokenize(n)

  const windows =
    hasToken(tokens, ['windows', 'win', 'win32', 'win64', 'msvc', 'mingw']) ||
    tokens.some((t) => /^win\d*$/.test(t)) ||
    n.endsWith('.exe')
  const linux =
    hasToken(tokens, ['linux', 'ubuntu', 'debian', 'fedora', 'appimage', 'steamos', 'steamdeck', 'gnu']) ||
    n.endsWith('.appimage')

  if (windows && linux) return 'unknown'
  if (windows) return 'windows'
  if (linux) return 'linux'
  if (hasToken(tokens, MAC_TOKENS)) return 'macos'
  if (hasToken(tokens, OTHER_PLATFORM_TOKENS)) return 'other-platform'
  // Sem nome de sistema: pacotes tar.* quase sempre são builds Linux
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz') || n.endsWith('.tar.xz')) return 'linux'
  return 'unknown'
}

type AssetArch = 'x64' | 'arm64' | 'x86' | 'any'

export function classifyAssetArch(name: string): AssetArch {
  const n = name.toLowerCase()
  const tokens = tokenize(n)
  if (hasToken(tokens, ['arm64', 'aarch64', 'armv8', 'arm'])) return 'arm64'
  if (hasToken(tokens, ['x86_64', 'x64', 'amd64', 'win64']) || /x86[_-]64/.test(n)) return 'x64'
  if (hasToken(tokens, ['x86', 'i386', 'i686', 'win32', '32bit'])) return 'x86'
  return 'any'
}

function archScore(arch: AssetArch, hostArch: string): number {
  const hostIsArm = hostArch === 'arm64'
  if (arch === 'any') return 0
  if (arch === 'arm64') return hostIsArm ? 20 : -200
  if (arch === 'x64') return hostIsArm ? -20 : 20
  return -15 // x86 (32 bits)
}

function packageScore(name: string, os: 'linux' | 'windows'): number {
  const n = name.toLowerCase()
  let score = 0
  if (os === 'linux') {
    if (n.endsWith('.appimage')) score += 15
    else if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) score += 12
    else if (n.endsWith('.zip')) score += 10
    else if (n.endsWith('.tar.xz')) score += 8
  } else {
    if (n.includes('portable')) score += 10
    if (n.endsWith('.zip')) score += 8
    else if (n.endsWith('.7z') || n.endsWith('.rar')) score += 5
    else if (n.endsWith('.exe')) score += 3
  }
  if (/(^|[^a-z])(setup|installer|install)([^a-z]|$)/.test(n)) score -= 20
  if (n.includes('steamdeck') || n.includes('steam-deck')) score -= 2
  if (n.includes('debug')) score -= 30
  if (n.includes('dedicated') || n.includes('server')) score -= 30
  return score
}

/**
 * Escolhe o melhor binário de uma release para o sistema do usuário.
 * Função pura (sem acessar `process`), usada pelo app e pelo script de auditoria do catálogo.
 */
export function selectBestAsset(assets: GitHubAsset[], host: AssetSelectorHost): AssetSelection {
  const isLinuxHost = host.platform === 'linux'
  const defaultOs: AssetOs = host.platform === 'win32' ? 'windows' : isLinuxHost ? 'linux' : 'macos'

  const usable = assets.filter((a) => !isUnusableAsset(a.name))
  if (usable.length === 0) {
    return {
      asset: null,
      targetOs: defaultOs === 'macos' ? 'linux' : defaultOs,
      requiresCompatibilityLayer: false,
      reason: 'Nenhum binário pré-compilado anexado a esta release.'
    }
  }

  const rank = (
    list: GitHubAsset[],
    os: 'linux' | 'windows',
    unknownBonus: number
  ): { asset: GitHubAsset; score: number }[] =>
    list
      .map((asset) => {
        const tag = classifyAssetOs(asset.name)
        let score = 0
        if (tag === os) score += 100
        else if (tag === 'unknown') score += unknownBonus
        else return null
        score += archScore(classifyAssetArch(asset.name), host.arch)
        score += packageScore(asset.name, os)
        return { asset, score }
      })
      .filter((x): x is { asset: GitHubAsset; score: number } => x !== null)
      .filter((x) => x.score > -100)
      .sort((a, b) => b.score - a.score)

  // Windows (nativo): binários marcados para Windows; depois genéricos (zip/exe sem sistema no nome).
  // Nunca cai para um build de outro sistema: melhor avisar do que instalar o arquivo errado.
  if (!isLinuxHost) {
    const ranked = rank(usable, 'windows', 40).filter((x) => !x.asset.name.toLowerCase().endsWith('.appimage'))
    if (ranked.length > 0) {
      return {
        asset: ranked[0].asset,
        targetOs: 'windows',
        requiresCompatibilityLayer: false,
        reason: `Build Windows selecionada (${ranked[0].asset.name})`
      }
    }
    return {
      asset: null,
      targetOs: 'windows',
      requiresCompatibilityLayer: false,
      reason: 'Esta release não traz build para Windows (só outros sistemas).'
    }
  }

  // Linux: build nativa quando existir e o usuário preferir
  if (host.preferNativeLinux) {
    const linuxRanked = rank(usable, 'linux', -1000)
    if (linuxRanked.length > 0) {
      const best = linuxRanked[0].asset
      return {
        asset: best,
        targetOs: 'linux',
        requiresCompatibilityLayer: false,
        reason: `Build nativa para Linux selecionada (${best.name})`
      }
    }
  }

  const winRanked = rank(usable, 'windows', 20).filter(
    (x) => !x.asset.name.toLowerCase().endsWith('.appimage')
  )
  if (winRanked.length > 0) {
    const best = winRanked[0].asset
    return {
      asset: best,
      targetOs: 'windows',
      requiresCompatibilityLayer: true,
      reason: `Build Windows selecionada com camada de compatibilidade Proton/umu-run (${best.name})`
    }
  }

  // Última tentativa no Linux: qualquer pacote Linux mesmo com preferNativeLinux desligado
  const linuxFallback = rank(usable, 'linux', -1000)
  if (linuxFallback.length > 0) {
    return {
      asset: linuxFallback[0].asset,
      targetOs: 'linux',
      requiresCompatibilityLayer: false,
      reason: `Build nativa para Linux selecionada (${linuxFallback[0].asset.name})`
    }
  }

  return {
    asset: null,
    targetOs: 'linux',
    requiresCompatibilityLayer: false,
    reason: 'Esta release não traz build para Linux nem para Windows (só outros sistemas).'
  }
}
