#!/usr/bin/env bash
# Windows packaged smoke: unzip portable zip, launch Electron, orphan node.exe.
# Kill Electron only (not the process tree) and assert sidecar node.exe is gone.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required but not found on PATH${2:+ ($2)}" >&2
    exit 1
  fi
}

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) ;;
  *)
    echo "error: scripts/smoke-windows.sh is Windows-only (got $(uname -s))" >&2
    exit 1
    ;;
esac

need_cmd curl
need_cmd jq

product_name=$(jq -r .productName styling.json)
product_name_safe=$(jq -r .productNameSafe styling.json)
if [ -z "$product_name" ] || [ "$product_name" = "null" ] || [ -z "$product_name_safe" ] || [ "$product_name_safe" = "null" ]; then
  echo "error: styling.json is missing productName or productNameSafe" >&2
  exit 1
fi

win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

# Prefer GHA RUNNER_ARCH: Git Bash on windows-11-arm can report x86_64.
detect_pack_arch() {
  if [ -n "${RUNNER_ARCH:-}" ]; then
    case "$RUNNER_ARCH" in
      X64|x64|amd64) printf 'x64' ;;
      ARM64|arm64|aarch64) printf 'arm64' ;;
      *)
        echo "error: unsupported RUNNER_ARCH=$RUNNER_ARCH (expected X64 or ARM64)" >&2
        exit 1
        ;;
    esac
    return
  fi
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *)
      echo "error: unsupported architecture $(uname -m) (expected x64 or arm64)" >&2
      exit 1
      ;;
  esac
}

out_dir=${1:-${PACKAGE_OUT:-$repo_root/dist/installers}}
case "$out_dir" in
  /*) ;;
  *) out_dir="$repo_root/$out_dir" ;;
esac

pack_arch=$(detect_pack_arch)
zip=$(find "$out_dir" -maxdepth 1 -type f -name "${product_name_safe}-*-win-${pack_arch}.zip" -print -quit || true)
nsis=$(find "$out_dir" -maxdepth 1 -type f -name "${product_name_safe}-*-win-${pack_arch}.exe" -print -quit || true)

if [ -z "$zip" ] || [ -z "$nsis" ]; then
  echo "error: expected win-${pack_arch} NSIS .exe and portable .zip in $out_dir" >&2
  ls -la "$out_dir" >&2 || true
  exit 1
fi

echo "smoke-windows: nsis=$nsis"
echo "smoke-windows: zip=$zip"

workdir=$(mktemp -d)
app_pid=

cleanup() {
  if [ -n "${app_pid:-}" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill -9 "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

mkdir -p "$workdir/app"
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$zip" -d "$workdir/app"
else
  tar -xf "$zip" -C "$workdir/app"
fi

exe=$(find "$workdir/app" -maxdepth 2 -name "${product_name}.exe" -print -quit || true)
node_exe=$(find "$workdir/app" -path '*/resources/harness/node/node.exe' -print -quit || true)
entry=$(find "$workdir/app" -path '*/resources/harness/sidecar-entry.mjs' -print -quit || true)
dsh_cmd=$(find "$workdir/app" -path '*/resources/harness/bin/dsh.cmd' -print -quit || true)
boot=$(find "$workdir/app" -path '*/resources/harness/node_modules/@deepseek-ai/dsh-app-boot/package.json' -print -quit || true)

if [ -z "$exe" ] || [ -z "$node_exe" ] || [ -z "$entry" ] || [ -z "$dsh_cmd" ] || [ -z "$boot" ]; then
  echo "error: portable zip missing exe / node.exe / sidecar-entry.mjs / dsh.cmd / dsh-app-boot" >&2
  find "$workdir/app" -maxdepth 5 -print >&2 || true
  exit 1
fi
echo "smoke-windows: zip has node/node.exe, sidecar-entry.mjs, bin/dsh.cmd, dsh-app-boot"

# Isolated profile so official node.exe / Electron see Win32 paths, not MSYS.
export DSH_HOME
DSH_HOME=$(win_path "$workdir/dsh")
export USERPROFILE
USERPROFILE=$(win_path "$workdir/home")
export HOME="$USERPROFILE"
export APPDATA
APPDATA=$(win_path "$workdir/home/AppData/Roaming")
export LOCALAPPDATA
LOCALAPPDATA=$(win_path "$workdir/home/AppData/Local")
export DSH_TELEMETRY_DISABLED=1
export DSH_DESKTOP_SKIP_ONBOARDING=1
mkdir -p \
  "$workdir/dsh" \
  "$workdir/home/Documents" \
  "$workdir/home/AppData/Roaming" \
  "$workdir/home/AppData/Local"

ready_timeout=${SMOKE_READY_TIMEOUT:-180}
orphan_timeout=${SMOKE_ORPHAN_TIMEOUT:-2}

"$exe" >"$workdir/app.out" 2>"$workdir/err" &
app_pid=$!
echo "smoke-windows: launched pid=$app_pid exe=$exe"

url=
deadline=$((SECONDS + ready_timeout))
listen_port="$workdir/dsh/desktop/listen-port"
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid" || true
    app_pid=
    echo "error: packaged app exited before ready" >&2
    echo "----- stdout -----" >&2
    cat "$workdir/app.out" >&2 || true
    echo "----- stderr -----" >&2
    cat "$workdir/err" >&2 || true
    exit 1
  fi
  if [ -f "$listen_port" ]; then
    port=$(tr -d '[:space:]' <"$listen_port")
    if [ -n "$port" ] && curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$port/"; then
      url="http://127.0.0.1:$port"
      break
    fi
  fi
  sleep 1
done

if [ -z "$url" ]; then
  echo "error: packaged app ready timeout after ${ready_timeout}s" >&2
  echo "----- stdout -----" >&2
  cat "$workdir/app.out" >&2 || true
  echo "----- stderr -----" >&2
  cat "$workdir/err" >&2 || true
  echo "----- sidecar.log -----" >&2
  cat "$workdir/dsh/desktop/sidecar.log" >&2 || true
  echo "----- main.log -----" >&2
  cat "$workdir/dsh/desktop/main.log" >&2 || true
  echo "----- desktop dir -----" >&2
  ls -la "$workdir/dsh" "$workdir/dsh/desktop" >&2 || true
  exit 1
fi

echo "smoke-windows: ready $url"

node_win=$(win_path "$node_exe")
helper_node=$(command -v node || true)
if [ -z "$helper_node" ]; then
  helper_node=$node_exe
fi

# Resolve sidecar node.exe + Electron parent. Do not use taskkill /T.
ids=$(
  SMOKE_NODE_EXE="$node_win" "$helper_node" --input-type=module <<'JS'
import { execFileSync } from 'node:child_process'

const nodePath = process.env.SMOKE_NODE_EXE
const ps = `
$target = $env:SMOKE_NODE_EXE
$p = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and ($_.ExecutablePath -ieq $target)
} | Select-Object -First 1
if (-not $p) { Write-Output ''; exit 0 }
Write-Output ("{0} {1}" -f $p.ProcessId, $p.ParentProcessId)
`
const out = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', ps],
  { encoding: 'utf8', env: { ...process.env, SMOKE_NODE_EXE: nodePath } },
).trim()
process.stdout.write(`${out}\n`)
JS
)
sidecar_pid=${ids%% *}
electron_pid=${ids#* }
sidecar_pid=${sidecar_pid//$'\r'/}
electron_pid=${electron_pid//$'\r'/}

if [ -z "$sidecar_pid" ] || [ "$sidecar_pid" = "$ids" ]; then
  echo "error: sidecar node.exe not running after ready ($node_win)" >&2
  exit 1
fi
if [ -z "$electron_pid" ] || [ "$electron_pid" = "0" ]; then
  echo "error: could not resolve Electron parent of sidecar pid $sidecar_pid" >&2
  exit 1
fi

echo "smoke-windows: orphan kill electron=$electron_pid sidecar=$sidecar_pid"
# No /T — the contract is stdin EOF / parent-death watch, not a job-object tree kill.
taskkill //PID "$electron_pid" //F >/dev/null 2>&1 || kill -9 "$electron_pid" 2>/dev/null || true
app_pid=

pid_alive() {
  local pid=$1
  powershell.exe -NoProfile -Command \
    "if (Get-Process -Id $pid -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" \
    >/dev/null 2>&1
}

gone=0
orphan_deadline=$((SECONDS + orphan_timeout))
while [ "$SECONDS" -lt "$orphan_deadline" ]; do
  if ! pid_alive "$sidecar_pid"; then
    gone=1
    break
  fi
  sleep 0.1
done

if [ "$gone" -ne 1 ]; then
  echo "error: sidecar node.exe $sidecar_pid still alive ${orphan_timeout}s after Electron $electron_pid was killed" >&2
  exit 1
fi

echo "smoke-windows: sidecar node.exe exited after Electron death"
echo "smoke-windows: ok"
