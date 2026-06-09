// Package router — health aggregate handler.
//
// healthAggregateHandler is the BFF-owned GET /api/health endpoint (D-01). It
// probes flowd /healthz, chat /healthz, and memory-gateway /metrics in
// PARALLEL using goroutines + sync.WaitGroup and maps each to up/down/degraded.
//
// SECURITY (T-05-leak): the DTO carries ONLY status/lastChecked/latencyMs.
// It NEVER echoes the probe URL, the upstream host, or any raw error string.
// "unknown" is a CLIENT-side-only state; this handler never emits it (D-02).
package router

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/costa92/llm-agent-console/internal/config"
)

// perProbeTimeout is the per-upstream HTTP probe deadline. 3s is generous
// enough for a healthy service; an unreachable host will time-out within it.
const perProbeTimeout = 3 * time.Second

// degradedAbove is the latency threshold above which a 2xx probe is reported
// as "degraded" rather than "up". Note: memory-gateway's /metrics endpoint
// does real Prometheus-registry work, so its latency is noisier than a
// dedicated liveness ping — a "degraded" dot here is an amber signal, not
// necessarily a service-level problem. (D-02 / Open-Question #2 resolution.)
const degradedAbove = 1 * time.Second

// serviceHealth is the per-service DTO returned inside {"services":{…}}.
// LatencyMs is omitted from the JSON when negative (connection error).
type serviceHealth struct {
	Status      string `json:"status"`
	LastChecked string `json:"lastChecked"`
	LatencyMs   int64  `json:"latencyMs,omitempty"`
}

// healthProbe pairs a service name with the URL to probe.
type healthProbe struct {
	name string // "memory" | "flow" | "chat"
	url  string
}

// healthAggregateHandler returns a closure-over-cfg http.HandlerFunc that
// probes the three upstreams concurrently and returns a leak-free status DTO.
// It mirrors the configEnvHandler(cfg) pattern in router.go.
func healthAggregateHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		probes := []healthProbe{
			{"flow", cfg.FlowBase + "/healthz"},
			{"chat", cfg.ChatBase + "/healthz"},
			// memory-gateway has no /healthz — use GET /metrics (status only,
			// body discarded). HEAD would 405 under Go 1.22+ method-specific
			// ServeMux. (RESEARCH §Verified Upstream Health Endpoints)
			{"memory", cfg.MemoryBase + "/metrics"},
		}

		results := make(map[string]serviceHealth, len(probes))
		var mu sync.Mutex
		var wg sync.WaitGroup

		// All probes share the same lastChecked timestamp (the handler's wall-
		// clock at request time — consistent across the parallel probes).
		lastChecked := time.Now().UTC().Format(time.RFC3339)

		for _, p := range probes {
			wg.Add(1)
			go func(p healthProbe) {
				defer wg.Done()
				status, latency := probeOne(r.Context(), p.url, perProbeTimeout, degradedAbove)
				sh := serviceHealth{
					Status:      status,
					LastChecked: lastChecked,
				}
				// Omit latencyMs when probeOne could not measure (connection error).
				if latency >= 0 {
					sh.LatencyMs = latency.Milliseconds()
				}
				mu.Lock()
				results[p.name] = sh
				mu.Unlock()
			}(p)
		}
		wg.Wait()

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"services": results})
	}
}

// probeOne performs a single GET probe and maps the outcome to a status string.
//
// Security contract (T-05-leak): it NEVER returns the probe URL, the upstream
// host, or the raw error string — callers receive only the status token and a
// latency duration (or -1 on connection error).
//
//   - 2xx and fast (≤ degradedAbove): "up"
//   - 2xx but slow (> degradedAbove): "degraded"
//   - non-2xx: "down"
//   - transport error / timeout: "down", latency == -1
func probeOne(ctx context.Context, url string, timeout, degradedThreshold time.Duration) (status string, latency time.Duration) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		// Malformed URL in config — treat as unreachable. Do NOT echo the URL.
		return "down", -1
	}

	start := time.Now()
	resp, err := http.DefaultClient.Do(req)
	latency = time.Since(start)

	if err != nil {
		// Transport error (connection refused, timeout, DNS failure, etc.).
		// Never echo err.Error() — it may contain the upstream host.
		return "down", -1
	}
	defer resp.Body.Close()
	// Drain body to release the connection. For memory-gateway /metrics this
	// is a full Prometheus text payload — we NEVER parse it (Pitfall 2).
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "down", latency
	}
	if latency > degradedThreshold {
		return "degraded", latency
	}
	return "up", latency
}
