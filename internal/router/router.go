// Package router builds the BFF HTTP handler.
//
// It mounts the synthetic SSE proof endpoint (BFF-03), a health check, the three
// allowlisted upstream proxy directors (memory/flow/chat), and the read-only
// /api/config/env endpoint (SHELL-04). The whole mux is wrapped by the app-layer
// operator-token middleware (CONTEXT D-01): non-allowlisted paths return 404, and
// only mapped upstream routes are proxied (no open proxy / SSRF surface).
package router

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/costa92/llm-agent-console/internal/config"
	"github.com/costa92/llm-agent-console/internal/proxy"
)

// syntheticTicks is how many tick frames the SSE proof emits before closing.
const syntheticTicks = 30

// New returns the BFF HTTP handler. It wires the three upstream proxy directors
// from cfg, the synthetic SSE proof, the health check, and /api/config/env, then
// wraps the whole mux with the operator-token middleware so auth gates every
// route (empty operator token = disabled in dev).
//
// Upstream routes use http.StripPrefix so the directors receive an already-
// stripped path (e.g. /api/memory/items/1 → /items/1 at the gateway). Only these
// mapped prefixes are reachable; any other /api/* path falls through to 404.
func New(cfg *config.Config) http.Handler {
	mux := http.NewServeMux()

	// Allowlisted upstream proxies (one director per upstream auth model).
	mux.Handle("/api/memory/", http.StripPrefix("/api/memory", proxy.NewMemoryProxy(cfg)))
	mux.Handle("/api/flow/", http.StripPrefix("/api/flow", proxy.NewFlowProxy(cfg)))
	mux.Handle("/api/chat/", http.StripPrefix("/api/chat", proxy.NewChatProxy(cfg)))

	// BFF-03 synthetic SSE proof + health check (no auth on healthz).
	mux.HandleFunc("GET /api/stream/test", syntheticSSEHandler)
	mux.HandleFunc("GET /healthz", healthHandler)

	// SHELL-04: active environment/endpoint indicator (read-only, no secrets).
	mux.HandleFunc("GET /api/config/env", configEnvHandler(cfg))

	// Gate every route behind the app-layer operator token (D-01).
	return proxy.MiddlewareOperatorAuth(cfg.OperatorToken, mux)
}

// configEnvHandler serves SHELL-04: the active environment name and the upstream
// base URLs the BFF targets. It deliberately EXCLUDES every secret
// (flowd_token, operator_token) — only non-secret targeting info is exposed.
func configEnvHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"env":         "dev",
			"memory_base": cfg.MemoryBase,
			"flow_base":   cfg.FlowBase,
			"chat_base":   cfg.ChatBase,
		})
	}
}

// healthHandler returns 200 with a small JSON body for compose health checks.
// It requires no auth (consistent with the upstream /healthz bypass pattern).
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

// syntheticSSEHandler emits a timestamped `event: tick` frame every second for
// syntheticTicks ticks, then an `event: done` frame, flushing after every
// write. It sets the SSE transport headers (Content-Type text/event-stream,
// X-Accel-Buffering: no, Cache-Control: no-cache, no-transform) so the response
// is self-describing for any intermediate proxy (D-06). This endpoint requires
// no operator auth — it is a BFF-03 transport proof only.
func syntheticSSEHandler(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	n := 0
	for {
		select {
		case t := <-ticker.C:
			fmt.Fprintf(w, "event: tick\ndata: {\"t\":%d,\"ts\":\"%s\"}\n\n",
				n, t.UTC().Format(time.RFC3339))
			flusher.Flush()
			n++
			if n >= syntheticTicks {
				fmt.Fprintf(w, "event: done\ndata: {\"ticks\":%d}\n\n", syntheticTicks)
				flusher.Flush()
				return
			}
		case <-r.Context().Done():
			// Client disconnected — stop emitting.
			return
		}
	}
}
