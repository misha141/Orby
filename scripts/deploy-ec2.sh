#!/usr/bin/env bash
# Sync Orby to EC2 and run docker compose (build + up).
#
# Usage:
#   ./scripts/deploy-ec2.sh              # rsync + docker compose up -d --build
#   ./scripts/deploy-ec2.sh --no-build   # rsync + up -d (no image rebuild)
#   ./scripts/deploy-ec2.sh --sync-only  # rsync only
#
# Setup: cp scripts/deploy-ec2.env.example scripts/deploy-ec2.env && edit deploy-ec2.env
#
# Debug SSH: DEPLOY_SSH_DEBUG=1 ./scripts/deploy-ec2.sh

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORBY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$SCRIPT_DIR/deploy-ec2.env" ]]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/deploy-ec2.env"
fi

EC2_USER="${EC2_USER:-ubuntu}"
EC2_HOST="${EC2_HOST:-}"
EC2_KEY="${EC2_KEY:-}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/orby}"

SYNC_ONLY=0
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --sync-only) SYNC_ONLY=1 ;;
    --no-build) NO_BUILD=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | tail -n +2
      exit 0
      ;;
  esac
done

if [[ -z "$EC2_HOST" ]]; then
  echo "Error: EC2_HOST is not set. Create scripts/deploy-ec2.env from deploy-ec2.env.example" >&2
  exit 1
fi

if [[ "$REMOTE_DIR" == /Users/* ]]; then
  echo "Error: REMOTE_DIR=$REMOTE_DIR looks like a Mac path." >&2
  echo "       Use a path on the Linux server, e.g. REMOTE_DIR=/home/ubuntu/orby or REMOTE_DIR=~/orby" >&2
  exit 1
fi

# Resolve relative EC2_KEY (works no matter which directory you run the script from)
if [[ -n "$EC2_KEY" && "$EC2_KEY" != /* ]]; then
  if [[ -f "$SCRIPT_DIR/$EC2_KEY" ]]; then
    EC2_KEY="$SCRIPT_DIR/$EC2_KEY"
  elif [[ -f "$ORBY_ROOT/$EC2_KEY" ]]; then
    EC2_KEY="$ORBY_ROOT/$EC2_KEY"
  fi
fi

if [[ -n "$EC2_KEY" && ! -f "$EC2_KEY" ]]; then
  echo "Error: EC2_KEY file not found: $EC2_KEY" >&2
  exit 1
fi

# EC2_HOST can be "1.2.3.4" or "ubuntu@1.2.3.4"
if [[ "$EC2_HOST" == *"@"* ]]; then
  TARGET="$EC2_HOST"
else
  TARGET="${EC2_USER}@${EC2_HOST}"
fi

ssh_fail_help() {
  echo "" >&2
  echo "SSH publickey auth failed. Common fixes:" >&2
  echo "  • AWS console → EC2 → Instances → select instance → Key pair name must match this .pem." >&2
  echo "  • Wrong OS user: Amazon Linux → EC2_USER=ec2-user ; Ubuntu → EC2_USER=ubuntu" >&2
  echo "  • Test manually: ssh -i \"${EC2_KEY:-~/.ssh/key.pem}\" $TARGET" >&2
  echo "  • Verbose: DEPLOY_SSH_DEBUG=1 ./scripts/deploy-ec2.sh" >&2
}

ssh_base() {
  local ssh_debug=0
  [[ "${DEPLOY_SSH_DEBUG:-}" == 1 ]] && ssh_debug=1

  if [[ -n "$EC2_KEY" && -f "$EC2_KEY" ]]; then
    if [[ "$ssh_debug" -eq 1 ]]; then
      ssh -vvv -i "$EC2_KEY" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes "$@"
    else
      ssh -i "$EC2_KEY" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes "$@"
    fi
  else
    if [[ "$ssh_debug" -eq 1 ]]; then
      ssh -vvv -o StrictHostKeyChecking=accept-new "$@"
    else
      ssh -o StrictHostKeyChecking=accept-new "$@"
    fi
  fi
}

rsync_ssh() {
  local v=""
  [[ "${DEPLOY_SSH_DEBUG:-}" == 1 ]] && v="-vvv "
  if [[ -n "$EC2_KEY" && -f "$EC2_KEY" ]]; then
    echo "ssh ${v}-i $(printf '%q' "$EC2_KEY") -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes"
  else
    echo "ssh ${v}-o StrictHostKeyChecking=accept-new"
  fi
}

RSYNC_SSH=$(rsync_ssh)

echo "==> SSH target: $TARGET"
echo "==> Using key: ${EC2_KEY:-'(default ssh agent — set EC2_KEY in deploy-ec2.env)'}"
echo "==> Ensuring remote directory exists: $REMOTE_DIR"
if ! ssh_base "$TARGET" "bash -lc $(printf '%q' "mkdir -p $REMOTE_DIR")"; then
  ssh_fail_help
  exit 1
fi

echo "==> Syncing $ORBY_ROOT -> $TARGET:$REMOTE_DIR"

rsync -az --progress --delete \
  -e "$RSYNC_SSH" \
  --exclude 'node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/.next' \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude 'scripts/deploy-ec2.env' \
  --exclude 'scripts/*.pem' \
  "$ORBY_ROOT/" \
  "$TARGET:$REMOTE_DIR/"

echo "==> Rsync finished"

if [[ "$SYNC_ONLY" -eq 1 ]]; then
  echo "==> --sync-only: skipping docker compose"
  exit 0
fi

echo "==> Checking required remote env files"
if ! ssh_base "$TARGET" "test -f $(printf '%q' "$REMOTE_DIR/.env")"; then
  echo "Error: missing required file on server: $REMOTE_DIR/.env" >&2
  echo "Create local .env in the project root so deploy can sync it." >&2
  echo "You can copy from .env.docker.example and set your EC2 URLs." >&2
  exit 1
fi

if ! ssh_base "$TARGET" "test -f $(printf '%q' "$REMOTE_DIR/backend/.env")"; then
  echo "Error: missing required file on server: $REMOTE_DIR/backend/.env" >&2
  echo "Create local backend/.env so deploy can sync it." >&2
  exit 1
fi

REMOTE_CMD="cd $REMOTE_DIR && docker compose up -d"
if [[ "$NO_BUILD" -eq 0 ]]; then
  REMOTE_CMD=$(cat <<EOF
cd $REMOTE_DIR
build_output=\$(docker compose up -d --build 2>&1)
build_status=\$?
if [ "\$build_status" -eq 0 ]; then
  printf '%s\n' "\$build_output"
elif printf '%s\n' "\$build_output" | grep -Fq 'compose build requires buildx'; then
  printf '%s\n' "\$build_output"
  echo "buildx is too old; retrying with legacy Docker builder"
  DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose up -d --build
else
  printf '%s\n' "\$build_output"
  exit "\$build_status"
fi
EOF
)
fi

echo "==> Remote: $REMOTE_CMD"
ssh_base "$TARGET" "bash -lc $(printf '%q' "$REMOTE_CMD")"

DISPLAY_HOST="$EC2_HOST"
[[ "$DISPLAY_HOST" == *"@"* ]] && DISPLAY_HOST="${DISPLAY_HOST#*@}"
echo "==> Done. Frontend: http://${DISPLAY_HOST}:3000 (if SG allows) — API :4000"
