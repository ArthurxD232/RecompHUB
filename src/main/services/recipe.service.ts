import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import {
  CatalogGame,
  GameRecipe,
  RomAvailabilityStatus,
  RomVaultEntry
} from '../../shared/types'
import { StoreService } from './store.service'
import { RomVaultService } from './rom-vault.service'
import { isInstallerAsset } from './asset-selector'

export interface RecipeExecutionResult {
  executablePath: string
  requiresCompatibilityLayer: boolean
  romPaired: boolean
  pairedRomPaths: string[]
  pairedPatchPaths: string[]
  portableMode: boolean
  status: 'READY_TO_PLAY' | 'NEEDS_ROM' | 'ERROR'
  logs: string[]
}

export class RecipeService {
  constructor(
    private store: StoreService,
    private romVault: RomVaultService
  ) {}

  public async applyRecipe(
    game: CatalogGame,
    installDir: string,
    availability: RomAvailabilityStatus,
    onLog?: (msg: string) => void
  ): Promise<RecipeExecutionResult> {
    const logs: string[] = []
    const log = (msg: string): void => {
      const timestamped = `[${new Date().toLocaleTimeString()}] ${msg}`
      logs.push(timestamped)
      if (onLog) onLog(timestamped)
    }

    const settings = this.store.getSettings()
    const recipe: GameRecipe = game.recipe || {
      id: `default_${game.id}`,
      repoFullName: game.repoFullName,
      title: game.title,
      console: game.consoleBadge,
      family: game.inferredFamily,
      createPortableTxt: true,
      requirements: []
    }

    log(`Iniciando receita pós-instalação: Família ${recipe.family} (${recipe.title})`)

    // Flatten single nested folder if archive extracted into a single subfolder
    this.flattenSingleSubdirectoryIfNeeded(installDir, log)

    // 1. Portable mode (portable.txt) for N64Recomp or when configured
    let portableMode = false
    if (recipe.family === 'N64Recomp' || recipe.createPortableTxt || settings.createPortableTxtByDefault) {
      const portableTxtPath = path.join(installDir, 'portable.txt')
      try {
        if (!fs.existsSync(portableTxtPath)) {
          fs.writeFileSync(
            portableTxtPath,
            '# Created automatically by RecompHub (1-Click Portable Mode)\n',
            'utf-8'
          )
        }
        portableMode = true
        log('Arquivo portable.txt criado na raiz para isolar saves e configurações.')
      } catch (err: any) {
        log(`Aviso ao criar portable.txt: ${err?.message}`)
      }
    }

    // 2. Pair required ROMs / ISOs / BIOS from local vault
    const pairedRomPaths: string[] = []
    let allRequiredPaired = true

    for (const item of availability.matchedRequirements) {
      const req = item.requirement
      const localEntry = item.localEntry

      // Patches/atualizações/DLC são vinculados depois (passo 2b)
      if (req.type === 'patch') continue

      if (!localEntry || !fs.existsSync(localEntry.filePath)) {
        if (!req.optional) {
          allRequiredPaired = false
          log(`Requisito pendente: ${req.label} (esperado: ${req.expectedFilename})`)
        }
        continue
      }

      const destPath = path.join(
        installDir,
        req.keepOriginalName ? localEntry.fileName : req.expectedFilename
      )

      // Pasta do jogo (dump de PS4 etc.): atalho para o local original, nunca uma cópia de dezenas de GB
      if (localEntry.isDirectory) {
        const linked = this.linkDirectory(localEntry.filePath, destPath, log)
        pairedRomPaths.push(linked ?? localEntry.filePath)
        if (linked) {
          log(`Pasta do jogo vinculada: ${path.basename(destPath)} -> ${localEntry.filePath}`)
        }
        continue
      }

      try {
        const isN64Game =
          recipe.console === 'N64' ||
          recipe.family === 'N64Recomp' ||
          destPath.toLowerCase().endsWith('.z64') ||
          localEntry.filePath.toLowerCase().endsWith('.n64') ||
          localEntry.filePath.toLowerCase().endsWith('.v64') ||
          localEntry.filePath.toLowerCase().endsWith('.z64')

        await this.linkOrCopyRom(
          localEntry,
          destPath,
          settings.linkStrategy,
          isN64Game,
          log
        )
        pairedRomPaths.push(destPath)

        // Also link with the original filename in installDir if different, so ports that look
        // for original dump names or open a file picker in cwd find it immediately.
        // NOTE: If the original file was an unconverted N64 format (.n64/.v64), do NOT create an unconverted
        // duplicate that could cause asset extractors (like ZAPD) or recompilers to segfault!
        const origDestPath = path.join(installDir, localEntry.fileName)
        const isUnconvertedN64Name =
          origDestPath.toLowerCase().endsWith('.n64') ||
          origDestPath.toLowerCase().endsWith('.v64')

        if (
          !isUnconvertedN64Name &&
          path.resolve(origDestPath) !== path.resolve(destPath) &&
          !fs.existsSync(origDestPath)
        ) {
          try {
            this.createFileLink(
              destPath,
              origDestPath,
              settings.linkStrategy
            )
          } catch {
            // Ignore secondary alias error
          }
        }

        // Special handling for PSXRecomp:
        // - Create case-insensitive alias for BIOS on Linux (SCPH1001.BIN & scph1001.bin)
        // - If pairing a .bin file, also pair companion .cue file if present in the same directory
        if (recipe.family === 'PSXRecomp') {
          if (req.type === 'bios') {
            const lowerBios = path.join(installDir, req.expectedFilename.toLowerCase())
            const upperBios = path.join(installDir, req.expectedFilename.toUpperCase())
            for (const aliasPath of [lowerBios, upperBios]) {
              if (aliasPath !== destPath && !fs.existsSync(aliasPath)) {
                this.createFileLink(destPath, aliasPath, settings.linkStrategy)
              }
            }
            log('Aliases de BIOS PS1 (maiúsculo/minúsculo) configurados para compatibilidade Linux/Windows.')
          } else if (req.type === 'bin_cue') {
            this.linkCompanionCueIfPresent(localEntry.filePath, destPath, settings.linkStrategy, log)
          }
        }
      } catch (err: any) {
        allRequiredPaired = false
        log(`Erro ao vincular ${req.label}: ${err?.message}`)
      }
    }

    // 2b. Patches, atualizações e DLC: vinculados à subpasta definida pela receita (padrão: patches/)
    const pairedPatchPaths: string[] = []
    for (const item of availability.matchedRequirements) {
      if (item.requirement.type !== 'patch') continue
      const patches = (item.localEntries ?? (item.localEntry ? [item.localEntry] : [])).filter(
        (e) => fs.existsSync(e.filePath)
      )
      const targetDir = path.join(installDir, item.requirement.targetSubdir || 'patches')
      // Atalhos de patches que o usuário removeu da lista saem da pasta do jogo (arquivos de verdade ficam)
      this.removeOrphanLinks(targetDir, new Set(patches.map((p) => p.fileName)))
      if (patches.length === 0) continue
      fs.mkdirSync(targetDir, { recursive: true })
      for (const patch of patches) {
        const dest = path.join(targetDir, patch.fileName)
        const placed = this.placePatch(patch, dest, settings.linkStrategy, log)
        if (placed) pairedPatchPaths.push(dest)
      }
      if (pairedPatchPaths.length > 0) {
        log(
          `${pairedPatchPaths.length} patch(es)/atualização(ões) disponíveis em "${path.relative(installDir, targetDir)}/".`
        )
      }
    }

    // 3. Family-specific post-processing
    if (recipe.family === 'N64Recomp' && pairedRomPaths.length > 0) {
      this.patchN64RecompConfigIfNeeded(installDir, recipe, pairedRomPaths[0], log)
    } else if (recipe.family === 'XenonRecomp' && pairedRomPaths.length > 0) {
      await this.runXenonIsoExtraction(installDir, pairedRomPaths[0], settings.extractXisoPath, log)
    } else if (recipe.family === 'AssetExtractor' && pairedRomPaths.length > 0) {
      await this.runAssetExtractorIfNeeded(installDir, recipe, pairedRomPaths[0], log)
    }

    // 4. Discover main executable and set executable permissions on Linux
    const execInfo = this.findMainExecutable(installDir, recipe)
    if (execInfo.executablePath) {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(execInfo.executablePath, 0o755)
        } catch {
          // Ignore chmod error on NTFS/FAT mounts
        }
      }

      // If executable lives in a subdirectory (e.g. runtime/ac5.exe), also link paired ROMs into that subdirectory
      const execDir = path.dirname(execInfo.executablePath)
      if (path.resolve(execDir) !== path.resolve(installDir) && pairedRomPaths.length > 0) {
        for (const romPath of pairedRomPaths) {
          const romInExecDir = path.join(execDir, path.basename(romPath))
          // Pastas de jogo (dumps) já têm o atalho na raiz; não duplica
          if (fs.existsSync(romPath) && fs.statSync(romPath).isDirectory()) continue
          if (!fs.existsSync(romInExecDir)) {
            try {
              this.createFileLink(romPath, romInExecDir, settings.linkStrategy)
              log(`Link complementar da ISO criado no diretório do executável (${path.relative(installDir, romInExecDir)}).`)
            } catch {
              // Ignore
            }
          }
        }
      }

      // If PS2Recomp runtime is detected (ps2_image.bin next to executable), ensure saves folder exists & patch fullscreen
      if (fs.existsSync(path.join(execDir, 'ps2_image.bin'))) {
        const savesDir = path.join(installDir, 'saves')
        const runtimeSavesDir = path.join(execDir, 'saves')
        try {
          if (!fs.existsSync(savesDir)) fs.mkdirSync(savesDir, { recursive: true })
          if (!fs.existsSync(runtimeSavesDir)) fs.mkdirSync(runtimeSavesDir, { recursive: true })
          this.configurePs2RecompFullscreen(execInfo.executablePath, execDir, log)
          log('Ambiente PS2 Static Recompilation (ps2_image.bin + shaders + saves + tela cheia) preparado.')
        } catch {
          // Ignore
        }
      }

      if (isInstallerAsset(path.basename(execInfo.executablePath))) {
        log(
          `Aviso: "${path.basename(execInfo.executablePath)}" parece ser o instalador próprio deste port. Execute-o uma vez e depois use o botão de engrenagem para selecionar o executável do jogo instalado.`
        )
      }

      log(
        `Executável principal detectado: ${path.basename(execInfo.executablePath)}${
          execInfo.requiresCompatibilityLayer ? ' (Modo Compatibilidade Proton/umu-run)' : ' (Nativo)'
        }`
      )
    } else {
      log('Aviso: Executável principal não identificado automaticamente; pode ser selecionado manualmente.')
    }

    const romRequiredCount = recipe.requirements.filter((r) => !r.optional).length
    const romPaired = romRequiredCount === 0 || (allRequiredPaired && pairedRomPaths.length >= romRequiredCount)

    const status = romPaired ? 'READY_TO_PLAY' : 'NEEDS_ROM'
    log(
      status === 'READY_TO_PLAY'
        ? 'Jogo configurado e pronto para jogar (READY_TO_PLAY)!'
        : 'Jogo instalado, aguardando pareamento da ROM/ISO exigida (NEEDS_ROM).'
    )

    return {
      executablePath: execInfo.executablePath,
      requiresCompatibilityLayer: execInfo.requiresCompatibilityLayer,
      romPaired,
      pairedRomPaths,
      pairedPatchPaths,
      portableMode,
      status,
      logs
    }
  }

  private flattenSingleSubdirectoryIfNeeded(installDir: string, log: (m: string) => void): void {
    try {
      const entries = fs.readdirSync(installDir, { withFileTypes: true }).filter(
        (e) => e.name !== 'portable.txt' && !e.name.startsWith('.')
      )
      if (entries.length === 1 && entries[0].isDirectory()) {
        const nestedDir = path.join(installDir, entries[0].name)
        const nestedItems = fs.readdirSync(nestedDir)
        for (const item of nestedItems) {
          const src = path.join(nestedDir, item)
          const dest = path.join(installDir, item)
          if (!fs.existsSync(dest)) {
            fs.renameSync(src, dest)
          }
        }
        fs.rmdirSync(nestedDir)
        log(`Estrutura de subpasta única (${entries[0].name}) nivelada para a raiz do jogo.`)
      }
    } catch {
      // Ignore if unable to flatten
    }
  }

  private async linkOrCopyRom(
    entry: RomVaultEntry,
    destPath: string,
    strategy: 'symlink' | 'hardlink' | 'copy',
    ensureBigEndianZ64: boolean,
    log: (m: string) => void
  ): Promise<void> {
    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }

    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath)
    }

    // Check if N64 ROM needs byte-order conversion to .z64 (big-endian 0x80371240)
    const isDestZ64 = destPath.toLowerCase().endsWith('.z64')
    if (ensureBigEndianZ64 || isDestZ64) {
      const needsSwap = this.checkN64ByteSwapNeeded(entry.filePath)
      if (needsSwap !== 'none') {
        log(
          `Convertendo ROM N64 (${needsSwap}) automaticamente para formato Big-Endian (.z64)...`
        )
        this.convertN64RomToZ64(entry.filePath, destPath, needsSwap)
        return
      }
    }

    const usedStrategy = this.createFileLink(entry.filePath, destPath, strategy)
    log(
      `ROM pareada (${usedStrategy}): ${entry.fileName} -> ${path.basename(destPath)} [SHA-1: ${entry.sha1.slice(0, 10)}...]`
    )
  }

  private isSymlink(p: string): boolean {
    try {
      return fs.lstatSync(p).isSymbolicLink()
    } catch {
      return false
    }
  }

  /** Remove o atalho anterior (só se for um atalho: nunca apaga arquivos ou pastas de verdade). */
  private removeLinkIfAny(p: string): boolean {
    if (!this.isSymlink(p)) return !fs.existsSync(p)
    try {
      fs.rmSync(p, { force: true })
    } catch {
      try {
        fs.rmdirSync(p)
      } catch {
        return false
      }
    }
    return true
  }

  /**
   * Atalho para uma pasta. No Windows usa "junction", que não exige administrador.
   * Retorna o caminho do atalho ou null se não foi possível criar.
   */
  private linkDirectory(target: string, linkPath: string, log: (m: string) => void): string | null {
    try {
      if (path.resolve(target) === path.resolve(linkPath)) return linkPath
      if (!this.removeLinkIfAny(linkPath)) {
        log(`Aviso: já existe algo em "${path.basename(linkPath)}" que não é um atalho; nada foi alterado.`)
        return null
      }
      fs.mkdirSync(path.dirname(linkPath), { recursive: true })
      fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
      return linkPath
    } catch (err: any) {
      log(
        `Aviso: não foi possível criar o atalho da pasta (${err?.message}). O jogo continua apontando para o local original: ${target}`
      )
      return null
    }
  }

  private removeOrphanLinks(dir: string, keep: Set<string>): void {
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const full = path.join(dir, name)
      if (!keep.has(name) && this.isSymlink(full)) this.removeLinkIfAny(full)
    }
  }

  /** Coloca um patch na pasta do jogo por atalho; só copia arquivos pequenos (nunca dezenas de GB). */
  private placePatch(
    entry: RomVaultEntry,
    destPath: string,
    strategy: 'symlink' | 'hardlink' | 'copy',
    log: (m: string) => void
  ): boolean {
    if (entry.isDirectory) {
      return this.linkDirectory(entry.filePath, destPath, log) !== null
    }
    try {
      if (!this.removeLinkIfAny(destPath)) return false
      this.createFileLink(entry.filePath, destPath, strategy, 512 * 1024 * 1024)
      return true
    } catch (err: any) {
      log(`Aviso: não foi possível vincular o patch ${entry.fileName}: ${err?.message}`)
      return false
    }
  }

  private createFileLink(
    srcPath: string,
    destPath: string,
    strategy: 'symlink' | 'hardlink' | 'copy',
    maxCopyBytes = Number.POSITIVE_INFINITY
  ): string {
    if (strategy === 'symlink') {
      try {
        fs.symlinkSync(srcPath, destPath)
        return 'symlink'
      } catch {
        // Fallback to hardlink or copy
      }
    }

    if (strategy === 'hardlink' || strategy === 'symlink') {
      try {
        fs.linkSync(srcPath, destPath)
        return 'hardlink'
      } catch {
        // Cross-device link not permitted, fallback to copy
      }
    }

    if (fs.statSync(srcPath).size > maxCopyBytes) {
      throw new Error(
        'o sistema não permite atalhos entre esses discos e o arquivo é grande demais para copiar'
      )
    }
    fs.copyFileSync(srcPath, destPath)
    return 'copy'
  }

  private checkN64ByteSwapNeeded(filePath: string): 'none' | 'v64_byteswap' | 'n64_wordswap' {
    try {
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(4)
      fs.readSync(fd, buf, 0, 4, 0)
      fs.closeSync(fd)

      const magic = buf.readUInt32BE(0)
      if (magic === 0x80371240) return 'none' // Big-endian .z64
      if (magic === 0x37804012) return 'v64_byteswap' // Byte-swapped .v64
      if (magic === 0x40123780) return 'n64_wordswap' // Little-endian .n64
    } catch {
      // Ignore
    }
    return 'none'
  }

  private convertN64RomToZ64(
    srcPath: string,
    destPath: string,
    mode: 'v64_byteswap' | 'n64_wordswap'
  ): void {
    const buf = fs.readFileSync(srcPath)
    if (mode === 'v64_byteswap') {
      for (let i = 0; i + 1 < buf.length; i += 2) {
        const tmp = buf[i]
        buf[i] = buf[i + 1]
        buf[i + 1] = tmp
      }
    } else if (mode === 'n64_wordswap') {
      for (let i = 0; i + 3 < buf.length; i += 4) {
        const b0 = buf[i]
        const b1 = buf[i + 1]
        const b2 = buf[i + 2]
        const b3 = buf[i + 3]
        buf[i] = b3
        buf[i + 1] = b2
        buf[i + 2] = b1
        buf[i + 3] = b0
      }
    }
    fs.writeFileSync(destPath, buf)
  }

  private linkCompanionCueIfPresent(
    srcBinPath: string,
    destBinPath: string,
    strategy: 'symlink' | 'hardlink' | 'copy',
    log: (m: string) => void
  ): void {
    const parsedSrc = path.parse(srcBinPath)
    const companionCue = path.join(parsedSrc.dir, `${parsedSrc.name}.cue`)
    if (fs.existsSync(companionCue)) {
      const parsedDest = path.parse(destBinPath)
      const destCue = path.join(parsedDest.dir, `${parsedDest.name}.cue`)
      try {
        // Rewrite .cue FILE line so it references the linked .bin filename
        const cueContent = fs.readFileSync(companionCue, 'utf-8')
        const updatedCue = cueContent.replace(
          /FILE\s+"[^"]+"\s+BINARY/i,
          `FILE "${parsedDest.base}" BINARY`
        )
        fs.writeFileSync(destCue, updatedCue, 'utf-8')
        log(`Arquivo .cue complementar gerado e ajustado: ${path.basename(destCue)}`)
      } catch {
        this.createFileLink(companionCue, destCue, strategy)
      }
    }
  }

  private patchN64RecompConfigIfNeeded(
    installDir: string,
    recipe: GameRecipe,
    pairedRomPath: string,
    log: (m: string) => void
  ): void {
    const configSpec = recipe.configFileToPatch
    if (!configSpec) return

    const configPath = path.join(installDir, configSpec.filename)
    const romFileName = path.basename(pairedRomPath)

    try {
      if (fs.existsSync(configPath)) {
        let content = fs.readFileSync(configPath, 'utf-8')
        const regex = new RegExp(`^(${configSpec.romKey}\\s*=\\s*).*$`, 'm')
        if (regex.test(content)) {
          content = content.replace(regex, `$1"${romFileName}"`)
        } else {
          content += `\n${configSpec.romKey} = "${romFileName}"\n`
        }
        fs.writeFileSync(configPath, content, 'utf-8')
        log(`Configuração ${configSpec.filename} atualizada com ${configSpec.romKey} = "${romFileName}".`)
      }
    } catch (err: any) {
      log(`Nota: Não foi necessário alterar ${configSpec.filename} (${err?.message}).`)
    }
  }

  private async runXenonIsoExtraction(
    installDir: string,
    isoPath: string,
    extractXisoBinary: string,
    log: (m: string) => void
  ): Promise<void> {
    if (!isoPath.toLowerCase().endsWith('.iso')) {
      log('Arquivo Xbox 360 já está em formato extraído (.xex).')
      return
    }

    log(`Executando extração de ISO Xbox 360 via ${extractXisoBinary}...`)
    await new Promise<void>((resolve) => {
      const child = spawn(extractXisoBinary, ['-x', isoPath, '-d', installDir], {
        cwd: installDir
      })

      child.stdout.on('data', (data) => {
        const line = data.toString().trim()
        if (line) log(`[extract-xiso] ${line}`)
      })

      child.stderr.on('data', (data) => {
        const line = data.toString().trim()
        if (line) log(`[extract-xiso] ${line}`)
      })

      child.on('error', () => {
        log(
          `Utilitário '${extractXisoBinary}' não encontrado no PATH. A ISO foi vinculada na raiz (${path.basename(isoPath)}); instale extract-xiso nas Configurações para descompactação automática de ISOs Xbox 360.`
        )
        resolve()
      })

      child.on('close', (code) => {
        if (code === 0) {
          log('ISO Xbox 360 extraída com sucesso na raiz do binário recompilado!')
        } else {
          log(`extract-xiso finalizou com código ${code}.`)
        }
        resolve()
      })
    })
  }

  private async runAssetExtractorIfNeeded(
    installDir: string,
    recipe: GameRecipe,
    romPath: string,
    log: (m: string) => void
  ): Promise<void> {
    const extCfg = recipe.extractorConfig
    if (!extCfg) return

    const files = this.listFilesRecursive(installDir, 2)

    // Check if expected output packages are already generated (e.g. mm.o2r, oot.o2r)
    const expectedOutputs = extCfg.expectedOutputFiles || []
    const requiredArchives = expectedOutputs.filter(
      (name) => name !== '2ship.o2r' && name !== 'soh.otr'
    )
    const allExpectedGenerated =
      requiredArchives.length > 0 &&
      requiredArchives.every((name) => {
        const p = path.join(installDir, name)
        return fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024
      })

    if (allExpectedGenerated) {
      log(`Pacotes de assets (${requiredArchives.join(', ')}) já se encontram gerados. Pronto para jogar!`)
      return
    }

    // 1. Check if dedicated CLI extractor binary (like OpenGOAL's `extractor` or `torch`) exists
    let dedicatedExtractor = files.find((f) => {
      const base = path.basename(f).toLowerCase()
      return (
        base === 'extractor' ||
        base === 'extractor.exe' ||
        base === 'torch' ||
        base === 'torch.exe'
      )
    })

    let extractorArgs = extCfg.cliArgs.map((arg) =>
      arg.replace('{ROM_PATH}', romPath).replace('{INSTALL_DIR}', installDir)
    )

    // 2. If no standalone extractor binary, look for integrated ports (like 2Ship2Harkinian, Ship of Harkinian)
    if (!dedicatedExtractor) {
      const execCandidate = files.find((f) => {
        const base = path.basename(f).toLowerCase()
        return (
          base.includes('2ship') ||
          base.includes('soh') ||
          base.includes('spaghettikart')
        )
      })

      if (execCandidate) {
        dedicatedExtractor = execCandidate
        if (execCandidate.toLowerCase().endsWith('.appimage')) {
          extractorArgs = ['--appimage-extract-and-run']
        } else {
          extractorArgs = []
        }
      }
    }

    if (!dedicatedExtractor) {
      log(
        `ROM posicionada em ${path.basename(romPath)}. O extrator integrado gerará os pacotes (.o2r/.otr) automaticamente na inicialização.`
      )
      return
    }

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(dedicatedExtractor, 0o755)
      } catch {
        // Ignore
      }
    }

    log(`Iniciando geração de assets (.o2r/.otr) com ${path.basename(dedicatedExtractor)}...`)

    await new Promise<void>((resolve) => {
      let finished = false
      const finishOnce = (reason: string): void => {
        if (finished) return
        finished = true
        clearInterval(pollInterval)
        log(reason)
        try {
          child.kill('SIGTERM')
        } catch {
          // Ignore
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // Ignore
          }
          resolve()
        }, 500)
      }

      const checkOutputFiles = (): void => {
        if (
          requiredArchives.length > 0 &&
          requiredArchives.every((name) => {
            const p = path.join(installDir, name)
            return fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024
          })
        ) {
          finishOnce('Arquivo(s) .o2r/.otr gerado(s) com sucesso na raiz do jogo!')
        }
      }

      const pollInterval = setInterval(checkOutputFiles, 1000)

      const child = spawn(dedicatedExtractor, extractorArgs, {
        cwd: installDir
      })

      const handleData = (d: Buffer): void => {
        const text = d.toString()
        const lines = text.split('\n')
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue

          // Log extraction progress milestones
          if (
            line.includes('/ 660') ||
            line.includes('Generating OTR') ||
            line.includes('Generating O2R') ||
            line.includes('Loaded ZIP (O2R)')
          ) {
            log(`[AssetExtractor] ${line}`)
          }

          if (
            line.includes('Loaded ZIP (O2R) archive:') ||
            line.includes('Starting 2 Ship 2 Harkinian') ||
            line.includes('Starting Ship of Harkinian')
          ) {
            finishOnce('Extração de assets concluída com sucesso! Jogo 100% pronto para jogar.')
          }
        }
      }

      child.stdout?.on('data', handleData)
      child.stderr?.on('data', handleData)

      child.on('error', (err) => {
        clearInterval(pollInterval)
        log(`Aviso ao executar extrator: ${err.message}`)
        resolve()
      })

      child.on('close', (code) => {
        clearInterval(pollInterval)
        checkOutputFiles()
        if (!finished) {
          log(`Processo de extração finalizado (código ${code ?? 0}).`)
          resolve()
        }
      })

      // Safety timeout: 3 minutes max
      setTimeout(() => {
        if (!finished) {
          clearInterval(pollInterval)
          checkOutputFiles()
          finishOnce('Geração de assets finalizada ou tempo limite atingido. Continuando...')
        }
      }, 180000)
    })
  }

  public findMainExecutable(
    installDir: string,
    recipe?: GameRecipe
  ): { executablePath: string; requiresCompatibilityLayer: boolean } {
    const allFiles = this.listFilesRecursive(installDir, 3)

    const ignoredNames = [
      'uninstall',
      'unins000',
      'vc_redist',
      'dxsetup',
      'crashpad_handler',
      'unitycrashhandler',
      'extract-xiso',
      'extractor.exe'
    ]

    const isIgnored = (filePath: string): boolean => {
      const base = path.basename(filePath).toLowerCase()
      return ignoredNames.some((ig) => base.includes(ig))
    }

    // 1. Check explicit hints from recipe first
    if (recipe?.executableHints && recipe.executableHints.length > 0) {
      for (const hint of recipe.executableHints) {
        const match = allFiles.find(
          (f) => path.basename(f).toLowerCase() === hint.toLowerCase()
        )
        if (match) {
          const isExe = match.toLowerCase().endsWith('.exe')
          return {
            executablePath: match,
            requiresCompatibilityLayer: process.platform === 'linux' && isExe
          }
        }
      }
    }

    // 2. On Linux, check for .AppImage or native ELF binary first
    if (process.platform === 'linux') {
      const appImage = allFiles.find(
        (f) => f.toLowerCase().endsWith('.appimage') && !isIgnored(f)
      )
      if (appImage) {
        return { executablePath: appImage, requiresCompatibilityLayer: false }
      }

      const elfBinary = allFiles.find(
        (f) => !isIgnored(f) && this.isElfBinary(f)
      )
      if (elfBinary) {
        return { executablePath: elfBinary, requiresCompatibilityLayer: false }
      }
    }

    // 3. Look for .exe files (native on Windows, or Proton/umu-run on Linux)
    const exeFiles = allFiles.filter(
      (f) => f.toLowerCase().endsWith('.exe') && !isIgnored(f)
    )
    if (exeFiles.length > 0) {
      // Prefer shallowest .exe
      exeFiles.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length)
      return {
        executablePath: exeFiles[0],
        requiresCompatibilityLayer: process.platform === 'linux'
      }
    }

    // 3b. Windows: alguns ports (ex.: apps em Java) só trazem scripts .bat/.cmd de início
    if (process.platform === 'win32') {
      const scriptIgnored = /(setup|install|uninstall|update|optional|debug|build|clean)/i
      const batFiles = allFiles.filter(
        (f) => /\.(bat|cmd)$/i.test(f) && !isIgnored(f) && !scriptIgnored.test(path.basename(f))
      )
      if (batFiles.length > 0) {
        const preferred = (f: string): number =>
          /(run|start|launch|play)/i.test(path.basename(f)) ? 0 : 1
        batFiles.sort(
          (a, b) =>
            preferred(a) - preferred(b) || a.split(path.sep).length - b.split(path.sep).length
        )
        return { executablePath: batFiles[0], requiresCompatibilityLayer: false }
      }
    }

    // 4. Look for .sh launcher scripts on Linux
    if (process.platform === 'linux') {
      const shFile = allFiles.find(
        (f) => f.toLowerCase().endsWith('.sh') && !isIgnored(f)
      )
      if (shFile) {
        return { executablePath: shFile, requiresCompatibilityLayer: false }
      }
    }

    return { executablePath: '', requiresCompatibilityLayer: false }
  }

  private isElfBinary(filePath: string): boolean {
    try {
      const ext = path.extname(filePath).toLowerCase()
      if (
        ['.so', '.dll', '.bin', '.z64', '.n64', '.v64', '.iso', '.png', '.jpg', '.toml', '.txt', '.json', '.md', '.o2r', '.otr', '.pak'].includes(
          ext
        )
      ) {
        return false
      }
      if (path.basename(filePath).toLowerCase().startsWith('lib')) {
        return false
      }
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(4)
      const bytesRead = fs.readSync(fd, buf, 0, 4, 0)
      fs.closeSync(fd)
      return (
        bytesRead === 4 &&
        buf[0] === 0x7f &&
        buf[1] === 0x45 &&
        buf[2] === 0x4c &&
        buf[3] === 0x46
      )
    } catch {
      return false
    }
  }

  private configurePs2RecompFullscreen(
    executablePath: string,
    execDir: string,
    log: (m: string) => void
  ): void {
    try {
      // 1. Patch SDL_EVENT_WINDOW_MAXIMIZED in ac5.exe jump table so clicking the window Maximize button toggles Fullscreen
      if (fs.existsSync(executablePath)) {
        const buf = fs.readFileSync(executablePath)
        const origJumpTable = Buffer.from(
          '14db04fc4cda04fc34dd04fc1edb04fc4cda04fca4dd04fc14db04fc',
          'hex'
        )
        const patchedJumpTable = Buffer.from(
          '14db04fc4cda04fc34dd04fc1edb04fc4cda04fca4dd04fcb3de04fc',
          'hex'
        )
        const idx = buf.indexOf(origJumpTable)
        if (idx !== -1) {
          patchedJumpTable.copy(buf, idx)
          fs.writeFileSync(executablePath, buf)
          log('Botão Maximizar da janela vinculado ao modo Tela Cheia (SDL3 Maximize -> Fullscreen).')
        }
      }

      // 2. Ensure ac5_settings.ini has Borderless Fullscreen enabled by default
      const iniPath = path.join(execDir, 'ac5_settings.ini')
      if (fs.existsSync(iniPath)) {
        let ini = fs.readFileSync(iniPath, 'utf-8')
        ini = ini.replace(/^(window_mode\s*=\s*)\d+/m, '$11')
        ini = ini.replace(/^(fullscreen_type\s*=\s*)\d+/m, '$11')
        ini = ini.replace(/^(aspect\s*=\s*)\d+/m, '$11')
        ini = ini.replace(/^(widescreen\s*=\s*)\d+/m, '$11')
        fs.writeFileSync(iniPath, ini, 'utf-8')
        log('Configuração ac5_settings.ini ajustada para Tela Cheia Sem Bordas (Borderless 16:9).')
      }
    } catch {
      // Ignore
    }
  }

  private listFilesRecursive(dir: string, maxDepth = 3, depth = 0): string[] {
    if (depth > maxDepth || !fs.existsSync(dir)) return []
    const results: string[] = []
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return results
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile()) {
        results.push(fullPath)
      } else if (entry.isDirectory()) {
        results.push(...this.listFilesRecursive(fullPath, maxDepth, depth + 1))
      }
    }
    return results
  }
}
