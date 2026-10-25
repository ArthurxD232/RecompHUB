import { CatalogGame, DownloadTaskProgress, InstalledGame, RecipeFamily } from '../../shared/types'

/** Nome amigável da toolchain (o valor interno da receita não diz nada ao usuário). */
export function familyLabel(family: RecipeFamily | string): string {
  switch (family) {
    case 'N64Recomp':
      return 'N64Recomp'
    case 'PSXRecomp':
      return 'PSXRecomp'
    case 'XenonRecomp':
      return 'XenonRecomp'
    case 'AssetExtractor':
      return 'Extrai assets'
    default:
      return 'Port nativo'
  }
}

/** Cor de destaque por fabricante, para varrer a lista com os olhos. */
export function consoleColor(badge: string): string {
  const b = badge.toLowerCase()
  if (/^ps|playstation/.test(b)) return '#4f8cff'
  if (b.startsWith('xbox')) return '#4cc26a'
  if (/n64|gamecube|wii|snes|nes|gb|ds|3ds|virtual/.test(b)) return '#ec5b62'
  if (/dreamcast|mega|sega/.test(b)) return '#38bdf8'
  return '#94a3b8'
}

export function formatDateShort(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function isInProgress(task: DownloadTaskProgress): boolean {
  return !['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR'].includes(task.stage)
}

/** Instalação (ou download em andamento) de qualquer port do grupo. */
export function findInstalled(
  game: CatalogGame,
  byId: Map<string, InstalledGame>
): InstalledGame | undefined {
  return byId.get(game.id) || game.ports?.map((p) => byId.get(p.id)).find(Boolean)
}

export function findActiveDownload(
  game: CatalogGame,
  byId: Map<string, DownloadTaskProgress>
): DownloadTaskProgress | undefined {
  return byId.get(game.id) || game.ports?.map((p) => byId.get(p.id)).find(Boolean)
}

const BADGE_ABBR: Record<string, string> = {
  GameCube: 'GC',
  'Xbox 360': '360',
  'Sega CD': 'CD',
  'PC / Outros': 'PC',
  'Mega Drive': 'MD',
  'Virtual Boy': 'VB',
  Dreamcast: 'DC'
}

/** Sigla curta do console para ícones pequenos. */
export function badgeAbbr(badge: string): string {
  return BADGE_ABBR[badge] || badge.slice(0, 3).toUpperCase()
}
