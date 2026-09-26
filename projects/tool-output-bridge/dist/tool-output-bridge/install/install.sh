#!/usr/bin/env sh
set -eu

command -v node >/dev/null 2>&1 || { printf '%s\n' 'Please install Node.js 20+ first.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || { printf '%s\n' 'Node.js 20+ is required.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf '%s\n' 'Please install curl first.' >&2; exit 1; }

repository=${JIMI_TOOLS_REPOSITORY:-deepsleep-claw/SleepTavernHome}
ref=${JIMI_TOOLS_REF:-main}
action=menu
case "${1:-}" in menu|install|uninstall|status) action=$1; shift ;; esac
temporary=$(mktemp -d "${TMPDIR:-/tmp}/jimi-tools.XXXXXXXX")
trap 'rm -f -- "$temporary/installer.mjs"; rmdir -- "$temporary"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
url="https://raw.githubusercontent.com/$repository/$ref/projects/tool-output-bridge/dist/tool-output-bridge/installer.mjs"
printf '%s\n' 'Downloading Jimi Tools installer...'
curl --fail --show-error --silent --location --connect-timeout 15 --max-time 120 "$url" -o "$temporary/installer.mjs"
if [ "$action" = menu ]; then
    if ! ( : </dev/tty ) 2>/dev/null; then
        printf '%s\n' 'An interactive terminal is required. Use install, uninstall or status in automation.' >&2
        exit 1
    fi
    node "$temporary/installer.mjs" "$action" --online --repository "$repository" --ref "$ref" "$@" </dev/tty
else
    node "$temporary/installer.mjs" "$action" --online --repository "$repository" --ref "$ref" "$@"
fi
