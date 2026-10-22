const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')

async function ensureElectron() {
  const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
  const pathTxt = path.join(electronDir, 'path.txt')
  const platformPath = process.platform === 'win32' ? 'electron.exe' : 'electron'
  const binPath = path.join(electronDir, 'dist', platformPath)

  if (fs.existsSync(pathTxt) && fs.existsSync(binPath)) {
    return
  }

  console.log('[RecompHub] Verificando binário do Electron para Node', process.version)
  const { downloadArtifact } = require('@electron/get')
  const pkg = require(path.join(electronDir, 'package.json'))

  const zipPath = await downloadArtifact({
    version: pkg.version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch
  })

  const distDir = path.join(electronDir, 'dist')
  fs.mkdirSync(distDir, { recursive: true })

  const zip = new AdmZip(zipPath)
  zip.extractAllTo(distDir, true)

  if (process.platform !== 'win32' && fs.existsSync(binPath)) {
    fs.chmodSync(binPath, 0o755)
  }

  fs.writeFileSync(pathTxt, platformPath, 'utf-8')
  console.log('[RecompHub] Binário do Electron configurado com sucesso!')
}

ensureElectron().catch((err) => {
  console.error('[RecompHub] Erro ao preparar Electron:', err)
  process.exit(1)
})
