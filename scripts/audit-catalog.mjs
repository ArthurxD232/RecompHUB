// Auditoria "a seco" do catálogo do PortsDR: node scripts/audit-catalog.mjs [--layout] [--limit N] [--out relatorio.json]
//
// Para cada jogo do catálogo ele reproduz, SEM baixar jogos nem ROMs, o que o RecompHUB faria na instalação:
//   1. interpreta o HTML do PortsDR com o mesmo parser do app (CatalogService.parsePortsDR);
//   2. lê a lista de arquivos da release anunciada (página pública expanded_assets, sem limite de API);
//   3. roda o seletor de assets (src/main/services/asset-selector.ts) para Windows e para Linux;
//   4. com --layout: lê só o "índice" (diretório central) dos .zip escolhidos por requisição parcial
//      e confere se existe executável, se há pacote dentro de pacote e se o nome é plausível.
// O que NÃO dá para verificar daqui: abrir o jogo de verdade (precisa da sua ISO/ROM, GPU e, no Linux, do Proton).
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const DO_LAYOUT = flag('--layout')
const LIMIT = Number(opt('--limit') || 0)
const OUT = opt('--out')
const CONCURRENCY = Number(opt('--concurrency') || 6)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'recomphub-audit-'))

async function bundle(entry, name) {
  const outfile = join(tmp, name)
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'error',
    loader: { '.json': 'json' }
  })
  return import(pathToFileURL(outfile).href)
}

const { selectBestAsset } = await bundle('src/main/services/asset-selector.ts', 'asset-selector.mjs')
const { CatalogService } = await bundle('src/main/services/catalog.service.ts', 'catalog.service.mjs')
rmSync(tmp, { recursive: true, force: true })

const UA = 'RecompHub-Audit/1.0 (+https://github.com/ArthurxD232/RecompHUB)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.ok) return res.text()
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (i + 1))
      continue
    }
    throw new Error(`HTTP ${res.status}`)
  }
  throw new Error('limite de requisições do GitHub')
}

/** Lista os arquivos de uma release pela página pública (não consome a cota da API). */
async function listReleaseAssets(releaseUrl) {
  const m = releaseUrl.match(/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/([^?#]+)/)
  if (!m) return { error: 'link de release sem tag' }
  const [, repo, tag] = m
  let html
  try {
    html = await fetchText(`https://github.com/${repo}/releases/expanded_assets/${tag}`)
  } catch (err) {
    return { error: `release inacessível (${err.message})` }
  }
  const assets = []
  const re = /href="(\/[^"]+\/releases\/download\/[^"]+)"[\s\S]*?(?=href="\/[^"]+\/releases\/download\/|$)/g
  let block
  while ((block = re.exec(html))) {
    const href = block[1]
    const name = decodeURIComponent(href.split('/').pop())
    const sizeMatch = block[0].match(/([\d.]+)\s*(KB|MB|GB)/i)
    const size = sizeMatch
      ? Math.round(parseFloat(sizeMatch[1]) * { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[sizeMatch[2].toLowerCase()])
      : 0
    assets.push({ name, browserDownloadUrl: `https://github.com${href}`, size, contentType: '' })
  }
  return { assets }
}

/** Lê o diretório central de um .zip por requisições parciais (sem baixar o arquivo). */
async function listZip(url) {
  const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' })
  if (!head.ok) throw new Error(`HTTP ${head.status}`)
  const size = Number(head.headers.get('content-length') || 0)
  const finalUrl = head.url
  const range = async (a, b) => {
    const r = await fetch(finalUrl, { headers: { 'User-Agent': UA, Range: `bytes=${a}-${b}` } })
    if (!(r.status === 206 || r.status === 200)) throw new Error(`HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  const tail = await range(Math.max(0, size - 66000), size - 1)
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('zip inválido')
  let cdSize = tail.readUInt32LE(eocd + 12)
  let cdOffset = tail.readUInt32LE(eocd + 16)
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip64 (pulado)')
  const cd = await range(cdOffset, cdOffset + cdSize - 1)
  const names = []
  let p = 0
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    names.push(cd.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/'))
    p += 46 + nameLen + extraLen + commentLen
  }
  return { size, names }
}

function analyzeLayout(names) {
  const files = names.filter((n) => !n.endsWith('/'))
  const exes = files.filter((n) => /\.exe$/i.test(n) && !/(unins|uninstall|vc_?redist|crashpad|dxsetup|extract-xiso)/i.test(n))
  const nested = files.filter((n) => /\.(zip|7z|rar|tar\.gz|tgz|tar\.xz)$/i.test(n))
  const installers = exes.filter((n) => /(setup|install)/i.test(n))
  const depth = (n) => n.split('/').length
  exes.sort((a, b) => depth(a) - depth(b))
  // Sem .exe, o app usa scripts .bat/.cmd de início no Windows (mesma regra do RecipeService)
  const scripts = files
    .filter((n) => /\.(bat|cmd)$/i.test(n) && !/(setup|install|uninstall|update|optional|debug|build|clean)/i.test(n))
    .sort((a, b) => depth(a) - depth(b))
  return { fileCount: files.length, exes, nested, installers, mainExe: exes[0] || scripts[0] || null }
}

// ---------------------------------------------------------------------------------------
console.log('Lendo o catálogo do PortsDR...')
const html = await fetchText('https://portsdr.com/')
const service = new CatalogService({})
let games = service.parsePortsDR(html)
if (LIMIT > 0) games = games.slice(0, LIMIT)
console.log(`${games.length} ports de PC no catálogo${LIMIT ? ` (limitado a ${LIMIT})` : ''}\n`)

const hosts = {
  windows: { platform: 'win32', arch: 'x64', preferNativeLinux: true },
  linux: { platform: 'linux', arch: 'x64', preferNativeLinux: true },
  proton: { platform: 'linux', arch: 'x64', preferNativeLinux: false }
}

const results = []
let cursor = 0
let done = 0

async function auditGame(game) {
  const r = {
    id: game.id,
    title: game.title,
    project: game.projectName,
    console: game.consoleBadge,
    repo: game.repoFullName,
    release: game.releaseUrl || null,
    problems: [],
    picks: {}
  }

  if (!game.releaseUrl) {
    r.problems.push('sem-release: o PortsDR lista só o código-fonte')
    return r
  }

  const listing = await listReleaseAssets(game.releaseUrl)
  if (listing.error) {
    r.problems.push(`release: ${listing.error}`)
    return r
  }
  if (listing.assets.length === 0) {
    r.problems.push('release-vazia: nenhum arquivo anexado')
    return r
  }
  r.assetCount = listing.assets.length

  for (const [key, host] of Object.entries(hosts)) {
    const sel = selectBestAsset(listing.assets, host)
    const entry = { asset: sel.asset?.name || null, size: sel.asset?.size || 0, compat: sel.requiresCompatibilityLayer }
    if (!sel.asset) {
      r.problems.push(`${key}: nenhum binário utilizável`)
    } else if (/(setup|installer)/i.test(sel.asset.name)) {
      r.problems.push(`${key}: o arquivo escolhido parece um instalador (${sel.asset.name})`)
    }
    if (DO_LAYOUT && sel.asset && /\.zip$/i.test(sel.asset.name) && key !== 'proton') {
      try {
        const { names } = await listZip(sel.asset.browserDownloadUrl)
        const layout = analyzeLayout(names)
        entry.layout = { files: layout.fileCount, mainExe: layout.mainExe, nested: layout.nested.slice(0, 3) }
        const wantExe = key === 'windows' || sel.requiresCompatibilityLayer
        if (wantExe && !layout.mainExe) {
          r.problems.push(
            layout.nested.length
              ? `${key}: o zip só contém pacote(s) internos (${layout.nested[0]})`
              : `${key}: o zip não contém .exe`
          )
        }
        if (wantExe && layout.mainExe && layout.installers.length && layout.mainExe === layout.installers[0]) {
          r.problems.push(`${key}: o único executável é um instalador (${layout.mainExe})`)
        }
      } catch (err) {
        entry.layoutError = err.message
      }
    }
    r.picks[key] = entry
  }
  return r
}

async function worker() {
  while (cursor < games.length) {
    const game = games[cursor++]
    try {
      results.push(await auditGame(game))
    } catch (err) {
      results.push({ id: game.id, title: game.title, repo: game.repoFullName, problems: [`erro: ${err.message}`], picks: {} })
    }
    done++
    if (done % 25 === 0) console.log(`  ${done}/${games.length}...`)
    await sleep(120)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

// ---------------------------------------------------------------------------------------
results.sort((a, b) => a.title.localeCompare(b.title))
const ok = results.filter((r) => r.problems.length === 0)
const bad = results.filter((r) => r.problems.length > 0)

const byCategory = {}
for (const r of bad) {
  for (const p of r.problems) {
    const cat = p.replace(/^(windows|linux|proton): /, '').split(/[:(]/)[0].trim()
    byCategory[cat] = (byCategory[cat] || 0) + 1
  }
}

console.log('\n================ RESUMO ================')
console.log(`Total auditado: ${results.length}`)
console.log(`Sem nenhum problema detectado: ${ok.length}`)
console.log(`Com algum problema: ${bad.length}`)
console.log('Problemas por tipo:')
for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${cat}`)

console.log('\n---- Detalhes dos problemas ----')
for (const r of bad) {
  console.log(`• ${r.title} [${r.console}] — ${r.project}`)
  for (const p of r.problems) console.log(`    - ${p}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), layout: DO_LAYOUT, results }, null, 2))
  console.log(`\nRelatório completo salvo em ${OUT}`)
}
