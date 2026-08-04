#!/usr/bin/env bash
# SpellPaw — 生产模式服务管理脚本（启动 / 重启 / 停止 / 状态 / 日志）
#
# 用法:
#   ./scripts/app.sh start           # 构建（如需要）+ 启动生产 server（后台）
#   ./scripts/app.sh start --skip-build   # 不重新构建，直接启动
#   ./scripts/app.sh start --build   # 强制重新构建再启动
#   ./scripts/app.sh stop            # 优雅停止（等待退出，超时强杀）
#   ./scripts/app.sh restart         # 停止 + 启动（可加 --build / --skip-build）
#   ./scripts/app.sh status          # 查看运行状态 + 健康检查
#   ./scripts/app.sh logs            # 跟随应用日志
#   ./scripts/app.sh help
#
# 可用环境变量覆盖:
#   APP_PORT (默认 3000)        - 应用监听端口
#   APP_START_TIMEOUT (默认 90) - 启动后等待健康检查的秒数
#   APP_STOP_TIMEOUT (默认 15)  - 停止时等待优雅退出的秒数
#   COMPOSE_FILE (默认 ./docker-compose.yml)
#
# 产物位置:
#   .runtime/app.pid           - 实际 server 进程 PID
#   .runtime/app.launcher.pid  - 后台启动器（pnpm start）PID
#   .runtime/app.log           - 应用日志（stdout + stderr）

set -euo pipefail

# ---------- 配置 ----------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_PORT="${APP_PORT:-3000}"
APP_START_TIMEOUT="${APP_START_TIMEOUT:-90}"
APP_STOP_TIMEOUT="${APP_STOP_TIMEOUT:-15}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/app.pid"
LAUNCHER_PID_FILE="$RUNTIME_DIR/app.launcher.pid"
LOG_FILE="$RUNTIME_DIR/app.log"
SVC_WAIT_TIMEOUT=60        # 等待 Postgres/Redis 就绪的秒数
HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"

# 颜色输出（非 tty 时自动关闭）
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

log()  { printf '%s▶ %s%s\n' "$C_BLUE" "$*" "$C_RESET"; }
ok()   { printf '%s✓ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
die()  { printf '%s✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }
step() { printf '\n%s━━ %s ━━%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }

# ---------- 依赖检查 ----------
ensure_deps() {
  local missing=()
  command -v pnpm    >/dev/null 2>&1 || missing+=(pnpm)
  command -v docker  >/dev/null 2>&1 || missing+=(docker)
  command -v curl    >/dev/null 2>&1 || missing+=(curl)
  command -v lsof    >/dev/null 2>&1 || missing+=(lsof)
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "缺少依赖: ${missing[*]}。请先安装。"
  fi
  ok "依赖检查通过 (pnpm / docker / curl / lsof)"
}

# 选择 docker compose 命令（compose v2 插件优先）
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  DC=()
fi

# ---------- 基础设施（Postgres + Redis）----------
ensure_infra() {
  [[ ${#DC[@]} -gt 0 ]] || die "未找到 docker compose 命令"
  # 容器已健康则跳过
  if docker ps --filter name=spellpaw-db --filter status=running --format '{{.Names}}' | grep -q spellpaw-db \
     && docker ps --filter name=spellpaw-redis --filter status=running --format '{{.Names}}' | grep -q spellpaw-redis; then
    ok "基础设施已运行 (db / redis)"
    return
  fi
  log "基础设施未运行，启动 Postgres + Redis…"
  "${DC[@]}" -f "$COMPOSE_FILE" up -d
  wait_for_postgres
  wait_for_redis
}

wait_for_postgres() {
  log "等待 Postgres 就绪…"
  local waited=0
  while ! docker exec spellpaw-db pg_isready -U spellpaw -d spellpaw >/dev/null 2>&1; do
    sleep 1; waited=$((waited + 1))
    [[ $waited -ge $SVC_WAIT_TIMEOUT ]] && die "Postgres 就绪超时"
  done
  ok "Postgres 就绪 (port 5433)"
}

wait_for_redis() {
  log "等待 Redis 就绪…"
  local waited=0
  while ! docker exec spellpaw-redis redis-cli ping >/dev/null 2>&1; do
    sleep 1; waited=$((waited + 1))
    [[ $waited -ge $SVC_WAIT_TIMEOUT ]] && die "Redis 就绪超时"
  done
  ok "Redis 就绪 (port 6379)"
}

# ---------- 环境变量 ----------
ensure_env() {
  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    warn ".env 不存在，从 .env.example 创建…"
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  fi
  # 补齐可能缺失的密钥（仅当值为空时填充）
  local changed=0
  fill_secret() {
    local key="$1"
    if grep -qE "^${key}=\"[[:space:]]*\"$" "$ROOT_DIR/.env"; then
      local val; val="$(openssl rand -base64 32)"
      sed -e "s|^${key}=\"\"|${key}=\"${val}\"|" "$ROOT_DIR/.env" > "$ROOT_DIR/.env.tmp" \
        && mv "$ROOT_DIR/.env.tmp" "$ROOT_DIR/.env"
      changed=1
      warn "已为 ${key} 生成随机值"
    fi
  }
  fill_secret AUTH_SECRET
  fill_secret ENCRYPTION_KEY
  if [[ $changed -eq 1 ]]; then ok ".env 密钥已补齐"; else ok ".env 已就绪"; fi
  # 校验 .env 可被正确加载（不导入，避免与脚本自身变量冲突）
  # shellcheck disable=SC1091
  if ! (set -a; . "$ROOT_DIR/.env"; set +a) >/dev/null 2>&1; then
    die ".env 解析失败，请检查格式"
  fi
}

# ---------- 依赖安装 ----------
ensure_node_modules() {
  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    step "安装依赖"
    pnpm install
  else
    ok "node_modules 已存在，跳过 install"
  fi
}

# ---------- 构建 ----------
needs_build() {
  [[ -f "$ROOT_DIR/.next/BUILD_ID" ]]
}

build_app() {
  step "生产构建 (pnpm build)"
  pnpm build
  ok "构建完成"
}

# ---------- 进程管理 ----------
# 读取 PID 文件并校验进程仍存活；不存在/已死返回空
read_pid() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    printf '%s' "$pid"
  else
    rm -f "$file"
  fi
}

# 端口上是否有 next-server 在监听（返回 PID）
port_server_pid() {
  local pid
  pid="$(lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n1 || true)"
  if [[ -n "$pid" ]] && ps -o command= -p "$pid" 2>/dev/null | grep -qiE 'next-server|next start'; then
    printf '%s' "$pid"
  fi
}

is_running() {
  local pid
  pid="$(read_pid "$PID_FILE")"
  [[ -n "$pid" ]] || [[ -n "$(port_server_pid)" ]]
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

wait_pid_exit() {
  local pid="$1" timeout="$2" waited=0
  while pid_alive "$pid"; do
    sleep 1; waited=$((waited + 1))
    [[ $waited -ge $timeout ]] && return 1
  done
  return 0
}

stop_app() {
  local launcher server pid
  launcher="$(read_pid "$LAUNCHER_PID_FILE")"
  server="$(read_pid "$PID_FILE")"

  if [[ -z "$launcher" && -z "$server" ]]; then
    server="$(port_server_pid)"   # PID 文件丢失时的兜底：按端口找
  fi

  if [[ -z "$launcher" && -z "$server" ]]; then
    warn "应用未在运行，无需停止"
    return 0
  fi

  step "停止应用 (port $APP_PORT)"
  for pid in "$launcher" "$server"; do
    [[ -n "$pid" ]] && pid_alive "$pid" && { log "发送 SIGTERM → PID $pid"; kill "$pid" 2>/dev/null || true; }
  done

  # 等待优雅退出（Next.js / BullMQ worker 收到 SIGTERM 后清理连接）
  local waited=0
  while pid_alive "$server" || pid_alive "$launcher"; do
    if [[ $waited -ge $APP_STOP_TIMEOUT ]]; then
      warn "优雅退出超时 (${APP_STOP_TIMEOUT}s)，强制终止…"
      for pid in "$launcher" "$server"; do
        pid_alive "$pid" && { kill -9 "$pid" 2>/dev/null || true; }
      done
      sleep 1
      break
    fi
    sleep 1; waited=$((waited + 1))
  done

  # 兜底：端口仍被 next-server 占用则强杀
  local leftover
  leftover="$(port_server_pid)"
  if [[ -n "$leftover" ]]; then
    warn "端口 $APP_PORT 仍被 PID $leftover 占用，强制清理…"
    kill -9 "$leftover" 2>/dev/null || true
    sleep 1
  fi

  rm -f "$PID_FILE" "$LAUNCHER_PID_FILE"
  ok "应用已停止"
}

# ---------- 启动 ----------
launch_app() {
  # 防冲突：端口被非 Next 进程占用时拒绝启动
  local holder
  holder="$(lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n1 || true)"
  if [[ -n "$holder" ]] && ! ps -o command= -p "$holder" 2>/dev/null | grep -qiE 'next-server|next start'; then
    die "端口 $APP_PORT 被 PID $holder 占用（非 Next 进程），请处理后重试或设置 APP_PORT"
  fi

  mkdir -p "$RUNTIME_DIR"
  step "启动生产 server (port $APP_PORT, 日志: $LOG_FILE)"
  NODE_ENV=production nohup pnpm start --port "$APP_PORT" >> "$LOG_FILE" 2>&1 &
  local launcher_pid=$!
  echo "$launcher_pid" > "$LAUNCHER_PID_FILE"

  # 等待健康检查通过
  log "等待健康检查 $HEALTH_URL (最多 ${APP_START_TIMEOUT}s)…"
  local waited=0
  while ! curl -sf "$HEALTH_URL" >/dev/null 2>&1; do
    if ! pid_alive "$launcher_pid"; then
      echo "--- 进程已退出，最近日志 ---" >&2
      tail -n 30 "$LOG_FILE" >&2 || true
      rm -f "$LAUNCHER_PID_FILE" "$PID_FILE"
      die "应用进程启动后即退出，详见日志: $LOG_FILE"
    fi
    sleep 1; waited=$((waited + 1))
    if [[ $waited -ge $APP_START_TIMEOUT ]]; then
      warn "健康检查超时，进程仍在运行，请检查日志: $LOG_FILE"
      warn "可用 ./scripts/app.sh logs 查看日志"
      return 1
    fi
  done

  # 记录真实 server PID（pnpm 可能 fork 子进程，以监听端口的为准）
  local server_pid
  server_pid="$(port_server_pid)"
  if [[ -z "$server_pid" ]]; then
    server_pid="$launcher_pid"
  fi
  echo "$server_pid" > "$PID_FILE"
  ok "应用已启动 (PID $server_pid, http://localhost:$APP_PORT)"
}

cmd_start() {
  local build_mode="auto"
  for arg in "$@"; do
    case "$arg" in
      --build)      build_mode="force" ;;
      --skip-build) build_mode="skip" ;;
      *) die "未知参数: $arg（支持 --build / --skip-build）" ;;
    esac
  done

  if is_running; then
    warn "应用已在运行，请先 ./scripts/app.sh stop 或使用 restart"
    return 1
  fi

  ensure_deps
  step "1/4 基础设施 (Postgres + Redis)"
  ensure_infra
  step "2/4 环境变量"
  ensure_env
  step "3/4 依赖与构建"
  ensure_node_modules
  case "$build_mode" in
    force) build_app ;;
    skip)  ok "跳过构建 (--skip-build)" ;;
    auto)  if needs_build; then ok "检测到生产构建产物，跳过构建 (用 --build 强制重建)"; else build_app; fi ;;
  esac
  step "4/4 启动应用"
  launch_app
}

cmd_stop() {
  ensure_deps
  stop_app
}

cmd_restart() {
  local build_args=()
  for arg in "$@"; do
    case "$arg" in
      --build|--skip-build) build_args+=("$arg") ;;
      *) die "未知参数: $arg（支持 --build / --skip-build）" ;;
    esac
  done
  step "重启应用"
  stop_app
  cmd_start "${build_args[@]}"
}

cmd_status() {
  local pid server_pid launcher_pid
  pid="$(read_pid "$PID_FILE")"
  launcher_pid="$(read_pid "$LAUNCHER_PID_FILE")"
  server_pid="$(port_server_pid)"

  step "应用状态"
  if [[ -n "$pid" || -n "$server_pid" ]]; then
    local p="${server_pid:-$pid}"
    ok "运行中 — PID $p, 端口 $APP_PORT"
    local uptime; uptime="$(ps -o etime= -p "$p" 2>/dev/null | tr -d ' ' || true)"
    [[ -n "$uptime" ]] && echo "  已运行: ${uptime}"
    echo "  启动器 PID: ${launcher_pid:--}"
    echo "  日志: $LOG_FILE"
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
      ok "健康检查 $HEALTH_URL → OK"
    else
      warn "健康检查 $HEALTH_URL → 未通过"
    fi
  else
    warn "未运行"
  fi

  step "基础设施状态"
  if docker ps --filter name=spellpaw-db --filter status=running --format '{{.Names}}' | grep -q spellpaw-db \
     && docker ps --filter name=spellpaw-redis --filter status=running --format '{{.Names}}' | grep -q spellpaw-redis; then
    ok "db (5433) / redis (6379) 运行中"
  else
    warn "db / redis 未运行（启动应用时自动拉起，或 ./scripts/dev.sh infra）"
  fi
}

cmd_logs() {
  [[ -f "$LOG_FILE" ]] || die "日志文件不存在（应用尚未启动过）: $LOG_FILE"
  tail -f "$LOG_FILE"
}

usage() {
  cat <<EOF
SpellPaw 生产服务管理脚本

用法: ./scripts/app.sh <命令> [参数]

命令:
  start            构建（如需要）+ 启动生产 server（后台运行）
    --build        强制重新构建
    --skip-build   跳过构建直接启动
  stop             停止应用（SIGTERM 优雅退出，超时强杀）
  restart          停止 + 启动（可加 --build / --skip-build）
  status           查看应用与基础设施状态、健康检查
  logs             跟随应用日志
  help             显示帮助

环境变量:
  APP_PORT          应用监听端口 (默认 3000)
  APP_START_TIMEOUT 健康检查等待秒数 (默认 90)
  APP_STOP_TIMEOUT  优雅退出等待秒数 (默认 15)

文件:
  .runtime/app.pid / app.launcher.pid / app.log
EOF
}

# ---------- 入口 ----------
main() {
  local sub="${1:-help}"
  shift || true
  case "$sub" in
    start)   cmd_start "$@" ;;
    stop)    cmd_stop ;;
    restart) cmd_restart "$@" ;;
    status)  cmd_status ;;
    logs)    cmd_logs ;;
    help|-h|--help) usage ;;
    *) die "未知命令: $sub（试试 ./scripts/app.sh help）" ;;
  esac
}

main "$@"
