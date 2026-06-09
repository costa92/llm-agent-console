.PHONY: spa-build up down proof

# spa-build: install node deps (offline-prefer) then build the SPA into web/dist/.
# This MUST be run before `make up` on a fresh checkout or after SPA code changes.
spa-build:
	npm --prefix web ci --prefer-offline 2>/dev/null || npm --prefix web install
	npm --prefix web run build

# up: build the SPA, then bring up the bff + nginx compose stack.
# Requires Docker and a populated web/dist/ (handled by the spa-build dependency).
up: spa-build
	docker compose -f deploy/docker-compose.yml up -d --build --wait

# down: tear down the compose stack (containers + anonymous volumes).
down:
	docker compose -f deploy/docker-compose.yml down

# proof: run the full SSE proof harness (PART 1 direct-BFF + PART 2 + PART 3 through-nginx).
# Requires Docker for PART 2 and PART 3 (skips gracefully if Docker is unavailable).
proof:
	./scripts/sse-proof.sh
