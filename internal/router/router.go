// Package router builds the BFF HTTP handler.
//
// Phase 1 (BFF-03 keystone) mounts only the synthetic SSE proof endpoint and a
// health check. The per-upstream proxy directors (memory/flow/chat) are added
// in later plans; this skeleton exists to prove unbuffered SSE transport
// end-to-end through the fronting nginx before any streaming UI is built.
package router

import (
	"fmt"
	"net/http"
	"time"

	"github.com/costa92/llm-agent-console/internal/config"
)

// syntheticTicks is how many tick frames the SSE proof emits before closing.
const syntheticTicks = 30

// New returns the BFF HTTP handler. cfg is accepted for forward-compatibility
// with later plans that wire the proxy directors from config; Phase 1 does not
// yet read upstream URLs here.
func New(cfg *config.Config) http.Handler {
	_ = cfg // upstream directors are wired in a later plan

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/stream/test", syntheticSSEHandler)
	mux.HandleFunc("GET /healthz", healthHandler)
	return mux
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
