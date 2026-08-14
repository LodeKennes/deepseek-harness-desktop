#!/usr/bin/env bash
# Packaged smoke: Linux AppImage/deb/rpm/pacman, or macOS DMG/zip.
# Orphan: kill Electron after ready; sidecar must die within 2s.
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

need_cmd curl
need_cmd jq

product_name=$(jq -r .productName styling.json)
desktop_name=$(jq -r .desktopName styling.json)
if [ -z "$product_name" ] || [ "$product_name" = "null" ] || [ -z "$desktop_name" ] || [ "$desktop_name" = "null" ]; then
  echo "error: styling.json is missing productName or desktopName" >&2
  exit 1
fi

out_dir=${1:-${PACKAGE_OUT:-$repo_root/dist/installers}}
case "$out_dir" in
  /*) ;;
  *) out_dir="$repo_root/$out_dir" ;;
esac

# First match only. macOS find is BSD and has no GNU -quit.
first_glob_file() {
  local f
  for f in "$@"; do
    if [ -f "$f" ]; then
      printf '%s\n' "$f"
      return 0
    fi
  done
  return 1
}

first_find_print() {
  ( set +o pipefail; find "$@" -print | head -n 1 )
}

smoke_packaged_mac() {
  need_cmd unzip
  local zip dmg app helper bin url port
  local ready_timeout sidecar_pid electron_pid gone orphan_deadline deadline
  zip=$(first_glob_file "$out_dir"/*.zip || true)
  dmg=$(first_glob_file "$out_dir"/*.dmg || true)
  if [ -z "$zip" ] || [ -z "$dmg" ]; then
    echo "error: expected .dmg and .zip in $out_dir" >&2
    ls -la "$out_dir" >&2 || true
    exit 1
  fi

  workdir=$(mktemp -d)
  wrapper_pid=
  # Invoked via trap EXIT; shellcheck cannot see that (SC2317/SC2329).
  # shellcheck disable=SC2317,SC2329
  cleanup_mac() {
    set +e
    if [ -n "${wrapper_pid:-}" ] && kill -0 "$wrapper_pid" 2>/dev/null; then
      kill -9 "$wrapper_pid" 2>/dev/null || true
      wait "$wrapper_pid" 2>/dev/null || true
    fi
    pkill -9 -f "$workdir" 2>/dev/null || true
    # AppImage/zip extract trees are often mode 555; do not fail the smoke on leftover files.
    chmod -R u+w "$workdir" 2>/dev/null || true
    rm -rf "$workdir" 2>/dev/null || true
  }
  trap cleanup_mac EXIT

  echo "smoke-packaged: zip=$zip"
  echo "smoke-packaged: dmg=$dmg"

  mkdir -p "$workdir/app"
  unzip -q "$zip" -d "$workdir/app"
  app=$(first_find_print "$workdir/app" -maxdepth 3 -name '*.app' -type d || true)
  if [ -z "$app" ]; then
    echo "error: unzipped macOS zip has no .app" >&2
    find "$workdir/app" >&2 || true
    exit 1
  fi
  helper="$app/Contents/Resources/harness/node/bin/node-spawn-helper"
  if [ ! -x "$helper" ]; then
    echo "error: packaged app missing executable node-spawn-helper at $helper" >&2
    ls -la "$app/Contents/Resources/harness/node/bin" >&2 || true
    exit 1
  fi
  if [ ! -f "$app/Contents/Resources/harness/sidecar-entry.mjs" ]; then
    echo "error: packaged app missing extraResources harness/sidecar-entry.mjs" >&2
    exit 1
  fi
  if [ ! -f "$app/Contents/Resources/harness/node_modules/@deepseek-ai/dsh-app-boot/package.json" ]; then
    echo "error: packaged app missing harness/node_modules/@deepseek-ai/dsh-app-boot" >&2
    ls -la "$app/Contents/Resources/harness" >&2 || true
    ls -la "$app/Contents/Resources/harness/node_modules/@deepseek-ai" >&2 || true
    exit 1
  fi
  echo "smoke-packaged: zip has spawn-helper and staged harness"

  bin="$app/Contents/MacOS/$product_name"
  if [ ! -x "$bin" ]; then
    echo "error: packaged .app has no $product_name binary" >&2
    ls -la "$app/Contents/MacOS" >&2 || true
    exit 1
  fi

  export HOME="$workdir/home"
  export DSH_HOME="$workdir/dsh"
  export DSH_TELEMETRY_DISABLED=1
  export DSH_DESKTOP_SKIP_ONBOARDING=1
  mkdir -p "$HOME" "$DSH_HOME"

  # macos-latest has a window server; skip xvfb. Unsigned local .app is not quarantined.
  "$bin" >"$workdir/app.out" 2>"$workdir/app.err" &
  wrapper_pid=$!
  echo "smoke-packaged: launched $bin pid=$wrapper_pid"

  ready_timeout=${SMOKE_READY_TIMEOUT:-180}
  url=
  deadline=$((SECONDS + ready_timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$wrapper_pid" 2>/dev/null; then
      wait "$wrapper_pid" || true
      wrapper_pid=
      echo "error: packaged app exited before ready" >&2
      echo "----- stdout -----" >&2
      cat "$workdir/app.out" >&2 || true
      echo "----- stderr -----" >&2
      cat "$workdir/app.err" >&2 || true
      echo "----- sidecar.log -----" >&2
      cat "$DSH_HOME/desktop/sidecar.log" >&2 || true
      echo "----- main.log -----" >&2
      cat "$DSH_HOME/desktop/main.log" >&2 || true
      exit 1
    fi
    if [ -f "$DSH_HOME/desktop/listen-port" ]; then
      port=$(tr -d '[:space:]' <"$DSH_HOME/desktop/listen-port")
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
    cat "$workdir/app.err" >&2 || true
    echo "----- sidecar.log -----" >&2
    cat "$DSH_HOME/desktop/sidecar.log" >&2 || true
    echo "----- main.log -----" >&2
    cat "$DSH_HOME/desktop/main.log" >&2 || true
    exit 1
  fi

  echo "smoke-packaged: ready $url"

  sidecar_pid=$(pgrep -n -f 'sidecar-entry\.mjs' || true)
  if [ -z "$sidecar_pid" ]; then
    echo "error: sidecar-entry.mjs not running after ready" >&2
    exit 1
  fi
  electron_pid=$(ps -o ppid= -p "$sidecar_pid" | tr -d ' ')
  if [ -z "$electron_pid" ] || [ "$electron_pid" = "1" ]; then
    echo "error: could not resolve Electron parent of sidecar pid $sidecar_pid" >&2
    exit 1
  fi

  echo "smoke-packaged: orphan kill -9 electron=$electron_pid sidecar=$sidecar_pid"
  kill -9 "$electron_pid"
  gone=0
  orphan_deadline=$((SECONDS + 2))
  while [ "$SECONDS" -lt "$orphan_deadline" ]; do
    if ! kill -0 "$sidecar_pid" 2>/dev/null; then
      gone=1
      break
    fi
    sleep 0.1
  done
  if [ "$gone" -ne 1 ]; then
    echo "error: sidecar $sidecar_pid still alive 2s after Electron $electron_pid was killed" >&2
    exit 1
  fi
  echo "smoke-packaged: sidecar exited after Electron death"

  if [ -n "${wrapper_pid:-}" ] && kill -0 "$wrapper_pid" 2>/dev/null; then
    kill -9 "$wrapper_pid" 2>/dev/null || true
    wait "$wrapper_pid" 2>/dev/null || true
  fi
  wrapper_pid=
  echo "smoke-packaged: ok"
}

case "$(uname -s)" in
  Darwin*)
    smoke_packaged_mac
    exit 0
    ;;
  Linux*) ;;
  *)
    echo "error: scripts/smoke-packaged.sh supports Linux and macOS only (got $(uname -s))" >&2
    exit 1
    ;;
esac

need_cmd dpkg-deb
need_cmd rpm
need_cmd bsdtar
# Never apt-get install libfuse2. AppImage smoke uses extract-and-run.

appimage=$(find "$out_dir" -maxdepth 1 -type f -name '*.AppImage' -print -quit || true)
deb=$(find "$out_dir" -maxdepth 1 -type f -name '*.deb' -print -quit || true)
rpm_package=$(find "$out_dir" -maxdepth 1 -type f -name '*.rpm' -print -quit || true)
pacman_package=$(find "$out_dir" -maxdepth 1 -type f -name '*.pkg.tar.zst' -print -quit || true)

if [ -z "$appimage" ] || [ -z "$deb" ] || [ -z "$rpm_package" ] || [ -z "$pacman_package" ]; then
  echo "error: expected .deb, .rpm, .pkg.tar.zst, and .AppImage in $out_dir" >&2
  ls -la "$out_dir" >&2 || true
  exit 1
fi

chmod +x "$appimage"

workdir=$(mktemp -d)
wrapper_pid=

cleanup() {
  set +e
  if [ -n "${wrapper_pid:-}" ] && kill -0 "$wrapper_pid" 2>/dev/null; then
    kill -9 "$wrapper_pid" 2>/dev/null || true
    wait "$wrapper_pid" 2>/dev/null || true
  fi
  pkill -9 -f "$workdir" 2>/dev/null || true
  # AppImage --appimage-extract writes 555 squashfs-root dirs. rm -rf then
  # errors "Directory not empty" and fails a green smoke under `set -e`.
  chmod -R u+w "$workdir" 2>/dev/null || true
  rm -rf "$workdir" 2>/dev/null || true
}
trap cleanup EXIT

echo "smoke-packaged: appimage=$appimage"
echo "smoke-packaged: deb=$deb"
echo "smoke-packaged: rpm=$rpm_package"
echo "smoke-packaged: pacman=$pacman_package"

# --- static: AppImage Exec includes --no-sandbox (no FUSE) ---
mkdir -p "$workdir/appimage"
(
  cd "$workdir/appimage"
  "$appimage" --appimage-extract >/dev/null
)
ai_desktop=$(find "$workdir/appimage/squashfs-root" -maxdepth 2 -name '*.desktop' -print -quit || true)
if [ -z "$ai_desktop" ]; then
  echo "error: AppImage extract produced no .desktop file" >&2
  exit 1
fi
if ! grep -E '^Exec=' "$ai_desktop" | grep -q -- '--no-sandbox'; then
  echo "error: AppImage desktop Exec must include --no-sandbox" >&2
  cat "$ai_desktop" >&2
  exit 1
fi
if ! find "$workdir/appimage/squashfs-root" -path '*/resources/harness/sidecar-entry.mjs' | grep -q .; then
  echo "error: AppImage missing extraResources harness/sidecar-entry.mjs" >&2
  exit 1
fi
echo "smoke-packaged: AppImage desktop has --no-sandbox and staged harness"

# --- static: .deb Exec does NOT include --no-sandbox ---
mkdir -p "$workdir/deb"
dpkg-deb -x "$deb" "$workdir/deb"
deb_desktop=$(find "$workdir/deb" -name '*.desktop' -print -quit || true)
if [ -z "$deb_desktop" ]; then
  echo "error: .deb unpack produced no .desktop file" >&2
  exit 1
fi
if grep -E '^Exec=' "$deb_desktop" | grep -q -- '--no-sandbox'; then
  echo "error: .deb desktop Exec must not include --no-sandbox" >&2
  cat "$deb_desktop" >&2
  exit 1
fi
if ! find "$workdir/deb" -path '*/resources/harness/sidecar-entry.mjs' | grep -q .; then
  echo "error: .deb missing extraResources harness/sidecar-entry.mjs" >&2
  exit 1
fi
sandbox=$(find "$workdir/deb" -name chrome-sandbox -print -quit || true)
if [ -z "$sandbox" ]; then
  echo "error: .deb missing chrome-sandbox helper" >&2
  exit 1
fi
echo "smoke-packaged: .deb desktop has no --no-sandbox; chrome-sandbox present"

# --- static: Fedora RPM and Arch package contain the staged runtime ---
rpm -qpl "$rpm_package" > "$workdir/rpm-files.txt"
if ! grep -q '/resources/harness/sidecar-entry.mjs$' "$workdir/rpm-files.txt"; then
  echo "error: RPM missing extraResources harness/sidecar-entry.mjs" >&2
  exit 1
fi
if ! grep -q '/chrome-sandbox$' "$workdir/rpm-files.txt"; then
  echo "error: RPM missing chrome-sandbox helper" >&2
  exit 1
fi

bsdtar -tf "$pacman_package" > "$workdir/pacman-files.txt"
if ! grep -q '/resources/harness/sidecar-entry.mjs$' "$workdir/pacman-files.txt"; then
  echo "error: pacman package missing extraResources harness/sidecar-entry.mjs" >&2
  exit 1
fi
if ! grep -q '/chrome-sandbox$' "$workdir/pacman-files.txt"; then
  echo "error: pacman package missing chrome-sandbox helper" >&2
  exit 1
fi
echo "smoke-packaged: RPM and pacman packages contain staged harness and chrome-sandbox"

# --- launch AppImage without FUSE; orphan after ready ---
need_cmd xvfb-run

export HOME="$workdir/home"
export DSH_HOME="$workdir/dsh"
export DSH_TELEMETRY_DISABLED=1
export DSH_DESKTOP_SKIP_ONBOARDING=1
mkdir -p "$HOME" "$DSH_HOME"

# First heal can exceed 60s.
ready_timeout=${SMOKE_READY_TIMEOUT:-180}

# --no-sandbox is in the .desktop Exec, but extract-and-run does not use that file.
xvfb-run --auto-servernum --server-args='-screen 0 1280x800x24' \
  "$appimage" --appimage-extract-and-run --no-sandbox \
  >"$workdir/app.out" 2>"$workdir/app.err" &
wrapper_pid=$!

echo "smoke-packaged: launched AppImage extract-and-run pid=$wrapper_pid"

url=
deadline=$((SECONDS + ready_timeout))
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! kill -0 "$wrapper_pid" 2>/dev/null; then
    wait "$wrapper_pid" || true
    wrapper_pid=
    echo "error: packaged app exited before ready" >&2
    echo "----- stdout -----" >&2
    cat "$workdir/app.out" >&2 || true
    echo "----- stderr -----" >&2
    cat "$workdir/app.err" >&2 || true
    exit 1
  fi
  if [ -f "$DSH_HOME/desktop/listen-port" ]; then
    port=$(tr -d '[:space:]' <"$DSH_HOME/desktop/listen-port")
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
  cat "$workdir/app.err" >&2 || true
  echo "----- sidecar.log -----" >&2
  cat "$DSH_HOME/desktop/sidecar.log" >&2 || true
  echo "----- main.log -----" >&2
  cat "$DSH_HOME/desktop/main.log" >&2 || true
  exit 1
fi

echo "smoke-packaged: ready $url"

sidecar_pid=$(pgrep -n -f 'sidecar-entry\.mjs' || true)
if [ -z "$sidecar_pid" ]; then
  echo "error: sidecar-entry.mjs not running after ready" >&2
  exit 1
fi

electron_pid=$(ps -o ppid= -p "$sidecar_pid" | tr -d ' ')
if [ -z "$electron_pid" ] || [ "$electron_pid" = "1" ]; then
  echo "error: could not resolve Electron parent of sidecar pid $sidecar_pid" >&2
  exit 1
fi

echo "smoke-packaged: orphan kill -9 electron=$electron_pid sidecar=$sidecar_pid"
kill -9 "$electron_pid"

gone=0
orphan_deadline=$((SECONDS + 2))
while [ "$SECONDS" -lt "$orphan_deadline" ]; do
  if ! kill -0 "$sidecar_pid" 2>/dev/null; then
    gone=1
    break
  fi
  sleep 0.1
done

if [ "$gone" -ne 1 ]; then
  echo "error: sidecar $sidecar_pid still alive 2s after Electron $electron_pid was killed" >&2
  exit 1
fi

echo "smoke-packaged: sidecar exited after Electron death"

if [ -n "${wrapper_pid:-}" ] && kill -0 "$wrapper_pid" 2>/dev/null; then
  kill -9 "$wrapper_pid" 2>/dev/null || true
  wait "$wrapper_pid" 2>/dev/null || true
fi
wrapper_pid=

# --- unpacked .deb starts (chrome-sandbox setuid as postinst would) ---
# Fresh profile: AppImage left listen-port under the previous DSH_HOME.
export DSH_HOME="$workdir/dsh-deb"
export HOME="$workdir/home-deb"
export ELECTRON_DISABLE_SANDBOX=1
mkdir -p "$HOME" "$DSH_HOME"

# Spaced productName splits Chromium execvp at /opt; package.sh uses productNameSafe.
opt_dir=$(find "$workdir/deb/opt" -mindepth 1 -maxdepth 1 -type d -print -quit || true)
launch_dir="$workdir/deb-launch/$desktop_name"
if [ -z "$opt_dir" ]; then
  echo "error: unpacked .deb has no /opt install directory" >&2
  find "$workdir/deb" -maxdepth 3 -print >&2 || true
  exit 1
fi
mkdir -p "$(dirname "$launch_dir")"
mv "$opt_dir" "$launch_dir"
bin="$launch_dir/$desktop_name"
if [ ! -x "$bin" ]; then
  bin=$(find "$launch_dir" -maxdepth 1 -type f -name "$desktop_name" -print -quit || true)
fi
if [ -z "$bin" ] || [ ! -x "$bin" ]; then
  echo "error: unpacked .deb has no $desktop_name binary" >&2
  ls -la "$launch_dir" >&2 || true
  exit 1
fi

# Unpack is not a real dpkg install: chrome-sandbox is not setuid, and GHA
# kernels reject the zygote sandbox (EINVAL). The shipped .deb Exec stays
# clean (asserted above). This launch is CI-only.
echo "smoke-packaged: unpacked .deb launch uses --no-sandbox (CI unpack only)"
deb_extra=(--no-sandbox --disable-gpu --disable-dev-shm-usage)

xvfb-run --auto-servernum --server-args='-screen 0 1280x800x24' \
  "$bin" "${deb_extra[@]}" \
  >"$workdir/deb.out" 2>"$workdir/deb.err" &
wrapper_pid=$!

deb_url=
deadline=$((SECONDS + ready_timeout))
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! kill -0 "$wrapper_pid" 2>/dev/null; then
    wait "$wrapper_pid" || true
    wrapper_pid=
    echo "error: unpacked .deb app exited before ready" >&2
    echo "----- stdout -----" >&2
    cat "$workdir/deb.out" >&2 || true
    echo "----- stderr -----" >&2
    cat "$workdir/deb.err" >&2 || true
    exit 1
  fi
  if [ -f "$DSH_HOME/desktop/listen-port" ]; then
    port=$(tr -d '[:space:]' <"$DSH_HOME/desktop/listen-port")
    if [ -n "$port" ] && curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$port/"; then
      deb_url="http://127.0.0.1:$port"
      break
    fi
  fi
  sleep 1
done

if [ -z "$deb_url" ]; then
  echo "error: unpacked .deb ready timeout after ${ready_timeout}s" >&2
  echo "----- stdout -----" >&2
  cat "$workdir/deb.out" >&2 || true
  echo "----- stderr -----" >&2
  cat "$workdir/deb.err" >&2 || true
  exit 1
fi

echo "smoke-packaged: unpacked .deb ready $deb_url"
kill -9 "$wrapper_pid" 2>/dev/null || true
wait "$wrapper_pid" 2>/dev/null || true
wrapper_pid=

echo "smoke-packaged: ok"
