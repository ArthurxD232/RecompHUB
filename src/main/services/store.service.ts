import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  AppSettings,
  CatalogGame,
  InstalledGame,
  RomVaultEntry
} from '../../shared/types'

interface StoreSchema {
  settings: AppSettings
  catalogCache: {
    games: CatalogGame[]
    lastUpdated: string
  }
  romVault: RomVaultEntry[]
  library: InstalledGame[]
}

export class StoreService {
  private storePath: string
  private data: StoreSchema

  constructor() {
    let userDataDir: string
    try {
      userDataDir = app.getPath('userData')
    } catch {
      userDataDir = path.join(os.homedir(), '.config', 'recomphub')
    }

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true })
    }

    const defaultInstallRoot = path.join(userDataDir, 'Games')
    const defaultVaultRoot = path.join(userDataDir, 'RomVault')

    if (!fs.existsSync(defaultInstallRoot)) {
      fs.mkdirSync(defaultInstallRoot, { recursive: true })
    }
    if (!fs.existsSync(defaultVaultRoot)) {
      fs.mkdirSync(defaultVaultRoot, { recursive: true })
    }

    this.storePath = path.join(userDataDir, 'recomphub-store.json')

    const defaultData: StoreSchema = {
      settings: {
        romVaultPath: defaultVaultRoot,
        installRootPath: defaultInstallRoot,
        linuxRunnerType: 'auto',
        customProtonPath: '',
        umuRunPath: 'umu-run',
        extractXisoPath: 'extract-xiso',
        githubToken: '',
        preferNativeLinuxBuild: true,
        createPortableTxtByDefault: true,
        linkStrategy: 'symlink'
      },
      catalogCache: {
        games: [],
        lastUpdated: ''
      },
      romVault: [],
      library: []
    }

    this.data = this.loadFromDisk(defaultData)
  }

  private loadFromDisk(defaults: StoreSchema): StoreSchema {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8')
        const parsed = JSON.parse(raw)
        return {
          ...defaults,
          ...parsed,
          settings: {
            ...defaults.settings,
            ...(parsed.settings || {})
          }
        }
      }
    } catch (err) {
      console.error('[StoreService] Failed to read store file, using defaults:', err)
    }
    return defaults
  }

  private saveToDisk(): void {
    try {
      const tempPath = `${this.storePath}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tempPath, this.storePath)
    } catch (err) {
      console.error('[StoreService] Failed to write store file:', err)
    }
  }

  public getSettings(): AppSettings {
    return this.data.settings
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.data.settings = {
      ...this.data.settings,
      ...partial
    }
    this.saveToDisk()
    return this.data.settings
  }

  public getCatalogCache(): { games: CatalogGame[]; lastUpdated: string } {
    return this.data.catalogCache
  }

  public setCatalogCache(games: CatalogGame[]): void {
    this.data.catalogCache = {
      games,
      lastUpdated: new Date().toISOString()
    }
    this.saveToDisk()
  }

  public getRomVault(): RomVaultEntry[] {
    return this.data.romVault
  }

  public setRomVault(entries: RomVaultEntry[]): void {
    this.data.romVault = entries
    this.saveToDisk()
  }

  public upsertRomVaultEntry(entry: RomVaultEntry): void {
    const idx = this.data.romVault.findIndex(
      (e) => e.filePath === entry.filePath || (entry.sha1 && e.sha1 === entry.sha1)
    )
    if (idx >= 0) {
      const prev = this.data.romVault[idx]
      const mergedGames = Array.from(
        new Set([...(prev.assignedGameIds || []), ...(entry.assignedGameIds || [])])
      )
      const mergedReqs = Array.from(
        new Set([
          ...(prev.assignedRequirementIds || []),
          ...(entry.assignedRequirementIds || [])
        ])
      )
      this.data.romVault[idx] = {
        ...prev,
        ...entry,
        assignedGameIds: mergedGames,
        assignedRequirementIds: mergedReqs
      }
    } else {
      this.data.romVault.push(entry)
    }
    this.saveToDisk()
  }

  public getLibrary(): InstalledGame[] {
    return this.data.library
  }

  public getInstalledGame(gameId: string): InstalledGame | undefined {
    return this.data.library.find((g) => g.gameId === gameId || g.id === gameId)
  }

  public upsertInstalledGame(game: InstalledGame): InstalledGame {
    const idx = this.data.library.findIndex((g) => g.gameId === game.gameId)
    if (idx >= 0) {
      this.data.library[idx] = game
    } else {
      this.data.library.unshift(game)
    }
    this.saveToDisk()
    return game
  }

  public removeInstalledGame(gameId: string): void {
    this.data.library = this.data.library.filter(
      (g) => g.gameId !== gameId && g.id !== gameId
    )
    this.saveToDisk()
  }
}
