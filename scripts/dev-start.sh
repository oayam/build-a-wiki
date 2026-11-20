#!/usr/bin/env bash
set -euo pipefail

script=$(realpath -- "${BASH_SOURCE[0]}")
root=$(dirname -- "$(dirname -- "$script")")
cd -- "$root"

case "${1:-}" in
  backend|frontend)
    # Keep startup errors visible in a newly opened terminal.
    trap 'result=$?; if (( result != 0 && result != 130 )) && [[ -t 0 ]]; then read -r -p "启动失败，按 Enter 关闭此终端。" || true; fi' EXIT
    if [[ $1 == backend ]]; then
      set -a
      source ./.env
      set +a
      export PATH="$HOME/.cargo/bin:$PATH"
      cargo run --locked --manifest-path backend/Cargo.toml --bin wiki-api
    else
      cd frontend
      npm run dev -- --strictPort
    fi
    exit 0
    ;;
  "") ;;
  *) echo "用法：$0 [frontend|backend]" >&2; exit 2 ;;
esac

if [[ ! -r .env ]]; then
  echo "缺少 $root/.env，请先按 README 的「本地运行」步骤准备开发环境。" >&2
  exit 1
fi

if [[ -n ${WSL_DISTRO_NAME:-} ]] && command -v wt.exe >/dev/null && [[ -z ${TMUX:-} ]]; then
  # Use the same WSL distribution and Linux user as the calling shell.
  wsl=(wsl.exe --distribution "$WSL_DISTRO_NAME" --user "$(id -un)" --exec bash -i "$script")
  exec wt.exe -w new new-tab --title "Wiki 后端" "${wsl[@]}" backend \; \
    new-tab --title "Wiki 前端" "${wsl[@]}" frontend
fi

if ! command -v tmux >/dev/null; then
  echo "需要 Windows Terminal（WSL）或 tmux。也可以在两个终端分别运行 $0 backend 和 $0 frontend。" >&2
  exit 1
fi

session=build-a-wiki-dev
if ! tmux has-session -t "=$session" 2>/dev/null; then
  tmux new-session -d -s "$session" -n backend bash -i "$script" backend \; \
    new-window -t "=$session:" -n frontend bash -i "$script" frontend
fi
if [[ -n ${TMUX:-} ]]; then
  exec tmux switch-client -t "=$session"
fi
exec tmux attach-session -t "=$session"
