// 'cheerio/slim' expõe o mesmo load() sem puxar o undici (que faz require('node:sqlite'),
// módulo inexistente no Node 20 do Electron 33 e que quebrava o app no Windows).
import * as cheerio from 'cheerio/slim'
import { createHash } from 'crypto'
import {
  CatalogGame,
  CatalogResult,
  GameRecipe,
  GitHubAsset,
  OSPlatform,
  RecipeFamily,
  ReleaseStatus,
  ResolvedReleaseInfo,
  RomRequirement
} from '../../shared/types'
import { StoreService } from './store.service'
import { groupCatalogGames } from './port-metadata.service'
import { selectBestAsset } from './asset-selector'
import recipesData from '../data/recipes.json'

// Aumente quando mudar a forma de interpretar o HTML do PortsDR (invalida o hash de "página sem mudanças").
const CATALOG_PARSER_VERSION = 3
// Com cache local a atualização ao vivo espera a janela terminar de abrir (a lista já aparece pelo cache).
const BACKGROUND_SYNC_DELAY_MS = 2500

const CONSOLE_BADGE_MAP: Record<string, string> = {
  'Nintendo 64': 'N64',
  PlayStation: 'PS1',
  'PlayStation 2': 'PS2',
  'PlayStation 3': 'PS3',
  'PlayStation 4': 'PS4',
  'PlayStation Portable': 'PSP',
  'Xbox 360': 'Xbox 360',
  Xbox: 'Xbox',
  GameCube: 'GameCube',
  'Wii U': 'Wii U',
  Wii: 'Wii',
  Dreamcast: 'Dreamcast',
  SNES: 'SNES',
  NES: 'NES',
  'Game Boy Advance': 'GBA',
  'Game Boy Color': 'GBC',
  'Game Boy': 'GB',
  'Nintendo DS': 'NDS',
  'Nintendo 3DS': '3DS',
  'Mega Drive': 'Mega Drive',
  'Virtual Boy': 'Virtual Boy',
  Others: 'PC / Outros'
}

const CONSOLE_ROM_SPECS: Record<
  string,
  {
    type: 'rom' | 'iso' | 'bin_cue'
    expectedFilename: string
    extensions: string[]
    labelSuffix: string
  }
> = {
  N64: {
    type: 'rom',
    expectedFilename: 'baserom.us.z64',
    extensions: ['.z64', '.n64', '.v64'],
    labelSuffix: 'ROM Nintendo 64 (.z64 / .n64 / .v64 ou Compactado)'
  },
  PS1: {
    type: 'bin_cue',
    expectedFilename: 'game.bin',
    extensions: ['.bin', '.cue', '.iso', '.img', '.chd'],
    labelSuffix: 'ISO / BIN+CUE PlayStation 1 (ou Compactado)'
  },
  PS2: {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.bin', '.chd'],
    labelSuffix: 'ISO PlayStation 2 (.iso ou Compactado)'
  },
  PS3: {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.pkg', '.bin'],
    labelSuffix: 'ISO / Dump PlayStation 3 (.iso / .pkg ou Compactado)'
  },
  PS4: {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.pkg'],
    labelSuffix: 'Dump / Arquivos do Jogo PlayStation 4 (ou Compactado)'
  },
  PSP: {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.cso'],
    labelSuffix: 'ISO PlayStation Portable (.iso / .cso ou Compactado)'
  },
  'Xbox 360': {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.xex'],
    labelSuffix: 'ISO / XEX Xbox 360 (.iso / .xex ou Compactado)'
  },
  Xbox: {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.xbe'],
    labelSuffix: 'ISO / XBE Xbox Clássico (.iso / .xbe ou Compactado)'
  },
  GameCube: {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.gcm', '.rvz', '.ciso'],
    labelSuffix: 'ISO GameCube (.iso / .gcm / .rvz ou Compactado)'
  },
  Wii: {
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.wbfs', '.rvz'],
    labelSuffix: 'ISO / WBFS Nintendo Wii (ou Compactado)'
  },
  'Wii U': {
    type: 'iso',
    expectedFilename: 'game.wux',
    extensions: ['.wux', '.wud', '.rpx', '.iso'],
    labelSuffix: 'Imagem Wii U (.wux / .wud / .rpx / .iso ou Compactado)'
  },
  Dreamcast: {
    type: 'iso',
    expectedFilename: 'game.gdi',
    extensions: ['.gdi', '.cdi', '.iso', '.chd'],
    labelSuffix: 'Imagem Dreamcast (.gdi / .cdi / .iso ou Compactado)'
  },
  SNES: {
    type: 'rom',
    expectedFilename: 'baserom.sfc',
    extensions: ['.sfc', '.smc'],
    labelSuffix: 'ROM Super Nintendo (.sfc / .smc ou Compactado)'
  },
  NES: {
    type: 'rom',
    expectedFilename: 'baserom.nes',
    extensions: ['.nes'],
    labelSuffix: 'ROM NES (.nes ou Compactado)'
  },
  GBA: {
    type: 'rom',
    expectedFilename: 'baserom.gba',
    extensions: ['.gba'],
    labelSuffix: 'ROM Game Boy Advance (.gba ou Compactado)'
  },
  GBC: {
    type: 'rom',
    expectedFilename: 'baserom.gbc',
    extensions: ['.gbc', '.gb'],
    labelSuffix: 'ROM Game Boy Color (.gbc / .gb ou Compactado)'
  },
  GB: {
    type: 'rom',
    expectedFilename: 'baserom.gb',
    extensions: ['.gb'],
    labelSuffix: 'ROM Game Boy (.gb ou Compactado)'
  },
  NDS: {
    type: 'rom',
    expectedFilename: 'baserom.nds',
    extensions: ['.nds'],
    labelSuffix: 'ROM Nintendo DS (.nds ou Compactado)'
  },
  '3DS': {
    type: 'rom',
    expectedFilename: 'baserom.3ds',
    extensions: ['.3ds', '.cci', '.cia'],
    labelSuffix: 'ROM Nintendo 3DS (.3ds / .cia ou Compactado)'
  },
  'Mega Drive': {
    type: 'rom',
    expectedFilename: 'baserom.md',
    extensions: ['.md', '.gen', '.bin', '.smd'],
    labelSuffix: 'ROM Mega Drive / Genesis (.md / .bin ou Compactado)'
  },
  'Virtual Boy': {
    type: 'rom',
    expectedFilename: 'baserom.vb',
    extensions: ['.vb'],
    labelSuffix: 'ROM Virtual Boy (.vb ou Compactado)'
  }
}

export class CatalogService {
  private recipes: GameRecipe[]

  constructor(private store: StoreService) {
    this.recipes = recipesData as GameRecipe[]
  }

  public getRecipes(): GameRecipe[] {
    return this.recipes
  }

  public findRecipeForRepo(
    repoFullName: string,
    releaseRepoFullName?: string
  ): GameRecipe | undefined {
    const norm = repoFullName.toLowerCase()
    const relNorm = releaseRepoFullName?.toLowerCase()
    return this.recipes.find((r) => {
      if (r.repoFullName.toLowerCase() === norm) return true
      if (relNorm && r.repoFullName.toLowerCase() === relNorm) return true
      if (r.aliases?.some((a) => a.toLowerCase() === norm || a.toLowerCase() === relNorm)) {
        return true
      }
      return false
    })
  }

  public inferFamily(
    consoleBadge: string,
    projectName: string,
    repoFullName: string,
    explicitRecipe?: GameRecipe
  ): RecipeFamily {
    if (explicitRecipe) return explicitRecipe.family
    const combined = `${projectName} ${repoFullName}`.toLowerCase()

    if (
      combined.includes('harkinian') ||
      combined.includes('shipwright') ||
      combined.includes('2ship') ||
      combined.includes('spaghettikart') ||
      combined.includes('starship') ||
      combined.includes('opengoal') ||
      combined.includes('jak-project')
    ) {
      return 'AssetExtractor'
    }

    if (consoleBadge === 'Xbox 360' || combined.includes('xenon')) {
      return 'XenonRecomp'
    }

    if (consoleBadge === 'PS1' && combined.includes('recomp')) {
      return 'PSXRecomp'
    }

    if (consoleBadge === 'N64') {
      return 'N64Recomp'
    }

    return 'GenericNative'
  }

  public buildHeuristicRecipe(game: CatalogGame): GameRecipe {
    if (game.recipe && game.recipe.requirements && game.recipe.requirements.length > 0) {
      return game.recipe
    }

    const family = game.inferredFamily
    const slug = game.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const spec = CONSOLE_ROM_SPECS[game.consoleBadge] || {
      type: 'iso' as const,
      expectedFilename: 'game.iso',
      extensions: ['.iso', '.bin', '.rom', '.z64', '.dat', '.pak', '.wad'],
      labelSuffix: 'ISO / ROM / Arquivos Originais do Jogo (ou Compactado)'
    }

    const defaultRomRequirement: RomRequirement = {
      id: `${slug}_main_rom`,
      label: `${game.title} — ${spec.labelSuffix}`,
      type: spec.type,
      expectedFilename: spec.expectedFilename,
      extensions: spec.extensions
    }

    if (family === 'N64Recomp') {
      return {
        id: `heuristic_${game.id}`,
        repoFullName: game.repoFullName,
        title: `${game.title} (${game.projectName})`,
        console: 'N64',
        family: 'N64Recomp',
        createPortableTxt: true,
        configFileToPatch: {
          filename: 'config.toml',
          romKey: 'rom_path'
        },
        requirements: [defaultRomRequirement],
        notes:
          'Receita N64Recomp: cria portable.txt, descompacta a ROM (se estiver em .zip/.7z/.rar) e vincula na pasta do jogo para que já inicie pronta.'
      }
    }

    if (family === 'PSXRecomp') {
      return {
        id: `heuristic_${game.id}`,
        repoFullName: game.repoFullName,
        title: `${game.title} (${game.projectName})`,
        console: 'PS1',
        family: 'PSXRecomp',
        requirements: [
          defaultRomRequirement,
          {
            id: 'ps1_bios_scph1001',
            label: 'PlayStation BIOS (SCPH1001.BIN) — Opcional se embutida',
            type: 'bios',
            expectedFilename: 'SCPH1001.BIN',
            sha1: ['10155d8d6e6e832d6ea66db9bc098321fb5e8ebf'],
            md5: ['924e392ed05558ffdb115408c263dccf'],
            extensions: ['.bin', '.rom'],
            optional: true
          }
        ],
        notes:
          'Receita PSXRecomp: extrai/vincula a imagem .bin/.cue/.iso selecionada (e BIOS se fornecida) na pasta raiz do port.'
      }
    }

    if (family === 'XenonRecomp') {
      return {
        id: `heuristic_${game.id}`,
        repoFullName: game.repoFullName,
        title: `${game.title} (${game.projectName})`,
        console: 'Xbox 360',
        family: 'XenonRecomp',
        xenonConfig: {
          extractXisoArgs: ['-x'],
          targetSubdir: '.'
        },
        requirements: [defaultRomRequirement],
        notes:
          'Receita XenonRecomp: descompacta e extrai a ISO de Xbox 360 selecionada e posiciona o executável recompilado na raiz.'
      }
    }

    if (family === 'AssetExtractor') {
      return {
        id: `heuristic_${game.id}`,
        repoFullName: game.repoFullName,
        title: `${game.title} (${game.projectName})`,
        console: game.consoleBadge,
        family: 'AssetExtractor',
        extractorConfig: {
          binaryPatterns: ['extractor', 'torch', game.projectName.toLowerCase()],
          cliArgs: ['--extract-assets'],
          expectedOutputFiles: ['.o2r', '.otr', 'iso_data']
        },
        requirements: [defaultRomRequirement],
        notes:
          'Receita AssetExtractor: posiciona a ROM/ISO selecionada na pasta do jogo e executa o extrator de assets (.otr/.o2r).'
      }
    }

    // Even GenericNative ports ALWAYS require the user's base ISO/ROM!
    return {
      id: `heuristic_${game.id}`,
      repoFullName: game.repoFullName,
      title: `${game.title} (${game.projectName})`,
      console: game.consoleBadge,
      family: 'GenericNative',
      createPortableTxt: true,
      requirements: [defaultRomRequirement],
      notes:
        'Extrai (caso compactada em .zip/.7z/.rar) e posiciona a ISO/ROM selecionada diretamente na pasta do jogo antes de iniciar.'
    }
  }

  private hasSyncedLiveThisSession = false
  private refreshPromise: Promise<CatalogResult> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private groupedMemo: { key: string; games: CatalogGame[] } | null = null
  private updateListeners: ((result: CatalogResult) => void)[] = []

  public onUpdated(callback: (result: CatalogResult) => void): () => void {
    this.updateListeners.push(callback)
    return () => {
      this.updateListeners = this.updateListeners.filter(
        (listener) => listener !== callback
      )
    }
  }

  private emitUpdated(result: CatalogResult): void {
    for (const listener of this.updateListeners) {
      listener(result)
    }
  }

  /** Prepara (recipes + agrupamento por jogo) os games do cache; o resultado é memorizado por versão do cache. */
  private prepareGames(games: CatalogGame[], cacheKey: string): CatalogGame[] {
    if (this.groupedMemo && this.groupedMemo.key === cacheKey) {
      return this.groupedMemo.games
    }
    const grouped = groupCatalogGames(games.map((game) => this.attachRecipeInfo(game)))
    this.groupedMemo = { key: cacheKey, games: grouped }
    return grouped
  }

  private scheduleBackgroundSync(hasCache: boolean): void {
    if (this.hasSyncedLiveThisSession || this.refreshPromise || this.refreshTimer) return
    if (!hasCache) {
      void this.refreshCatalog()
      return
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshCatalog()
    }, BACKGROUND_SYNC_DELAY_MS)
  }

  public async getCatalog(forceRefresh = false): Promise<CatalogResult> {
    if (forceRefresh) {
      return this.refreshCatalog()
    }

    const cached = this.store.getCatalogCache()
    this.scheduleBackgroundSync(cached.games.length > 0)

    if (cached.games.length > 0) {
      return {
        games: this.prepareGames(cached.games, cached.lastUpdated),
        lastUpdated: cached.lastUpdated,
        source: 'cache'
      }
    }

    const fallback = this.getFallbackCatalog()
    return {
      games: groupCatalogGames(fallback),
      lastUpdated: '',
      source: 'fallback'
    }
  }

  private refreshCatalog(): Promise<CatalogResult> {
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = this.fetchLiveCatalog()
    return this.refreshPromise.finally(() => {
      this.hasSyncedLiveThisSession = true
      this.refreshPromise = null
    })
  }

  private async fetchLiveCatalog(): Promise<CatalogResult> {
    const cached = this.store.getCatalogCache()
    try {
      const html = await this.fetchPortsDRHtml()
      const htmlHash = createHash('sha1')
        .update(`v${CATALOG_PARSER_VERSION}:`)
        .update(html)
        .digest('hex')

      // Mesma página de antes: nada a reprocessar, gravar ou reenviar para a interface
      if (cached.games.length > 0 && htmlHash === this.store.getCatalogHtmlHash()) {
        const now = new Date().toISOString()
        this.emitUpdated({ games: [], lastUpdated: now, source: 'live', unchanged: true })
        return {
          games: this.prepareGames(cached.games, cached.lastUpdated),
          lastUpdated: now,
          source: 'live'
        }
      }

      const scrapedGames = this.parsePortsDR(html)
      if (scrapedGames.length > 0) {
        this.store.setCatalogCache(scrapedGames, htmlHash)
        const fresh = this.store.getCatalogCache()
        const result: CatalogResult = {
          games: this.prepareGames(scrapedGames, fresh.lastUpdated),
          lastUpdated: fresh.lastUpdated,
          source: 'live'
        }
        this.emitUpdated(result)
        return result
      }
    } catch (err) {
      console.warn('[CatalogService] Error scraping portsdr.com, checking cache/fallback:', err)
    }

    if (cached.games.length > 0) {
      return {
        games: this.prepareGames(cached.games, cached.lastUpdated),
        lastUpdated: cached.lastUpdated,
        source: 'cache'
      }
    }

    const fallback = this.getFallbackCatalog()
    this.store.setCatalogCache(fallback)
    const result: CatalogResult = {
      games: groupCatalogGames(fallback),
      lastUpdated: new Date().toISOString(),
      source: 'fallback'
    }
    this.emitUpdated(result)
    return result
  }

  private attachRecipeInfo(game: CatalogGame): CatalogGame {
    const explicitRecipe = this.findRecipeForRepo(
      game.repoFullName,
      game.releaseRepoFullName
    )
    const inferredFamily = this.inferFamily(
      game.consoleBadge,
      game.projectName,
      game.repoFullName,
      explicitRecipe
    )
    return {
      ...game,
      recipe: explicitRecipe || this.buildHeuristicRecipe({ ...game, recipe: undefined, inferredFamily }),
      inferredFamily
    }
  }

  public async scrapePortsDR(): Promise<CatalogGame[]> {
    return this.parsePortsDR(await this.fetchPortsDRHtml())
  }

  private async fetchPortsDRHtml(): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch('https://portsdr.com/', {
        headers: {
          'User-Agent': 'RecompHub-Launcher/1.0 (https://portsdr.com)'
        },
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`PortsDR returned HTTP ${response.status}`)
      }

      return await response.text()
    } finally {
      clearTimeout(timeout)
    }
  }

  public parsePortsDR(html: string): CatalogGame[] {
    const $ = cheerio.load(html)
    const games: CatalogGame[] = []
    const seenIds = new Set<string>()

    $('article.port-card').each((_, el) => {
      const card = $(el)
      const originalPlatform = card.attr('data-original-platform')?.trim() || 'Others'
      const platformsAttr = card.attr('data-platforms') || ''
      const isAiAssisted = card.attr('data-ai-assisted') === 'true'
      const updatedAt = card.attr('data-updated-at') || new Date().toISOString()

      const title = card.find('h3').first().text().trim()
      const projectName = card.find('p.project-name').first().text().trim() || title
      const imageUrl = card.find('.port-icon img').attr('src')?.trim()

      const releaseAnchor = card.find('.release-info a').first()
      const releaseUrl = releaseAnchor.attr('href')?.trim()
      const versionText =
        releaseAnchor.text().replace(/^Version\s+/i, '').trim() || 'Latest'
      const statusText = card.find('.release-info .release-status').text().trim()
      const releaseStatus: ReleaseStatus =
        statusText === 'Pre-release'
          ? 'Pre-release'
          : releaseUrl
            ? 'Latest'
            : 'Source Only'

      let githubUrl = ''
      let websiteUrl = ''
      card.find('.port-links a').each((__, linkEl) => {
        const href = $(linkEl).attr('href')?.trim() || ''
        const label = $(linkEl).text().trim().toLowerCase()
        if (href.includes('github.com') && (label.includes('repo') || !githubUrl)) {
          githubUrl = href
        } else if (label.includes('website') || label.includes('project')) {
          websiteUrl = href
        }
      })

      if (!githubUrl && releaseUrl && releaseUrl.includes('github.com')) {
        const match = releaseUrl.match(/https:\/\/github\.com\/([^/]+\/[^/]+)/)
        if (match) {
          githubUrl = `https://github.com/${match[1]}`
        }
      }

      const repoFullName = this.extractRepoFullName(githubUrl)
      const releaseRepoFullName = releaseUrl
        ? this.extractRepoFullName(releaseUrl)
        : undefined

      if (!title || !repoFullName) return

      const rawPlatforms = platformsAttr
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean)
      const platforms = rawPlatforms.filter((p): p is OSPlatform =>
        ['Windows', 'Linux', 'macOS', 'Android'].includes(p)
      )

      // O RecompHUB roda no Windows e no Linux: ports só de macOS, Android, iOS, Switch, Vita etc.
      // não têm o que instalar aqui (antes eles apareciam como se fossem "Windows").
      const runsOnPc =
        rawPlatforms.length === 0 ||
        rawPlatforms.some((p) => p === 'Windows' || p === 'Linux')
      if (!runsOnPc) return

      const consoleBadge = CONSOLE_BADGE_MAP[originalPlatform] || originalPlatform

      let id = `${repoFullName.replace('/', '__')}__${projectName}`
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')

      if (seenIds.has(id)) {
        id = `${id}-${games.length}`
      }
      seenIds.add(id)

      const recipe = this.findRecipeForRepo(repoFullName, releaseRepoFullName)
      const inferredFamily = this.inferFamily(
        consoleBadge,
        projectName,
        repoFullName,
        recipe
      )

      const baseGame: CatalogGame = {
        id,
        title,
        projectName,
        repoFullName,
        releaseRepoFullName,
        githubUrl,
        releaseUrl,
        websiteUrl: websiteUrl || undefined,
        imageUrl,
        console: originalPlatform,
        consoleBadge,
        version: versionText,
        releaseStatus,
        isAiAssisted,
        platforms: platforms.length > 0 ? platforms : ['Windows'],
        updatedAt,
        inferredFamily
      }

      baseGame.recipe = recipe || this.buildHeuristicRecipe(baseGame)
      games.push(baseGame)
    })

    return games
  }

  private extractRepoFullName(url: string): string {
    const match = url.match(/github\.com\/([^/]+\/[^/#?]+)/i)
    return match ? match[1].replace(/\.git$/i, '') : ''
  }

  public async resolveRelease(game: CatalogGame): Promise<ResolvedReleaseInfo> {
    const settings = this.store.getSettings()
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RecompHub-Launcher/1.0'
    }
    if (settings.githubToken.trim()) {
      headers.Authorization = `Bearer ${settings.githubToken.trim()}`
    }

    const candidateRepos = Array.from(
      new Set([game.releaseRepoFullName, game.repoFullName].filter(Boolean) as string[])
    )

    let releaseData: any = null
    let usedRepo = game.repoFullName

    for (const repo of candidateRepos) {
      try {
        const latestRes = await fetch(
          `https://api.github.com/repos/${repo}/releases/latest`,
          { headers }
        )
        if (latestRes.ok) {
          const json = await latestRes.json()
          if (json && Array.isArray(json.assets) && json.assets.length > 0) {
            releaseData = json
            usedRepo = repo
            break
          }
        }
      } catch {
        // Ignore
      }

      try {
        const listRes = await fetch(
          `https://api.github.com/repos/${repo}/releases?per_page=10`,
          { headers }
        )
        if (listRes.ok) {
          const list = await listRes.json()
          if (Array.isArray(list) && list.length > 0) {
            const withAssets = list.find(
              (r: any) => Array.isArray(r.assets) && r.assets.length > 0
            )
            releaseData = withAssets || list[0]
            usedRepo = repo
            break
          }
        }
      } catch {
        // Ignore
      }
    }

    if (!releaseData) {
      throw new Error(
        `Nenhuma release encontrada no GitHub para ${game.repoFullName}. Verifique sua conexão ou configure um GitHub Token nas Configurações caso tenha atingido o limite da API.`
      )
    }

    const allAssets: GitHubAsset[] = (releaseData.assets || []).map((a: any) => ({
      name: a.name,
      browserDownloadUrl: a.browser_download_url,
      size: a.size || 0,
      contentType: a.content_type || ''
    }))

    const selection = selectBestAsset(allAssets, {
      platform: process.platform,
      arch: process.arch,
      preferNativeLinux: settings.preferNativeLinuxBuild
    })

    return {
      repoFullName: usedRepo,
      tagName: releaseData.tag_name || game.version,
      name: releaseData.name || releaseData.tag_name || game.version,
      publishedAt: releaseData.published_at || game.updatedAt,
      isPrerelease: Boolean(releaseData.prerelease),
      htmlUrl: releaseData.html_url || game.githubUrl,
      selectedAsset: selection.asset,
      allAssets,
      targetOs: selection.targetOs,
      requiresCompatibilityLayer: selection.requiresCompatibilityLayer,
      selectionReason: selection.reason
    }
  }

  private getFallbackCatalog(): CatalogGame[] {
    const rawFallback: Omit<CatalogGame, 'recipe' | 'inferredFamily'>[] = [
      {
        id: 'zelda64recomp__zelda64recomp',
        title: "The Legend of Zelda: Majora's Mask",
        projectName: 'Zelda64Recomp',
        repoFullName: 'Zelda64Recomp/Zelda64Recomp',
        githubUrl: 'https://github.com/Zelda64Recomp/Zelda64Recomp',
        imageUrl: 'https://cdn2.steamgriddb.com/thumb/ea950bbd8550e65a1e8fbf4ee210ad73.jpg',
        console: 'Nintendo 64',
        consoleBadge: 'N64',
        version: 'v1.2.2',
        releaseStatus: 'Latest',
        isAiAssisted: false,
        platforms: ['Windows', 'Linux', 'macOS'],
        updatedAt: '2026-09-15T12:00:00Z'
      },
      {
        id: 'banjorecomp__banjorecomp',
        title: 'Banjo-Kazooie',
        projectName: 'BanjoRecomp',
        repoFullName: 'BanjoRecomp/BanjoRecomp',
        githubUrl: 'https://github.com/BanjoRecomp/BanjoRecomp',
        console: 'Nintendo 64',
        consoleBadge: 'N64',
        version: 'v1.0.1',
        releaseStatus: 'Latest',
        isAiAssisted: false,
        platforms: ['Windows', 'Linux', 'macOS'],
        updatedAt: '2026-09-10T12:00:00Z'
      },
      {
        id: 'harbourmasters__2ship2harkinian',
        title: "The Legend of Zelda: Majora's Mask",
        projectName: '2 Ship 2 Harkinian',
        repoFullName: 'HarbourMasters/2ship2harkinian',
        releaseRepoFullName: '2ship2harkinian/2ship2harkinian',
        githubUrl: 'https://github.com/HarbourMasters/2ship2harkinian',
        imageUrl:
          'https://raw.githubusercontent.com/HarbourMasters/2ship2harkinian/refs/heads/develop/mm/windows/2SHIP2HARKINIAN.ico',
        console: 'Nintendo 64',
        consoleBadge: 'N64',
        version: '5.0.1',
        releaseStatus: 'Latest',
        isAiAssisted: false,
        platforms: ['Windows', 'Linux', 'macOS'],
        updatedAt: '2026-08-25T17:54:43Z'
      },
      {
        id: 'harbourmasters__shipwright',
        title: 'The Legend of Zelda: Ocarina of Time',
        projectName: 'Ship of Harkinian',
        repoFullName: 'HarbourMasters/Shipwright',
        githubUrl: 'https://github.com/HarbourMasters/Shipwright',
        console: 'Nintendo 64',
        consoleBadge: 'N64',
        version: '9.1.2',
        releaseStatus: 'Latest',
        isAiAssisted: false,
        platforms: ['Windows', 'Linux', 'macOS'],
        updatedAt: '2026-09-01T10:00:00Z'
      },
      {
        id: 'hedge-dev__unleashedrecomp',
        title: 'Sonic Unleashed',
        projectName: 'UnleashedRecomp',
        repoFullName: 'hedge-dev/UnleashedRecomp',
        githubUrl: 'https://github.com/hedge-dev/UnleashedRecomp',
        console: 'Xbox 360',
        consoleBadge: 'Xbox 360',
        version: 'v1.0.3',
        releaseStatus: 'Latest',
        isAiAssisted: false,
        platforms: ['Windows', 'Linux'],
        updatedAt: '2026-08-20T15:00:00Z'
      },
      {
        id: 'mstan__apeescaperecomp',
        title: 'Ape Escape',
        projectName: 'ApeEscapeRecomp',
        repoFullName: 'mstan/ApeEscapeRecomp',
        githubUrl: 'https://github.com/mstan/ApeEscapeRecomp',
        console: 'PlayStation',
        consoleBadge: 'PS1',
        version: 'v0.3.0',
        releaseStatus: 'Latest',
        isAiAssisted: true,
        platforms: ['Windows', 'Linux'],
        updatedAt: '2026-10-01T11:00:00Z'
      },
      {
        id: 'sal063__ac6_recomp',
        title: 'Ace Combat 6: Fires of Liberation',
        projectName: 'AC6_recomp',
        repoFullName: 'sal063/AC6_recomp',
        githubUrl: 'https://github.com/sal063/AC6_recomp',
        console: 'Xbox 360',
        consoleBadge: 'Xbox 360',
        version: 'v0.2.0',
        releaseStatus: 'Pre-release',
        isAiAssisted: true,
        platforms: ['Windows'],
        updatedAt: '2026-10-12T09:00:00Z'
      },
      {
        id: 'sciaschi__cbfd-recompiled',
        title: "Conker's Bad Fur Day",
        projectName: 'CBFD-Recompiled',
        repoFullName: 'sciaschi/CBFD-Recompiled',
        githubUrl: 'https://github.com/sciaschi/CBFD-Recompiled',
        console: 'Nintendo 64',
        consoleBadge: 'N64',
        version: 'v0.1.0',
        releaseStatus: 'Pre-release',
        isAiAssisted: false,
        platforms: ['Windows', 'Linux'],
        updatedAt: '2026-10-05T14:20:00Z'
      }
    ]

    return rawFallback.map((item) => {
      const recipe = this.findRecipeForRepo(item.repoFullName, item.releaseRepoFullName)
      const inferredFamily = this.inferFamily(
        item.consoleBadge,
        item.projectName,
        item.repoFullName,
        recipe
      )
      const full: CatalogGame = {
        ...item,
        inferredFamily
      }
      full.recipe = recipe || this.buildHeuristicRecipe(full)
      return full
    })
  }
}
