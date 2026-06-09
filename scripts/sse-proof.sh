#!/usr/bin/env bash
# BFF-03 keystone proof (D-06 / ROADMAP SC4).
#
# Proves SSE events flow incrementally (one tick/second), NOT batched at the end.
#
#   PART 1 — Direct-BFF proof: build + run the BFF, curl -N :8090, assert >= 3
#            incremental `event: tick` frames. Always runs (no Docker needed).
#   PART 2 — Through-nginx proof (the actual BFF-03 gate): docker compose up the
#            bff + nginx stack, curl -N :80 through nginx (gzip on at the http
#            level; the per-location `gzip off` must override it), assert >= 3
#            incremental ticks. Skips with exit 0 if Docker is unavailable.
#
# Run from the repo root: ./scripts/sse-proof.sh
set -uo pipefail

# Resolve repo root (this script lives in <root>/scripts/).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MIN_TICKS=3
BFF_BIN=/tmp/console-proof
DIRECT_OUT=/tmp/sse-direct.txt
NGINX_OUT=/tmp/sse-nginx.txt

banner() { printf '\n========== %s ==========\n' "$1"; }

# ---------------------------------------------------------------------------
# PART 1 — Direct-BFF proof (no Docker required)
# ---------------------------------------------------------------------------
banner "PART 1: direct-BFF SSE proof (:8090)"

echo "[1] building BFF binary..."
if ! GOWORK=off go build -o "$BFF_BIN" ./cmd/console; then
    echo "FAILURE: go build failed"
    exit 1
fi

echo "[2] starting BFF in background..."
"$BFF_BIN" --config config/config.dev.yaml >/tmp/console-proof.log 2>&1 &
BFFPID=$!
# Ensure the BFF is killed on any exit.
cleanup_bff() { kill "$BFFPID" 2>/dev/null; wait "$BFFPID" 2>/dev/null; }
trap cleanup_bff EXIT

echo "[3] waiting for BFF /healthz..."
ready=""
for _ in $(seq 1 10); do
    if curl -sf http://localhost:8090/healthz >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 0.3
done
if [ -z "$ready" ]; then
    echo "FAILURE: BFF did not become ready on :8090"
    cat /tmp/console-proof.log
    exit 1
fi

echo "[4] streaming GET :8090/api/stream/test (max 5s)..."
curl -N http://localhost:8090/api/stream/test --max-time 5 2>/dev/null > "$DIRECT_OUT" &
CURLPID=$!
wait "$CURLPID"

DIRECT_TICKS=$(grep -c 'event: tick' "$DIRECT_OUT" 2>/dev/null || echo 0)
echo "[5] direct tick frames observed: $DIRECT_TICKS (need >= $MIN_TICKS)"

# Stop the BFF now that PART 1 is done.
cleanup_bff
trap - EXIT

if [ "$DIRECT_TICKS" -lt "$MIN_TICKS" ]; then
    echo "PART 1 FAILURE: direct-BFF stream was batched or empty ($DIRECT_TICKS < $MIN_TICKS)"
    echo "If the BFF emitted ticks but they arrived all at once, the handler is not flushing per event."
    exit 1
fi
echo "PART 1 SUCCESS: direct-BFF delivered $DIRECT_TICKS incremental ticks within 5s."

# ---------------------------------------------------------------------------
# PART 2 — Through-nginx proof (the BFF-03 gate per D-06 / ROADMAP SC4)
# ---------------------------------------------------------------------------
banner "PART 2: through-nginx SSE proof (:80)"

if ! command -v docker >/dev/null 2>&1; then
    echo "SKIP: docker not available — run 'docker compose -f deploy/docker-compose.yml up'"
    echo "      manually and verify 'curl -N http://localhost/api/stream/test' emits incremental ticks."
    echo "PART 1 (direct-BFF) already passed; the nginx path is a manual step when Docker is unavailable."
    exit 0
fi

COMPOSE="docker compose -f deploy/docker-compose.yml"

echo "[6] bringing up bff + nginx via docker compose (--wait)..."
if ! $COMPOSE up -d --build --wait; then
    echo "PART 2 FAILURE: docker compose up did not become healthy"
    $COMPOSE logs --no-color 2>&1 | tail -40
    $COMPOSE down -v >/dev/null 2>&1
    exit 1
fi

echo "[7] streaming GET :80/api/stream/test through nginx (max 5s)..."
curl -N http://localhost/api/stream/test --max-time 5 2>/dev/null > "$NGINX_OUT" &
NCURLPID=$!
wait "$NCURLPID"

NGINX_TICKS=$(grep -c 'event: tick' "$NGINX_OUT" 2>/dev/null || echo 0)
echo "[8] through-nginx tick frames observed: $NGINX_TICKS (need >= $MIN_TICKS)"

echo "[9] tearing down compose stack..."
$COMPOSE down -v >/dev/null 2>&1

if [ "$NGINX_TICKS" -lt "$MIN_TICKS" ]; then
    echo "PART 2 FAILURE: nginx batched the SSE stream ($NGINX_TICKS < $MIN_TICKS)."
    echo "Check: proxy_buffering off, gzip off, and SSE location ordering in deploy/nginx.conf."
    exit 1
fi
echo "PART 2 SUCCESS: nginx delivered $NGINX_TICKS incremental ticks within 5s (BFF-03 gate passed)."

# ---------------------------------------------------------------------------
# PART 3 — Through-nginx replay-path proof (:80/api/replay/test)
# ---------------------------------------------------------------------------
banner "PART 3: through-nginx replay-path SSE proof (:80/api/replay/test)"

if ! command -v docker >/dev/null 2>&1; then
    echo "SKIP: docker not available — run 'docker compose -f deploy/docker-compose.yml up'"
    echo "      manually and verify 'curl -N http://localhost/api/replay/test' emits incremental ticks."
    echo "PART 1 (direct-BFF) already passed; the nginx replay path is a manual step when Docker is unavailable."
    exit 0
fi

REPLAY_OUT=/tmp/sse-replay.txt
PART3_STARTED=""

# Reuse the compose stack if it is still up (PART 2 tore it down above, so bring it up again).
if [ -z "$($COMPOSE ps --quiet bff 2>/dev/null)" ]; then
    echo "[10] bringing up bff + nginx via docker compose (--wait) for replay-path proof..."
    if ! $COMPOSE up -d --build --wait; then
        echo "PART 3 FAILURE: docker compose up did not become healthy (replay pre-step)"
        $COMPOSE logs --no-color 2>&1 | tail -40
        $COMPOSE down -v >/dev/null 2>&1
        exit 1
    fi
    PART3_STARTED=1
fi

echo "[11] streaming GET :80/api/replay/test through nginx (max 5s)..."
curl -N http://localhost/api/replay/test --max-time 5 2>/dev/null > "$REPLAY_OUT" &
RCURLPID=$!
wait "$RCURLPID"

REPLAY_TICKS=$(grep -c 'event: tick' "$REPLAY_OUT" 2>/dev/null || echo 0)
echo "[12] through-nginx replay-path tick frames observed: $REPLAY_TICKS (need >= $MIN_TICKS)"

if [ -n "$PART3_STARTED" ]; then
    echo "[13] tearing down compose stack (started by PART 3)..."
    $COMPOSE down -v >/dev/null 2>&1
fi

if [ "$REPLAY_TICKS" -lt "$MIN_TICKS" ]; then
    echo "PART 3 FAILURE: nginx did not deliver incremental replay ticks ($REPLAY_TICKS < $MIN_TICKS)."
    echo "Check: location ~* ^/api/.*(stream|replay) in deploy/nginx.conf."
    exit 1
fi
echo "PART 3 SUCCESS: nginx delivered $REPLAY_TICKS incremental replay ticks (GAP-1 fix confirmed: (stream|replay) regex active)."

banner "BFF-03 + REPLAY PROOF COMPLETE — all three legs incremental"
exit 0
