import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { InstalledGame, CatalogGame } from '../../shared/types'
import type { RunnerService } from './runner.service'

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[i] = c >>> 0
}

function computeCrc32(buf: Buffer): number {
  if (typeof zlib.crc32 === 'function') {
    return zlib.crc32(buf)
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

export function computeSteamShortcutAppId(exe: string, appName: string): number {
  const combined = Buffer.from(exe + appName, 'utf8')
  const crc = computeCrc32(combined)
  return (crc | 0x80000000) >> 0
}

export interface SteamShortcutEntry {
  appid: number
  AppName: string
  Exe: string
  StartDir: string
  icon: string
  ShortcutPath: string
  LaunchOptions: string
  IsHidden: number
  AllowDesktopConfig: number
  AllowOverlay: number
  OpenVR: number
  Devkit: number
  DevkitGameID: string
  DevkitOverrideAppID: number
  LastPlayTime: number
  FlatpakAppID: string
  sortas: string
  tags: Record<string, string>
}

/**
 * Lê e analisa o formato binário Valve Data Format (VDF) do shortcuts.vdf da Steam.
 */
export function parseBinaryVdf(buffer: Buffer): { shortcuts: Record<string, SteamShortcutEntry> } {
  let pos = 0
  function readString(): string {
    const start = pos
    while (pos < buffer.length && buffer[pos] !== 0) pos++
    const str = buffer.toString('utf8', start, pos)
    pos++ // pula byte nulo
    return str
  }

  function parseDict(): any {
    const obj: Record<string, any> = {}
    while (pos < buffer.length) {
      const type = buffer[pos++]
      if (type === 0x08) break
      const key = readString()
      if (type === 0x00) {
        obj[key] = parseDict()
      } else if (type === 0x01) {
        obj[key] = readString()
      } else if (type === 0x02) {
        obj[key] = buffer.readInt32LE(pos)
        pos += 4
      } else if (type === 0x07) {
        obj[key] = buffer.readBigInt64LE(pos)
        pos += 8
      }
    }
    return obj
  }

  if (buffer.length < 2) return { shortcuts: {} }
  const rootType = buffer[pos++]
  if (rootType !== 0x00) return { shortcuts: {} }
  const rootKey = readString()
  if (rootKey !== 'shortcuts') return { shortcuts: {} }

  return { shortcuts: parseDict() }
}

/**
 * Serializa a estrutura para o formato binário Valve Data Format (VDF) aceito pela Steam.
 */
export function writeBinaryVdf(obj: { shortcuts: Record<string, any> }): Buffer {
  const parts: Buffer[] = []

  function writeString(str: string): void {
    parts.push(Buffer.from(str, 'utf8'), Buffer.from([0]))
  }

  function serializeDict(dict: Record<string, any>): void {
    for (const [key, val] of Object.entries(dict)) {
      if (typeof val === 'string') {
        parts.push(Buffer.from([0x01]))
        writeString(key)
        writeString(val)
      } else if (typeof val === 'number') {
        parts.push(Buffer.from([0x02]))
        writeString(key)
        const b = Buffer.alloc(4)
        b.writeInt32LE(val)
        parts.push(b)
      } else if (typeof val === 'bigint') {
        parts.push(Buffer.from([0x07]))
        writeString(key)
        const b = Buffer.alloc(8)
        b.writeBigInt64LE(val)
        parts.push(b)
      } else if (typeof val === 'object' && val !== null) {
        parts.push(Buffer.from([0x00]))
        writeString(key)
        serializeDict(val)
      }
    }
    parts.push(Buffer.from([0x08]))
  }

  for (const [rootKey, rootVal] of Object.entries(obj)) {
    parts.push(Buffer.from([0x00]))
    writeString(rootKey)
    serializeDict(rootVal)
  }
  parts.push(Buffer.from([0x08]))
  return Buffer.concat(parts)
}

export class SteamService {
  private runner?: RunnerService

  constructor(runner?: RunnerService) {
    this.runner = runner
  }

  /**
   * Localiza todas as pastas de usuários válidas da Steam (userdata/<user_id>).
   */
  public getSteamUserDirs(): string[] {
    const home = os.homedir()
    const candidateRoots: string[] = []

    if (process.platform === 'win32') {
      const progFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
      const progFiles = process.env.ProgramFiles || 'C:\\Program Files'
      candidateRoots.push(
        path.join(progFiles86, 'Steam', 'userdata'),
        path.join(progFiles, 'Steam', 'userdata'),
        'D:\\Steam\\userdata',
        'E:\\Steam\\userdata'
      )
    } else if (process.platform === 'darwin') {
      candidateRoots.push(path.join(home, 'Library', 'Application Support', 'Steam', 'userdata'))
    } else {
      // Linux / Steam Deck
      candidateRoots.push(
        path.join(home, '.local', 'share', 'Steam', 'userdata'),
        path.join(home, '.steam', 'steam', 'userdata'),
        path.join(home, '.steam', 'root', 'userdata'),
        path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam', 'userdata'),
        path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.steam', 'steam', 'userdata')
      )
    }

    const userDirs: string[] = []
    const seen = new Set<string>()

    for (const root of candidateRoots) {
      if (!fs.existsSync(root)) continue
      let realRoot = root
      try {
        realRoot = fs.realpathSync(root)
      } catch {
        realRoot = root
      }
      if (seen.has(realRoot)) continue
      seen.add(realRoot)

      try {
        const entries = fs.readdirSync(root, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory() && /^\d+$/.test(entry.name) && entry.name !== '0') {
            userDirs.push(path.join(root, entry.name))
          }
        }
      } catch {
        // Ignora erros de leitura de permissão
      }
    }

    return userDirs
  }

  /**
   * Detecta se o cliente Steam está em execução no momento.
   */
  public isSteamRunning(): boolean {
    const home = os.homedir()

    if (process.platform === 'linux') {
      const pidCandidates = [
        path.join(home, '.steam', 'steam.pid'),
        path.join(home, '.local', 'share', 'Steam', 'steam.pid'),
        path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam', 'steam.pid')
      ]
      for (const p of pidCandidates) {
        if (fs.existsSync(p)) {
          try {
            const pid = parseInt(fs.readFileSync(p, 'utf8').trim(), 10)
            if (!isNaN(pid)) {
              process.kill(pid, 0)
              return true
            }
          } catch {
            // Se process.kill(pid, 0) falhar, o processo não está vivo
          }
        }
      }
    }

    try {
      if (process.platform === 'win32') {
        const out = require('node:child_process').execSync('tasklist /FI "IMAGENAME eq steam.exe" /NH', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        })
        return out.toLowerCase().includes('steam.exe')
      } else {
        const out = require('node:child_process').execSync('pgrep -x steam || pgrep -x steamwebhelper', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        })
        return Boolean(out.trim())
      }
    } catch {
      return false
    }
  }

  /**
   * Verifica se o jogo já está adicionado ao shortcuts.vdf da Steam.
   */
  public async isGameInSteam(gameId: string): Promise<boolean> {
    const userDirs = this.getSteamUserDirs()
    if (userDirs.length === 0) return false

    for (const userDir of userDirs) {
      const shortcutsFile = path.join(userDir, 'config', 'shortcuts.vdf')
      if (!fs.existsSync(shortcutsFile)) continue
      try {
        const buf = fs.readFileSync(shortcutsFile)
        const parsed = parseBinaryVdf(buf)
        const exists = Object.values(parsed.shortcuts || {}).some(
          (s) => s.DevkitGameID === gameId || (s.tags && Object.values(s.tags).includes(gameId))
        )
        if (exists) return true
      } catch {
        // Ignora erro de leitura
      }
    }

    return false
  }

  /**
   * Adiciona o jogo instalado como um atalho não-Steam no shortcuts.vdf de todas as contas encontradas,
   * copiando ou baixando as artes para userdata/<user_id>/config/grid/.
   */
  public async addGameToSteam(
    game: InstalledGame,
    catalogGame?: CatalogGame
  ): Promise<{
    success: boolean
    alreadyAdded: boolean
    steamRunning: boolean
    userCount: number
    message: string
  }> {
    if (!game.executablePath || !fs.existsSync(game.executablePath)) {
      throw new Error(`Executável do jogo não encontrado em: "${game.executablePath}".`)
    }

    const userDirs = this.getSteamUserDirs()
    if (userDirs.length === 0) {
      throw new Error(
        'Nenhuma pasta de usuário da Steam foi encontrada neste computador. Certifique-se de que a Steam já foi instalada e que você já fez login pelo menos uma vez.'
      )
    }

    const appName = game.title
    const quotedExe = `"${path.resolve(game.executablePath)}"`
    const rawStartDir = path.dirname(path.resolve(game.executablePath))
    const startDir = rawStartDir.endsWith(path.sep) ? rawStartDir : `${rawStartDir}${path.sep}`
    const appId = computeSteamShortcutAppId(quotedExe, appName)
    const unsignedAppId = (appId >>> 0).toString()

    // Prepara o ambiente de execução caso o jogo necessite de configurações de port/ini prévias
    try {
      this.runner?.prepareLaunchEnvironment(game)
    } catch {
      // Ignora erro
    }

    const launchOptions = this.runner
      ? this.runner.getLaunchOptionsForSteam(game)
      : process.platform === 'linux' && !game.executablePath.toLowerCase().endsWith('.exe')
      ? 'env -u LD_LIBRARY_PATH -u LD_PRELOAD %command%'
      : ''

    // 1. Tenta obter / preparar as imagens de capa, banner e ícone
    let coverBuf: Buffer | null = null
    let heroBuf: Buffer | null = null
    let iconBuf: Buffer | null = null

    // Procura ícones ou banners locais na pasta de instalação (ex.: PS4 icon0.png e pic1.png)
    if (game.installDir && fs.existsSync(game.installDir)) {
      const heroCandidates = [
        path.join(game.installDir, 'game_dump', 'sce_sys', 'pic1.png'),
        path.join(game.installDir, 'CUSA00223', 'sce_sys', 'pic1.png'),
        path.join(game.installDir, 'pic1.png'),
        path.join(game.installDir, 'hero.png')
      ]
      for (const h of heroCandidates) {
        if (fs.existsSync(h)) {
          try {
            heroBuf = fs.readFileSync(h)
            break
          } catch {}
        }
      }

      const iconCandidates = [
        path.join(game.installDir, 'launcher', 'infamous.png'),
        path.join(game.installDir, 'game_dump', 'sce_sys', 'icon0.png'),
        path.join(game.installDir, 'CUSA00223', 'sce_sys', 'icon0.png'),
        path.join(game.installDir, 'icon0.png'),
        path.join(game.installDir, 'icon.png')
      ]
      for (const ic of iconCandidates) {
        if (fs.existsSync(ic)) {
          try {
            iconBuf = fs.readFileSync(ic)
            break
          } catch {}
        }
      }
    }

    // Tenta baixar a capa do catálogo se houver URL válida
    const imageUrl = game.imageUrl || catalogGame?.imageUrl
    if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
      try {
        const res = await fetch(imageUrl, {
          headers: { 'User-Agent': 'RecompHub-Launcher/1.0' },
          signal: AbortSignal.timeout(6000)
        })
        if (res.ok) {
          const arr = await res.arrayBuffer()
          coverBuf = Buffer.from(arr)
        }
      } catch {
        // Se falhar o download da capa da web, usa o ícone local como fallback
      }
    } else if (imageUrl && fs.existsSync(imageUrl)) {
      try {
        coverBuf = fs.readFileSync(imageUrl)
      } catch {}
    }

    if (!coverBuf && iconBuf) {
      coverBuf = iconBuf
    }
    if (!iconBuf && coverBuf) {
      iconBuf = coverBuf
    }

    let alreadyAdded = false

    // 2. Aplica em cada diretório de usuário da Steam encontrado
    for (const userDir of userDirs) {
      const configDir = path.join(userDir, 'config')
      const shortcutsFile = path.join(configDir, 'shortcuts.vdf')
      const gridDir = path.join(configDir, 'grid')

      fs.mkdirSync(gridDir, { recursive: true })

      let parsed: { shortcuts: Record<string, SteamShortcutEntry> } = { shortcuts: {} }
      if (fs.existsSync(shortcutsFile)) {
        try {
          const buf = fs.readFileSync(shortcutsFile)
          parsed = parseBinaryVdf(buf)
          // Salva backup de segurança
          const backupFile = path.join(configDir, 'shortcuts.vdf.bak')
          if (!fs.existsSync(backupFile)) {
            fs.copyFileSync(shortcutsFile, backupFile)
          }
        } catch {
          parsed = { shortcuts: {} }
        }
      }

      // Salva artes no grid
      let iconFilePath = ''
      if (iconBuf) {
        const iconName = `${unsignedAppId}_icon.png`
        const iconDest = path.join(gridDir, iconName)
        try {
          fs.writeFileSync(iconDest, iconBuf)
          iconFilePath = iconDest
        } catch {}
      }

      if (coverBuf) {
        try {
          // Capa vertical (padrão da grade da biblioteca Steam)
          fs.writeFileSync(path.join(gridDir, `${unsignedAppId}p.png`), coverBuf)
          // Capa horizontal (banner largo)
          fs.writeFileSync(path.join(gridDir, `${unsignedAppId}.png`), coverBuf)
        } catch {}
      }

      if (heroBuf) {
        try {
          fs.writeFileSync(path.join(gridDir, `${unsignedAppId}_hero.png`), heroBuf)
        } catch {}
      }

      // Procura se já existia na lista
      const shortcuts = parsed.shortcuts || {}
      let targetKey: string | null = null
      for (const [k, s] of Object.entries(shortcuts)) {
        if (s.DevkitGameID === game.id || s.AppName === appName || s.Exe === quotedExe) {
          targetKey = k
          alreadyAdded = true
          break
        }
      }

      if (targetKey === null) {
        const maxIdx = Object.keys(shortcuts).reduce((max, k) => {
          const n = parseInt(k, 10)
          return !isNaN(n) && n > max ? n : max
        }, -1)
        targetKey = (maxIdx + 1).toString()
      }

      shortcuts[targetKey] = {
        appid: appId,
        AppName: appName,
        Exe: quotedExe,
        StartDir: startDir,
        icon: iconFilePath || (shortcuts[targetKey]?.icon ?? ''),
        ShortcutPath: '',
        LaunchOptions: launchOptions,
        IsHidden: 0,
        AllowDesktopConfig: 1,
        AllowOverlay: 1,
        OpenVR: 0,
        Devkit: 0,
        DevkitGameID: game.id,
        DevkitOverrideAppID: 0,
        LastPlayTime: shortcuts[targetKey]?.LastPlayTime || 0,
        FlatpakAppID: '',
        sortas: '',
        tags: { '0': 'RecompHUB', '1': game.consoleBadge || 'Port' }
      }

      // Escreve de forma atômica
      const newBuf = writeBinaryVdf({ shortcuts })
      const tmpFile = `${shortcutsFile}.tmp.${Date.now()}`
      fs.writeFileSync(tmpFile, newBuf)
      fs.renameSync(tmpFile, shortcutsFile)
    }

    const steamRunning = this.isSteamRunning()
    const message = steamRunning
      ? 'Jogo adicionado à Steam com sucesso! Como a Steam está aberta no momento, basta reiniciá-la para que o jogo apareça na sua biblioteca.'
      : 'Jogo adicionado à Steam com sucesso! Abra a Steam para encontrá-lo pronto na sua biblioteca.'

    return {
      success: true,
      alreadyAdded,
      steamRunning,
      userCount: userDirs.length,
      message
    }
  }

  /**
   * Remove o atalho do jogo e suas artes associadas de todas as contas Steam.
   */
  public async removeGameFromSteam(gameId: string): Promise<{ success: boolean; removedCount: number }> {
    const userDirs = this.getSteamUserDirs()
    let removedCount = 0

    for (const userDir of userDirs) {
      const configDir = path.join(userDir, 'config')
      const shortcutsFile = path.join(configDir, 'shortcuts.vdf')
      const gridDir = path.join(configDir, 'grid')

      if (!fs.existsSync(shortcutsFile)) continue

      try {
        const buf = fs.readFileSync(shortcutsFile)
        const parsed = parseBinaryVdf(buf)
        const shortcuts = parsed.shortcuts || {}

        const remaining: SteamShortcutEntry[] = []
        for (const s of Object.values(shortcuts)) {
          if (s.DevkitGameID === gameId || (s.tags && Object.values(s.tags).includes(gameId))) {
            removedCount++
            const unsignedAppId = (s.appid >>> 0).toString()
            // Remove arquivos de imagem do grid
            for (const ext of ['.png', '.jpg']) {
              try { fs.rmSync(path.join(gridDir, `${unsignedAppId}p${ext}`), { force: true }) } catch {}
              try { fs.rmSync(path.join(gridDir, `${unsignedAppId}${ext}`), { force: true }) } catch {}
              try { fs.rmSync(path.join(gridDir, `${unsignedAppId}_hero${ext}`), { force: true }) } catch {}
              try { fs.rmSync(path.join(gridDir, `${unsignedAppId}_logo${ext}`), { force: true }) } catch {}
              try { fs.rmSync(path.join(gridDir, `${unsignedAppId}_icon${ext}`), { force: true }) } catch {}
            }
          } else {
            remaining.push(s)
          }
        }

        // Re-indexa os atalhos restantes
        const newShortcuts: Record<string, SteamShortcutEntry> = {}
        remaining.forEach((s, idx) => {
          newShortcuts[idx.toString()] = s
        })

        const newBuf = writeBinaryVdf({ shortcuts: newShortcuts })
        const tmpFile = `${shortcutsFile}.tmp.${Date.now()}`
        fs.writeFileSync(tmpFile, newBuf)
        fs.renameSync(tmpFile, shortcutsFile)
      } catch {
        // Ignora erros ao salvar
      }
    }

    return {
      success: true,
      removedCount
    }
  }
}
