#!/usr/bin/env bash
# Creates the contributor's runner repository and its secrets, in one go.
# Run it yourself, in your own terminal: it opens your browser twice and asks you to paste two
# tokens. The tokens go straight into GitHub's secret store; they are never shown or saved.
set -euo pipefail

HOME_DIR="${AGENTS_CONTRIBUTING_HOME:-$HOME/.agents-contributing}"
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$HOME_DIR/contributor.yml"
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
open_url() { echo "  $1"; (command -v open >/dev/null && open "$1") || (command -v xdg-open >/dev/null && xdg-open "$1") || true; }

[ -f "$CONFIG" ] || { echo "No contributor config at $CONFIG. Ask your agent to finish steps 1 and 2 of the join skill first."; exit 1; }
command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }

step "1/5  GitHub login"
if ! gh auth status >/dev/null 2>&1; then
  echo "Your browser opens to log in to GitHub."
  gh auth login --web --git-protocol https --scopes workflow
elif ! gh auth status 2>&1 | grep -q "workflow"; then
  echo "Your browser opens once more, to allow adding the runner's workflow file."
  gh auth refresh --hostname github.com --scopes workflow
fi
ME=$(gh api user --jq .login)
REPO="$ME/agents-contributing-runner"
echo "  Logged in as $ME."

step "2/5  The runner repository: $REPO"
if gh api "repos/$REPO" >/dev/null 2>&1; then
  echo "  It exists already. Updating its settings and files."
else
  gh repo create "$REPO" --public --description "My agents-contributing runner. Not accepting contributions." \
    --disable-issues --disable-wiki --clone=false >/dev/null
fi
gh repo edit "$REPO" --add-topic agents-contributing-runner --enable-projects=false --enable-discussions=false >/dev/null
gh api -X PUT "repos/$REPO/interaction-limits" -f limit=collaborators_only -f expiry=six_months >/dev/null

put() { # put <path in repo> <local file>: create or update one file
  local sha
  sha=$(gh api "repos/$REPO/contents/$1" --jq .sha 2>/dev/null || true)
  gh api -X PUT "repos/$REPO/contents/$1" -f message="Set up $1" -f content="$(base64 < "$2" | tr -d '\n')" \
    ${sha:+-f sha="$sha"} >/dev/null
}
put README.md "$TOOLS/templates/runner/README.md"
put contributor.yml "$CONFIG"
put .github/workflows/contribute.yml "$TOOLS/templates/runner/.github/workflows/contribute.yml"
gh api "repos/$REPO/contents/contributions.jsonl" >/dev/null 2>&1 || put contributions.jsonl /dev/null
echo "  Done: closed to outside input, with your config, an empty log and a daily workflow."

step "3/5  A GitHub token for the runner"
URL="https://github.com/settings/tokens/new?scopes=public_repo&description=agents-contributing-runner"
echo "Your browser opens a page with everything filled in: only public repositories."
echo "Set an expiration you like, click 'Generate token', and copy it."
open_url "$URL"
read -r -s -p "  Paste the token here (it is not shown): " TOKEN; echo
[ -n "$TOKEN" ] || { echo "No token given."; exit 1; }
printf '%s' "$TOKEN" | gh secret set AGENTS_CONTRIBUTING_GITHUB_TOKEN --repo "$REPO"
unset TOKEN

step "4/5  Your agent's subscription"
PROVIDER_CLI=("$TOOLS/node_modules/.bin/tsx" "$TOOLS/src/cli/provider.ts")
if ! "${PROVIDER_CLI[@]}" ci-secret name "$CONFIG" >/dev/null 2>&1; then
  echo "  Your agent cannot run in GitHub Actions yet (see its README under src/balance/adapters/)."
  echo "  Everything else is ready; run the routine from your agent instead."
else
  SECRET_NAME=$("${PROVIDER_CLI[@]}" ci-secret name "$CONFIG")
  SECRET_COMMAND=$("${PROVIDER_CLI[@]}" ci-secret command "$CONFIG")
  if [ -n "$SECRET_NAME" ]; then
    "${PROVIDER_CLI[@]}" ci-secret help "$CONFIG"
    [ -n "$SECRET_COMMAND" ] && $SECRET_COMMAND
    read -r -s -p "  Paste that token here (it is not shown): " TOKEN; echo
    [ -n "$TOKEN" ] || { echo "No token given."; exit 1; }
    printf '%s' "$TOKEN" | gh secret set "$SECRET_NAME" --repo "$REPO"
    unset TOKEN
  else
    echo "  Your agent needs no secret of its own."
  fi
fi

step "5/5  A first dry run"
gh workflow enable contribute.yml --repo "$REPO" >/dev/null 2>&1 || true
gh workflow run contribute.yml --repo "$REPO" -f dry_run=true -f force=true
echo "  Started. It writes nothing; it shows what the runner would do today."
echo "  Watch it here: https://github.com/$REPO/actions"
echo
echo "All set. From now on the runner checks your balance every day and contributes only when there is surplus."
