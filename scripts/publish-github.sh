#!/usr/bin/env bash
# Publica o RecompHUB no GitHub: cria o repositório, envia o código e cria a release beta-0.1
# com todos os arquivos de ./release anexados.
#
# Uso:
#   GITHUB_TOKEN=ghp_xxx ./scripts/publish-github.sh
#
# O token precisa da permissão "repo" (classic) ou "Contents: Read and write" +
# "Administration: Read and write" (fine-grained).
set -euo pipefail

OWNER="${GITHUB_OWNER:-ArthurxD232}"
REPO="${GITHUB_REPO:-RecompHUB}"
TAG="${RELEASE_TAG:-beta-0.1}"
RELEASE_NAME="RecompHUB beta-0.1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="https://api.github.com"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Erro: defina GITHUB_TOKEN. Ex.: GITHUB_TOKEN=ghp_xxx $0" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "==> Verificando repositório ${OWNER}/${REPO}..."
status=$(curl -s -o /dev/null -w "%{http_code}" "${auth[@]}" "${API}/repos/${OWNER}/${REPO}")
if [[ "$status" == "404" ]]; then
  echo "==> Criando repositório ${REPO}..."
  curl -sf "${auth[@]}" -X POST "${API}/user/repos" -d @- >/dev/null <<EOF
{
  "name": "${REPO}",
  "description": "Launcher 1-Click para jogar jogos descompilados e recompilados no PC (catálogo PortsDR.com por TinSoldier97). Linux & Windows.",
  "homepage": "https://portsdr.com/",
  "private": false,
  "has_issues": true
}
EOF
fi

echo "==> Enviando código (branch main + tag ${TAG})..."
cd "$ROOT"
remote_url="https://x-access-token:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git"
git push "$remote_url" main
# --force: se a tag já existir no GitHub (publicação anterior), ela é movida para o commit atual.
git push --force "$remote_url" "refs/tags/${TAG}"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${OWNER}/${REPO}.git"

echo "==> Criando release ${TAG}..."
body=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1],encoding="utf-8").read()))' "$ROOT/RELEASE_NOTES.md")
release_json=$(curl -s "${auth[@]}" "${API}/repos/${OWNER}/${REPO}/releases/tags/${TAG}")
release_id=$(echo "$release_json" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))')
if [[ -z "$release_id" ]]; then
  release_json=$(curl -sf "${auth[@]}" -X POST "${API}/repos/${OWNER}/${REPO}/releases" -d @- <<EOF
{
  "tag_name": "${TAG}",
  "name": "${RELEASE_NAME}",
  "body": ${body},
  "draft": false,
  "prerelease": true
}
EOF
)
  release_id=$(echo "$release_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
else
  echo "==> Release já existe (id ${release_id}), atualizando notas..."
  curl -sf "${auth[@]}" -X PATCH "${API}/repos/${OWNER}/${REPO}/releases/${release_id}" -d @- >/dev/null <<EOF
{
  "name": "${RELEASE_NAME}",
  "body": ${body},
  "prerelease": true
}
EOF
fi

echo "==> Enviando arquivos da release..."
# Lista dos arquivos já anexados (nome<TAB>id), para substituir versões antigas.
existing_assets=$(curl -sf "${auth[@]}" "${API}/repos/${OWNER}/${REPO}/releases/${release_id}/assets?per_page=100" \
  | python3 -c 'import json,sys;[print(a["name"]+"\t"+str(a["id"])) for a in json.load(sys.stdin)]')
for f in "$ROOT"/release/RecompHUB-beta-0.1-* "$ROOT"/release/SHA256SUMS.txt; do
  [[ -f "$f" ]] || continue
  name=$(basename "$f")
  old_id=$(printf '%s\n' "$existing_assets" | awk -F'\t' -v n="$name" '$1==n{print $2}')
  if [[ -n "$old_id" ]]; then
    echo "    - removendo versão antiga de ${name}"
    curl -sf "${auth[@]}" -X DELETE "${API}/repos/${OWNER}/${REPO}/releases/assets/${old_id}" >/dev/null || true
  fi
  echo "    - enviando ${name}"
  curl -sf "${auth[@]}" -H "Content-Type: application/octet-stream" \
    --data-binary @"$f" \
    "https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release_id}/assets?name=${name}" >/dev/null \
    || echo "      (falhou ao enviar ${name})"
done

echo ""
echo "✅ Pronto! https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}"
