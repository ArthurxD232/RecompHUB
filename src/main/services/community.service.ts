import {
  CatalogGame,
  CommunityPort,
  CommunityResult,
  GameRecipe,
  InspectedGitHubRepo,
  OSPlatform,
  RomRequirement,
  SubmitPortPayload
} from '../../shared/types'
import { StoreService } from './store.service'
import { enrichPort, groupCatalogGames } from './port-metadata.service'
import bundledCommunityPorts from '../data/community-ports.json'

const COMMUNITY_PORTS_REMOTE_URL =
  'https://raw.githubusercontent.com/ArthurxD232/RecompHUB/main/data/community-ports.json'

export class CommunityService {
  private updateListeners: ((result: CommunityResult) => void)[] = []
  private cachedPorts: CatalogGame[] = []
  private lastUpdated = ''
  private syncPromise: Promise<CommunityResult> | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private hasSyncedThisSession = false
  // Assinatura do JSON atual: evita reprocessar e reenviar à interface uma lista idêntica
  private rawSignature: string

  constructor(private store: StoreService) {
    // Initialize with bundled community ports
    this.rawSignature = JSON.stringify(bundledCommunityPorts)
    this.cachedPorts = this.preparePorts(bundledCommunityPorts as CommunityPort[])
    this.lastUpdated = new Date().toISOString()
  }

  public onUpdated(callback: (result: CommunityResult) => void): () => void {
    this.updateListeners.push(callback)
    return () => {
      this.updateListeners = this.updateListeners.filter((l) => l !== callback)
    }
  }

  public async getCommunityPorts(forceRefresh = false): Promise<CommunityResult> {
    if (forceRefresh) {
      return this.refreshFromRemote()
    }

    if (!this.syncPromise && !this.syncTimer && !this.hasSyncedThisSession) {
      // Sincroniza em segundo plano depois que a janela já abriu
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null
        void this.refreshFromRemote().catch(() => {})
      }, 3500)
    }

    return {
      ports: this.cachedPorts,
      lastUpdated: this.lastUpdated,
      source: 'cache'
    }
  }

  public async refreshFromRemote(): Promise<CommunityResult> {
    if (this.syncPromise) return this.syncPromise

    this.syncPromise = this.fetchRemoteCommunityPorts()
    return this.syncPromise.finally(() => {
      this.syncPromise = null
      this.hasSyncedThisSession = true
    })
  }

  private async fetchRemoteCommunityPorts(): Promise<CommunityResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)

    try {
      const response = await fetch(COMMUNITY_PORTS_REMOTE_URL, {
        headers: {
          'User-Agent': 'RecompHub-Community-Sync/1.0'
        },
        signal: controller.signal
      })

      if (response.ok) {
        const rawJson = (await response.json()) as CommunityPort[]
        if (Array.isArray(rawJson) && rawJson.length > 0) {
          const signature = JSON.stringify(rawJson)
          this.lastUpdated = new Date().toISOString()

          if (signature === this.rawSignature) {
            // Nada mudou desde o que já está carregado
            for (const listener of this.updateListeners) {
              listener({ ports: [], lastUpdated: this.lastUpdated, source: 'live', unchanged: true })
            }
            return { ports: this.cachedPorts, lastUpdated: this.lastUpdated, source: 'live' }
          }

          const prepared = this.preparePorts(rawJson)
          this.cachedPorts = prepared
          this.rawSignature = signature

          const result: CommunityResult = {
            ports: prepared,
            lastUpdated: this.lastUpdated,
            source: 'live'
          }

          for (const listener of this.updateListeners) {
            listener(result)
          }

          return result
        }
      }
    } catch (err) {
      console.warn('[CommunityService] Error fetching remote community ports, using local cache:', err)
    } finally {
      clearTimeout(timeout)
    }

    return {
      ports: this.cachedPorts,
      lastUpdated: this.lastUpdated,
      source: 'fallback'
    }
  }

  /**
   * Prepares CommunityPort definitions into CatalogGame objects with proper recipes and ports grouping.
   */
  private preparePorts(rawPorts: CommunityPort[]): CatalogGame[] {
    const games: CatalogGame[] = rawPorts.map((item) => {
      const recipe: GameRecipe = item.recipe || {
        id: `community_recipe_${item.id}`,
        repoFullName: item.repoFullName,
        title: `${item.title} (${item.projectName})`,
        console: item.consoleBadge,
        family: item.inferredFamily || 'GenericNative',
        createPortableTxt: true,
        requirements: item.romRequirement
          ? [item.romRequirement]
          : [
              {
                id: `${item.id}_rom`,
                label: `${item.title} — ISO / ROM Original`,
                type: 'iso',
                expectedFilename: 'game.iso',
                extensions: ['.iso', '.bin', '.z64', '.n64', '.rom']
              }
            ],
        notes: item.differences || item.description
      }

      const baseGame: CatalogGame = {
        id: item.id,
        title: item.title,
        projectName: item.projectName,
        repoFullName: item.repoFullName,
        releaseRepoFullName: item.releaseRepoFullName,
        githubUrl: item.githubUrl,
        releaseUrl: item.releaseUrl,
        websiteUrl: item.websiteUrl,
        imageUrl: item.imageUrl,
        console: item.console,
        consoleBadge: item.consoleBadge,
        version: item.version,
        releaseStatus: item.releaseStatus,
        isAiAssisted: item.isAiAssisted ?? false,
        platforms: item.platforms,
        updatedAt: item.updatedAt,
        recipe,
        inferredFamily: item.inferredFamily || 'GenericNative',
        toolchainType: item.toolchainType,
        howItWorks: item.howItWorks,
        description: item.description,
        highlights: item.highlights || [],
        differences: item.differences,
        isCommunity: true,
        submittedBy: item.submittedBy,
        approvedAt: item.approvedAt,
        verificationLevel: item.verificationLevel || 'community'
      }

      return baseGame
    })

    return groupCatalogGames(games)
  }

  /**
   * Inspects a GitHub repository to auto-fill metadata when submitting a port.
   */
  public async inspectGitHubRepo(url: string): Promise<InspectedGitHubRepo> {
    const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i)
    if (!match) {
      throw new Error('URL do GitHub inválida. Exemplo: https://github.com/autor/projeto')
    }

    const owner = match[1]
    const repo = match[2].replace(/\.git$/i, '')
    const fullName = `${owner}/${repo}`

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RecompHub-Launcher/1.0'
    }
    const settings = this.store.getSettings()
    if (settings.githubToken.trim()) {
      headers.Authorization = `Bearer ${settings.githubToken.trim()}`
    }

    // 1. Fetch Repo info
    const repoRes = await fetch(`https://api.github.com/repos/${fullName}`, { headers })
    if (!repoRes.ok) {
      throw new Error(
        `Repositório '${fullName}' não foi encontrado no GitHub (HTTP ${repoRes.status}).`
      )
    }
    const repoData = (await repoRes.json()) as any

    // 2. Fetch Latest Release
    let hasReleases = false
    let latestTagName: string | undefined
    let latestReleaseName: string | undefined
    let latestReleaseUrl: string | undefined
    let publishedAt: string | undefined
    let assets: { name: string; size: number; browserDownloadUrl: string }[] = []

    try {
      const relRes = await fetch(`https://api.github.com/repos/${fullName}/releases/latest`, { headers })
      if (relRes.ok) {
        const relData = (await relRes.json()) as any
        hasReleases = true
        latestTagName = relData.tag_name
        latestReleaseName = relData.name || relData.tag_name
        latestReleaseUrl = relData.html_url
        publishedAt = relData.published_at
        assets = (relData.assets || []).map((a: any) => ({
          name: a.name,
          size: a.size,
          browserDownloadUrl: a.browser_download_url
        }))
      }
    } catch {
      // Ignored if releases fail
    }

    // Detect platforms from asset extensions
    const detectedPlatforms: OSPlatform[] = []
    const assetNames = assets.map((a) => a.name.toLowerCase())

    const hasWindows = assetNames.some(
      (n) => n.endsWith('.exe') || n.includes('win64') || n.includes('windows') || n.includes('win32')
    )
    const hasLinux = assetNames.some(
      (n) => n.endsWith('.appimage') || n.includes('linux') || n.endsWith('.tar.gz') || n.endsWith('.deb')
    )
    const hasMac = assetNames.some(
      (n) => n.endsWith('.dmg') || n.includes('macos') || n.includes('darwin')
    )

    if (hasWindows) detectedPlatforms.push('Windows')
    if (hasLinux) detectedPlatforms.push('Linux')
    if (hasMac) detectedPlatforms.push('macOS')
    if (detectedPlatforms.length === 0) {
      detectedPlatforms.push('Windows') // default
    }

    // Auto-suggest Console Badge from description or repo name
    const combinedText = `${repo} ${repoData.description || ''}`.toLowerCase()
    let suggestedConsoleBadge = 'PC / Outros'
    if (combinedText.includes('n64') || combinedText.includes('nintendo 64')) suggestedConsoleBadge = 'N64'
    else if (combinedText.includes('ps1') || combinedText.includes('psx') || combinedText.includes('playstation 1')) suggestedConsoleBadge = 'PS1'
    else if (combinedText.includes('ps2') || combinedText.includes('playstation 2')) suggestedConsoleBadge = 'PS2'
    else if (combinedText.includes('ps3') || combinedText.includes('playstation 3')) suggestedConsoleBadge = 'PS3'
    else if (combinedText.includes('xbox 360') || combinedText.includes('x360') || combinedText.includes('xenon')) suggestedConsoleBadge = 'Xbox 360'
    else if (combinedText.includes('gamecube') || combinedText.includes('gc')) suggestedConsoleBadge = 'GameCube'
    else if (combinedText.includes('wii u') || combinedText.includes('wiiu')) suggestedConsoleBadge = 'Wii U'
    else if (combinedText.includes('wii')) suggestedConsoleBadge = 'Wii'
    else if (combinedText.includes('dreamcast')) suggestedConsoleBadge = 'Dreamcast'
    else if (combinedText.includes('snes') || combinedText.includes('super nintendo')) suggestedConsoleBadge = 'SNES'
    else if (combinedText.includes('gba') || combinedText.includes('game boy advance')) suggestedConsoleBadge = 'GBA'

    // Auto-suggest toolchain
    let suggestedToolchain = 'Port Nativo C/C++ Recompilado'
    if (combinedText.includes('n64recomp') || (suggestedConsoleBadge === 'N64' && combinedText.includes('recomp'))) {
      suggestedToolchain = 'Recompilação Estática (N64Recomp)'
    } else if (combinedText.includes('psxrecomp') || (suggestedConsoleBadge === 'PS1' && combinedText.includes('recomp'))) {
      suggestedToolchain = 'Recompilação Estática (PSXRecomp)'
    } else if (combinedText.includes('xenon') || combinedText.includes('xenonrecomp')) {
      suggestedToolchain = 'Recompilação Estática (XenonRecomp)'
    } else if (combinedText.includes('ultraship') || combinedText.includes('harbourmasters')) {
      suggestedToolchain = 'Descompilação C & Engine libultraship'
    } else if (combinedText.includes('decomp') || combinedText.includes('descompilação')) {
      suggestedToolchain = 'Descompilação & Port Nativo'
    }

    return {
      owner,
      repo,
      fullName,
      githubUrl: `https://github.com/${fullName}`,
      title: repoData.description ? repoData.description.split(/[-—–|]/)[0].trim() : repo,
      projectName: repo,
      description: repoData.description || `Port nativo de ${repo} desenvolvido pela comunidade.`,
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      defaultBranch: repoData.default_branch || 'main',
      hasReleases,
      latestTagName,
      latestReleaseName,
      latestReleaseUrl,
      publishedAt,
      assets,
      detectedPlatforms,
      suggestedConsoleBadge,
      suggestedToolchain,
      avatarUrl: repoData.owner?.avatar_url
    }
  }

  /**
   * Generates a pre-filled GitHub Issue URL for submitting a community port.
   */
  public generateCommunityIssueUrl(payload: SubmitPortPayload): string {
    const owner = 'ArthurxD232'
    const repo = 'RecompHUB'

    const id = `community__${payload.projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`
    const highlights = payload.highlights && payload.highlights.length > 0 ? payload.highlights : ['60 FPS', 'Widescreen Nativo']

    const repoFullName = payload.githubUrl.replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '')
    const communityDataObj: Partial<CommunityPort> = {
      id,
      title: payload.title.trim(),
      projectName: payload.projectName.trim(),
      repoFullName,
      githubUrl: payload.githubUrl.trim(),
      releaseUrl: `${payload.githubUrl.trim().replace(/\/$/, '')}/releases/latest`,
      imageUrl: `https://opengraph.githubassets.com/1/${repoFullName}`,
      console: payload.console,
      consoleBadge: payload.consoleBadge,
      version: 'Latest',
      releaseStatus: 'Latest',
      platforms: ['Windows', 'Linux'],
      updatedAt: new Date().toISOString(),
      submittedBy: payload.submittedBy ? (payload.submittedBy.startsWith('@') ? payload.submittedBy : `@${payload.submittedBy}`) : undefined,
      verificationLevel: 'community',
      toolchainType: payload.toolchainType,
      howItWorks: payload.howItWorks || 'Port nativo de PC baseado em código descompilado/recompilado.',
      description: payload.description.trim(),
      highlights,
      romRequirement: payload.romExtension
        ? {
            id: `${id}_rom`,
            label: `ROM / ISO original de ${payload.title} (${payload.romExtension})`,
            type: payload.romExtension.includes('iso') ? 'iso' : 'rom',
            expectedFilename: `game${payload.romExtension}`,
            extensions: [payload.romExtension, '.zip', '.7z', '.rar']
          }
        : undefined
    }

    const title = `[Sugestão de Port]: ${payload.title} (${payload.projectName})`
    const body = `### 🎮 Sugestão de Novo Port da Comunidade para o RecompHUB

**Título do Jogo:** ${payload.title}
**Nome do Projeto:** ${payload.projectName}
**Repositório Oficial:** [${payload.githubUrl}](${payload.githubUrl})
**Plataforma Original:** ${payload.console} (${payload.consoleBadge})
**Toolchain / Arquitetura:** ${payload.toolchainType}
**Enviado por:** ${payload.submittedBy || 'Membro da Comunidade'}

#### 📝 Descrição do Port
${payload.description}

#### ⚙️ Como Funciona & Diferenciais
${payload.howItWorks || 'Port desenvolvido pela comunidade com melhorias de resolução e controles.'}

${payload.notes ? `#### 📌 Observações Extras\n${payload.notes}\n` : ''}

---
> [!NOTE]
> **Para os Mantenedores (@ArthurxD232):**
> Para aprovar e publicar este port automaticamente no RecompHUB para todos os usuários, basta adicionar a etiqueta/label **\`approved\`** nesta Issue! A GitHub Action fará a publicação no catálogo oficial instantaneamente.

\`\`\`json <!-- RECOMPHUB_COMMUNITY_PORT_PAYLOAD
${JSON.stringify(communityDataObj, null, 2)}
--> \`\`\`
`

    const encodedTitle = encodeURIComponent(title)
    const encodedBody = encodeURIComponent(body)

    return `https://github.com/${owner}/${repo}/issues/new?title=${encodedTitle}&body=${encodedBody}&labels=community-port-submission`
  }
}
