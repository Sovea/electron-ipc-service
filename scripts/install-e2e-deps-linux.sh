#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "test:e2e:install-deps is only supported on Linux" >&2
  exit 1
fi
if ! command -v apt-get >/dev/null || ! command -v apt-cache >/dev/null; then
  echo "test:e2e:install-deps requires a Debian/Ubuntu-based Linux" >&2
  exit 1
fi

pnpm exec playwright install-deps chromium

e2e_gtk_package="libgtk-3-0"
if apt-cache show libgtk-3-0t64 >/dev/null 2>&1; then
  e2e_gtk_package="libgtk-3-0t64"
fi

e2e_privilege=()
if [[ "$(id -u)" -ne 0 ]]; then
  e2e_privilege=(sudo)
fi

"${e2e_privilege[@]}" env \
  DEBIAN_FRONTEND=noninteractive \
  NEEDRESTART_MODE=a \
  apt-get install -y --no-install-recommends \
  "${e2e_gtk_package}" \
  libepoxy0
