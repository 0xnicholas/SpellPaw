#!/usr/bin/env bash
# SpellPaw — 本地开发一键启动脚本
#
# 用法:
#   ./scripts/dev.sh            # 默认: 启动基础设施 + 迁移 + 种子 + dev server
#   ./scripts/dev.sh up         # 同上
#   ./scripts/dev.sh infra      # 只起 Postgres + Redis
#   ./scripts/dev.sh db         # 只跑 prisma generate + migrate + seed
#   ./scripts/dev.sh down       # 停止基础设施
#   ./scripts/dev.sh reset      # 停止 + 清空卷 + 重新建库（开发数据会丢）
#   ./scripts/dev.sh logs       # 跟随 db/redis 日志
#
# 可用环境变量覆盖:
#   DEV_PORT (默认 3000)        - dev server 端口
#   COMPOSE_FILE (默认 ./docker-compose.yml)
#   SKIP_KILL_STALE (默认 0)    - 设为 1 跳过清理占用 DEV_PORT 的旧进程

set -euo pipefail

# ---------- 配置 ----------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEV_PORT="${DEV_PORT:-3000}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
SKIP_KILL_STALE="${SKIP_KILL_STALE:-0}"
DOCKER_START_TIMEOUT=120   # 等待 Docker daemon 拉起的秒数
SVC_WAIT_TIMEOUT=60        # 等待 Postgres/Redis 就绪的秒数

# 颜色输出（非 tty 时自动关闭）
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

log()  { printf '%s▶ %s%s\n' "$C_BLUE" "$*" "$C_RESET"; }
ok()   { printf '%s✓ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
die()  { printf '%s✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }
step() { printf '\n%s━━ %s ━━%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }

# 选择 docker 命令（compose v2 插件优先）
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  DC=()
fi

# ---------- 依赖检查 ----------
ensure_deps() {
  local missing=()
  command -v pnpm   >/dev/null 2>&1 || missing+=(pnpm)
  command -v docker >/dev/null 2>&1 || missing+=(docker)
  command -v openssl >/dev/null 2>&1 || missing+=(openssl)
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "缺少依赖: ${missing[*]}。请先安装。"
  fi
  ok "依赖检查通过 (pnpm / docker / openssl)"
}

# ---------- Docker daemon ----------
ensure_docker_daemon() {
  if docker info >/dev/null 2>&1; then
    ok "Docker daemon 已运行"
    return
  fi
  warn "Docker daemon 未运行，尝试拉起…"
  case "$(uname -s)" in
    Darwin)
      if [[ -d /Applications/Docker.app ]]; then
        open -ga Docker
      else
        die "未找到 Docker.app，请先安装 Docker Desktop。"
      fi
      ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl start docker || die "无法启动 docker 服务"
      else
        die "无法自动启动 Docker，请手动启动后重试。"
      fi
      ;;
    *)
      die "不支持的系统，请手动启动 Docker。"
      ;;
  esac
  log "等待 Docker daemon 就绪 (最多 ${DOCKER_START_TIMEOUT}s)…"
  local waited=0
  while ! docker info >/dev/null 2>&1; do
    sleep 2; waited=$((waited + 2))
    [[ $waited -ge $DOCKER_START_TIMEOUT ]] && die "Docker daemon 启动超时"
    printf '.'
  done
  printf '\n'
  ok "Docker daemon 已就绪"
}

# ---------- 基础设施 ----------
infra_up() {
  [[ ${#DC[@]} -gt 0 ]] || die "未找到 docker compose 命令"
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
      # 用临时文件安全替换，兼容 BSD/macOS sed
      sed -e "s|^${key}=\"\"|${key}=\"${val}\"|" "$ROOT_DIR/.env" > "$ROOT_DIR/.env.tmp" \
        && mv "$ROOT_DIR/.env.tmp" "$ROOT_DIR/.env"
      changed=1
      warn "已为 ${key} 生成随机值"
    fi
  }
  fill_secret AUTH_SECRET
  fill_secret ENCRYPTION_KEY
  [[ $changed -eq 1 ]] && ok ".env 密钥已补齐" || ok ".env 已就绪"
  # 加载环境变量供后续步骤（prisma / seed 需要 DATABASE_URL）
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
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

# ---------- 数据库 ----------
db_setup() {
  step "Prisma generate"
  pnpm prisma generate
  step "Prisma migrate deploy (非交互，仅应用待迁移)"
  pnpm prisma migrate deploy
  step "种子数据 (幂等: twitter / linkedin / instagram)"
  pnpm db:seed
}

# ---------- dev server ----------
clear_stale_dev() {
  [[ "$SKIP_KILL_STALE" == "1" ]] && return
  local pid
  pid="$(lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n1 || true)"
  if [[ -n "$pid" ]]; then
    local cmd; cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    if echo "$cmd" | grep -qiE 'next dev|next-server'; then
      warn "端口 $DEV_PORT 被旧的 Next dev server (PID $pid) 占用，正在清理…"
      kill "$pid" 2>/dev/null || true
      for _ in {1..10}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.3
      done
      kill -9 "$pid" 2>/dev/null || true
      ok "已清理旧 dev server"
    else
      warn "端口 $DEV_PORT 被 PID $pid 占用但非 Next 进程: ${cmd:0:60}"
      warn "如需让脚本启动 dev server，请手动处理或设置 DEV_PORT"
    fi
  fi
}

run_dev() {
  clear_stale_dev
  step "启动 dev server"
  exec pnpm dev
}

# ---------- 子命令 ----------
cmd_up() {
  ensure_deps
  step "1/4 基础设施 (Postgres + Redis)"
  ensure_docker_daemon
  infra_up
  step "2/4 环境变量"
  ensure_env
  step "3/4 依赖与数据库"
  ensure_node_modules
  db_setup
  step "4/4 dev server"
  run_dev
}

cmd_infra() {
  ensure_deps
  ensure_docker_daemon
  infra_up
  ok "基础设施已启动。容器: db(5433) redis(6379)"
}

cmd_db() {
  ensure_deps
  ensure_env
  ensure_node_modules
  db_setup
}

cmd_down() {
  ensure_deps
  step "停止基础设施"
  "${DC[@]}" -f "$COMPOSE_FILE" down
  ok "已停止"
}

cmd_reset() {
  ensure_deps
  ensure_docker_daemon
  step "停止并清空数据卷（开发数据将丢失）"
  "${DC[@]}" -f "$COMPOSE_FILE" down -v
  warn "已清空卷，重新创建基础设施…"
  infra_up
  ensure_env
  ensure_node_modules
  db_setup
  ok "重置完成，运行 ./scripts/dev.sh 启动"
}

cmd_logs() {
  ensure_deps
  "${DC[@]}" -f "$COMPOSE_FILE" logs -f db redis
}

usage() {
  cat <<EOF
SpellPaw 启动脚本

用法: ./scripts/dev.sh [命令]

命令:
  up       (默认) 启动基础设施 + 迁移 + 种子 + dev server
  infra    仅启动 Postgres + Redis
  db       仅运行 prisma generate + migrate + seed
  down     停止基础设施
  reset    停止 + 清空数据卷 + 重建（开发数据丢失）
  logs     跟随 db / redis 日志
  help     显示帮助

环境变量:
  DEV_PORT          dev server 端口 (默认 3000)
  SKIP_KILL_STALE   1 = 不清理占用 DEV_PORT 的旧进程
EOF
}

# ---------- 入口 ----------
main() {
  local sub="${1:-up}"
  case "$sub" in
    up)    cmd_up ;;
    infra) cmd_infra ;;
    db)    cmd_db ;;
    down)  cmd_down ;;
    reset) cmd_reset ;;
    logs)  cmd_logs ;;
    help|-h|--help) usage ;;
    *) die "未知命令: $sub（试试 ./scripts/dev.sh help）" ;;
  esac
}

main "$@"
