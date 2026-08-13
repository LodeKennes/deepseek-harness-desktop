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

need_cmd curl

stage=${STAGE:-$repo_root/dist/runtime}
case "$stage" in
  /*) ;;
  *) stage="$repo_root/$stage" ;;
esac

entry="$stage/sidecar-entry.mjs"
if [ -x "$stage/node/bin/node" ]; then
  node_bin="$stage/node/bin/node"
else
  need_cmd node
  node_bin=$(command -v node)
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

export DSH_HOME="$dsh_home"
export DSH_TELEMETRY_DISABLED=1

mkfifo "$workdir/in"
# Reader (sidecar stdin) is opened by the child; open the writer after spawn.
"$node_bin" "$entry" web --host 127.0.0.1 --port "$port" \
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
