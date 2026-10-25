# RecompHUB beta-0.2 🎮

Segunda versão beta do **RecompHUB** – o launcher que deixa os jogos descompilados e recompilados do PC prontos para jogar em 1 clique. Esta versão traz a aba **Comunidade** com ports reais, um visual novo no estilo da Steam, abertura mais rápida no Windows e uma instalação bem mais segura.

## 💙 Créditos

Catálogo de jogos fornecido pelo **[PortsDR.com](https://portsdr.com/)**, criado por **TinSoldier97**. Obrigado por reunir e organizar todos esses ports da comunidade! Os jogos pertencem aos seus respectivos autores e projetos.

## 🆕 Novidades da beta-0.2

- 🌐 **Aba Comunidade com ports reais**: ports do GitHub que ainda não estão no PortsDR, com release pronta para Windows/Linux — *Metroid Prime Port* (GameCube), *Conker's Bad Fur Day: Reloaded*, *Body Harvest: Recompiled* e *BattleTanx: Global Assault* (N64) e *Sonic CD (RSDKv3)*. Só entram recompilações, descompilações e ports nativos de jogos; a ISO/ROM é sempre sua.
- 🤝 **Sugestão de novos ports**: cole o link do repositório, o RecompHUB inspeciona releases e plataformas e gera a proposta; quando um mantenedor adiciona a label `approved`, a GitHub Action publica o port para todo mundo.
- 🎨 **Visual renovado no estilo da Steam**: destaque rotativo no catálogo, cards em cápsula, barra lateral estilo biblioteca, capas geradas quando o port não tem imagem, foco visível para teclado e suporte a "reduzir movimento". A grade carrega aos poucos e continua fluida com centenas de jogos.
- ⚡ **Abertura mais rápida no Windows**: o `.exe` portátil agora é gravado sem compressão (descompacta bem mais rápido) e sem idiomas do Chromium que o app não usa. Novo **instalador** `...-Setup.exe` (sem administrador) que abre tão rápido quanto o `.zip`.
- 🧰 **Instalação mais segura**: o app não escolhe mais ZIP de macOS ou Linux no Windows, nem pacotes de "notices/update"; ports só de iOS, Switch ou macOS deixam de aparecer na lista; pacotes dentro de pacotes (ex.: `linux.tar.gz` dentro de um `.zip`) são extraídos; scripts `.bat` são usados quando o port não tem `.exe`; e o app avisa quando o port usa instalador próprio.
- 🎯 **ISO/ROM direto no jogo**: ports como *Metroid Prime Port* e *BattleTanx* recebem o caminho da sua ISO/ROM ao iniciar.
- 🔎 **Ferramenta de auditoria do catálogo** (`npm run audit:catalog`): para cada jogo do PortsDR, confere qual arquivo seria instalado e se o pacote tem executável, sem baixar jogos.

## ✨ O que já vinha da beta-0.1

- 📚 **Catálogo automático** puxado do PortsDR.com (jogos novos aparecem sozinhos)
- 🗂️ **Agrupamento de múltiplos ports**: jogos repetidos (como *Majora's Mask*, *Banjo-Kazooie*, *Crash Team Racing*, *GoldenEye 007*) ficam juntos em um único card com seletor de versões
- 🔍 **Comparativo & tecnologias dos ports**: mostra o que cada port é e como foi feito (recompilação estática via N64Recomp/XenonRecomp/PSXRecomp, descompilação & libultraship ou nativo) e seus pontos fortes
- ⬇️ **Instalação em 1 clique** direto do GitHub oficial de cada port
- 💿 **Use a sua própria ISO/ROM** – arquivo direto ou compactado (.zip / .7z / .rar) com descompactação automática
- 🔍 **Reconhecimento automático da ROM** pelo hash (mesmo com outro nome) e conversão automática para Big-Endian (.z64)
- ⚙️ **Configuração automática** de cada jogo (nome da ROM, modo portátil, extratores de assets como .o2r/.otr)
- 🐧 **Jogos de Windows rodam no Linux** via Proton / umu-run automaticamente
- 📊 **Progresso na aba Downloads** (download, descompactação e instalação)
- 🖥️ **Botão de tela cheia** para jogos compatíveis (F11 / Alt+Enter)
- 🗑️ **Desinstalar de verdade** – opção de apagar também a ISO/ROM do computador para liberar espaço

## ⚠️ Importante

O RecompHUB **não baixa ISOs nem ROMs**. Você precisa ter a sua própria cópia do jogo.

## 📥 Qual arquivo baixar?

| Sistema | Arquivo |
|---|---|
| Linux (recomendado) | `RecompHUB-beta-0.2-linux-x86_64.AppImage` |
| Linux (alternativo) | `RecompHUB-beta-0.2-linux-x64.tar.gz` |
| Windows (instalador, **abre mais rápido**) | `RecompHUB-beta-0.2-win-x64-Setup.exe` |
| Windows (sem instalar, único arquivo) | `RecompHUB-beta-0.2-win-x64.exe` |
| Windows (zip) | `RecompHUB-beta-0.2-win-x64.zip` |

No Linux: `chmod +x RecompHUB-beta-0.2-linux-x86_64.AppImage` e depois abra.

## 🐞 Versão beta

Alguns jogos ainda podem precisar de ajustes. Por enquanto, cerca de 8 ports do PortsDR são distribuídos com instalador próprio (o app avisa: depois de instalar, use o botão de engrenagem para escolher o executável), e alguns só têm release para outro sistema ou só `.msi`. Encontrou um problema? Abra uma Issue dizendo o jogo, seu sistema e o que aconteceu.
