#!/usr/bin/env bash
# Smoke test: stage the harness runtime, start the sidecar via sidecar-entry.mjs,
# verify it serves the web UI on loopback, then send 'quit' on stdin and verify
# clean exit within 5s.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
cd "$repo_root"

ready_timeout=${SMOKE_READY_TIMEOUT:-60}
quit_timeout=${SMOKE_QUIT_TIMEOUT:-10}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required but not found on PATH${2:+ ($2)}" >&2
    exit 1
  fi
}

stage=${1:-dist/runtime}
case "$stage" in
  /*) ;;
  *) stage="$repo_root/$stage" ;;
esac

node_bin="$stage/node/bin/node"
if [ ! -f "$node_bin" ]; then
  node_bin="$stage/node/node.exe"
fi
entry="$stage/sidecar-entry.mjs"

if [ ! -x "$node_bin" ] && [ ! -f "$node_bin" ]; then
  echo "error: node binary missing at $node_bin (run scripts/stage-runtime.sh)" >&2
  exit 1
fi
if [ ! -f "$entry" ]; then
  echo "error: sidecar entry missing at $entry (run scripts/stage-runtime.sh)" >&2
  exit 1
fi

port_in_use() {
  local p=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$p" >/dev/null 2>&1 && return 0 || return 1
  fi
  (exec 3<>/dev/tcp/127.0.0.1/"$p") 2>/dev/null && { exec 3>&-; return 0; } || return 1
}

find_free_port() {
  local p=13820
  while [ "$p" -lt 13900 ]; do
    if ! port_in_use "$p"; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
  done
  echo "error: could not find free port in range 13820-13899" >&2
  exit 1
}

workdir=$(mktemp -d)
dsh_home=$(mktemp -d)
patch="$workdir/smoke.cordis.yml"
printf '[]\n' > "$patch"
brand_patch="$repo_root/.cache/styling/brand.generated.cordis.yml"
if [ ! -f "$brand_patch" ]; then
  node "$script_dir/apply-styling.mjs" generate
fi
extra_patch=()
if [ -f "$brand_patch" ]; then
  extra_patch+=(--patch "$brand_patch")
fi
capabilities_patch="$repo_root/resources/desktop-capabilities.cordis.yml"
if [ -f "$capabilities_patch" ]; then
  extra_patch+=(--patch "$capabilities_patch")
fi
pid=
fifo_fd_open=0

cleanup() {
  if [ "$fifo_fd_open" -eq 1 ]; then
    exec 3>&- 2>/dev/null || true
    fifo_fd_open=0
  fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$workdir" "$dsh_home"
}
trap cleanup EXIT

# Isolate user config / session state from any real ~/.dsh during smoke
export DSH_HOME="$dsh_home"

port=$(find_free_port)

# On Windows (Git Bash/MSYS2), named pipes via mkfifo cannot bridge native
# node.exe stdin. Run an inline node runner that uses real anonymous pipes.
is_win=0
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) is_win=1 ;;
esac

win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

if [ "$is_win" -eq 1 ]; then
  export SMOKE_STAGE="$stage"
  export SMOKE_NODE_BIN=$(win_path "$node_bin")
  export SMOKE_ENTRY=$(win_path "$entry")
  export SMOKE_WORKDIR=$(win_path "$workdir")
  export SMOKE_PORT="$port"
  export SMOKE_READY_TIMEOUT="$ready_timeout"
  export SMOKE_QUIT_TIMEOUT="$quit_timeout"
  SMOKE_PATCH=$(win_path "$patch")
  if [ -f "$brand_patch" ]; then
    SMOKE_BRAND_PATCH=$(win_path "$brand_patch")
    export SMOKE_BRAND_PATCH
  fi
  export SMOKE_PATCH

  "$node_bin" --input-type=module - <<'EOF'
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { request } from 'node:http'

const nodeBin = process.env.SMOKE_NODE_BIN
const entry = process.env.SMOKE_ENTRY
const workdir = process.env.SMOKE_WORKDIR
const patch = process.env.SMOKE_PATCH
const port = process.env.SMOKE_PORT
const readyMs = Number(process.env.SMOKE_READY_TIMEOUT || 60) * 1000
const quitMs = Number(process.env.SMOKE_QUIT_TIMEOUT || 10) * 1000

const brand = process.env.SMOKE_BRAND_PATCH
const argv = [entry, 'web', '--patch', patch]
if (brand) argv.push('--patch', brand)
argv.push('--host', '127.0.0.1', '--port', port)
const child = spawn(nodeBin, argv, {
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
    const match = out.match(/http:\/\/127\.0\.0\.1:\d+[^\s)]*/)
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

const httpGet = (targetUrl, headers = {}) => new Promise((resolve, reject) => {
  const req = request(targetUrl, { method: 'GET', timeout: 10_000, headers }, (res) => {
    let body = ''
    res.on('data', chunk => { body += chunk })
    res.on('end', () => resolve({ code: res.statusCode ?? 0, headers: res.headers, body }))
  })
  req.on('error', reject)
  req.end()
})

let res = await httpGet(url)
if (res.code === 303 && res.headers['set-cookie']) {
  const setCookie = res.headers['set-cookie']
  const cookie = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : setCookie.split(';')[0]
  const nextUrl = new URL(res.headers.location || '/', url).href
  res = await httpGet(nextUrl, { cookie })
}

if (res.code !== 200) {
  dump()
  child.kill()
  throw new Error(`expected HTTP 200 from ${url}, got ${res.code}`)
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
  throw new Error(`sidecar exited with code ${status} (expected 0)`)
}
console.log('smoke-sidecar: quit ok')
process.exit(0)
EOF
  exit $?
fi

mkfifo "$workdir/in"
# Reader (sidecar stdin) is opened by the child; open the writer after spawn.
"$node_bin" "$entry" web --patch "$patch" "${extra_patch[@]}" --host 127.0.0.1 --port "$port" \
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
  if url=$(grep -Eom1 'http://127\.0\.0\.1:[0-9]+[^[:space:]\)]*' "$workdir/out" 2>/dev/null); then
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

html=$(curl -sSL -c "$workdir/cookies.txt" -b "$workdir/cookies.txt" --max-time 10 "$url")
code=$(curl -sSL -c "$workdir/cookies.txt" -b "$workdir/cookies.txt" -o /dev/null -w '%{http_code}' --max-time 10 "$url")
if [ "$code" != "200" ]; then
  echo "error: expected HTTP 200 from $url, got $code" >&2
  exit 1
fi
if [ -f "$brand_patch" ]; then
  product_name=$(jq -r .productName "$repo_root/styling.json")
  if ! printf '%s' "$html" | grep -Fq "<title>${product_name}</title>"; then
    echo "error: GET / missing <title>${product_name}</title>" >&2
    printf '%s\n' "$html" | head -n 20 >&2
    exit 1
  fi
fi

# Send quit command on stdin
printf 'quit\n' >&3
# Close writer to send EOF
exec 3>&-
fifo_fd_open=0

quit_deadline=$((SECONDS + quit_timeout))
while [ "$SECONDS" -lt "$quit_deadline" ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if kill -0 "$pid" 2>/dev/null; then
  echo "error: sidecar did not exit within ${quit_timeout}s after quit" >&2
  echo "----- stdout -----" >&2
  cat "$workdir/out" >&2 || true
  echo "----- stderr -----" >&2
  cat "$workdir/err" >&2 || true
  exit 1
fi

wait "$pid"
status=$?
pid=

if [ "$status" -ne 0 ]; then
  echo "error: sidecar exited with code $status (expected 0)" >&2
  echo "----- stdout -----" >&2
  cat "$workdir/out" >&2 || true
  echo "----- stderr -----" >&2
  cat "$workdir/err" >&2 || true
  exit 1
fi

echo "smoke-sidecar: quit ok"
