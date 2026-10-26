import * as path from 'path'
import { PkgInfo, readPkgInfo, sortForMerge } from './pkg'

/**
 * Variantes opcionais e excludentes (ex.: pasta "MODs" com 60fps/30fps/720p). Aplicar todas faria a
 * última vencer, então ficam de fora a menos que sejam escolhidas diretamente.
 */
export function isOptionalVariant(file: string): boolean {
  const name = path.basename(file)
  const parent = path.basename(path.dirname(file))
  const re = /(^|[^a-z0-9])mods?([^a-z0-9]|$)/i
  return re.test(name) || re.test(parent)
}

export interface PkgPlan {
  /** PKGs do jogo (base + patches) na ordem em que devem ser aplicados */
  gameInfos: PkgInfo[]
  /** PKGs de conteúdo adicional (DLC) */
  addonInfos: PkgInfo[]
  /** PKGs deixados de fora por serem variantes opcionais (mods) */
  skipped: PkgInfo[]
}

/**
 * Lê o cabeçalho de cada PKG (não precisa de chaves) e decide o que extrair e em que ordem:
 * jogo base, depois patches; DLC à parte; variantes de MOD ficam de fora quando há outro jogo.
 * Falha com uma mensagem clara quando o conjunto não serve (sem jogo base, patch delta...).
 */
export async function planPkgSet(
  pkgFiles: string[],
  options: { allowPatchOnly?: boolean } = {}
): Promise<PkgPlan> {
  if (pkgFiles.length === 0) throw new Error('Nenhum arquivo .pkg para extrair')

  const infos: PkgInfo[] = []
  for (const file of pkgFiles) {
    try {
      infos.push(await readPkgInfo(file))
    } catch (err: any) {
      throw new Error(`${path.basename(file)}: ${err?.message || err}`)
    }
  }

  // Com vários PKGs, as variantes de MOD ficam de fora (só entram se não houver outro jogo/patch)
  let skipped: PkgInfo[] = []
  let chosen = infos
  if (infos.length > 1) {
    const withoutVariants = infos.filter((i) => !isOptionalVariant(i.file))
    if (withoutVariants.some((i) => i.kind === 'game' || (options.allowPatchOnly && i.kind === 'patch'))) {
      skipped = infos.filter((i) => isOptionalVariant(i.file))
      chosen = withoutVariants
    }
  }

  const gameInfos = sortForMerge(chosen.filter((i) => i.kind === 'game' || i.kind === 'patch'))
  const addonInfos = chosen.filter((i) => i.kind === 'addon')
  const deltas = infos.filter((i) => i.kind === 'delta')
  if (deltas.length > 0) {
    throw new Error(
      `"${path.basename(deltas[0].file)}" é um patch delta do PS4 e não pode ser aplicado fora do console. Use um PKG completo ou um patch normal.`
    )
  }
  if (!options.allowPatchOnly && !gameInfos.some((i) => i.kind === 'game')) {
    throw new Error(
      gameInfos.length > 0
        ? 'Só há patches: falta o PKG do jogo base. Escolha a pasta que tem o PKG do jogo junto dos patches.'
        : 'Esses PKGs são só de conteúdo adicional (DLC): falta o PKG do jogo base.'
    )
  }
  return { gameInfos, addonInfos, skipped }
}

/** Nome da pasta de um DLC: o "rótulo" do conteúdo (ex.: SPEXPANSIONDLC03), como os ports esperam achá-lo. */
export function addonFolderName(info: PkgInfo): string {
  return info.contentId.split('-').pop() || path.basename(info.file, '.pkg')
}
