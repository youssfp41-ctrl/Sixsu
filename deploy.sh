#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sixsu Bot — Production Deployment Script
#
# Usage:
#   bash deploy.sh              # first-time deploy (production)
#   bash deploy.sh --restart    # rebuild + graceful reload existing process
#   bash deploy.sh --stop       # stop the bot
#   bash deploy.sh --status     # show PM2 status
#   bash deploy.sh --logs       # stream live logs
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_NAME="sixsu-bot"
ENV="${NODE_ENV:-production}"

# ─── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[deploy]${RESET} $*"; }
success() { echo -e "${GREEN}[deploy]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${RESET} $*"; }
fatal()   { echo -e "${RED}[deploy] FATAL:${RESET} $*" >&2; exit 1; }

# ─── Flags ────────────────────────────────────────────────────────────────────
MODE="start"
for arg in "$@"; do
  case "$arg" in
    --restart) MODE="restart" ;;
    --stop)    MODE="stop"    ;;
    --status)  MODE="status"  ;;
    --logs)    MODE="logs"    ;;
    --help|-h)
      sed -n '2,10p' "$0" | sed 's/^# //;s/^#//'
      exit 0
      ;;
    *)
      warn "Unknown flag: $arg  (run with --help for usage)"
      ;;
  esac
done

# ─── Guards ───────────────────────────────────────────────────────────────────
command -v node  >/dev/null 2>&1 || fatal "node is not installed."
command -v pnpm  >/dev/null 2>&1 || fatal "pnpm is not installed."
command -v pm2   >/dev/null 2>&1 || fatal "pm2 is not installed. Run: npm install -g pm2"

[[ -f ".env" ]] || warn ".env file not found — make sure env vars are set in the environment."
[[ -f "ecosystem.config.js" ]] || fatal "ecosystem.config.js not found. Run from the project root."

# ─── Actions ──────────────────────────────────────────────────────────────────
case "$MODE" in

  # ── stop ──────────────────────────────────────────────────────────────────
  stop)
    info "Stopping $APP_NAME..."
    pm2 stop "$APP_NAME" 2>/dev/null || warn "$APP_NAME is not running."
    success "Stopped."
    exit 0
    ;;

  # ── status ─────────────────────────────────────────────────────────────────
  status)
    pm2 status
    exit 0
    ;;

  # ── logs ───────────────────────────────────────────────────────────────────
  logs)
    exec pm2 logs "$APP_NAME"
    ;;

  # ── restart (graceful reload) ───────────────────────────────────────────────
  restart)
    info "Rebuilding..."
    pnpm run build

    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
      info "Reloading $APP_NAME (graceful)..."
      pm2 reload ecosystem.config.js --env "$ENV"
    else
      warn "$APP_NAME not found in PM2 — starting fresh."
      pm2 start ecosystem.config.js --env "$ENV"
    fi

    pm2 save
    success "Reloaded successfully."
    exit 0
    ;;

  # ── start (first-time deploy) ────────────────────────────────────────────
  start)
    info "Installing dependencies..."
    pnpm install --frozen-lockfile

    info "Building TypeScript..."
    pnpm run build

    info "Creating logs/ directory..."
    mkdir -p logs

    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
      warn "$APP_NAME already running — use --restart to reload."
      pm2 status
      exit 0
    fi

    info "Starting $APP_NAME in $ENV mode..."
    pm2 start ecosystem.config.js --env "$ENV"

    info "Saving PM2 process list..."
    pm2 save

    echo ""
    success "${BOLD}Deployment complete!${RESET}"
    echo -e "  ${CYAN}Logs:${RESET}   pm2 logs $APP_NAME"
    echo -e "  ${CYAN}Status:${RESET} pm2 status"
    echo -e "  ${CYAN}Stop:${RESET}   bash deploy.sh --stop"
    echo ""

    pm2 status
    ;;
esac
