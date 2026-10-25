import React, { useEffect, useState } from 'react'
import {
  HardDrive,
  FolderSearch,
  RefreshCw,
  Terminal,
  Key,
  CheckCircle2,
  Archive,
  Trash2
} from 'lucide-react'
import {
  AppSettings,
  DetectedLinuxRunner,
  RomVaultEntry
} from '../../shared/types'

interface SettingsProps {
  settings: AppSettings | null
  vaultEntries: RomVaultEntry[]
  scanProgress: { current: number; total: number; currentFile: string } | null
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>
  onScanVault: (customDir?: string) => Promise<void>
  onVaultChanged: () => Promise<void>
}

export const Settings: React.FC<SettingsProps> = ({
  settings,
  vaultEntries,
  scanProgress,
  onUpdateSettings,
  onScanVault,
  onVaultChanged
}) => {
  const [detectedRunners, setDetectedRunners] = useState<DetectedLinuxRunner[]>([])
  const [scanning, setScanning] = useState(false)
  const [githubTokenInput, setGithubTokenInput] = useState(
    settings?.githubToken || ''
  )
  const [savedBanner, setSavedBanner] = useState(false)

  useEffect(() => {
    if (settings) {
      setGithubTokenInput(settings.githubToken || '')
    }
  }, [settings?.githubToken])

  useEffect(() => {
    window.api
      .detectLinuxRunners()
      .then((list) => setDetectedRunners(list))
      .catch(() => {})
  }, [])

  if (!settings) {
    return (
      <div className="p-8 text-xs text-[#8f98a0]">
        Carregando configurações...
      </div>
    )
  }

  const handleChooseRomDir = async (): Promise<void> => {
    const dir = await window.api.selectDirectory(
      'Selecionar Pasta Padrão de ROMs / ISOs'
    )
    if (dir) {
      await onUpdateSettings({ romVaultPath: dir })
      setScanning(true)
      try {
        await onScanVault(dir)
      } finally {
        setScanning(false)
      }
    }
  }

  const handleChooseInstallDir = async (): Promise<void> => {
    const dir = await window.api.selectDirectory(
      'Selecionar Pasta de Instalação dos Jogos'
    )
    if (dir) {
      await onUpdateSettings({ installRootPath: dir })
      triggerSavedToast()
    }
  }

  const handleTriggerScan = async (): Promise<void> => {
    setScanning(true)
    try {
      await onScanVault()
    } finally {
      setScanning(false)
    }
  }

  const triggerSavedToast = (): void => {
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 2000)
  }

  return (
    <div className="min-h-full steam-main-gradient p-6 space-y-5 max-w-5xl mx-auto">
      <div className="border-b border-[#2a3846] pb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold uppercase tracking-wider text-white">
            PARÂMETROS E DIRETÓRIOS DO CLIENTE
          </h2>
          <p className="text-xs text-[#8f98a0] mt-0.5">
            Pastas de armazenamento, indexação de ISOs/ROMs locais e camada de compatibilidade Steam Play (Proton / umu-run).
          </p>
        </div>

        {savedBanner && (
          <span className="px-3 py-1 rounded-md bg-[#213a1b] border border-[#457839] text-xs text-[#6cc034] font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Alterações Aplicadas
          </span>
        )}
      </div>

      {/* 1. Storage & Local ISO/ROM Vault */}
      <section className="p-5 rounded-lg bg-[#16202d] border border-[#263649] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#223142] pb-3">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-[#67c1f5]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              ARMAZENAMENTO E COFRE LOCAL DE ISOs / ROMs
            </h3>
          </div>

          <button
            onClick={handleTriggerScan}
            disabled={scanning}
            className="steam-btn-blue px-4 py-1.5 rounded-md text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`}
            />
            <span>{scanning ? 'INDEXANDO...' : 'ESCANEAR PASTA (SHA-1)'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 rounded-md bg-[#101720] border border-[#233244] space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#8f98a0]">
              PASTA PADRÃO DE ISOs / ROMs EXTRAÍDAS
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={settings.romVaultPath}
                className="w-full px-2.5 py-1.5 rounded-md bg-[#16202d] border border-[#2b3c50] text-xs font-mono text-[#c7d5e0]"
              />
              <button
                onClick={handleChooseRomDir}
                className="px-3 py-1.5 rounded-md bg-[#283646] hover:bg-[#35475c] border border-[#3a4d63] text-xs font-semibold text-white flex items-center gap-1.5 shrink-0"
              >
                <FolderSearch className="w-3.5 h-3.5 text-[#67c1f5]" />
                <span>Procurar</span>
              </button>
            </div>
          </div>

          <div className="p-3 rounded-md bg-[#101720] border border-[#233244] space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-[#8f98a0]">
              PASTA DE INSTALAÇÃO DOS JOGOS
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={settings.installRootPath}
                className="w-full px-2.5 py-1.5 rounded-md bg-[#16202d] border border-[#2b3c50] text-xs font-mono text-[#c7d5e0]"
              />
              <button
                onClick={handleChooseInstallDir}
                className="px-3 py-1.5 rounded-md bg-[#283646] hover:bg-[#35475c] border border-[#3a4d63] text-xs font-semibold text-white flex items-center gap-1.5 shrink-0"
              >
                <FolderSearch className="w-3.5 h-3.5 text-[#67c1f5]" />
                <span>Procurar</span>
              </button>
            </div>
          </div>
        </div>

        {scanProgress && scanning && (
          <div className="p-3 rounded-md bg-[#101c28] border border-[#24435e] space-y-1.5">
            <div className="flex items-center justify-between text-xs text-[#67c1f5]">
              <span>Verificando SHA-1: {scanProgress.currentFile}</span>
              <span className="font-mono">
                {scanProgress.current} / {scanProgress.total}
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#0b1118] overflow-hidden">
              <div
                className="h-full bg-[#1a9fff] transition-all"
                style={{
                  width: `${Math.round(
                    (scanProgress.current / Math.max(1, scanProgress.total)) *
                      100
                  )}%`
                }}
              />
            </div>
          </div>
        )}

        {/* Indexed ROMs List */}
        <div className="rounded-md bg-[#101720] border border-[#233244] overflow-hidden">
          <div className="px-3.5 py-2 bg-[#141d28] border-b border-[#233244] flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#8f98a0]">
            <span>ARQUIVOS DE ISO / ROM VINCULADOS ({vaultEntries.length})</span>
            <span>HASH SHA-1</span>
          </div>
          {vaultEntries.length === 0 ? (
            <div className="p-5 text-center text-xs text-[#67707b]">
              Nenhuma ISO/ROM indexada ainda. Escolha o arquivo da ISO/ROM ou .zip/.7z/.rar diretamente na página de cada jogo.
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto divide-y divide-[#1d2938]">
              {vaultEntries.map((entry) => (
                <div
                  key={entry.filePath}
                  className="px-3.5 py-2 flex items-center justify-between gap-4 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[#dcdedf] truncate flex items-center gap-2">
                      <span>{entry.fileName}</span>
                      {entry.extractedFromArchive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#1d3247] text-[#67c1f5] inline-flex items-center gap-1">
                          <Archive className="w-2.5 h-2.5" />
                          {entry.extractedFromArchive}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#67707b] truncate font-mono">
                      {(entry.size / (1024 * 1024)).toFixed(1)} MB —{' '}
                      {entry.filePath}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px] text-[#6cc034] bg-[#18281c] px-2 py-0.5 rounded-md border border-[#2a4a32]">
                      {entry.sha1.slice(0, 12)}...
                    </span>
                    <button
                      onClick={async () => {
                        await window.api.removeRomVaultEntry(
                          entry.filePath,
                          true
                        )
                        await onVaultChanged()
                      }}
                      title="Excluir esta ISO/ROM do computador e remover do Cofre"
                      className="px-2 py-1 rounded-md bg-[#2a1d1d] hover:bg-[#7a2828] border border-[#522929] text-[10px] font-bold uppercase text-red-200 hover:text-white flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Excluir do PC</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 2. Steam Play / Compatibility Layer */}
      <section className="p-5 rounded-lg bg-[#16202d] border border-[#263649] space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#223142] pb-3">
          <Terminal className="w-4 h-4 text-[#67c1f5]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            COMPATIBILIDADE LINUX (PROTON / UMU-RUN) &amp; EXTRATORES
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#8f98a0]">
              FERRAMENTA DE COMPATIBILIDADE PADRÃO
            </label>
            <select
              value={settings.linuxRunnerType}
              onChange={(e) => {
                onUpdateSettings({
                  linuxRunnerType: e.target.value as AppSettings['linuxRunnerType']
                })
                triggerSavedToast()
              }}
              className="w-full px-3 py-1.5 rounded-md bg-[#101720] border border-[#2b3c50] text-xs text-white"
            >
              <option value="auto">Automático (umu-run → Steam Proton → Wine)</option>
              <option value="umu-run">UMU Launcher (umu-run)</option>
              <option value="proton">Steam Proton Direto</option>
              <option value="wine">Wine do Sistema</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#8f98a0]">
              MÉTODO DE VINCULAÇÃO DA ISO/ROM
            </label>
            <select
              value={settings.linkStrategy}
              onChange={(e) => {
                onUpdateSettings({
                  linkStrategy: e.target.value as AppSettings['linkStrategy']
                })
                triggerSavedToast()
              }}
              className="w-full px-3 py-1.5 rounded-md bg-[#101720] border border-[#2b3c50] text-xs text-white"
            >
              <option value="symlink">Symlink / Hardlink (Instantâneo, sem gastar disco)</option>
              <option value="hardlink">Hardlink (Fallback para cópia)</option>
              <option value="copy">Cópia Física Completa</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#8f98a0]">
              CAMINHO DO PROTON CUSTOMIZADO
            </label>
            <input
              type="text"
              value={settings.customProtonPath}
              onChange={(e) =>
                onUpdateSettings({ customProtonPath: e.target.value })
              }
              placeholder="Auto-detectado nas pastas da Steam"
              className="w-full px-3 py-1.5 rounded-md bg-[#101720] border border-[#2b3c50] text-xs font-mono text-[#c7d5e0]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#8f98a0]">
              EXECUTÁVEL EXTRACT-XISO (XBOX 360)
            </label>
            <input
              type="text"
              value={settings.extractXisoPath}
              onChange={(e) =>
                onUpdateSettings({ extractXisoPath: e.target.value })
              }
              placeholder="extract-xiso"
              className="w-full px-3 py-1.5 rounded-md bg-[#101720] border border-[#2b3c50] text-xs font-mono text-[#c7d5e0]"
            />
          </div>
        </div>

        {detectedRunners.length > 0 && (
          <div className="p-3 rounded-md bg-[#101720] border border-[#233244] space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8f98a0]">
              RUNNERS DETECTADOS NO SISTEMA:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detectedRunners.map((r) => (
                <button
                  key={r.path}
                  onClick={() => {
                    if (r.type === 'proton') {
                      onUpdateSettings({
                        linuxRunnerType: 'proton',
                        customProtonPath: r.path
                      })
                    } else {
                      onUpdateSettings({ linuxRunnerType: r.type })
                    }
                    triggerSavedToast()
                  }}
                  className="px-2.5 py-1 rounded-md bg-[#1d2a38] hover:bg-[#293b4f] border border-[#31465e] text-[11px] text-[#c7d5e0] flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#6cc034]" />
                  <span>{r.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 3. GitHub API Token */}
      <section className="p-5 rounded-lg bg-[#16202d] border border-[#263649] space-y-3">
        <div className="flex items-center gap-2.5 border-b border-[#223142] pb-2.5">
          <Key className="w-4 h-4 text-[#67c1f5]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            TOKEN DE ACESSO GITHUB API (OPCIONAL)
          </h3>
        </div>

        <div className="flex gap-2">
          <input
            type="password"
            value={githubTokenInput}
            onChange={(e) => setGithubTokenInput(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="flex-1 px-3 py-1.5 rounded-md bg-[#101720] border border-[#2b3c50] text-xs font-mono text-white"
          />
          <button
            onClick={() => {
              onUpdateSettings({ githubToken: githubTokenInput })
              triggerSavedToast()
            }}
            className="px-4 py-1.5 rounded-md bg-[#283646] hover:bg-[#35475c] border border-[#3a4d63] text-xs font-bold uppercase text-white"
          >
            Salvar Token
          </button>
        </div>
      </section>
    </div>
  )
}
