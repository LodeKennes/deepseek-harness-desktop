#!/usr/bin/env bash
# Host smoke: staged sidecar prints the URL, HTTP 200, stdin quit exits 0.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required but not found on PATH" >&2
    exit 1
  fi
}

is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) return 0 ;;
  esac
  return 1
}

win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

stage=${STAGE:-$repo_root/dist/runtime}
case "$stage" in
  /*) ;;
  *) stage="$repo_root/$stage" ;;
esac

entry="$stage/sidecar-entry.mjs"
if [ -f "$stage/node/node.exe" ]; then
  node_bin="$stage/node/node.exe"
elif [ -x "$stage/node/bin/node" ]; then
  node_bin="$stage/node/bin/node"
else
  need_cmd node
  node_bin=$(command -v node)
fi

if ! is_windows; then
  need_cmd curl
fi

if [ ! -f "$entry" ]; then
  echo "error: $entry missing; run scripts/stage-runtime.sh" >&2
  exit 1
fi

port=${SMOKE_PORT:-13820}
ready_timeout=${SMOKE_READY_TIMEOUT:-180}
quit_timeout=${SMOKE_QUIT_TIMEOUT:-10}

workdir=$(mktemp -d)
dsh_home=$(mktemp -d)
patch="$workdir/smoke.cordis.yml"
printf '[]\n' > "$patch"
pid=
fifo_fd_open=0

cleanup() {
  if [ "$fifo_fd_open" -eq 1 ]; then
    exec 3>&- || true
    fifo_fd_open=0
  fi
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$workdir" "$dsh_home"
}
trap cleanup EXIT

if is_windows; then
  export DSH_HOME
  DSH_HOME=$(win_path "$dsh_home")
  export USERPROFILE
  USERPROFILE=$(win_path "$dsh_home/home")
  mkdir -p "$dsh_home/home"
else
  export DSH_HOME="$dsh_home"
fi
export DSH_TELEMETRY_DISABLED=1

# Official node.exe cannot consume an MSYS FIFO. Drive stdin from Node.
if is_windows; then
  helper_node=$(command -v node || true)
  if [ -z "$helper_node" ]; then
    helper_node=$node_bin
  fi
  echo "smoke-sidecar: windows quit-pipe via node helper port=$port entry=$entry"
  SMOKE_NODE=$(win_path "$node_bin")
  SMOKE_ENTRY=$(win_path "$entry")
  SMOKE_PATCH=$(win_path "$patch")
  export SMOKE_NODE SMOKE_ENTRY SMOKE_PATCH SMOKE_PORT="$port"
  export SMOKE_READY_TIMEOUT="$ready_timeout" SMOKE_QUIT_TIMEOUT="$quit_timeout"
  "$helper_node" --input-type=module - "$workdir" <<'JS'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { writeFileSync } from 'node:fs'

const workdir = process.argv[2]
const nodeBin = process.env.SMOKE_NODE
const entry = process.env.SMOKE_ENTRY
const patch = process.env.SMOKE_PATCH
const port = process.env.SMOKE_PORT
const readyMs = Number(process.env.SMOKE_READY_TIMEOUT || 180) * 1000
const quitMs = Number(process.env.SMOKE_QUIT_TIMEOUT || 10) * 1000

const child = spawn(nodeBin, [entry, 'web', '--patch', patch, '--host', '127.0.0.1', '--port', port], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  env: process.env,
})

let out = ''
let err = ''
child.stdout.on('data', (chunk) => {
  out += chunk.toString('utf8')
})
child.stderr.on('data', (chunk) => {
  err += chunk.toString('utf8')
})

const dump = () => {
  writeFileSync(`${workdir}/out`, out)
  writeFileSync(`${workdir}/err`, err)
}

const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    dump()
    child.kill()
    reject(new Error(`sidecar ready timeout after ${readyMs / 1000}s`))
  }, readyMs)
  child.once('error', (e) => {
    clearTimeout(timer)
    dump()
    reject(e)
  })
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    dump()
    reject(new Error(`sidecar exited before ready (code ${code}, signal ${signal})`))
  })
  const onChunk = () => {
    const match = out.match(/http:\/\/127\.0\.0\.1:\d+/)
    if (!match) return
    clearTimeout(timer)
    child.removeAllListeners('exit')
    child.removeAllListeners('error')
    resolve(match[0])
  }
  child.stdout.on('data', onChunk)
  onChunk()
})

console.log(`smoke-sidecar: ready ${url}`)

const code = await new Promise((resolve, reject) => {
  const req = request(url, { method: 'GET', timeout: 10_000 }, (res) => {
    res.resume()
    resolve(res.statusCode ?? 0)
  })
  req.on('error', reject)
  req.end()
})
if (code !== 200) {
  dump()
  child.kill()
  throw new Error(`expected HTTP 200 from ${url}, got ${code}`)
}

child.stdin.write('quit\n')
child.stdin.end()

const status = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    dump()
    child.kill()
    reject(new Error(`sidecar did not exit within ${quitMs / 1000}s after quit`))
  }, quitMs)
  child.once('exit', (code) => {
    clearTimeout(timer)
    resolve(code ?? 1)
  })
})
dump()
if (status !== 0) {
  throw new Error(`sidecar exit ${status}, expected 0`)
}
console.log('smoke-sidecar: quit ok')
JS
  exit $?
fi

mkfifo "$workdir/in"
# Reader (sidecar stdin) is opened by the child; open the writer after spawn.
"$node_bin" "$entry" web --patch "$patch" --host 127.0.0.1 --port "$port" \
  <"$workdir/in" >"$workdir/out" 2>"$workdir/err" &
pid=$!
exec 3>"$workdir/in"
fifo_fd_open=1

echo "smoke-sidecar: pid=$pid port=$port entry=$entry"

url=
deadline=$((SECONDS + ready_timeout))
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" || true
    echo "error: sidecar exited before ready" >&2
    echo "----- stdout -----" >&2
    cat "$workdir/out" >&2 || true
    echo "----- stderr -----" >&2
    cat "$workdir/err" >&2 || true
    pid=
    exit 1
  fi
  if url=$(grep -Eom1 'http://127\.0\.0\.1:[0-9]+' "$workdir/out" 2>/dev/null); then
    break
  fi
  sleep 0.25
done

if [ -z "$url" ]; then
  echo "error: sidecar ready timeout after ${ready_timeout}s" >&2
  echo "----- stdout -----" >&2
  cat "$workdir/out" >&2 || true
  echo "----- stderr -----" >&2
  cat "$workdir/err" >&2 || true
  exit 1
fi

echo "smoke-sidecar: ready $url"

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url")
if [ "$code" != "200" ]; then
  echo "error: expected HTTP 200 from $url, got $code" >&2
  exit 1
fi

printf 'quit\n' >&3
exec 3>&-
fifo_fd_open=0

quit_deadline=$((SECONDS + quit_timeout))
while kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$quit_deadline" ]; do
  sleep 0.2
done

if kill -0 "$pid" 2>/dev/null; then
  echo "error: sidecar did not exit within ${quit_timeout}s after quit" >&2
  exit 1
fi

set +e
wait "$pid"
status=$?
set -e
pid=
if [ "$status" -ne 0 ]; then
  echo "error: sidecar exit $status, expected 0" >&2
  echo "----- stderr -----" >&2
  cat "$workdir/err" >&2 || true
  exit 1
fi

echo "smoke-sidecar: quit ok"
