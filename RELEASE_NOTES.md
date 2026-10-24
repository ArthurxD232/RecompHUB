# RecompHUB beta-0.1 🎮

Primeira versão pública do **RecompHUB** – o launcher que deixa os jogos descompilados e recompilados do PC prontos para jogar em 1 clique.

## 💙 Créditos

Catálogo de jogos fornecido pelo **[PortsDR.com](https://portsdr.com/)**, criado por **TinSoldier97**. Obrigado por reunir e organizar todos esses ports da comunidade! Os jogos pertencem aos seus respectivos autores e projetos.

## ✨ O que tem nesta versão

- 🌐 **Nova Aba Comunidade**: Descubra ports independentes criados por desenvolvedores da comunidade (ex: *Jak and Daxter OpenGOAL*, *Super Mario 64 PC Port*, *Sonic Mania Decompilation*, *Rayman 2 PC* e muito mais).
- 🤝 **Submissão Direta de Novos Ports**: Qualquer pessoa pode colar o link do repositório no GitHub. O RecompHUB inspeciona o repositório automaticamente, detecta plataformas suportadas, releases e assets, e gera a proposta para aprovação dos mantenedores.
- ⚡ **Aprovação Automática GitOps (GitHub Actions)**: Quando um mantenedor adiciona a label `approved` na Issue, a Action insere o port no catálogo oficial sem necessidade de deploy de servidor.
- 🔄 **Sincronização em Tempo Real**: Usuários existentes recebem ports aprovados instantaneamente na aba Comunidade sem precisar reinstalar o aplicativo.
- 📚 **Catálogo automático** puxado do PortsDR.com (jogos novos aparecem sozinhos)
- 🗂️ **Agrupamento de múltiplos ports**: Jogos repetidos (como *Majora's Mask*, *Banjo-Kazooie*, *Crash Team Racing*, *GoldenEye 007*) agora ficam juntos em um único card limpo com seletor de versões
- 🔍 **Comparativo & Tecnologias dos Ports**: Mostra visualmente o que cada port é, como foi feito (Recompilação Estática via N64Recomp/XenonRecomp/PSXRecomp vs Descompilação & libultraship vs Nativo) e seus pontos fortes (144+ FPS, Ray Tracing RT64, Mods, etc.)
- 💻 **Foco Desktop PC**: Filtramos os ports exclusivos de Android para que o launcher de computador fique 100% focado no PC
- ⬇️ **Instalação em 1 clique** direto do GitHub oficial de cada port
- 💿 **Use a sua própria ISO/ROM** – arquivo direto ou compactado (.zip / .7z / .rar) com descompactação automática
- 🔍 **Reconhecimento automático da ROM** pelo hash (mesmo com outro nome) e conversão automática para Big-Endian (.z64)
- ⚙️ **Configuração automática** de cada jogo (nome da ROM, modo portátil, extratores de assets como .o2r/.otr)
- 🐧 **Jogos de Windows rodam no Linux** via Proton / umu-run automaticamente
- 📊 **Progresso na aba Downloads** (download, descompactação e instalação)
- 🖥️ **Botão de tela cheia** para jogos compatíveis (F11 / Alt+Enter)
- 🗑️ **Desinstalar de verdade** – opção de apagar também a ISO/ROM do computador para liberar espaço
- 🎨 Interface rápida e moderna no estilo Steam

## ⚠️ Importante

O RecompHUB **não baixa ISOs nem ROMs**. Você precisa ter a sua própria cópia do jogo.

## 📥 Qual arquivo baixar?

| Sistema | Arquivo |
|---|---|
| Linux (recomendado) | `RecompHUB-beta-0.1-linux-x86_64.AppImage` |
| Linux (alternativo) | `RecompHUB-beta-0.1-linux-x64.tar.gz` |
| Windows (sem instalar) | `RecompHUB-beta-0.1-win-x64.exe` |
| Windows (zip) | `RecompHUB-beta-0.1-win-x64.zip` |

No Linux: `chmod +x RecompHUB-beta-0.1-linux-x86_64.AppImage` e depois abra.

## 🐞 Versão beta

Alguns jogos ainda podem precisar de ajustes. Encontrou um problema? Abra uma Issue dizendo o jogo, seu sistema e o que aconteceu.
