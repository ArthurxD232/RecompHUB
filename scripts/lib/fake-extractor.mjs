// "pkg_extractor" falso para os testes: um script que imita o comportamento do PKG Extractor real
// (ShadPs4Plus), conforme o código dele:
//   pkg_extractor <pkg> <destino>
//   - grava em <destino>/<TITLE_ID> (base), <destino>/<TITLE_ID>-patch ou <destino>/<TITLE_ID>/<rótulo> (DLC)
//   - imprime "\r      Extracting file X of N" e termina com "THE END"
//   - SAI COM CÓDIGO 0 MESMO QUANDO FALHA ("Cannot open/extract PKG file : motivo")
//   - com um arquivo que não é PKG só diz que "doesn't appear to be a valid PKG file"
// Não decifra nada: quem diz o que cada PKG "contém" é o manifesto. O que se testa é a orquestração
// do RecompHUB (ordem, pastas, patch por cima, DLC, mods, falhas), não a criptografia.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT = `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'))
const [pkg, dest] = process.argv.slice(2)
const out = (s) => process.stdout.write(s)
const entry = pkg && fs.existsSync(pkg) ? manifest[path.basename(pkg)] : undefined
if (!entry) {
  out('"' + (pkg || '') + '" doesn\\'t appear to be a valid PKG file\\n\\nTHE END ' + (pkg || '') + '\\n')
  process.exit(0)
}
fs.appendFileSync(path.join(__dirname, 'calls.log'), path.basename(pkg) + '\\n')
out('"' + pkg + '" is a valid PKG\\n\\n')
if (entry.failure === 'open') {
  out('Cannot open PKG file : chave invalida\\n')
} else if (entry.failure === 'exit') {
  out('algo deu muito errado\\n')
  process.exit(3)
} else {
  out('pkg is a game\\nExtracting pkg to "' + path.join(dest, entry.dir) + '"\\n')
  if (entry.failure === 'extract') {
    out('Cannot extract PKG file : disco cheio\\n')
  } else if (entry.failure !== 'silent') {
    const names = Object.keys(entry.files)
    names.forEach((rel, i) => {
      out('\\r      Extracting file ' + (i + 1) + ' of ' + names.length)
      const target = path.join(dest, entry.dir, rel)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, entry.files[rel])
      if (entry.delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, entry.delayMs)
    })
  }
}
out('\\nTHE END ' + pkg + '\\n')
`

/**
 * Cria o extrator falso em `dir` e devolve o caminho dele.
 * manifest: { "<nome do .pkg>": { dir, files: { "relativo": "conteúdo" }, failure?: 'open'|'extract'|'silent'|'exit', delayMs?: number } }
 * Cada PKG processado entra em <dir>/calls.log (uma linha por chamada, na ordem).
 */
export function writeFakeExtractor(dir, manifest, name = 'pkg_extractor') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'calls.log'), '')
  const file = join(dir, name)
  writeFileSync(file, SCRIPT)
  chmodSync(file, 0o755)
  return file
}
