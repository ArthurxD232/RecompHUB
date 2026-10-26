import * as path from 'path'
import { ensureFreeSpace, formatBytes } from '../archive.service'
import { PkgKeys } from './keys'
import { PkgInfo, PkgSession } from './pkg'
import { addonFolderName, planPkgSet } from './plan'
import type { PkgExtractProgress, PkgExtractResult } from './types'

export { addonFolderName, isOptionalVariant, planPkgSet } from './plan'
export type { PkgPlan } from './plan'
export {
  PkgExtractorLaunchError,
  extractPkgSetExternal,
  findExternalPkgExtractor,
  killActivePkgExtractors,
  probePkgExtractor
} from './external'
export type { PkgExtractorProbe } from './external'

export { findPkgKeysFile, loadPkgKeysFile, parsePkgKeys, shadPs4KeysCandidates } from './keys'
export type { PkgKeys } from './keys'
export { PkgKeyError, PkgSession, parseSfo, readPkgInfo, sortForMerge } from './pkg'
export type { PkgInfo, PkgKind } from './pkg'
export type { PkgExtractProgress, PkgExtractResult } from './types'

/**
 * Extrai um conjunto de PKGs do mesmo jogo para `destDir`:
 * primeiro o jogo base, depois os patches (que sobrescrevem arquivos do base).
 * DLC (conteúdo adicional) vai para `addonsDir/<content id>` quando `addonsDir` é informado.
 */
export async function extractPkgSet(
  pkgFiles: string[],
  destDir: string,
  keys: PkgKeys,
  options: {
    addonsDir?: string
    allowPatchOnly?: boolean
    onProgress?: (progress: PkgExtractProgress) => void
    shouldStop?: () => boolean
  } = {}
): Promise<PkgExtractResult> {
  const { gameInfos, addonInfos, skipped } = await planPkgSet(pkgFiles, {
    allowPatchOnly: options.allowPatchOnly
  })

  const sessions: { session: PkgSession; target: string; isAddon: boolean }[] = []
  try {
    for (const info of gameInfos) {
      sessions.push({ session: await PkgSession.open(info.file, keys), target: destDir, isAddon: false })
    }
    if (options.addonsDir) {
      for (const info of addonInfos) {
        sessions.push({
          session: await PkgSession.open(info.file, keys),
          // Pasta com o "rótulo" do DLC (ex.: SPEXPANSIONDLC03), que é como os ports esperam achá-lo
          target: path.join(options.addonsDir, addonFolderName(info)),
          isAddon: true
        })
      }
    }

    const totalBytes = sessions.reduce((sum, s) => sum + s.session.totalBytes, 0)
    await ensureFreeSpace(destDir, totalBytes + 512 * 1024 * 1024, `extrair os PKGs (${formatBytes(totalBytes)})`)

    let extractedBytes = 0
    let files = 0
    let lastEmit = 0
    for (const { session, target } of sessions) {
      const pkgName = path.basename(session.info.file)
      files += await session.extractTo(
        target,
        (bytes, currentFile) => {
          extractedBytes += bytes
          const now = Date.now()
          if (options.onProgress && now - lastEmit > 150) {
            lastEmit = now
            options.onProgress({
              percent: totalBytes > 0 ? Math.min(100, Math.round((extractedBytes / totalBytes) * 100)) : 100,
              extractedBytes,
              totalBytes,
              currentFile,
              pkgName
            })
          }
        },
        options.shouldStop
      )
    }
    options.onProgress?.({ percent: 100, extractedBytes, totalBytes, currentFile: '', pkgName: '' })

    return {
      applied: gameInfos,
      skipped,
      addons: options.addonsDir
        ? sessions.filter((s) => s.isAddon).map((s) => ({ info: s.session.info, dir: s.target }))
        : [],
      files,
      bytes: extractedBytes
    }
  } finally {
    for (const { session } of sessions) await session.close()
  }
}
