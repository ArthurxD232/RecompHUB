import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, execFileSync } from 'child_process'
import {
  CatalogGame,
  GameRecipe,
  RomAvailabilityStatus,
  RomVaultEntry
} from '../../shared/types'
import { StoreService } from './store.service'
import { RomVaultService } from './rom-vault.service'
import { isInstallerAsset } from './asset-selector'
import { findMarkerRoot } from './archive.service'
import { parseSfo } from './pkg/pkg'

export interface RecipeExecutionResult {
  executablePath: string
  requiresCompatibilityLayer: boolean
  romPaired: boolean
  pairedRomPaths: string[]
  pairedPatchPaths: string[]
  aliasLinkPaths: string[]
  portableMode: boolean
  status: 'READY_TO_PLAY' | 'NEEDS_ROM' | 'ERROR'
  logs: string[]
}

const BUNDLED_LUS_ARCHIVES = new Set([
  '2ship.o2r',
  'soh.otr',
  'soh.o2r',
  'ghostship.o2r',
  'spaghettikart.o2r',
  'starship.o2r',
  'lighthouse.o2r',
  'paperboat.o2r',
  'battleship.o2r'
])

/**
 * Compiles (once per session/boot) a tiny Linux LD_PRELOAD helper for HarbourMasters / Torch / Libultraship ports:
 * 1. Overrides `GameExtractor::Parse` so Torch's broken dry-run pass (which re-parses shared YAML files
 *    hundreds of times and hangs for ~103 seconds at "Reading <ROM>.z64... Reading ROM, please wait...")
 *    returns immediately in 0ms.
 * 2. When `RECOMPHUB_HEADLESS_EXTRACT=1` is set during post-install, runs `GameExtractor::RunStandalone` +
 *    `GameExtractor::GenerateOTRTo` headlessly inside `__libc_start_main` (after C++ static constructors run),
 *    generating the `.o2r` archive in ~1.8 seconds without opening any SDL window or popup.
 */
export function ensureLusFastExtractPreloadSo(): string | null {
  if (process.platform !== 'linux') return null
  const soPath = path.join(os.tmpdir(), 'recomphub-lus-fast-extract-v2.so')
  if (fs.existsSync(soPath)) {
    try {
      if (fs.statSync(soPath).size > 4096) return soPath
    } catch {
      // Recompile below
    }
  }

  const cppPath = path.join(os.tmpdir(), 'recomphub-lus-fast-extract-v2.cpp')
  const cppSource = `
#include <atomic>
#include <string>
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>

extern "C" {

bool _ZN13GameExtractor5ParseERSt6atomicImENSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE(
    void* /*self*/, std::atomic<size_t>& totalExtract, std::string /*o2rName*/) {
    totalExtract = 2500;
    return true;
}

bool _ZN13GameExtractor5ParseERSt6atomicImE(
    void* /*self*/, std::atomic<size_t>& totalExtract) {
    totalExtract = 2500;
    return true;
}

typedef bool (*RunStandaloneFn)(void*, std::string);
typedef bool (*GenerateOTRToFn)(void*, std::atomic<size_t>&, const std::string&, const std::string&);
typedef bool (*GenerateOTR2Fn)(void*, std::atomic<size_t>&, std::string);
typedef bool (*GenerateOTR1Fn)(void*, std::atomic<size_t>&);
typedef int (*main_t)(int, char**, char**);

static main_t real_main = nullptr;

static int headless_main(int argc, char** argv, char** envp) {
    const char* headless = getenv("RECOMPHUB_HEADLESS_EXTRACT");
    const char* romPath = getenv("RECOMPHUB_ROM_PATH");
    const char* installDir = getenv("RECOMPHUB_INSTALL_DIR");
    const char* o2rBase = getenv("RECOMPHUB_O2R_BASENAME");

    if (headless && headless[0] == '1' && romPath && romPath[0] != '\\0') {
        auto runStandalone = (RunStandaloneFn)dlsym(
            RTLD_DEFAULT,
            "_ZN13GameExtractor13RunStandaloneENSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE"
        );
        auto genOtrTo = (GenerateOTRToFn)dlsym(
            RTLD_DEFAULT,
            "_ZN13GameExtractor13GenerateOTRToERSt6atomicImERKNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEESA_"
        );
        auto genOtr2 = (GenerateOTR2Fn)dlsym(
            RTLD_DEFAULT,
            "_ZN13GameExtractor11GenerateOTRERSt6atomicImENSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE"
        );
        auto genOtr1 = (GenerateOTR1Fn)dlsym(
            RTLD_DEFAULT,
            "_ZN13GameExtractor11GenerateOTRERSt6atomicImE"
        );

        if (runStandalone && (genOtrTo || genOtr2 || genOtr1)) {
            alignas(16) unsigned char extractorBuf[512] = {0};
            fprintf(stdout, "[RecompHub] Generating O2R headlessly from %s...\\n", romPath);
            fflush(stdout);
            bool ok = runStandalone(extractorBuf, std::string(romPath));
            if (ok) {
                std::atomic<size_t> extractCount{0};
                std::string o2rName = (o2rBase && o2rBase[0]) ? std::string(o2rBase) : std::string("sm64");
                std::string outDir = (installDir && installDir[0]) ? std::string(installDir) : std::string(".");
                bool genOk = false;
                if (genOtrTo) {
                    genOk = genOtrTo(extractorBuf, extractCount, o2rName, outDir);
                } else if (genOtr2) {
                    genOk = genOtr2(extractorBuf, extractCount, o2rName);
                } else if (genOtr1) {
                    genOk = genOtr1(extractorBuf, extractCount);
                }
                fprintf(stdout, "[RecompHub] Loaded ZIP (O2R) archive: %s/%s.o2r (ok=%d, assets=%zu)\\n",
                        outDir.c_str(), o2rName.c_str(), (int)genOk, extractCount.load());
                fflush(stdout);
                if (genOk) {
                    _Exit(0);
                }
            }
        }
    }

    if (real_main) {
        return real_main(argc, argv, envp);
    }
    return 1;
}

typedef int (*libc_start_main_t)(
    main_t main, int argc, char** ubp_av,
    void (*init)(void), void (*fini)(void),
    void (*rtld_fini)(void), void* stack_end
);

int __libc_start_main(
    main_t main, int argc, char** ubp_av,
    void (*init)(void), void (*fini)(void),
    void (*rtld_fini)(void), void* stack_end
) {
    real_main = main;
    auto real_start = (libc_start_main_t)dlsym(RTLD_NEXT, "__libc_start_main");
    return real_start(headless_main, argc, ubp_av, init, fini, rtld_fini, stack_end);
}

}
`
  try {
    fs.writeFileSync(cppPath, cppSource, 'utf-8')
    execFileSync('g++', ['-shared', '-fPIC', '-O2', cppPath, '-o', soPath, '-ldl'], {
      stdio: 'ignore',
      timeout: 10000
    })
    if (fs.existsSync(soPath)) return soPath
  } catch {
    // g++ not installed or compilation failed; fallback to standard execution
  }
  return null
}

/**
 * Clears stuck `"ModalWindow": 1` in Libultraship config files (`*.cfg.json` / `*.json`)
 * and removes any stray PS4 `tlg.ini` / `settings.json` that may have been created in non-PS4 directories.
 */
export function sanitizeN64PortDirectory(installDir: string): void {
  if (!fs.existsSync(installDir)) return
  try {
    const entries = fs.readdirSync(installDir)
    for (const name of entries) {
      const lower = name.toLowerCase()
      if (lower.endsWith('.cfg.json') || lower === '2ship2harkinian.json' || lower === 'shipofharkinian.json') {
        const fullPath = path.join(installDir, name)
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          if (/("ModalWindow"\s*:\s*)1\b/.test(content)) {
            const updated = content.replace(/("ModalWindow"\s*:\s*)1\b/g, '$10')
            fs.writeFileSync(fullPath, updated, 'utf-8')
          }
        } catch {
          // Ignore
        }
      }
    }

    // Remove stray PS4 files if present in an N64 directory
    for (const stray of ['tlg.ini', path.join('user', 'tlg.ini'), path.join('user', 'settings.json')]) {
      const p = path.join(installDir, stray)
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { force: true })
        } catch {
          // Ignore
        }
      }
    }
    const settingsJsonPath = path.join(installDir, 'settings.json')
    if (fs.existsSync(settingsJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsJsonPath, 'utf-8'))
        if (parsed && typeof parsed.game_dir === 'string' && parsed.game_dir.toLowerCase().endsWith('.z64')) {
          fs.rmSync(settingsJsonPath, { force: true })
        }
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  }
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
    const aliasLinkPaths: string[] = []
    const resolvedRoots = new Map<string, string>()
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
          if (item.problem) log(`Problema: ${item.problem}`)
        }
        // Atalhos criados antes para um item que não serve mais não podem ficar apontando para ele
        if (req.type === 'folder') {
          this.removeLinkIfAny(path.join(installDir, req.expectedFilename))
          for (const alias of recipe.aliasLinks || []) {
            if (alias.requirementId !== req.id) continue
            const aliasPath = path.resolve(installDir, alias.path)
            if (aliasPath.startsWith(path.resolve(settings.installRootPath) + path.sep)) {
              this.removeLinkIfAny(aliasPath)
            }
          }
        } else if (!req.keepOriginalName) {
          // ISO/ROM removida do jogo: o atalho que ficou na pasta de instalação sai junto
          // (só atalhos simbólicos; um arquivo de verdade colocado ali nunca é apagado)
          this.removeLinkIfAny(path.join(installDir, req.expectedFilename))
        }
        continue
      }

      const destPath = path.join(
        installDir,
        req.keepOriginalName ? localEntry.fileName : req.expectedFilename
      )

      // Pasta do jogo (dump de PS4 etc.): atalho para o local original, nunca uma cópia de dezenas de GB
      if (localEntry.isDirectory) {
        // A raiz do jogo (onde está o eboot.bin etc.) pode estar numa subpasta do item registrado
        const gameRoot = req.markerFile
          ? (findMarkerRoot(localEntry.filePath, req.markerFile, 2) ?? localEntry.filePath)
          : localEntry.filePath
        if (gameRoot !== localEntry.filePath) {
          log(`A raiz do jogo está na subpasta: ${path.relative(localEntry.filePath, gameRoot)}`)
        }
        resolvedRoots.set(req.id, gameRoot)
        const linked = this.linkDirectory(gameRoot, destPath, log)
        pairedRomPaths.push(linked ?? gameRoot)
        if (linked) {
          log(`Pasta do jogo vinculada: ${path.basename(destPath)} -> ${gameRoot}`)
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

        // For N64 ports (HarbourMasters / Torch / ZAPD / N64Recomp), having multiple .z64 symlinks
        // in installDir causes ROM pickers ("Select ROM Version") to pop up or extractors to run twice!
        // Remove any other stale .z64/.n64/.v64 symlinks in installDir first.
        if (isN64Game) {
          this.cleanupExtraN64RomLinks(installDir, destPath)
        }

        // Also link with the original filename in installDir if different (ONLY for non-N64 games),
        // so ports that look for original dump names or open a file picker in cwd find it immediately.
        const origDestPath = path.join(installDir, localEntry.fileName)
        const isUnconvertedN64Name =
          origDestPath.toLowerCase().endsWith('.n64') ||
          origDestPath.toLowerCase().endsWith('.v64')

        if (
          !isN64Game &&
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

    // 2a. Atalhos extras definidos pela receita (o port procura o jogo num lugar fixo)
    for (const alias of recipe.aliasLinks || []) {
      const item = availability.matchedRequirements.find((m) => m.requirement.id === alias.requirementId)
      const entry = item?.localEntry
      if (!entry || !fs.existsSync(entry.filePath)) continue
      const aliasTarget = resolvedRoots.get(alias.requirementId) ?? entry.filePath

      const aliasPath = path.resolve(installDir, alias.path)
      const gamesRoot = path.resolve(settings.installRootPath)
      // Segurança: receitas podem vir de fora; nada é criado fora da pasta de jogos do app
      if (!aliasPath.startsWith(gamesRoot + path.sep)) {
        log(`Aviso: atalho "${alias.path}" ignorado (fica fora da pasta de jogos do RecompHUB).`)
        continue
      }
      if (entry.isDirectory) {
        if (this.linkDirectory(aliasTarget, aliasPath, log)) {
          aliasLinkPaths.push(aliasPath)
          log(`Atalho para o port encontrar o jogo: ${path.relative(gamesRoot, aliasPath)} -> ${aliasTarget}`)
        }
      } else if (this.removeLinkIfAny(aliasPath)) {
        try {
          this.createFileLink(entry.filePath, aliasPath, settings.linkStrategy, 512 * 1024 * 1024)
          aliasLinkPaths.push(aliasPath)
        } catch (err: any) {
          log(`Aviso: não foi possível criar o atalho ${alias.path}: ${err?.message}`)
        }
      } else {
        log(`Aviso: já existe algo em "${alias.path}" que não é um atalho; nada foi alterado.`)
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
      this.ensureN64RecompStoredRomLinks(
        installDir,
        recipe,
        pairedRomPaths[0],
        settings.linkStrategy,
        log
      )
    } else if (recipe.family === 'XenonRecomp' && pairedRomPaths.length > 0) {
      await this.runXenonIsoExtraction(installDir, pairedRomPaths[0], settings.extractXisoPath, log)
    } else if (recipe.family === 'AssetExtractor' && pairedRomPaths.length > 0) {
      this.prepareLusExtractorEnvironment(installDir, log)
      await this.runAssetExtractorIfNeeded(installDir, recipe, pairedRomPaths[0], log)
    }

    // 3b. PS4 / PS4 port post-processing (HayatoG launcher, ShadPS4, Bloodborne, etc.)
    const isPs4Port =
      recipe.console === 'PS4' ||
      (recipe.family === 'GenericNative' &&
        (fs.existsSync(path.join(installDir, 'port.env')) ||
          pairedRomPaths.some((p) => {
            try {
              return fs.existsSync(p) && fs.existsSync(path.join(p, 'eboot.bin'))
            } catch {
              return false
            }
          }) ||
          fs.existsSync(path.join(installDir, 'game_dump', 'eboot.bin')) ||
          recipe.title.toLowerCase().includes('infamous') ||
          recipe.title.toLowerCase().includes('bloodborne') ||
          recipe.repoFullName.toLowerCase().includes('iss_pc')))
    if (isPs4Port) {
      this.configurePs4PortEnvironment(installDir, pairedRomPaths, recipe, game, log)
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

    const status = (romPaired && Boolean(execInfo.executablePath)) ? 'READY_TO_PLAY' : 'NEEDS_ROM'
    log(
      status === 'READY_TO_PLAY'
        ? 'Jogo configurado e pronto para jogar (READY_TO_PLAY)!'
        : romPaired && !execInfo.executablePath
        ? 'Aviso: ROM pareada, mas o executável principal não foi encontrado na pasta de instalação (NEEDS_ROM).'
        : 'Jogo instalado, aguardando pareamento da ROM/ISO exigida (NEEDS_ROM).'
    )

    return {
      executablePath: execInfo.executablePath,
      requiresCompatibilityLayer: execInfo.requiresCompatibilityLayer,
      romPaired,
      pairedRomPaths,
      pairedPatchPaths,
      aliasLinkPaths,
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

  private cleanupExtraN64RomLinks(installDir: string, keepRomPath: string): void {
    try {
      const keepResolved = path.resolve(keepRomPath)
      const entries = fs.readdirSync(installDir)
      for (const name of entries) {
        const lower = name.toLowerCase()
        if (!lower.endsWith('.z64') && !lower.endsWith('.n64') && !lower.endsWith('.v64')) continue
        const fullPath = path.join(installDir, name)
        if (path.resolve(fullPath) === keepResolved) continue
        if (this.isSymlink(fullPath)) {
          this.removeLinkIfAny(fullPath)
        }
      }
    } catch {
      // Ignore
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

  /**
   * Every N64Recomp (`librecomp` / `N64ModernRuntime`) port calls `recomp::check_stored_rom(entry)`
   * at startup, which checks for `<config_dir>/<entry.game_id>.z64` (i.e. `<installDir>/<game_id>.z64`
   * when `portable.txt` exists). If that exact filename is missing, the game prompts the user to
   * select a ROM manually.
   *
   * This method automatically discovers `entry.game_id` by:
   * 1. Checking known N64Recomp repository mappings.
   * 2. Reading the 20-byte ASCII `internal_name` from offset `0x20..0x34` of the `.z64` ROM header
   *    and scanning the N64Recomp executable's `.rodata`/`.rdata` section around `internal_name`
   *    for the adjacent `game_id` string literal in `recomp::GameEntry`.
   * 3. Creating `<game_id>.z64` linked to `pairedRomPath` in `installDir`.
   */
  private ensureN64RecompStoredRomLinks(
    installDir: string,
    recipe: GameRecipe,
    pairedRomPath: string,
    strategy: 'symlink' | 'hardlink' | 'copy',
    log: (m: string) => void
  ): void {
    try {
      sanitizeN64PortDirectory(installDir)
      if (!fs.existsSync(pairedRomPath)) return

      const candidateGameIds = new Set<string>()
      const combined = `${recipe.id} ${recipe.repoFullName} ${recipe.title}`.toLowerCase()

      const knownMappings: Array<{ match: string; gameIds: string[] }> = [
        { match: 'zelda64recomp', gameIds: ['mm.n64.us.1.0', 'mm.n64.jp.1.1'] },
        { match: 'banjorecomp', gameIds: ['bk.n64.us.1.0'] },
        { match: 'banjotooie', gameIds: ['banjotooie.us', 'bt.n64.us.1.0'] },
        { match: 'cbfd', gameIds: ['conker.us', 'cbfd.n64.us.1.0'] },
        { match: 'aerogauge', gameIds: ['aerogauge.us'] },
        { match: 'bm64recomp', gameIds: ['bm64_us'] },
        { match: 'bmherorecomp', gameIds: ['bmhero'] },
        { match: 'goemon64recomp', gameIds: ['mnsg.us'] },
        { match: 'drmario64', gameIds: ['drmario64_us', 'drmario64.us'] },
        { match: 'quest64', gameIds: ['quest64.us'] },
        { match: 'dino', gameIds: ['dino.n64', 'dinosaurplanet'] },
        { match: 'starfox64', gameIds: ['sf64.n64.us.1.1', 'sf64.n64.us.1.0', 'sf64.us'] },
        { match: 'sm64recomp', gameIds: ['sm64.us', 'sm64.n64.us'] },
        { match: 'mk64recomp', gameIds: ['mk64.us', 'mk64.n64.us'] },
        { match: 'chameleontwist2', gameIds: ['ct2.us'] },
        { match: 'chameleontwist', gameIds: ['ct1.us'] },
        { match: 'buckbumble', gameIds: ['buck.us'] },
        { match: 'rrow', gameIds: ['rrow.us'] },
        { match: 'sssv', gameIds: ['sssv.us'] }
      ]

      for (const item of knownMappings) {
        if (combined.includes(item.match)) {
          for (const gid of item.gameIds) candidateGameIds.add(gid)
        }
      }

      // Read 20-byte ASCII internal_name at offset 0x20..0x34 of Big-Endian .z64 ROM
      const fd = fs.openSync(pairedRomPath, 'r')
      const headerBuf = Buffer.alloc(0x40)
      const bytesRead = fs.readSync(fd, headerBuf, 0, 0x40, 0)
      fs.closeSync(fd)

      if (bytesRead >= 0x34 && headerBuf.readUInt32BE(0) === 0x80371240) {
        const internalName = headerBuf
          .subarray(0x20, 0x34)
          .toString('ascii')
          .replace(/\0+$/g, '')
          .trim()

        if (internalName.length >= 3) {
          const execInfo = this.findMainExecutable(installDir, recipe)
          if (execInfo.executablePath && fs.existsSync(execInfo.executablePath)) {
            const stat = fs.statSync(execInfo.executablePath)
            // Scan binaries up to 120 MB
            if (stat.size > 0 && stat.size <= 120 * 1024 * 1024) {
              const binBuf = fs.readFileSync(execInfo.executablePath)
              const needle = Buffer.from(internalName + '\0', 'ascii')
              let searchFrom = 0
              while (searchFrom < binBuf.length) {
                const idx = binBuf.indexOf(needle, searchFrom)
                if (idx === -1) break
                searchFrom = idx + needle.length

                const winStart = Math.max(0, idx - 256)
                const winEnd = Math.min(binBuf.length, idx + 256)
                const slice = binBuf.subarray(winStart, winEnd)

                // Extract null-terminated ASCII strings in the window around internal_name
                let cur = ''
                for (let i = 0; i < slice.length; i++) {
                  const b = slice[i]
                  if (b >= 0x20 && b <= 0x7e) {
                    cur += String.fromCharCode(b)
                  } else {
                    if (b === 0 && cur.length >= 3 && cur.length <= 36 && cur !== internalName) {
                      if (
                        /^[a-z0-9][a-z0-9._-]{1,34}[a-z0-9]$/i.test(cur) &&
                        !/\.(cpp|hpp|c|h|toml|json|png|txt|dll|so|exe|z64|n64|v64)$/i.test(cur) &&
                        !/^(gl|vk|sdl|rt64|recomp|ultramodern|rml|main|entry|true|false|null)/i.test(cur)
                      ) {
                        candidateGameIds.add(cur)
                      }
                    }
                    cur = ''
                  }
                }
              }
            }
          }
        }
      }

      for (const gameId of candidateGameIds) {
        const storedRomName = gameId.toLowerCase().endsWith('.z64') ? gameId : `${gameId}.z64`
        const storedRomPath = path.join(installDir, storedRomName)
        if (path.resolve(storedRomPath) === path.resolve(pairedRomPath)) continue
        if (!fs.existsSync(storedRomPath)) {
          try {
            this.createFileLink(pairedRomPath, storedRomPath, strategy)
            log(`Vínculo N64Recomp (check_stored_rom) criado automaticamente: ${storedRomName}`)
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Optimizes the extraction environment for HarbourMasters / Torch / Libultraship ports:
   * 1. Resets stuck `"ModalWindow": 1` in `*.cfg.json` / `*.json`.
   * 2. Injects `logging: CRITICAL` into `config.yml` (if present in `installDir`, e.g. on Windows)
   *    so Torch doesn't write 25 MB of `[info]` logs to disk during extraction.
   */
  private prepareLusExtractorEnvironment(installDir: string, log: (m: string) => void): void {
    sanitizeN64PortDirectory(installDir)
    const configYmlPath = path.join(installDir, 'config.yml')
    if (fs.existsSync(configYmlPath)) {
      try {
        const content = fs.readFileSync(configYmlPath, 'utf-8')
        if (!content.includes('logging:')) {
          const updated = content.replace(/^(\s*config:\s*)$/gm, '$1\n    logging: CRITICAL')
          if (updated !== content) {
            fs.writeFileSync(configYmlPath, updated, 'utf-8')
            log('Configuração config.yml otimizada (logging: CRITICAL) para extração rápida de assets.')
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  private hasExpectedLusOutput(installDir: string, requiredArchives: string[]): boolean {
    if (requiredArchives.length === 0) return false
    try {
      const entries = fs.readdirSync(installDir)
      for (const reqName of requiredArchives) {
        if (reqName.startsWith('.')) {
          // Heuristic extension check (e.g. '.o2r', '.otr')
          const found = entries.some((e) => {
            const lower = e.toLowerCase()
            if (BUNDLED_LUS_ARCHIVES.has(lower)) return false
            if (!lower.endsWith(reqName.toLowerCase())) return false
            try {
              return fs.statSync(path.join(installDir, e)).size > 1024 * 1024
            } catch {
              return false
            }
          })
          if (found) return true
        } else {
          const p = path.join(installDir, reqName)
          if (fs.existsSync(p)) {
            const st = fs.statSync(p)
            if (st.isDirectory() || st.size > 1024 * 1024) return true
          }
        }
      }
    } catch {
      // Ignore
    }
    return false
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

    // Check if expected output packages are already generated (e.g. mm.o2r, oot.o2r, sm64.o2r)
    const expectedOutputs = extCfg.expectedOutputFiles || []
    const requiredArchives = expectedOutputs.filter(
      (name) => !BUNDLED_LUS_ARCHIVES.has(name.toLowerCase())
    )

    if (this.hasExpectedLusOutput(installDir, requiredArchives)) {
      log(`Pacote de assets (${requiredArchives.join(' / ')}) já se encontra gerado na pasta do jogo. Pronto para jogar!`)
      return
    }

    // 1. Check if dedicated CLI extractor binary (like OpenGOAL's `extractor` or standalone `torch`) exists
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

    // 2. If no standalone extractor binary, look for integrated HarbourMasters / Libultraship ports
    if (!dedicatedExtractor) {
      const patternCandidates = (extCfg.binaryPatterns || []).map((p) => p.toLowerCase())
      let execCandidate = files.find((f) => {
        const base = path.basename(f).toLowerCase()
        if (patternCandidates.some((pat) => base === pat || base.includes(pat))) {
          return (
            base.endsWith('.appimage') ||
            base.endsWith('.exe') ||
            this.isElfBinary(f)
          )
        }
        return (
          base.includes('2ship') ||
          base.includes('soh') ||
          base.includes('spaghettikart') ||
          base.includes('ghostship') ||
          base.includes('starship') ||
          base.includes('lighthouse') ||
          base.includes('paperboat') ||
          base.includes('battleship')
        )
      })

      if (!execCandidate) {
        const mainExec = this.findMainExecutable(installDir, recipe)
        if (mainExec.executablePath) {
          execCandidate = mainExec.executablePath
        }
      }

      if (execCandidate) {
        dedicatedExtractor = execCandidate
        // Passing romPath as CLI argument causes Libultraship/Torch ports to enter ES_EXTRACT_ARGS
        // directly instead of stopping on the "No O2R files found. Generate one now?" popup.
        if (execCandidate.toLowerCase().endsWith('.appimage')) {
          extractorArgs = ['--appimage-extract-and-run', romPath]
        } else {
          extractorArgs = [romPath]
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

    const firstExpected = requiredArchives.find((n) => !n.startsWith('.')) || 'sm64.o2r'
    const o2rBaseName = path.parse(firstExpected).name || 'sm64'
    const preloadSo = ensureLusFastExtractPreloadSo()
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      RECOMPHUB_HEADLESS_EXTRACT: '1',
      RECOMPHUB_ROM_PATH: romPath,
      RECOMPHUB_INSTALL_DIR: installDir,
      RECOMPHUB_O2R_BASENAME: o2rBaseName
    }
    if (preloadSo) {
      childEnv.LD_PRELOAD = childEnv.LD_PRELOAD
        ? `${preloadSo}:${childEnv.LD_PRELOAD}`
        : preloadSo
    }

    log(`Iniciando geração rápida de assets (.o2r/.otr) com ${path.basename(dedicatedExtractor)}...`)

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
          sanitizeN64PortDirectory(installDir)
          resolve()
        }, 500)
      }

      const checkOutputFiles = (): void => {
        if (this.hasExpectedLusOutput(installDir, requiredArchives)) {
          finishOnce('Arquivo(s) .o2r/.otr gerado(s) com sucesso na raiz do jogo!')
        }
      }

      const pollInterval = setInterval(checkOutputFiles, 1000)

      const child = spawn(dedicatedExtractor, extractorArgs, {
        cwd: installDir,
        env: childEnv
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
            line.includes('Loaded ZIP (O2R)') ||
            line.includes('[RecompHub]')
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
          finished = true
          sanitizeN64PortDirectory(installDir)
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

  private configurePs4PortEnvironment(
    installDir: string,
    pairedRomPaths: string[],
    recipe: GameRecipe,
    game: CatalogGame,
    log: (m: string) => void
  ): void {
    try {
      // 1. Locate game dump directory (contains eboot.bin)
      let dumpDir: string | null = null
      for (const p of pairedRomPaths) {
        if (!fs.existsSync(p)) continue
        try {
          if (fs.statSync(p).isDirectory()) {
            if (fs.existsSync(path.join(p, 'eboot.bin'))) {
              dumpDir = p
              break
            }
            const marker = findMarkerRoot(p, 'eboot.bin', 2)
            if (marker) {
              dumpDir = marker
              break
            }
          }
        } catch {
          // Ignore
        }
      }

      if (!dumpDir && fs.existsSync(path.join(installDir, 'game_dump'))) {
        const gd = path.join(installDir, 'game_dump')
        if (fs.existsSync(path.join(gd, 'eboot.bin'))) {
          dumpDir = gd
        }
      }

      if (!dumpDir && pairedRomPaths.length > 0) {
        dumpDir = pairedRomPaths[0]
      }

      if (!dumpDir || !fs.existsSync(dumpDir)) {
        return
      }

      let realDumpDir = dumpDir
      try {
        realDumpDir = fs.realpathSync(dumpDir)
      } catch {
        realDumpDir = dumpDir
      }

      // 2. Read param.sfo if present
      let titleId = ''
      let appVer = ''
      const sfoCandidates = [
        path.join(realDumpDir, 'sce_sys', 'param.sfo'),
        path.join(dumpDir, 'sce_sys', 'param.sfo')
      ]
      for (const sfoPath of sfoCandidates) {
        if (fs.existsSync(sfoPath)) {
          try {
            const buf = fs.readFileSync(sfoPath)
            const sfo = parseSfo(buf)
            if (sfo.TITLE_ID) titleId = String(sfo.TITLE_ID).trim()
            if (sfo.APP_VER) appVer = String(sfo.APP_VER).trim()
            break
          } catch {
            // Ignore
          }
        }
      }

      // 3. Inspect port.env
      let portSlug = ''
      const portEnvCandidates = [
        path.join(installDir, 'port.env'),
        path.join(installDir, 'launcher', 'port.env')
      ]
      for (const pe of portEnvCandidates) {
        if (fs.existsSync(pe)) {
          try {
            const lines = fs.readFileSync(pe, 'utf-8').split('\n')
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || trimmed.startsWith('#')) continue
              const match = trimmed.match(/^([A-Z_]+)\s*=\s*["']?(.*?)["']?$/)
              if (match) {
                if (match[1] === 'PORT_SLUG') portSlug = match[2].trim()
                if (match[1] === 'PORT_TITLE_ID' && !titleId) titleId = match[2].trim()
              }
            }
            break
          } catch {
            // Ignore
          }
        }
      }

      // Fallback heuristics for slug
      const combined = `${recipe.title} ${recipe.repoFullName}`.toLowerCase()
      if (!portSlug) {
        if (combined.includes('infamous') || combined.includes('iss_pc')) portSlug = 'infamous'
        else if (combined.includes('last guardian') || combined.includes('tlg')) portSlug = 'tlg'
        else if (combined.includes('god of war') || combined.includes('gow3')) portSlug = 'gow3'
        else if (combined.includes('gravity')) portSlug = 'gravity'
        else if (combined.includes('bloodborne')) portSlug = 'bloodborne'
      }

      // 4. Create directory aliases/symlinks (game_dump, TITLE_ID, ../TITLE_ID)
      const gdLink = path.join(installDir, 'game_dump')
      if (path.resolve(gdLink) !== path.resolve(dumpDir)) {
        this.linkDirectory(dumpDir, gdLink, log)
      }

      if (titleId) {
        const titleLinkInInstall = path.join(installDir, titleId)
        if (path.resolve(titleLinkInInstall) !== path.resolve(dumpDir)) {
          this.linkDirectory(dumpDir, titleLinkInInstall, log)
        }
        const titleLinkInParent = path.join(installDir, '..', titleId)
        if (!fs.existsSync(titleLinkInParent)) {
          try {
            this.linkDirectory(dumpDir, titleLinkInParent, log)
          } catch {
            // Ignore if permission denied outside installRoot
          }
        }
      }

      // 5. Update launcher config files with game_dir
      const slugs = new Set<string>()
      if (portSlug) slugs.add(portSlug)
      if (titleId === 'CUSA00223' || combined.includes('iss_pc') || combined.includes('infamous')) {
        slugs.add('infamous')
      }
      if (titleId === 'CUSA03627' || combined.includes('tlg')) slugs.add('tlg')
      if (titleId === 'CUSA01623' || combined.includes('gow3')) slugs.add('gow3')
      if (titleId === 'CUSA01114' || combined.includes('gravity')) slugs.add('gravity')

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
      // Portable configurations
      configPaths.push(path.join(installDir, 'user', 'settings.json'))
      configPaths.push(path.join(installDir, 'settings.json'))

      const installed = typeof this.store.getInstalledGame === 'function' ? this.store.getInstalledGame(game.id) : undefined
      const wantFullscreen = installed?.launchFullscreen !== false
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
          log(`Configuração automática do launcher PS4 aplicada (${path.basename(path.dirname(conf))}: game_dir e display_mode configurados).`)
        } catch {
          // Ignore
        }
      }

      // Sync user/tlg.ini
      const tlgIniPaths = [
        path.join(installDir, 'user', 'tlg.ini'),
        path.join(installDir, 'tlg.ini')
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

      // 6. Helpful version feedback for known requirements (e.g. inFAMOUS 1.07)
      if (titleId === 'CUSA00223' || combined.includes('infamous') || combined.includes('iss_pc')) {
        if (appVer && appVer < '01.07') {
          log(`[AVISO inFAMOUS Second Son] O dump detectado está na versão ${appVer}. O port do inFAMOUS Second Son exige os arquivos do Update 1.07 (eboot.bin e sce_module/libc.prx da 1.07). O launcher foi pré-configurado com a pasta, mas para poder clicar em JOGAR é necessário o Update 1.07 montado sobre a base.`)
        } else {
          log(`[inFAMOUS Second Son] Pasta do jogo PS4 pré-configurada com sucesso (${titleId} v${appVer || '1.07'}).`)
        }
      }
    } catch (err: any) {
      log(`Aviso ao configurar ambiente PS4: ${err?.message}`)
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
