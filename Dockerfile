# Multi-stage build for the llm-agent-console BFF.
#
# Needed by deploy/docker-compose.yml so the BFF-03 through-nginx proof
# (scripts/sse-proof.sh PART 2) can build and run the BFF behind nginx.

# --- build stage ---
FROM golang:1.26-alpine AS build
WORKDIR /src

# Cache module downloads.
COPY go.mod go.sum ./
RUN GOWORK=off go mod download

# Build the static BFF binary.
COPY . .
RUN GOWORK=off CGO_ENABLED=0 go build -o /out/console ./cmd/console

# --- runtime stage ---
FROM alpine:3.20
WORKDIR /app
# The BFF reads its config from a file; ship the committed dev sample.
COPY --from=build /out/console /app/console
COPY config/config.dev.yaml /app/config/config.dev.yaml

EXPOSE 8090
ENTRYPOINT ["/app/console"]
CMD ["--config", "/app/config/config.dev.yaml"]
