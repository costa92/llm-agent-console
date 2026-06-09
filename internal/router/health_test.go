package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/costa92/llm-agent-console/internal/config"
)

// TestHealthAggregate verifies the /api/health handler behaviour:
//   - flow upstream 200-fast   → services.flow.status == "up"
//   - chat upstream 503        → services.chat.status == "down"
//   - memory upstream 200-slow → services.memory.status == "degraded"
//   - probes run in parallel (total time ≈ slowest, not sum)
//
// Sub-test NoLeak asserts the response body never contains the upstream host
// string or any error/url/detail field (T-05-leak).
func TestHealthAggregate(t *testing.T) {
	// Fake upstreams.
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer up.Close()

	down503 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer down503.Close()

	// Sleep > degradedAbove (1s) so memory probe lands in "degraded".
	const slowSleep = 1500 * time.Millisecond
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(slowSleep)
		w.WriteHeader(http.StatusOK)
	}))
	defer slow.Close()

	cfg := &config.Config{
		FlowBase:   up.URL,
		ChatBase:   down503.URL,
		MemoryBase: slow.URL,
	}

	handler := healthAggregateHandler(cfg)

	t.Run("StatusMapping", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()

		start := time.Now()
		handler.ServeHTTP(rec, req)
		elapsed := time.Since(start)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}

		ct := rec.Header().Get("Content-Type")
		if !strings.Contains(ct, "application/json") {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		cc := rec.Header().Get("Cache-Control")
		if !strings.Contains(cc, "no-store") {
			t.Errorf("Cache-Control = %q, want no-store", cc)
		}

		var body struct {
			Services map[string]struct {
				Status      string `json:"status"`
				LastChecked string `json:"lastChecked"`
				LatencyMs   *int64 `json:"latencyMs"`
			} `json:"services"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("invalid JSON: %v\nbody: %s", err, rec.Body.String())
		}

		if got := body.Services["flow"].Status; got != "up" {
			t.Errorf("flow.status = %q, want up", got)
		}
		if got := body.Services["chat"].Status; got != "down" {
			t.Errorf("chat.status = %q, want down", got)
		}
		if got := body.Services["memory"].Status; got != "degraded" {
			t.Errorf("memory.status = %q, want degraded", got)
		}

		// "unknown" must NEVER appear in the server response (D-02: client-only).
		if strings.Contains(rec.Body.String(), "unknown") {
			t.Errorf("response body contains 'unknown'; server must never emit it")
		}

		// Verify probes ran in parallel: total elapsed should be well under 3×
		// the slow-sleep (sequential would be ~4.5s; parallel ≈ 1.5s).
		maxSeq := 3 * slowSleep
		if elapsed >= maxSeq {
			t.Errorf("elapsed=%v ≥ %v — probes appear sequential, not parallel", elapsed, maxSeq)
		}
	})

	t.Run("NoLeak", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		body := rec.Body.String()

		// Upstream hosts must NOT appear in the response.
		for _, srv := range []*httptest.Server{up, down503, slow} {
			host := srv.URL
			// Strip scheme for host-only check.
			host = strings.TrimPrefix(host, "http://")
			if strings.Contains(body, host) {
				t.Errorf("response leaks upstream host %q: %s", host, body)
			}
		}

		// Forbidden field names that would expose error detail.
		for _, forbidden := range []string{`"error"`, `"err"`, `"url"`, `"detail"`} {
			if strings.Contains(body, forbidden) {
				t.Errorf("response contains forbidden field %q: %s", forbidden, body)
			}
		}
	})

	t.Run("MemoryProbeHitsRootMetrics", func(t *testing.T) {
		// memory_base now carries the gateway's /memory API mount, but the
		// gateway serves GET /metrics at the server ROOT. The probe must strip
		// /memory before appending /metrics, i.e. hit /metrics — not
		// /memory/metrics (which 404s → memory always "down").
		var mu sync.Mutex
		var paths []string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			paths = append(paths, r.URL.Path)
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		cfgMem := &config.Config{
			FlowBase:   srv.URL,
			ChatBase:   srv.URL,
			MemoryBase: srv.URL + "/memory",
		}
		h := healthAggregateHandler(cfgMem)
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		mu.Lock()
		recorded := append([]string(nil), paths...)
		mu.Unlock()

		var sawRootMetrics bool
		for _, p := range recorded {
			if p == "/memory/metrics" {
				t.Errorf("memory probe hit %q; want root /metrics (memory_base carries /memory mount)", p)
			}
			if p == "/metrics" {
				sawRootMetrics = true
			}
		}
		if !sawRootMetrics {
			t.Errorf("no probe hit root /metrics; recorded paths = %v", recorded)
		}

		var body struct {
			Services map[string]struct {
				Status string `json:"status"`
			} `json:"services"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("invalid JSON: %v\nbody: %s", err, rec.Body.String())
		}
		if got := body.Services["memory"].Status; got != "up" {
			t.Errorf("memory.status = %q, want up", got)
		}
	})

	t.Run("UnreachableDown", func(t *testing.T) {
		// Use an unroutable port so the probe gets a connection error.
		cfgUnreachable := &config.Config{
			FlowBase:   "http://127.0.0.1:1",
			ChatBase:   "http://127.0.0.1:1",
			MemoryBase: "http://127.0.0.1:1",
		}
		h := healthAggregateHandler(cfgUnreachable)
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		var body struct {
			Services map[string]struct {
				Status string `json:"status"`
			} `json:"services"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("invalid JSON: %v\nbody: %s", err, rec.Body.String())
		}
		for svc, sh := range body.Services {
			if sh.Status != "down" {
				t.Errorf("unreachable %s.status = %q, want down", svc, sh.Status)
			}
		}
		// No upstream host leak.
		raw := rec.Body.String()
		if strings.Contains(raw, "127.0.0.1:1") {
			t.Errorf("response leaks unreachable host: %s", raw)
		}
	})
}
