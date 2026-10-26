import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ChildProcess, spawn, execSync } from 'child_process'
import { DetectedLinuxRunner, InstalledGame } from '../../shared/types'
import { StoreService } from './store.service'
import { DownloaderService } from './downloader.service'

export class RunnerService {
  private runningProcesses = new Map<
    string,
    { process?: ChildProcess; pid?: number; startedAtMs: number; isExternal?: boolean }
  >()
  private monitorTimer?: NodeJS.Timeout
  private isChecking = false

  constructor(
    private store: StoreService,
    private downloader: DownloaderService
  ) {
    this.startProcessMonitor()
  }

  public detectLinuxRunners(): DetectedLinuxRunner[] {
    if (process.platform !== 'linux') return []
    const runners: DetectedLinuxRunner[] = []

    // 1. Check umu-run
    const umuPath = this.whichCommand('umu-run')
    if (umuPath) {
      runners.push({
        type: 'umu-run',
        name: 'UMU Launcher (umu-run)',
        path: umuPath
      })
    }

    // 2. Scan Steam & Custom Proton directories
    const home = os.homedir()
    const protonSearchDirs = [
      path.join(home, '.local/share/Steam/compatibilitytools.d'),
      path.join(home, '.steam/root/compatibilitytools.d'),
      path.join(home, '.local/share/Steam/steamapps/common'),
      path.join(home, '.steam/steam/steamapps/common'),
      '/usr/share/steam/compatibilitytools.d'
    ]

    const seenProtonPaths = new Set<string>()
    for (const dir of protonSearchDirs) {
      if (!fs.existsSync(dir)) continue
      try {
        const subdirs = fs.readdirSync(dir, { withFileTypes: true })
        for (const d of subdirs) {
          if (!d.isDirectory()) continue
          const protonScript = path.join(dir, d.name, 'proton')
          if (fs.existsSync(protonScript)) {
            const real = fs.realpathSync(protonScript)
            if (!seenProtonPaths.has(real)) {
              seenProtonPaths.add(real)
              runners.push({
                type: 'proton',
                name: d.name,
                path: protonScript
              })
            }
          }
        }
      } catch {
        // Ignore
      }
    }

    // 3. Check Wine fallback
    const winePath = this.whichCommand('wine') || this.whichCommand('wine64')
    if (winePath) {
      runners.push({
        type: 'wine',
        name: 'Wine System Runtime',
        path: winePath
      })
    }

    return runners
  }

  private whichCommand(cmd: string): string | null {
    try {
      const out = execSync(`command -v ${cmd}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      return out || null
    } catch {
      return null
    }
  }

  public async launchGame(
    gameId: string
  ): Promise<{ pid?: number; command: string }> {
    const game = this.store.getInstalledGame(gameId)
    if (!game) {
      throw new Error('Jogo não encontrado na biblioteca instalada.')
    }

    if (!game.executablePath || !fs.existsSync(game.executablePath)) {
      throw new Error(
        `Executável não encontrado em "${game.executablePath || game.installDir}". Selecione o binário manualmente ou reaplique a receita.`
      )
    }

    if (this.runningProcesses.has(game.gameId)) {
      throw new Error('Este jogo já está em execução.')
    }

    const { cmd, args, env } = this.buildLaunchCommand(game)
    const fullCommandString = `${cmd} ${args.join(' ')}`.trim()

    // Ensure executable bit on Linux
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(game.executablePath, 0o755)
      } catch {
        // Ignore
      }
    }

    const child = spawn(cmd, args, {
      cwd: path.dirname(game.executablePath) || game.installDir,
      env: {
        ...process.env,
        ...env
      },
      detached: false
    })

    const startedAtMs = Date.now()
    this.runningProcesses.set(game.gameId, { process: child, pid: child.pid, startedAtMs })

    // Mark game as RUNNING
    this.store.upsertInstalledGame({
      ...game,
      status: 'RUNNING',
      lastPlayedAt: new Date().toISOString()
    })
    this.downloader.emitLibraryUpdated()

    child.on('close', () => {
      const entry = this.runningProcesses.get(game.gameId)
      if (entry) {
        this.runningProcesses.delete(game.gameId)
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - entry.startedAtMs) / 1000))

        const latestGame = this.store.getInstalledGame(game.gameId)
        if (latestGame) {
          this.store.upsertInstalledGame({
            ...latestGame,
            status: latestGame.romPaired ? 'READY_TO_PLAY' : 'NEEDS_ROM',
            playTimeSeconds: (latestGame.playTimeSeconds || 0) + elapsedSeconds,
            lastPlayedAt: new Date().toISOString()
          })
          this.downloader.emitLibraryUpdated()
        }
      }
    })

    child.on('error', (err) => {
      console.error(`[RunnerService] Error launching ${game.title}:`, err)
      this.runningProcesses.delete(game.gameId)
      const latestGame = this.store.getInstalledGame(game.gameId)
      if (latestGame) {
        this.store.upsertInstalledGame({
          ...latestGame,
          status: latestGame.romPaired ? 'READY_TO_PLAY' : 'NEEDS_ROM',
          recipeLogs: [
            ...latestGame.recipeLogs,
            `[ERRO EXECUÇÃO] ${err.message}`
          ]
        })
        this.downloader.emitLibraryUpdated()
      }
    })

    return {
      pid: child.pid,
      command: fullCommandString
    }
  }

  public async stopGame(gameId: string): Promise<void> {
    const running = this.runningProcesses.get(gameId)
    if (running) {
      try {
        if (running.process) {
          running.process.kill('SIGTERM')
        } else if (running.pid) {
          process.kill(running.pid, 'SIGTERM')
        }
      } catch {
        // Ignore
      }
      this.runningProcesses.delete(gameId)
    }

    const game = this.store.getInstalledGame(gameId)
    if (game && game.status === 'RUNNING') {
      const elapsedSeconds = running
        ? Math.max(1, Math.round((Date.now() - running.startedAtMs) / 1000))
        : 0
      this.store.upsertInstalledGame({
        ...game,
        status: game.romPaired ? 'READY_TO_PLAY' : 'NEEDS_ROM',
        playTimeSeconds: (game.playTimeSeconds || 0) + elapsedSeconds,
        lastPlayedAt: new Date().toISOString()
      })
      this.downloader.emitLibraryUpdated()
    }
  }

  /**
   * Monitoramento contínuo de processos ativos no sistema operacional (Linux / Windows).
   * Permite que quando um jogo for aberto via Steam, desktop ou terminal, o RecompHUB
   * detecte automaticamente que ele está rodando, marque o status RUNNING em tempo real,
   * contabilize o tempo jogado e atualize a interface assim que for fechado.
   */
  private scanRunningProcesses(): Map<string, number> {
    const runningMap = new Map<string, number>()

    if (process.platform === 'linux') {
      try {
        const pids = fs.readdirSync('/proc')
        for (const name of pids) {
          if (!/^\d+$/.test(name)) continue
          const pid = parseInt(name, 10)
          try {
            const exeLink = fs.readlinkSync(`/proc/${name}/exe`)
            if (exeLink) {
              runningMap.set(exeLink, pid)
              runningMap.set(path.basename(exeLink).toLowerCase(), pid)
            }
          } catch {}

          try {
            const rawCmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8')
            if (rawCmd) {
              const parts = rawCmd.split('\0')
              for (const p of parts) {
                if (!p || p.startsWith('-')) continue
                runningMap.set(p, pid)
                runningMap.set(path.basename(p).toLowerCase(), pid)
              }
            }
          } catch {}
        }
      } catch {}
      return runningMap
    }

    if (process.platform === 'win32') {
      try {
        const out = execSync('tasklist /FO CSV /NH', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        })
        const lines = out.trim().split('\n')
        for (const line of lines) {
          const parts = line.split('","').map((p) => p.replace(/^"|"$/g, '').trim())
          if (parts[0]) {
            const pid = parseInt(parts[1], 10)
            if (!isNaN(pid)) {
              runningMap.set(parts[0].toLowerCase(), pid)
            }
          }
        }
      } catch {}
      return runningMap
    }

    return runningMap
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  public async checkRunningProcesses(): Promise<void> {
    if (this.isChecking) return
    this.isChecking = true
    try {
      const runningMap = this.scanRunningProcesses()
      const installedGames = this.store.getLibrary()

      // 1. Verificar processos já rastreados
      for (const [gameId, entry] of Array.from(this.runningProcesses.entries())) {
        const stillAlive = entry.pid ? this.isPidAlive(entry.pid) : false
        if (!stillAlive) {
          const elapsedSeconds = Math.max(
            1,
            Math.round((Date.now() - entry.startedAtMs) / 1000)
          )
          this.runningProcesses.delete(gameId)
          const latestGame = this.store.getInstalledGame(gameId)
          if (latestGame) {
            this.store.upsertInstalledGame({
              ...latestGame,
              status: latestGame.romPaired ? 'READY_TO_PLAY' : 'NEEDS_ROM',
              playTimeSeconds: (latestGame.playTimeSeconds || 0) + elapsedSeconds,
              lastPlayedAt: new Date().toISOString()
            })
            this.downloader.emitLibraryUpdated()
          }
        }
      }

      // 2. Detectar jogos que foram iniciados externamente (ex: Steam)
      for (const game of installedGames) {
        if (!game.executablePath || !fs.existsSync(game.executablePath)) continue
        if (this.runningProcesses.has(game.gameId)) continue

        const targetExe = path.resolve(game.executablePath)
        const exeBase = path.basename(targetExe).toLowerCase()

        const foundPid = runningMap.get(targetExe) || runningMap.get(exeBase)

        if (foundPid) {
          this.runningProcesses.set(game.gameId, {
            pid: foundPid,
            startedAtMs: Date.now(),
            isExternal: true
          })
          if (game.status !== 'RUNNING') {
            this.store.upsertInstalledGame({
              ...game,
              status: 'RUNNING',
              lastPlayedAt: new Date().toISOString()
            })
            this.downloader.emitLibraryUpdated()
          }
        } else if (game.status === 'RUNNING') {
          // Jogo constava como RUNNING no store de uma sessão anterior não finalizada
          this.store.upsertInstalledGame({
            ...game,
            status: game.romPaired ? 'READY_TO_PLAY' : 'NEEDS_ROM'
          })
          this.downloader.emitLibraryUpdated()
        }
      }
    } finally {
      this.isChecking = false
    }
  }

  public startProcessMonitor(): void {
    if (this.monitorTimer) return
    this.monitorTimer = setInterval(() => {
      this.checkRunningProcesses().catch(() => {})
    }, 2000)
    if (typeof this.monitorTimer.unref === 'function') {
      this.monitorTimer.unref()
    }
  }

  public stopProcessMonitor(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = undefined
    }
  }

  /**
   * Prepara o ambiente de execução pré-launch (especialmente portas PS4, ini, display mode, settings.json).
   */
  public prepareLaunchEnvironment(game: InstalledGame): void {
    const execDir = path.dirname(game.executablePath) || game.installDir
    const extraEnv: Record<string, string> = {}
    this.ensurePs4LaunchEnvironment(game, execDir, extraEnv)
  }

  /**
   * Gera as opções de inicialização (LaunchOptions) ideais para atalhos da Steam.
   * No Linux, remove a injeção do runtime antigo da Steam (LD_LIBRARY_PATH/LD_PRELOAD)
   * que causa conflitos fatais de OpenGL/EGL/Wayland com binários modernos do sistema (ex: PySide6/Qt6).
   */
  public getLaunchOptionsForSteam(game: InstalledGame): string {
    const isLinux = process.platform === 'linux'
    const isExe = game.executablePath.toLowerCase().endsWith('.exe')
    const isAppImage = game.executablePath.toLowerCase().endsWith('.appimage')
    const execDir = path.dirname(game.executablePath) || game.installDir
    const extraArgs = this.resolveLaunchArgs(game, isLinux && isExe)
    const extraEnv: Record<string, string> = {}

    // PS2 static recompilation detection
    if (fs.existsSync(path.join(execDir, 'ps2_image.bin'))) {
      let discArg = 'game.iso'
      const candidateIso =
        game.pairedRomPaths?.find((p) => fs.existsSync(p)) ||
        path.join(game.installDir, 'game.iso')
      if (candidateIso && !fs.existsSync(path.join(execDir, 'game.iso'))) {
        try {
          fs.symlinkSync(candidateIso, path.join(execDir, 'game.iso'))
        } catch {
          discArg = candidateIso
        }
      }
      extraArgs.push('--data', '.', '--disc', discArg, '--vblanks', '0', '--watchdog', '0')
      extraEnv.PS2_SHADER_DIR = 'shaders'
      extraEnv.PS2_SAVE_DIR = 'saves'
      extraEnv.PS2_RN_CENSUS = '0'
    }

    if (isLinux) {
      if (isAppImage) {
        return `env -u LD_LIBRARY_PATH -u LD_PRELOAD APPIMAGE_EXTRACT_AND_RUN=1 %command%${extraArgs.length > 0 ? ' ' + extraArgs.join(' ') : ''}`
      }
      if (!isExe) {
        // Binário ELF nativo Linux (como inFAMOUS Second Son, TLG, etc.)
        const envPrefix = Object.entries(extraEnv)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ')
        const envPart = envPrefix ? ` ${envPrefix}` : ''
        return `env -u LD_LIBRARY_PATH -u LD_PRELOAD${envPart} %command%${extraArgs.length > 0 ? ' ' + extraArgs.join(' ') : ''}`
      }
      // Windows .exe no Linux: a Steam executará via Proton/Steam Play
      const envPrefix = Object.entries(extraEnv)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')
      const envPart = envPrefix ? `${envPrefix} ` : ''
      return `${envPart}%command%${extraArgs.length > 0 ? ' ' + extraArgs.join(' ') : ''}`
    }

    // Windows
    if (extraArgs.length > 0) {
      return extraArgs.join(' ')
    }
    return ''
  }

  /**
   * Expande os marcadores de `launchArgs` da receita ({ROM_PATH}, {INSTALL_DIR}).
   * Quando o jogo roda via Wine/Proton, caminhos Unix são convertidos para o drive Z:.
   */
  private resolveLaunchArgs(game: InstalledGame, viaWine: boolean): string[] {
    const templates = game.launchArgs
    if (!templates || templates.length === 0) return []

    // realpath devolve o arquivo original quando a ISO/ROM foi pareada por symlink
    const romPath = game.pairedRomPaths
      ?.filter((p) => fs.existsSync(p))
      .map((p) => {
        try {
          return fs.realpathSync(p)
        } catch {
          return p
        }
      })[0]
    const toHostPath = (p: string): string =>
      viaWine ? `Z:${p.replace(/\//g, '\\')}` : p

    const resolved: string[] = []
    for (const template of templates) {
      if (template.includes('{ROM_PATH}')) {
        if (!romPath) continue
        resolved.push(template.replace('{ROM_PATH}', toHostPath(romPath)))
      } else {
        resolved.push(template.replace('{INSTALL_DIR}', toHostPath(game.installDir)))
      }
    }
    return resolved
  }

  private buildLaunchCommand(game: InstalledGame): {
    cmd: string
    args: string[]
    env: Record<string, string>
  } {
    const isLinux = process.platform === 'linux'
    const isExe = game.executablePath.toLowerCase().endsWith('.exe')
    const isAppImage = game.executablePath.toLowerCase().endsWith('.appimage')
    const execDir = path.dirname(game.executablePath) || game.installDir

    const extraArgs: string[] = this.resolveLaunchArgs(game, isLinux && isExe)
    const extraEnv: Record<string, string> = {}

    // Detect PS2 Static Recompilation runtime (e.g. Ace Combat 5: ps2_image.bin + shaders)
    if (fs.existsSync(path.join(execDir, 'ps2_image.bin'))) {
      const savesDir = path.join(execDir, 'saves')
      if (!fs.existsSync(savesDir)) {
        try {
          fs.mkdirSync(savesDir, { recursive: true })
        } catch {
          // Ignore
        }
      }

      // Ensure game.iso exists inside execDir so relative '--disc game.iso' works under Wine/Proton & Windows
      let discArg = 'game.iso'
      const localDiscInExecDir = path.join(execDir, 'game.iso')
      if (!fs.existsSync(localDiscInExecDir)) {
        const candidateIso =
          game.pairedRomPaths?.find((p) => fs.existsSync(p)) ||
          path.join(game.installDir, 'game.iso')
        if (candidateIso && fs.existsSync(candidateIso)) {
          try {
            fs.symlinkSync(candidateIso, localDiscInExecDir)
          } catch {
            discArg = candidateIso
          }
        }
      }

      // Ensure fullscreen maximize patch & ac5_settings.ini window_mode match user preference
      try {
        if (fs.existsSync(game.executablePath)) {
          const buf = fs.readFileSync(game.executablePath)
          const origJump = Buffer.from(
            '14db04fc4cda04fc34dd04fc1edb04fc4cda04fca4dd04fc14db04fc',
            'hex'
          )
          const patchedJump = Buffer.from(
            '14db04fc4cda04fc34dd04fc1edb04fc4cda04fca4dd04fcb3de04fc',
            'hex'
          )
          const idx = buf.indexOf(origJump)
          if (idx !== -1) {
            patchedJump.copy(buf, idx)
            fs.writeFileSync(game.executablePath, buf)
          }
        }

        const iniPath = path.join(execDir, 'ac5_settings.ini')
        if (fs.existsSync(iniPath)) {
          const wantFullscreen = game.launchFullscreen !== false
          let ini = fs.readFileSync(iniPath, 'utf-8')
          ini = ini.replace(
            /^(window_mode\s*=\s*)\d+/m,
            `$1${wantFullscreen ? '1' : '0'}`
          )
          ini = ini.replace(/^(fullscreen_type\s*=\s*)\d+/m, '$11')
          fs.writeFileSync(iniPath, ini, 'utf-8')
        }
      } catch {
        // Ignore
      }

      extraArgs.push('--data', '.', '--disc', discArg, '--vblanks', '0', '--watchdog', '0')
      extraEnv.PS2_SHADER_DIR = 'shaders'
      extraEnv.PS2_SAVE_DIR = 'saves'
      extraEnv.PS2_RN_CENSUS = '0'
    }

    // Ensure PS4 Port environment (launcher settings & env vars)
    this.ensurePs4LaunchEnvironment(game, execDir, extraEnv)

    // Native execution on Windows or native Linux binary
    if (!isLinux || !isExe) {
      if (isLinux && isAppImage) {
        return {
          cmd: game.executablePath,
          args: [...extraArgs],
          env: {
            ...extraEnv,
            APPIMAGE_EXTRACT_AND_RUN: '1'
          }
        }
      }
      if (!isLinux && /\.(bat|cmd)$/i.test(game.executablePath)) {
        // O Node não executa .bat diretamente: passa pelo interpretador de comandos do Windows
        return {
          cmd: process.env.ComSpec || 'cmd.exe',
          args: ['/c', game.executablePath, ...extraArgs],
          env: { ...extraEnv }
        }
      }
      return {
        cmd: game.executablePath,
        args: [...extraArgs],
        env: { ...extraEnv }
      }
    }

    // Linux Compatibility Layer for Windows .exe binaries (Proton / umu-run / Wine)
    const settings = this.store.getSettings()
    const prefixDir = path.join(
      settings.installRootPath,
      '.compat_prefixes',
      game.gameId
    )
    if (!fs.existsSync(prefixDir)) {
      fs.mkdirSync(prefixDir, { recursive: true })
    }

    const detected = this.detectLinuxRunners()
    const runnerPref = settings.linuxRunnerType

    // 1. Explicit or auto umu-run
    const umuCandidate =
      (settings.umuRunPath && this.whichCommand(settings.umuRunPath)) ||
      detected.find((r) => r.type === 'umu-run')?.path

    if (
      (runnerPref === 'umu-run' || runnerPref === 'auto') &&
      umuCandidate
    ) {
      const env: Record<string, string> = {
        ...extraEnv,
        WINEPREFIX: path.join(prefixDir, 'pfx'),
        GAMEID: 'umu-default'
      }
      if (settings.customProtonPath && fs.existsSync(settings.customProtonPath)) {
        const protonDir = settings.customProtonPath.endsWith('/proton')
          ? path.dirname(settings.customProtonPath)
          : settings.customProtonPath
        env.PROTONPATH = protonDir
      }
      return {
        cmd: umuCandidate,
        args: [game.executablePath, ...extraArgs],
        env
      }
    }

    // 2. Explicit or auto Steam Proton
    let protonBinary = ''
    if (settings.customProtonPath && fs.existsSync(settings.customProtonPath)) {
      protonBinary = settings.customProtonPath.endsWith('proton')
        ? settings.customProtonPath
        : path.join(settings.customProtonPath, 'proton')
    } else {
      const detectedProton = detected.find((r) => r.type === 'proton')
      if (detectedProton) {
        protonBinary = detectedProton.path
      }
    }

    if (
      (runnerPref === 'proton' || runnerPref === 'auto') &&
      protonBinary &&
      fs.existsSync(protonBinary)
    ) {
      const home = os.homedir()
      const steamClientDir = fs.existsSync(path.join(home, '.local/share/Steam'))
        ? path.join(home, '.local/share/Steam')
        : path.join(home, '.steam/steam')

      return {
        cmd: protonBinary,
        args: ['run', game.executablePath, ...extraArgs],
        env: {
          ...extraEnv,
          STEAM_COMPAT_DATA_PATH: prefixDir,
          STEAM_COMPAT_CLIENT_INSTALL_PATH: steamClientDir
        }
      }
    }

    // 3. Fallback to Wine
    const wineBinary =
      detected.find((r) => r.type === 'wine')?.path || 'wine'
    return {
      cmd: wineBinary,
      args: [game.executablePath, ...extraArgs],
      env: {
        ...extraEnv,
        WINEPREFIX: path.join(prefixDir, 'pfx')
      }
    }
  }

  private ensurePs4LaunchEnvironment(
    game: InstalledGame,
    execDir: string,
    extraEnv: Record<string, string>
  ): void {
    try {
      // Find game dump path
      let dumpDir = game.pairedRomPaths?.find((p) => {
        try {
          return fs.existsSync(p) && (fs.existsSync(path.join(p, 'eboot.bin')) || fs.statSync(p).isDirectory())
        } catch {
          return false
        }
      })
      if (!dumpDir && fs.existsSync(path.join(game.installDir, 'game_dump'))) {
        dumpDir = path.join(game.installDir, 'game_dump')
      }
      if (!dumpDir && game.pairedRomPaths && game.pairedRomPaths.length > 0) {
        dumpDir = game.pairedRomPaths[0]
      }
      if (!dumpDir || !fs.existsSync(dumpDir)) return

      let realDumpDir = dumpDir
      try {
        realDumpDir = fs.realpathSync(dumpDir)
      } catch {
        realDumpDir = dumpDir
      }

      // Read port.env if present
      let portSlug = ''
      let portTitleId = ''
      const portEnvCandidates = [
        path.join(execDir, 'port.env'),
        path.join(game.installDir, 'port.env'),
        path.join(game.installDir, 'launcher', 'port.env')
      ]
      for (const pe of portEnvCandidates) {
        if (fs.existsSync(pe)) {
          try {
            const lines = fs.readFileSync(pe, 'utf-8').split('\n')
            for (const line of lines) {
              const match = line.trim().match(/^([A-Z_]+)\s*=\s*["']?(.*?)["']?$/)
              if (match) {
                if (match[1] === 'PORT_SLUG') portSlug = match[2].trim()
                if (match[1] === 'PORT_TITLE_ID') portTitleId = match[2].trim()
              }
            }
            break
          } catch {
            // Ignore
          }
        }
      }

      const titleLower = game.title.toLowerCase()
      if (!portSlug) {
        if (titleLower.includes('infamous') || game.gameId.includes('iss_pc')) portSlug = 'infamous'
        else if (titleLower.includes('last guardian') || game.gameId.includes('tlg')) portSlug = 'tlg'
        else if (titleLower.includes('god of war') || game.gameId.includes('gow3')) portSlug = 'gow3'
        else if (titleLower.includes('gravity')) portSlug = 'gravity'
        else if (titleLower.includes('bloodborne')) portSlug = 'bloodborne'
      }

      // Sync settings.json immediately before launch
      const slugs = new Set<string>()
      if (portSlug) slugs.add(portSlug)
      if (portTitleId === 'CUSA00223' || titleLower.includes('infamous')) slugs.add('infamous')
      if (portTitleId === 'CUSA03627' || titleLower.includes('last guardian')) slugs.add('tlg')
      if (portTitleId === 'CUSA01623' || titleLower.includes('god of war')) slugs.add('gow3')

      const home = os.homedir()
      const configPaths: string[] = []
      for (const s of slugs) {
        configPaths.push(path.join(home, '.config', `${s}-launcher`, 'settings.json'))
        if (process.env.XDG_CONFIG_HOME) {
          configPaths.push(path.join(process.env.XDG_CONFIG_HOME, `${s}-launcher`, 'settings.json'))
        }
        if (process.env.APPDATA) {
          configPaths.push(path.join(process.env.APPDATA, `${s}-launcher`, 'settings.json'))
        } else {
          configPaths.push(path.join(home, 'AppData', 'Roaming', `${s}-launcher`, 'settings.json'))
        }
      }
      configPaths.push(path.join(game.installDir, 'user', 'settings.json'))
      configPaths.push(path.join(game.installDir, 'settings.json'))

      const wantFullscreen = game.launchFullscreen !== false
      const displayModeStr = wantFullscreen ? 'Borderless' : 'Windowed'
      const iniDisplayMode = wantFullscreen ? 'borderless' : 'windowed'

      for (const conf of new Set(configPaths)) {
        try {
          const dir = path.dirname(conf)
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
          let current: Record<string, any> = {}
          if (fs.existsSync(conf)) {
            try {
              current = JSON.parse(fs.readFileSync(conf, 'utf-8'))
            } catch {
              current = {}
            }
          }
          current.game_dir = realDumpDir
          if (!current.game_language) current.game_language = 'pt_BR'
          if (!current.ui_language) current.ui_language = 'pt_BR'
          current.display_mode = displayModeStr
          fs.writeFileSync(conf, JSON.stringify(current, null, 2), 'utf-8')
        } catch {
          // Ignore
        }
      }

      // Sync user/tlg.ini for inFAMOUS / TLG / GoW3 ports
      const tlgIniPaths = [
        path.join(game.installDir, 'user', 'tlg.ini'),
        path.join(execDir, 'user', 'tlg.ini'),
        path.join(game.installDir, 'tlg.ini')
      ]
      for (const iniPath of new Set(tlgIniPaths)) {
        try {
          const dir = path.dirname(iniPath)
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
          let content = ''
          if (fs.existsSync(iniPath)) {
            content = fs.readFileSync(iniPath, 'utf-8')
          }
          if (/^display_mode\s*=/m.test(content)) {
            content = content.replace(/^display_mode\s*=.*$/m, `display_mode=${iniDisplayMode}`)
          } else {
            content = content ? `${content.trim()}\ndisplay_mode=${iniDisplayMode}\n` : `# tlg settings\ndisplay_mode=${iniDisplayMode}\n`
          }
          fs.writeFileSync(iniPath, content, 'utf-8')
        } catch {
          // Ignore
        }
      }

      // Export environment variables
      extraEnv.ISS_GAME_DIR = realDumpDir
      extraEnv.TLG_GAME_DIR = realDumpDir
      extraEnv.GOW3_GAME_DIR = realDumpDir
      extraEnv.PORT_GAME_DIR = realDumpDir
      extraEnv.GAME_DIR = realDumpDir
      if (portSlug) {
        const envKey = `${portSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GAME_DIR`
        extraEnv[envKey] = realDumpDir
      }
      if (portTitleId) {
        extraEnv.PORT_TITLE_ID = portTitleId
        extraEnv.CUSA_ID = portTitleId
      }
    } catch {
      // Ignore
    }
  }
}
