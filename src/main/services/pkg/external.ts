import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { directorySize, ensureFreeSpace, formatBytes } from '../archive.service'
import { PkgInfo } from './pkg'
import { addonFolderName, planPkgSet } from './plan'
import type { PkgExtractProgress, PkgExtractResult } from './types'

/**
 * Uso do "PKG Extractor" (ShadPs4Plus) que o PRÓPRIO USUÁRIO já tem instalado.
 *
 * O RecompHUB não inclui, não baixa e não distribui esse programa: só o executa como um programa
 * externo (`pkg_extractor <pkg> <destino>`), do mesmo jeito que o usuário faria no terminal.
 *
 * Comportamento do extrator (confirmado no código dele):
 *  - grava em `<destino>/<TITLE_ID>` (jogo base), `<destino>/<TITLE_ID>-patch` (atualização) ou
 *    `<destino>/<TITLE_ID>/<rótulo>` (DLC);
 *  - imprime `Extracting file X of N` enquanto trabalha;
 *  - SAI COM CÓDIGO 0 MESMO QUANDO FALHA, só avisando no texto ("Cannot open/extract PKG file").
 *    Por isso o sucesso é conferido pelo texto e pelos arquivos gerados, não só pelo código.
 */

export class PkgExtractorLaunchError extends Error {}

const BINARY_EXTENSIONS = process.platform === 'win32' ? new Set(['.exe']) : new Set(['', '.appimage'])
const EXTRACTOR_NAME = /^(pkg[_ -]?extractor|shadps4plus[_ -]?pkg[_ -]?extractor)/i

function looksLikeExtractor(name: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(name).toLowerCase()) && EXTRACTOR_NAME.test(name)
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** Procura o executável na pasta e em algumas subpastas (o zip do extrator se abre numa pasta própria). */
function searchDir(dir: string, depth: number): string | null {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (e.isFile() && looksLikeExtractor(e.name)) return path.join(dir, e.name)
  }
  if (depth > 0) {
    for (const e of entries) {
      if (e.isDirectory() && /pkg|extractor|shadps4/i.test(e.name)) {
        const found = searchDir(path.join(dir, e.name), depth - 1)
        if (found) return found
      }
    }
  }
  return null
}

function resolveCandidate(candidate: string): string | null {
  try {
    const stat = fs.statSync(candidate)
    if (stat.isFile()) return candidate
    if (stat.isDirectory()) return searchDir(candidate, 2)
  } catch {
    // não existe
  }
  return null
}

function commonDirs(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    const dirs = [
      path.join(home, 'Downloads'),
      path.join(home, 'Desktop'),
      path.join(home, 'Documents'),
      path.join(home, 'Apps')
    ]
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs'))
    if (process.env.ProgramFiles) dirs.push(process.env.ProgramFiles)
    return dirs
  }
  return [
    path.join(home, 'Applications'),
    path.join(home, 'AppImages'),
    path.join(home, 'Apps'),
    path.join(home, '.local/bin'),
    path.join(home, 'bin'),
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    '/opt'
  ]
}

/**
 * Procura o PKG Extractor já instalado: o que o usuário escolheu primeiro, depois a variável
 * RECOMPHUB_PKG_EXTRACTOR, o PATH e as pastas mais comuns (Downloads, Applications...).
 */
export function findExternalPkgExtractor(
  configuredPath?: string
): { path: string; source: 'config' | 'detected' } | null {
  if (configuredPath) {
    const hit = resolveCandidate(configuredPath)
    if (hit) return { path: hit, source: 'config' }
  }
  if (process.env.RECOMPHUB_PKG_EXTRACTOR) {
    const hit = resolveCandidate(process.env.RECOMPHUB_PKG_EXTRACTOR)
    if (hit) return { path: hit, source: 'detected' }
  }

  const names =
    process.platform === 'win32' ? ['pkg_extractor.exe'] : ['pkg_extractor', 'pkg_extractor.AppImage']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const file = path.join(dir, name)
      if (isFile(file)) return { path: file, source: 'detected' }
    }
  }

  for (const dir of commonDirs()) {
    const hit = searchDir(dir, 2)
    if (hit) return { path: hit, source: 'detected' }
  }
  return null
}

/** Ambiente limpo para o extrator: sem sobras do AppImage do próprio RecompHUB. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' }
  const appDir = process.env.APPDIR
  delete env.APPIMAGE
  delete env.APPDIR
  delete env.ARGV0
  delete env.OWD
  if (appDir && env.LD_LIBRARY_PATH) {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH.split(':')
      .filter((p) => p && !p.startsWith(appDir))
      .join(':')
  }
  return env
}

/** Garante a permissão de execução (quem baixa o .AppImage costuma esquecer do chmod +x). */
function ensureExecutable(file: string): void {
  if (process.platform === 'win32') return
  const mode = fs.statSync(file).mode
  if ((mode & 0o111) !== 0) return
  try {
    fs.chmodSync(file, mode | 0o111)
  } catch {
    throw new PkgExtractorLaunchError(
      `O arquivo "${file}" não tem permissão de execução e o RecompHUB não conseguiu ajustar. Rode: chmod +x "${file}"`
    )
  }
}

const activeChildren = new Set<ChildProcess>()

/** Encerra extrações em andamento (usado ao fechar o app, para não deixar processo órfão). */
export function killActivePkgExtractors(): void {
  for (const child of activeChildren) {
    try {
      child.kill()
    } catch {
      // já saiu
    }
  }
  activeChildren.clear()
}

interface RunResult {
  total: number
  tail: string
}

const FAILURE_PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/Cannot open PKG file\s*:\s*([^\r\n]*)/, (m) => `não foi possível abrir o PKG (${m[1].trim() || 'sem detalhes'})`],
  [/Cannot extract PKG file\s*:\s*([^\r\n]*)/, (m) => `falha ao extrair o PKG (${m[1].trim() || 'sem detalhes'})`],
  [/Could not read SFO/, () => 'não foi possível ler o param.sfo do PKG'],
  [/doesn't appear to be a valid PKG/, () => 'o extrator não reconheceu o arquivo como PKG']
]

function detectFailure(output: string): string | null {
  for (const [re, describe] of FAILURE_PATTERNS) {
    const m = re.exec(output)
    if (m) return describe(m)
  }
  return null
}

function lastLines(text: string, max = 300): string {
  const clean = text.replace(/\r/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join(' | ')
  return clean.length > max ? '…' + clean.slice(-max) : clean
}

/** Roda `extractor <arquivo> <destino>`, acompanhando "Extracting file X of N". */
function runExtractor(
  extractor: string,
  args: string[],
  options: { onFile?: (index: number, total: number) => void; timeoutMs?: number } = {}
): Promise<RunResult & { code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(extractor, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: childEnv()
      })
    } catch (err: any) {
      reject(new PkgExtractorLaunchError(`Não foi possível executar "${extractor}": ${err?.message || err}`))
      return
    }
    activeChildren.add(child)

    let tail = ''
    let carry = ''
    let total = 0
    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, options.timeoutMs)
      : null

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      tail = (tail + text).slice(-8192)
      const scan = carry + text
      const re = /Extracting file (\d+) of (\d+)/g
      let last: RegExpExecArray | null = null
      let m: RegExpExecArray | null
      while ((m = re.exec(scan))) last = m
      if (last) {
        total = Number(last[2])
        options.onFile?.(Number(last[1]), total)
      }
      carry = scan.slice(-48)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer)
      activeChildren.delete(child)
      reject(
        new PkgExtractorLaunchError(
          `Não foi possível executar "${extractor}" (${err.code || err.message}). Confira se é o PKG Extractor do seu sistema e se tem permissão de execução.`
        )
      )
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      activeChildren.delete(child)
      if (timedOut) {
        reject(new PkgExtractorLaunchError('O extrator demorou demais para responder.'))
        return
      }
      resolve({ total, tail, code, signal })
    })
  })
}

export interface PkgExtractorProbe {
  ok: boolean
  error?: string
}

const probeCache = new Map<string, PkgExtractorProbe>()

/**
 * Confere que o arquivo é mesmo o PKG Extractor e que abre neste sistema. Roda o programa uma vez
 * apontando para um PKG que não existe: ele só diz que "não é um PKG válido" e termina.
 */
export async function probePkgExtractor(file: string): Promise<PkgExtractorProbe> {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return { ok: false, error: 'O arquivo não existe mais.' }
  }
  if (!stat.isFile()) return { ok: false, error: 'Isso não é um arquivo.' }
  const key = `${path.resolve(file)}|${stat.mtimeMs}|${stat.size}`
  const cached = probeCache.get(key)
  if (cached) return cached

  try {
    ensureExecutable(file)
    const result = await runExtractor(file, [path.join(os.tmpdir(), 'recomphub-probe-inexistente.pkg')], {
      timeoutMs: 30_000
    })
    if (!/pkg/i.test(result.tail)) {
      return {
        ok: false,
        error: `Esse arquivo não parece ser o PKG Extractor (saída: ${lastLines(result.tail, 120) || 'vazia'}).`
      }
    }
    const probe: PkgExtractorProbe = { ok: true }
    probeCache.set(key, probe)
    return probe
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/** Move `src` para dentro de `dest`, trocando os arquivos que já existem (patch por cima do jogo). */
async function mergeTree(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true })
  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    const existing = await fs.promises.lstat(to).catch(() => null)
    if (entry.isDirectory()) {
      if (existing && !existing.isDirectory()) await fs.promises.rm(to, { force: true })
      await mergeTree(from, to)
    } else {
      if (existing) await fs.promises.rm(to, { recursive: true, force: true })
      try {
        await fs.promises.rename(from, to)
      } catch (err: any) {
        if (err?.code !== 'EXDEV') throw err
        await fs.promises.copyFile(from, to)
        await fs.promises.unlink(from)
      }
    }
  }
}

/** Acha a pasta que o extrator criou dentro da pasta de trabalho (que começa vazia). */
async function locateOutput(workDir: string, info: PkgInfo, isAddon: boolean, tail: string): Promise<string> {
  const dirs = (await fs.promises.readdir(workDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  if (dirs.length === 0) {
    throw new Error(
      `${path.basename(info.file)}: o extrator terminou sem gerar arquivos. Saída dele: ${lastLines(tail) || '(vazia)'}`
    )
  }
  const name = dirs.find((d) => info.titleId && d.startsWith(info.titleId)) ?? dirs[0]
  let out = path.join(workDir, name)
  if (isAddon) {
    // DLC: <TITLE_ID>/<rótulo>/arquivos
    const label = path.join(out, addonFolderName(info))
    if (fs.existsSync(label) && fs.statSync(label).isDirectory()) out = label
  }
  const { files } = await directorySize(out)
  if (files === 0) {
    throw new Error(
      `${path.basename(info.file)}: o extrator não gerou arquivos. Saída dele: ${lastLines(tail) || '(vazia)'}`
    )
  }
  return out
}

/**
 * Extrai um conjunto de PKGs do mesmo jogo usando o PKG Extractor externo, no mesmo formato do motor
 * próprio: o jogo base e os patches (por cima) em `destDir`, cada DLC em `addonsDir/<rótulo>`.
 * Cada PKG é extraído numa pasta de trabalho ao lado de `destDir` e depois movido (mesmo disco,
 * então é instantâneo): assim o patch entra por cima do jogo mesmo o extrator criando pastas separadas.
 */
export async function extractPkgSetExternal(
  pkgFiles: string[],
  destDir: string,
  extractor: string,
  options: {
    addonsDir?: string
    allowPatchOnly?: boolean
    onProgress?: (progress: PkgExtractProgress) => void
  } = {}
): Promise<PkgExtractResult> {
  const { gameInfos, addonInfos, skipped } = await planPkgSet(pkgFiles, {
    allowPatchOnly: options.allowPatchOnly
  })
  const jobs = [
    ...gameInfos.map((info) => ({ info, isAddon: false })),
    ...(options.addonsDir ? addonInfos.map((info) => ({ info, isAddon: true })) : [])
  ]

  const probe = await probePkgExtractor(extractor)
  if (!probe.ok) throw new PkgExtractorLaunchError(probe.error || 'O PKG Extractor não abriu.')

  const totalBytes = jobs.reduce((sum, j) => sum + j.info.fileSize, 0)
  const staging = path.join(path.dirname(destDir), path.basename(destDir) + '.tmp')
  await fs.promises.rm(staging, { recursive: true, force: true })
  await fs.promises.mkdir(staging, { recursive: true })
  await ensureFreeSpace(staging, totalBytes + 512 * 1024 * 1024, `extrair os PKGs (cerca de ${formatBytes(totalBytes)})`)

  let doneBytes = 0
  let files = 0
  let lastEmit = 0
  const addons: { info: PkgInfo; dir: string }[] = []
  try {
    for (let k = 0; k < jobs.length; k++) {
      const { info, isAddon } = jobs[k]
      const pkgName = path.basename(info.file)
      const workDir = path.join(staging, String(k))
      await fs.promises.mkdir(workDir, { recursive: true })

      const emit = (fraction: number, detail: string, force = false): void => {
        const now = Date.now()
        if (!options.onProgress || (!force && now - lastEmit < 150)) return
        lastEmit = now
        const extractedBytes = doneBytes + fraction * info.fileSize
        options.onProgress({
          percent: totalBytes > 0 ? Math.min(100, Math.round((extractedBytes / totalBytes) * 100)) : 100,
          extractedBytes,
          totalBytes,
          currentFile: '',
          pkgName,
          detail
        })
      }
      emit(0, 'iniciando o PKG Extractor...', true)

      const result = await runExtractor(extractor, [info.file, workDir], {
        onFile: (index, total) => emit(total > 0 ? index / total : 0, `arquivo ${index} de ${total}`)
      })
      const failure = detectFailure(result.tail)
      if (result.signal || (result.code ?? 0) !== 0) {
        throw new Error(
          `${pkgName}: o PKG Extractor terminou com erro (${result.signal ? `sinal ${result.signal}` : `código ${result.code}`})${failure ? ': ' + failure : '. Saída dele: ' + lastLines(result.tail)}`
        )
      }
      if (failure) throw new Error(`${pkgName}: ${failure}`)

      const output = await locateOutput(workDir, info, isAddon, result.tail)
      files += result.total
      if (isAddon) {
        const target = path.join(options.addonsDir!, addonFolderName(info))
        await fs.promises.rm(target, { recursive: true, force: true })
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await fs.promises.rename(output, target)
        addons.push({ info, dir: target })
      } else if (fs.existsSync(destDir)) {
        await mergeTree(output, destDir)
      } else {
        await fs.promises.mkdir(path.dirname(destDir), { recursive: true })
        await fs.promises.rename(output, destDir)
      }
      await fs.promises.rm(workDir, { recursive: true, force: true })
      emit(1, 'concluído', true)
      doneBytes += info.fileSize
    }
    options.onProgress?.({
      percent: 100,
      extractedBytes: totalBytes,
      totalBytes,
      currentFile: '',
      pkgName: '',
      detail: 'concluído'
    })
    return { applied: gameInfos, skipped, addons, files, bytes: totalBytes }
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true })
  }
}
