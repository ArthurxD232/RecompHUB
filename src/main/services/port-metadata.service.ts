import { CatalogGame, GamePortInfo, OSPlatform } from '../../shared/types'

interface CustomPortDetail {
  toolchainType?: string
  howItWorks?: string
  description?: string
  highlights?: string[]
  differences?: string
}

/**
 * Rich knowledge base for known community ports and re-compilations.
 * Keyed by lowercase `repoFullName` or unique prefix.
 */
const KNOWN_PORT_DETAILS: Record<string, CustomPortDetail> = {
  // --- The Legend of Zelda: Majora's Mask (N64) ---
  'zelda64recomp/zelda64recomp': {
    toolchainType: 'Recompilação Estática (N64Recomp)',
    howItWorks:
      'Desenvolvido por Mr-Wiseguy. Utiliza a ferramenta N64Recomp para traduzir o binário MIPS original da ROM diretamente em código C++ nativo de 64 bits para PC, sem emulador.',
    description:
      'Port com foco em desempenho extremo, fidelidade gráfica 1:1 e suporte a tecnologias gráficas de ponta.',
    highlights: [
      'Suporte a 144+ FPS destravado sem alterar a física',
      'Ray Tracing nativo via RT64',
      'Suporte completo a giroscópio e rumble moderno',
      'Carregamento instantâneo com consumo levíssimo'
    ],
    differences:
      'Focado em framerate ultra-alto (144Hz+), gráficos limpos e iluminação Ray Tracing RT64 com inicialização instantânea.'
  },
  'harbourmasters/2ship2harkinian': {
    toolchainType: 'Descompilação C & Engine libultraship',
    howItWorks:
      'Desenvolvido pela equipe HarbourMasters através da engenharia reversa e descompilação completa do código-fonte para C, acoplado à engine moderna libultraship (OpenGL, DirectX e Vulkan).',
    description:
      'A experiência definitiva para customização, mods, randomizers e melhorias de jogabilidade em Majora\'s Mask.',
    highlights: [
      'Gerador de Randomizer embutido completo',
      'Câmera livre em terceira pessoa analógica',
      'Menu interno de melhorias de qualidade de vida (QoL)',
      'Suporte a pacotes de texturas HD e modelos customizados'
    ],
    differences:
      'Focado no maior ecossistema de mods do jogo, câmera moderna totalmente livre, randomizer embutido e dezenas de cheats e melhorias.'
  },
  'chrissotraidis/maskpad': {
    toolchainType: 'Port Nativo com Foco em Controles',
    howItWorks:
      'Port nativo compacto compilado para PC com foco prioritário em mapeamento simplificado de controles modernos.',
    description:
      'Versão leve com foco em jogabilidade direta no controle sem necessidade de configurações complexas.',
    highlights: [
      'Mapeamento plug-and-play de gamepads XInput/DualShock',
      'Interface limpa e minimalista',
      'Inicialização rápida'
    ],
    differences:
      'Proposta minimalista e leve focada em configurar e jogar no controle sem menus extensos.'
  },

  // --- Banjo-Kazooie (N64) ---
  'banjorecomp/banjorecomp': {
    toolchainType: 'Recompilação Estática (N64Recomp)',
    howItWorks:
      'Recompilado estaticamente a partir da ROM original de Nintendo 64 diretamente para código C++ nativo via N64Recomp.',
    description:
      'Port oficial da comunidade Recomp com suporte a Ray Tracing RT64, 60+ FPS e taxas de atualização modernas.',
    highlights: [
      '60+ FPS com física preservada',
      'Ray Tracing com sombras e reflexos em tempo real (RT64)',
      'Widescreen e Ultrawide nativo',
      'Suporte nativo a controles modernos'
    ],
    differences:
      'Focado em performance pura, fidelidade 100% ao jogo original e visuais aprimorados com RT64.'
  },
  'harbourmasters/lighthouse': {
    toolchainType: 'Descompilação C & Engine libultraship',
    howItWorks:
      'Port desenvolvido pela equipe HarbourMasters baseado na descompilação do jogo em conjunto com a engine libultraship.',
    description:
      'Port focado em ferramentas de modding, menus internos avançados e melhorias de jogabilidade.',
    highlights: [
      'Engine moderna libultraship',
      'Menu de melhorias e cheats internos',
      'Câmera livre analógica'
    ],
    differences:
      'Ênfase em ferramentas de modding e nas conveniências da engine libultraship da HarbourMasters.'
  },
  'rinnegatamante/lighthouse': {
    toolchainType: 'Fork Leve Otimizado',
    howItWorks:
      'Fork com otimizações em rotinas gráficas e de memória para execução fluida em arquiteturas leves.',
    description:
      'Versão alternativa leve com foco em eficiência e compatibilidade multiplataforma.',
    highlights: [
      'Baixo overhead de CPU/GPU',
      'Renderização OpenGL leve'
    ],
    differences:
      'Otimizado para baixo consumo de memória RAM e execução em hardwares modestos.'
  },

  // --- Crash Team Racing (PS1) ---
  'ctr-tools/ctr-native': {
    toolchainType: 'Descompilação Nativa C (PS1)',
    howItWorks:
      'Descompilação reversa matemática do código assembly original do PlayStation 1 para C puro compilado nativamente.',
    description:
      'Port nativo para PC de alta precisão do clássico CTR, mantendo a física lendária 100% idêntica ao original.',
    highlights: [
      'Física de curvas, drifting e boost 1:1 idêntica ao PS1',
      '60 FPS fluidos e resoluções modernas até 4K',
      'Multiplayer local com tela dividida',
      'Widescreen real sem distorção'
    ],
    differences:
      'Focado na preservação exata da física original do PS1 combinada com 60 FPS e resoluções modernas.'
  },
  'rinnegatamante/crash-team-racing-high-octane': {
    toolchainType: 'Reimplementação & Engine C++',
    howItWorks:
      'Reimplementação da lógica de jogo com renderizadores modernos e suporte amplo a diferentes plataformas.',
    description:
      'Port aprimorado com novos recursos gráficos e suporte a múltiplos renderizadores.',
    highlights: [
      'Renderizadores gráficos modernos',
      'Suporte amplo a gamepads',
      'Opções de câmera ajustáveis'
    ],
    differences:
      'Oferece opções gráficas adicionais e arquitetura adaptável para diversos sistemas.'
  },

  // --- GoldenEye 007 (N64) ---
  'cblock85/goldeneye64recomp': {
    toolchainType: 'Recompilação Estática (N64Recomp)',
    howItWorks:
      'Recompilado diretamente do binário MIPS de N64 para binário nativo x86_64 com integração ao renderizador moderno RT64.',
    description:
      'Permite jogar GoldenEye como um jogo moderno de tiro em primeira pessoa no PC, com 60+ FPS e mira no mouse.',
    highlights: [
      '60+ FPS fluidos',
      'Controles analógicos duplos modernos e mira no mouse estilo PC',
      'Suporte a Ray Tracing RT64',
      'Widescreen nativo 16:9'
    ],
    differences:
      'Destaque para a jogabilidade estilo FPS moderna com mira no mouse, controles modernos e Ray Tracing.'
  },
  'jkdansereau/goldeneye-pc-port': {
    toolchainType: 'Port Nativo C / Decomp',
    howItWorks:
      'Baseado na descompilação clássica em C do jogo original adaptada com renderização OpenGL nativa.',
    description:
      'Port clássico focado na experiência autêntica de PC com menus fiéis e renderização leve.',
    highlights: [
      'Renderização OpenGL nativa',
      'Resoluções altas',
      'Mapeamento customizável'
    ],
    differences:
      'Foco em simplicidade e autenticidade clássica da descompilação original.'
  },
  'murkantor/project-midas': {
    toolchainType: 'Recompilação com Melhorias Visuais',
    howItWorks:
      'Port aprimorado com pipelines de texturas em alta resolução e renderização moderna.',
    description:
      'Versão focada em pacotes de texturas HD e multiplayer local fluido.',
    highlights: [
      'Suporte a texturas em alta definição',
      'Multiplayer local otimizado'
    ],
    differences:
      'Ênfase em texturas de alta resolução e melhorias visuais dos cenários.'
  },

  // --- The Legend of Zelda: Ocarina of Time (N64) ---
  'harbourmasters/shipwright': {
    toolchainType: 'Descompilação C & Engine libultraship',
    howItWorks:
      'Descompilação reversa completa do código fonte do clássico da Nintendo acoplada à engine libultraship da HarbourMasters.',
    description:
      'O port nativo mais consagrado e completo de Ocarina of Time do mundo (Ship of Harkinian).',
    highlights: [
      '60+ FPS destravado com interpolação perfeita',
      'Câmera livre em terceira pessoa analógica',
      'Randomizer completo embutido',
      'Centenas de melhorias de qualidade de vida, texturas HD e modelos 3D'
    ],
    differences:
      'O projeto mais rico em mods, texturas HD, randomizers e opções gráficas personalizáveis para OoT.'
  },
  'z2442/oot-psp': {
    toolchainType: 'Port Nativo Leve Otimizado',
    howItWorks:
      'Port derivado do código C descompilado adaptado para arquiteturas compactas de baixo consumo.',
    description:
      'Versão leve e minimalista focada em baixo uso de recursos.',
    highlights: [
      'Baixo consumo de memória RAM',
      'Execução leve e direta'
    ],
    differences:
      'Voltado para hardwares modestos com consumo mínimo de recursos de sistema.'
  },

  // --- Sonic Unleashed (Xbox 360) ---
  'hedge-dev/unleashedrecomp': {
    toolchainType: 'Recompilação Estática (XenonRecomp)',
    howItWorks:
      'Recompila o executável PowerPC do Xbox 360 (.xex) para binário nativo x86_64 usando a ferramenta XenonRecomp.',
    description:
      'Port oficial de PC de Sonic Unleashed rodando com taxa de quadros e resolução modernas sem emulador.',
    highlights: [
      '60 FPS fluidos e resolução 4K nativa',
      'Suporte a mouse/teclado e controles modernos de PC',
      'Física em tempo real idêntica ao Xbox 360',
      'Sem o peso de emulação de CPU'
    ],
    differences:
      'Build principal de PC com aceleração de hardware nativa moderna e suporte a 60 FPS.'
  },
  'nagaa95/unleashedrecomp-nx': {
    toolchainType: 'Recompilação Xenon Multiplataforma',
    howItWorks:
      'Fork adaptado com foco em portabilidade e perfis específicos de renderização de shaders.',
    description:
      'Versão com ajustes experimentais de compatibilidade e portabilidade.',
    highlights: [
      'Shaders adaptados',
      'Ajustes para dispositivos portáteis'
    ],
    differences:
      'Contém modificações experimentais voltadas para dispositivos portáteis.'
  },

  // --- Super Metroid (SNES) ---
  'mstan/supermetroidrecomp': {
    toolchainType: 'Recompilação Estática (SNES)',
    howItWorks:
      'Recompila estaticamente as instruções 65816 do SNES diretamente para C++ nativo.',
    description:
      'Port nativo direto de Super Metroid com suporte a widescreen real sem esticar a imagem.',
    highlights: [
      'Widescreen real 16:9 expandindo a visão lateral',
      'Zero input lag de emulador',
      'Renderização direta de shaders e efeitos'
    ],
    differences:
      'Destaque absoluto para o modo widescreen real, expandindo a área do jogo nas laterais sem distorcer os sprites.'
  },
  'radzprower/super-metroid-launcher': {
    toolchainType: 'Port C Nativo com Launcher',
    howItWorks:
      'Port baseado na descompilação em C com launcher integrado para configuração de som e vídeo.',
    description:
      'Versão com interface gráfica dedicada para configuração de áudio, filtros e controles.',
    highlights: [
      'Menu gráfico integrado de configurações',
      'Filtros visuais customizáveis',
      'Perfis de mapeamento de controles'
    ],
    differences:
      'Inclui menu de launcher para ajustes detalhados de tela, áudio e mapeamento de botões.'
  },

  // --- Star Fox 64 (N64) ---
  'harbourmasters/starship': {
    toolchainType: 'Descompilação C & Engine libultraship',
    howItWorks:
      'Port da equipe HarbourMasters usando libultraship sobre o código C descompilado.',
    description:
      'Port moderno de Star Fox 64 com suporte a 60 FPS e widescreen verdadeiro.',
    highlights: [
      '60 FPS com controles refinados',
      'Widescreen nativo sem barras pretas',
      'Suporte a controles modernos com rumble',
      'Menu interno de melhorias QoL'
    ],
    differences:
      'Suporte a 60 FPS fluidos, widescreen nativo e todos os recursos da engine moderna libultraship.'
  },
  'themriron2/sf64-psp': {
    toolchainType: 'Port Nativo Compacto',
    howItWorks:
      'Port compacto em C adaptado para renderizadores leves.',
    description:
      'Versão leve com foco em fidelidade de hardware clássico.',
    highlights: [
      'Fidelidade clássica',
      'Baixo consumo de CPU'
    ],
    differences:
      'Versão clássica e minimalista sem os recursos adicionais de engine moderna.'
  },

  // --- Mario Kart 64 (N64) ---
  'harbourmasters/spaghettikart': {
    toolchainType: 'Descompilação C & Engine libultraship',
    howItWorks:
      'Desenvolvido pela HarbourMasters com engine libultraship e suporte total a DirectX/OpenGL/Vulkan.',
    description:
      'Port nativo com suporte a alta resolução, widescreen e 60 FPS sem acelerar o jogo.',
    highlights: [
      '60 FPS com física de corrida correta',
      'Widescreen 16:9 real',
      'Suporte a múltiplos controles modernos',
      'Menu de melhorias e cheats'
    ],
    differences:
      'Permite jogar Mario Kart 64 a 60 FPS fluidos, com widescreen real e multiplayer local configurável.'
  },

  // --- Perfect Dark (N64) ---
  'perfect-dark-pc-port/perfect_dark': {
    toolchainType: 'Port C Nativo de Alta Fidelidade',
    howItWorks:
      'Descompilação completa do código original da Rare adaptada para compiladores nativos modernos de PC.',
    description:
      'A experiência definitiva para jogar Perfect Dark no PC com suporte total a mouse e teclado.',
    highlights: [
      'Mira perfeita com mouse e teclado estilo PC moderno',
      '60+ FPS destravado e fluido',
      'Multiplayer com bots e tela dividida',
      'Widescreen nativo e resoluções até 4K'
    ],
    differences:
      'Projetado especificamente para ser jogado como um jogo moderno de tiro de PC com mouse preciso e 60+ FPS.'
  },
  'dabdavis/perfect-dark-dabs-mod': {
    toolchainType: 'Fork Aprimorado com Mods',
    howItWorks:
      'Fork derivado do port nativo com modificações e opções de balanceamento adicionais.',
    description:
      'Versão com ajustes experimentais de armas, IA e jogabilidade.',
    highlights: [
      'Ajustes experimentais de armas',
      'Opções extras de jogabilidade'
    ],
    differences:
      'Inclui modificações de jogabilidade e opções extras criadas pela comunidade.'
  },

  // --- The Legend of Zelda: A Link to the Past (SNES) ---
  'radzprower/zelda-3-launcher': {
    toolchainType: 'Port C Nativo com Suporte a MSU-1',
    howItWorks:
      'Port em C do jogo clássico acompanhado de launcher moderno para customização.',
    description:
      'Port completo com suporte a trilha sonora orquestrada via MSU-1 e tela widescreen.',
    highlights: [
      'Suporte a áudio orquestrado em alta fidelidade (MSU-1)',
      'Widescreen 16:9 expandido',
      'Filtros gráficos CRT e interpolação'
    ],
    differences:
      'Destaque para o suporte a trilha orquestrada com qualidade de CD (MSU-1) e widescreen real.'
  },
  'xander-haj/z3r-launcher': {
    toolchainType: 'Port C Nativo para Randomizer',
    howItWorks:
      'Port focado na comunidade de Speedrun e Randomizers de A Link to the Past.',
    description:
      'Versão otimizada para carregamento veloz de sementes randomizadas.',
    highlights: [
      'Carregamento instantâneo de sementes',
      'Estatísticas de tempo em tempo real'
    ],
    differences:
      'Prioriza velocidade de carregamento e compatibilidade com o ecossistema de Randomizer.'
  },

  // --- Diddy Kong Racing (N64) ---
  'thatguymcd/dkr-r': {
    toolchainType: 'Recompilação Estática (N64Recomp)',
    howItWorks:
      'Recompilado estaticamente via N64Recomp diretamente para binário x86_64 nativo.',
    description:
      'Port com taxa de quadros aprimorada, widescreen nativo e suporte a Ray Tracing.',
    highlights: [
      '60+ FPS com física preservada',
      'Widescreen 16:9 nativo',
      'Suporte a iluminação Ray Tracing RT64'
    ],
    differences:
      'Focado em alta performance e integração com o renderizador moderno RT64.'
  },
  'akratch/goldenballoon': {
    toolchainType: 'Port C / Descompilação',
    howItWorks:
      'Baseado na descompilação em C com foco em ferramentas de criação de pistas e modding.',
    description:
      'Versão da comunidade focada em criação de pistas e customização.',
    highlights: [
      'Ferramentas para mods',
      'Câmeras customizáveis'
    ],
    differences:
      'Focado na comunidade de modding e pistas personalizadas.'
  },

  // --- Conker's Bad Fur Day (N64) ---
  'sciaschi/cbfd-recompiled': {
    toolchainType: 'Recompilação Estática (N64Recomp)',
    howItWorks:
      'Recompilado estaticamente a partir do binário de N64 para C++ nativo via N64Recomp.',
    description:
      'Port nativo para PC de Conker\'s Bad Fur Day rodando com 60 FPS e widescreen.',
    highlights: [
      '60 FPS fluidos',
      'Widescreen nativo sem cortes',
      'Carregamento instantâneo'
    ],
    differences:
      'Execução nativa de alta velocidade com taxas de quadro modernizadas.'
  },

  // --- Ace Combat 6: Fires of Liberation (Xbox 360) ---
  'sal063/ac6_recomp': {
    toolchainType: 'Recompilação Estática (XenonRecomp)',
    howItWorks:
      'Recompilação do executável do Xbox 360 para PC x86_64 nativo com suporte a controles modernos de voo.',
    description:
      'Port nativo do simulador de combate aéreo do Xbox 360 rodando no PC.',
    highlights: [
      'Resoluções elevadas até 4K',
      'Suporte a joysticks de voo (HOTAS) e gamepads',
      'Desempenho fluido sem emulador'
    ],
    differences:
      'Port nativo focado em desempenho com taxa de quadros e resolução modernas.'
  },

  // --- Ape Escape (PS1) ---
  'mstan/apeescaperecomp': {
    toolchainType: 'Recompilação Estática (PSXRecomp)',
    howItWorks:
      'Recompilação estática das instruções MIPS R3000A do PS1 para C++ nativo de 64 bits.',
    description:
      'Port nativo de Ape Escape com suporte analógico duplo aprimorado e taxas de quadro destravadas.',
    highlights: [
      'Suporte perfeito aos direcionais analógicos duplos',
      'Widescreen e 60 FPS',
      'Sem input lag de emulação'
    ],
    differences:
      'Port nativo x86_64 preservando o controle analógico duplo lendário do PS1 com gráficos modernizados.'
  }
}

/**
 * Fallback dynamic generator that inspects consoleBadge, inferredFamily,
 * repo name and project name to generate high quality descriptions.
 */
function generateDynamicPortMetadata(game: CatalogGame): {
  toolchainType: string
  howItWorks: string
  description: string
  highlights: string[]
  differences?: string
} {
  const family = game.inferredFamily
  const consoleBadge = game.consoleBadge
  const proj = game.projectName || game.title
  const repoLower = game.repoFullName.toLowerCase()
  const projLower = proj.toLowerCase()

  if (family === 'N64Recomp' || repoLower.includes('recomp') || projLower.includes('recomp')) {
    return {
      toolchainType: 'Recompilação Estática (N64Recomp)',
      howItWorks:
        'Traduz o código de máquina MIPS original da ROM do Nintendo 64 diretamente em código nativo de 64 bits para PC via N64Recomp, sem necessidade de emulador.',
      description: `Port nativo de ${game.title} focado em alta fidelidade, tempo de resposta instantâneo e suporte a resoluções modernas.`,
      highlights: [
        'Desempenho nativo 64-bit sem emulação',
        'Taxas de quadros aprimoradas',
        'Suporte nativo a telas modernas e gamepads'
      ],
      differences:
        'Executa como binário nativo com altíssimo desempenho, consumo levíssimo de hardware e suporte ao renderizador RT64.'
    }
  }

  if (family === 'PSXRecomp' || consoleBadge === 'PS1') {
    return {
      toolchainType: 'Recompilação Estática (PSXRecomp)',
      howItWorks:
        'Recompilado estaticamente a partir das instruções MIPS R3000A do PlayStation original diretamente para código C++ nativo.',
      description: `Port nativo de PlayStation 1 para PC com renderização acelerada por GPU e fidelidade de timing original.`,
      highlights: [
        'Execução nativa x86_64 para PC',
        'Áudio e vídeo sincronizados com alta fidelidade',
        'Compatibilidade com gamepads modernos'
      ],
      differences:
        'Executa o clássico do PS1 diretamente na GPU do computador sem a latência de emuladores convencionais.'
    }
  }

  if (family === 'XenonRecomp' || consoleBadge === 'Xbox 360') {
    return {
      toolchainType: 'Recompilação Estática (XenonRecomp)',
      howItWorks:
        'Traduz os executáveis PowerPC (.xex) do Xbox 360 para binários nativos x86_64 usando a ferramenta de recompilação XenonRecomp.',
      description: `Port nativo de Xbox 360 rodando diretamente no hardware do seu PC sem necessidade do emulador Xenia.`,
      highlights: [
        'Aproveita toda a aceleração da sua GPU e CPU',
        'Suporte a resoluções altas e controles de PC',
        'Desempenho muito superior a emulação'
      ],
      differences:
        'Recompilado estaticamente para rodar como um aplicativo de PC nativo, eliminando o gargalo de virtualização.'
    }
  }

  if (family === 'AssetExtractor' || repoLower.includes('harbour') || projLower.includes('ship')) {
    return {
      toolchainType: 'Descompilação C & Engine libultraship',
      howItWorks:
        'Baseado no código fonte descompilado do jogo acoplado a uma engine moderna de PC com renderização gráfica avançada (DirectX/OpenGL/Vulkan).',
      description: `Port nativo rico em opções de customização, suporte a mods, pacotes de textura HD e câmera livre.`,
      highlights: [
        'Câmera moderna e suporte a controles atuais',
        'Suporte a pacotes de texturas e modificações',
        'Menu interno completo de opções gráficas'
      ],
      differences:
        'Excelente flexibilidade com suporte a mods, menu interno de melhorias de jogabilidade e opções gráficas detalhadas.'
    }
  }

  return {
    toolchainType: 'Port Nativo C/C++ Recompilado',
    howItWorks:
      'Código-fonte original descompilado ou reimplementado pela comunidade e compilado diretamente para execução nativa em computadores modernos.',
    description: `Port nativo desenvolvido pela comunidade para rodar diretamente no PC com máximo desempenho e baixa latência.`,
    highlights: [
      'Execução nativa de alta velocidade',
      'Suporte a gamepads de PC (XInput/DualSense)',
      'Resoluções e taxas de quadros personalizáveis'
    ],
    differences:
      'Port nativo clássico da comunidade com foco em compatibilidade e execução suave no PC.'
  }
}

/**
 * Enriches a CatalogGame into a GamePortInfo with toolchain, description,
 * howItWorks, highlights, and differences metadata.
 */
export function enrichPort(game: CatalogGame): GamePortInfo {
  const key = game.repoFullName.toLowerCase().trim()
  const custom = KNOWN_PORT_DETAILS[key]
  const fallback = generateDynamicPortMetadata(game)

  return {
    id: game.id,
    title: game.title,
    projectName: game.projectName,
    repoFullName: game.repoFullName,
    releaseRepoFullName: game.releaseRepoFullName,
    githubUrl: game.githubUrl,
    releaseUrl: game.releaseUrl,
    websiteUrl: game.websiteUrl,
    imageUrl: game.imageUrl,
    console: game.console,
    consoleBadge: game.consoleBadge,
    version: game.version,
    releaseStatus: game.releaseStatus,
    isAiAssisted: game.isAiAssisted,
    platforms: game.platforms,
    updatedAt: game.updatedAt,
    recipe: game.recipe,
    inferredFamily: game.inferredFamily,

    toolchainType: custom?.toolchainType || fallback.toolchainType,
    howItWorks: custom?.howItWorks || fallback.howItWorks,
    description: custom?.description || fallback.description,
    highlights: custom?.highlights || fallback.highlights,
    differences: custom?.differences || fallback.differences
  }
}

/**
 * Normalizes a game title for grouping canonical titles.
 * Handles apostrophes, removes trailing parenthesized tags (e.g. "(USA)", "(zeranemesis)"),
 * and trims whitespace.
 */
export function normalizeGameTitle(title: string): string {
  return title
    .replace(/[’']/g, "'")
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Scores a port to decide the best primary representative port for a game card:
 * 1. Has explicit/curated recipe in recipes.json (+50)
 * 2. Has release status 'Latest' (+20) vs 'Pre-release' (+5) vs 'Source Only' (0)
 * 3. Supports both Windows and Linux (+15)
 * 4. Most recent update (+date score)
 */
function scorePortForPrimary(port: CatalogGame): number {
  let score = 0
  if (port.recipe && !port.recipe.id.startsWith('heuristic_')) {
    score += 50
  }
  if (port.releaseStatus === 'Latest') score += 20
  else if (port.releaseStatus === 'Pre-release') score += 5

  const hasWin = port.platforms.includes('Windows')
  const hasLin = port.platforms.includes('Linux')
  if (hasWin && hasLin) score += 15
  else if (hasWin) score += 10

  const time = new Date(port.updatedAt).getTime()
  if (!Number.isNaN(time)) {
    // Normalizes recent timestamps (scaled between 0 and 10)
    score += Math.min(10, Math.max(0, (time - 1700000000000) / 3000000000))
  }

  return score
}

/**
 * Groups an array of raw CatalogGames:
 * 1. Excludes Android-only ports (ports with ONLY Android platform, no Windows/Linux/macOS).
 * 2. Groups multiple ports of the same game into a single canonical CatalogGame.
 * 3. Enriches each port with detailed descriptions and differences.
 * 4. Sets canonical properties on the returned game.
 */
export function groupCatalogGames(rawGames: CatalogGame[]): CatalogGame[] {
  // 1. Filter out Android-only ports from the PC launcher catalog
  const pcGames = rawGames.filter((g) => {
    const platforms = g.platforms || []
    if (platforms.length === 0) return true
    const hasDesktop = platforms.some((p: OSPlatform) =>
      ['Windows', 'Linux', 'macOS'].includes(p)
    )
    return hasDesktop
  })

  // 2. Group by normalized title + console badge
  const groupMap = new Map<string, CatalogGame[]>()
  for (const game of pcGames) {
    const normTitle = normalizeGameTitle(game.title)
    const key = `${normTitle}::${game.consoleBadge.toLowerCase()}`
    const list = groupMap.get(key) || []
    list.push(game)
    groupMap.set(key, list)
  }

  // 3. For each group, pick primary port and enrich all ports
  const result: CatalogGame[] = []

  for (const [_groupKey, portsList] of groupMap.entries()) {
    // Sort ports so the best one is primary
    portsList.sort((a, b) => scorePortForPrimary(b) - scorePortForPrimary(a))

    const primaryPort = portsList[0]
    const enrichedPorts = portsList.map((p) => enrichPort(p))

    // Canonical clean title (use primary title, cleaned of extraneous parentheses)
    const cleanTitle = primaryPort.title.replace(/\s*\([^)]*\)\s*$/, '').trim() || primaryPort.title

    // Create canonical CatalogGame
    const canonicalGame: CatalogGame = {
      ...primaryPort,
      title: cleanTitle,
      canonicalId: `canonical_${normalizeGameTitle(cleanTitle).replace(/[^a-z0-9_-]+/g, '_')}__${primaryPort.consoleBadge.toLowerCase()}`,
      ports: enrichedPorts,
      selectedPortId: primaryPort.id,
      toolchainType: enrichedPorts[0].toolchainType,
      howItWorks: enrichedPorts[0].howItWorks,
      description: enrichedPorts[0].description,
      highlights: enrichedPorts[0].highlights,
      differences: enrichedPorts[0].differences
    }

    result.push(canonicalGame)
  }

  // Sort games alphabetically by title for a clean catalog presentation
  result.sort((a, b) => a.title.localeCompare(b.title))

  return result
}
