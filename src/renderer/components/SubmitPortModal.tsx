import React, { useState } from 'react'
import {
  X,
  Github,
  Search,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  HardDrive,
  Cpu
} from 'lucide-react'
import { InspectedGitHubRepo, SubmitPortPayload } from '../../shared/types'

interface SubmitPortModalProps {
  isOpen: boolean
  onClose: () => void
}

const CONSOLE_OPTIONS: { label: string; badge: string }[] = [
  { label: 'Nintendo 64', badge: 'N64' },
  { label: 'PlayStation 1', badge: 'PS1' },
  { label: 'PlayStation 2', badge: 'PS2' },
  { label: 'PlayStation 3', badge: 'PS3' },
  { label: 'Xbox 360', badge: 'Xbox 360' },
  { label: 'Nintendo GameCube', badge: 'GameCube' },
  { label: 'Nintendo Wii', badge: 'Wii' },
  { label: 'Nintendo Wii U', badge: 'Wii U' },
  { label: 'Sega Dreamcast', badge: 'Dreamcast' },
  { label: 'Super Nintendo', badge: 'SNES' },
  { label: 'Game Boy Advance', badge: 'GBA' },
  { label: 'PC / Outros', badge: 'PC / Outros' }
]

const TOOLCHAIN_OPTIONS = [
  'Recompilação Estática (N64Recomp)',
  'Recompilação Estática (PSXRecomp)',
  'Recompilação Estática (XenonRecomp)',
  'Descompilação C & Engine libultraship',
  'Descompilação & Port Nativo C/C++',
  'Reimplementação de Engine / Engine Moderna',
  'Port Nativo C/C++ Recompilado'
]

export const SubmitPortModal: React.FC<SubmitPortModalProps> = ({
  isOpen,
  onClose
}) => {
  const [githubUrl, setGithubUrl] = useState('')
  const [isInspecting, setIsInspecting] = useState(false)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [inspectedData, setInspectedData] = useState<InspectedGitHubRepo | null>(null)

  // Form fields
  const [title, setTitle] = useState('')
  const [projectName, setProjectName] = useState('')
  const [selectedConsole, setSelectedConsole] = useState(CONSOLE_OPTIONS[0])
  const [toolchain, setToolchain] = useState(TOOLCHAIN_OPTIONS[0])
  const [description, setDescription] = useState('')
  const [romExtension, setRomExtension] = useState('.z64')
  const [submittedBy, setSubmittedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [submittedSuccess, setSubmittedSuccess] = useState(false)

  if (!isOpen) return null

  const handleInspect = async (): Promise<void> => {
    if (!githubUrl.trim()) return
    setIsInspecting(true)
    setInspectError(null)

    try {
      const data = await window.api.inspectGitHubRepoForPort(githubUrl.trim())
      setInspectedData(data)
      setTitle(data.title || data.repo)
      setProjectName(data.projectName || data.repo)
      setDescription(data.description || '')

      const matchedConsole = CONSOLE_OPTIONS.find(
        (c) => c.badge === data.suggestedConsoleBadge
      )
      if (matchedConsole) {
        setSelectedConsole(matchedConsole)
        if (matchedConsole.badge === 'N64') setRomExtension('.z64')
        else if (matchedConsole.badge === 'PS1' || matchedConsole.badge === 'PS2') setRomExtension('.iso')
        else if (matchedConsole.badge === 'Xbox 360') setRomExtension('.iso')
      }

      if (data.suggestedToolchain) {
        setToolchain(data.suggestedToolchain)
      }
    } catch (err: any) {
      setInspectError(err?.message || 'Erro ao inspecionar repositório no GitHub.')
    } finally {
      setIsInspecting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!githubUrl.trim() || !title.trim() || !projectName.trim()) return

    const payload: SubmitPortPayload = {
      githubUrl: githubUrl.trim(),
      title: title.trim(),
      projectName: projectName.trim(),
      console: selectedConsole.label,
      consoleBadge: selectedConsole.badge,
      description: description.trim() || `Port de ${title} para PC.`,
      toolchainType: toolchain,
      howItWorks: `Port desenvolvido com ${toolchain} para execução nativa no PC.`,
      highlights: ['Execução Nativa', 'Suporte a Controles'],
      romExtension: romExtension.trim() || undefined,
      submittedBy: submittedBy.trim() || undefined,
      notes: notes.trim() || undefined
    }

    const issueUrl = await window.api.generateCommunityIssueUrl(payload)
    await window.api.openExternalUrl(issueUrl)
    setSubmittedSuccess(true)
  }

  const handleResetAndClose = (): void => {
    setGithubUrl('')
    setInspectedData(null)
    setInspectError(null)
    setSubmittedSuccess(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-[#171f2a] border border-[#2e435a] rounded-[4px] shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-4 bg-[#121922] border-b border-[#28384b] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[3px] bg-[#1a9fff]/20 border border-[#1a9fff]/40 flex items-center justify-center text-[#67c1f5]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Sugerir Novo Port da Comunidade
              </h2>
              <p className="text-[11px] text-[#8f98a0]">
                Indique um projeto do GitHub para ser avaliado e adicionado ao RecompHUB
              </p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="text-[#8f98a0] hover:text-white p-1 rounded hover:bg-[#1e2a38] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submittedSuccess ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#1e3b26] border border-[#3b754b] text-[#6cc034] mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">
              Sugestão Aberta no GitHub com Sucesso!
            </h3>
            <p className="text-xs text-[#c7d5e0] max-w-md mx-auto leading-relaxed">
              A página da Issue foi aberta no seu navegador. Os mantenedores do RecompHUB irão analisar os arquivos e, ao adicionarem a etiqueta <strong className="text-[#67c1f5] font-mono">approved</strong>, o port entrará automaticamente no ar para todos os usuários!
            </p>
            <div className="pt-2">
              <button
                onClick={handleResetAndClose}
                className="steam-btn-blue px-6 py-2 rounded-[2px] text-xs font-bold uppercase tracking-wider text-white shadow"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs text-[#c7d5e0]">
            {/* Step 1: URL input */}
            <div className="space-y-1.5">
              <label className="font-bold text-white uppercase text-[11px] flex items-center gap-1.5">
                <Github className="w-3.5 h-3.5 text-[#67c1f5]" />
                <span>Link do Repositório no GitHub</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  required
                  placeholder="https://github.com/autor/nome-do-port"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={handleInspect}
                  disabled={isInspecting || !githubUrl.trim()}
                  className="px-4 py-2 bg-[#253648] hover:bg-[#324961] disabled:opacity-50 text-white font-bold uppercase text-[11px] tracking-wider rounded-[2px] flex items-center gap-1.5 shrink-0"
                >
                  {isInspecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5 text-[#67c1f5]" />
                  )}
                  <span>Analisar Repositório</span>
                </button>
              </div>
              <p className="text-[10px] text-[#8f98a0]">
                O aplicativo inspecionará as releases e preencherá os dados automaticamente para você.
              </p>
            </div>

            {inspectError && (
              <div className="p-3 bg-[#441a1a] border border-[#7a2e2e] rounded-[2px] text-xs text-red-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" />
                <span>{inspectError}</span>
              </div>
            )}

            {inspectedData && (
              <div className="space-y-2">
                <div className="p-3 bg-[#111c27] border border-[#233a52] rounded-[2px] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#67c1f5]">
                      ✓ Dados Detectados do Repositório
                    </span>
                    <span className="font-mono text-[10px] text-[#8f98a0]">
                      ⭐ {inspectedData.stars} estrelas • {inspectedData.hasReleases ? 'Releases disponíveis' : 'Sem releases públicas'}
                    </span>
                  </div>
                  {inspectedData.latestTagName && (
                    <div className="text-[11px] text-[#c7d5e0]">
                      Última Release: <strong className="text-white font-mono">{inspectedData.latestTagName}</strong> ({inspectedData.assets.length} arquivos anexados)
                    </div>
                  )}
                  {inspectedData.detectedPlatforms.length > 0 && (
                    <div className="text-[10px] text-[#8f98a0] flex items-center gap-1.5">
                      <span>Plataformas detectadas nos binários:</span>
                      <span className="text-[#6cc034] font-semibold">
                        {inspectedData.detectedPlatforms.join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                {!inspectedData.hasReleases && (
                  <div className="p-3 bg-[#241a12] border border-[#6b4718] rounded-[2px] text-xs text-[#ffc875] flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-[#e5a93c] shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-bold text-[#ffc875]">Aviso: Repositório sem releases públicas</div>
                      <p className="text-[11px] text-[#decab0] leading-relaxed">
                        Este projeto no GitHub ainda não publicou arquivos executáveis (.zip / .exe) na aba Releases. Você ainda pode enviar a sugestão para a comunidade, mas para o jogo ser instalado com 1 clique no RecompHUB, os desenvolvedores precisarão criar uma Release no GitHub.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Form fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-[#223040]">
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                  Nome do Jogo Original
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Super Mario 64"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                  Nome do Projeto do Port
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: sm64-port"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                  Plataforma / Console Original
                </label>
                <select
                  value={selectedConsole.badge}
                  onChange={(e) => {
                    const opt = CONSOLE_OPTIONS.find((c) => c.badge === e.target.value)
                    if (opt) {
                      setSelectedConsole(opt)
                      if (opt.badge === 'N64') setRomExtension('.z64')
                      else if (opt.badge === 'PS1' || opt.badge === 'PS2') setRomExtension('.iso')
                    }
                  }}
                  className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none"
                >
                  {CONSOLE_OPTIONS.map((c) => (
                    <option key={c.badge} value={c.badge}>
                      {c.label} ({c.badge})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                  Tipo de Arquivo Exigido da ROM / ISO
                </label>
                <input
                  type="text"
                  placeholder="Ex: .z64, .iso, .bin"
                  value={romExtension}
                  onChange={(e) => setRomExtension(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                Toolchain / Método do Port
              </label>
              <select
                value={toolchain}
                onChange={(e) => setToolchain(e.target.value)}
                className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none"
              >
                {TOOLCHAIN_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                Breve Descrição do Port & Recursos
              </label>
              <textarea
                rows={2}
                placeholder="Explique resumidamente o que é este port e seus recursos principais (60 FPS, widescreen, etc.)."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none resize-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                  Seu Usuário do GitHub (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="@seu_usuario"
                  value={submittedBy}
                  onChange={(e) => setSubmittedBy(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#96a0aa]">
                  Observações Extras (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Instruções ou dependências específicas"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#10161f] border border-[#2b3c4f] focus:border-[#1a9fff] rounded-[2px] text-white outline-none"
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-[#223040]">
              <div className="text-[10px] text-[#8f98a0]">
                A submissão abrirá uma Issue oficial pré-preenchida no GitHub do RecompHUB.
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetAndClose}
                  className="px-4 py-2 bg-[#253241] hover:bg-[#314256] text-white font-bold uppercase text-[11px] tracking-wider rounded-[2px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!githubUrl.trim() || !title.trim()}
                  className="steam-btn-blue px-5 py-2 text-white font-bold uppercase text-[11px] tracking-wider rounded-[2px] shadow flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span>Enviar para Aprovação</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
