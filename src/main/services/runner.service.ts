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
    { process: ChildProcess; startedAtMs: number }
  >()

  constructor(
    private store: StoreService,
    private downloader: DownloaderService
  ) {}

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
    this.runningProcesses.set(game.gameId, { process: child, startedAtMs })

    // Mark game as RUNNING
    this.store.upsertInstalledGame({
      ...game,
      status: 'RUNNING',
      lastPlayedAt: new Date().toISOString()
    })
    this.downloader.emitLibraryUpdated()

    child.on('close', () => {
      const entry = this.runningProcesses.get(game.gameId)
      this.runningProcesses.delete(game.gameId)

      const elapsedSeconds = entry
        ? Math.max(1, Math.round((Date.now() - entry.startedAtMs) / 1000))
        : 0

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
        running.process.kill('SIGTERM')
      } catch {
        // Ignore
      }
      this.runningProcesses.delete(gameId)
    }

    const game = this.store.getInstalledGame(gameId)
    if (game && game.status === 'RUNNING') {
      this.store.upsertInstalledGame({
        ...game,
        status: game.romPaired ? 'READY_TO_PLAY' : 'NEEDS_ROM'
      })
      this.downloader.emitLibraryUpdated()
    }
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

    const extraArgs: string[] = []
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
}
