package router

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/costa92/llm-agent-console/internal/config"
)

// mockCfg returns a config pointing the upstreams at unroutable local ports so
// allowlisted routes attempt to proxy (and fail with 502) rather than 404. The
// distinction under test is route-allowlisting (404 vs not-404), not upstream
// reachability.
func mockCfg() *config.Config {
	cfg := &config.Config{
		MemoryBase: "http://127.0.0.1:1",
		FlowBase:   "http://127.0.0.1:1",
		ChatBase:   "http://127.0.0.1:1",
	}
	cfg.Server.Port = "8090"
	return cfg
}

// TestAllowlist verifies only mapped routes are reachable: /api/memory/* dispatches
// to the memory director (not 404), while an unmapped path returns 404.
func TestAllowlist(t *testing.T) {
	h := New(mockCfg())

	t.Run("nonexistent-404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/nonexistent", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("/api/nonexistent status = %d, want 404", rec.Code)
		}
	})

	t.Run("memory-routed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/memory/items/test", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		// Must NOT be 404 — the route is allowlisted. A 502 (upstream
		// unreachable) is acceptable; 404 would mean not allowlisted.
		if rec.Code == http.StatusNotFound {
			t.Errorf("/api/memory/items/test returned 404; route should be allowlisted")
		}
	})

	t.Run("flow-routed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/flow/flows", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotFound {
			t.Errorf("/api/flow/flows returned 404; route should be allowlisted")
		}
	})

	t.Run("chat-routed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/chat/sessions", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotFound {
			t.Errorf("/api/chat/sessions returned 404; route should be allowlisted")
		}
	})
}

// TestSyntheticReplaySSEHandler verifies GET /api/replay/test:
//   - returns HTTP 200
//   - sets Content-Type: text/event-stream
//   - sets X-Accel-Buffering: no
//   - emits at least one "event: tick" frame (proven via a real server + context cancel)
//
// Using httptest.NewServer (real socket) because httptest.NewRecorder does not flush
// incrementally — the handler would block for all 30 ticks before the recorder saw
// any body, mirroring the approach in sse_test.go TestSyntheticSSE.
func TestSyntheticReplaySSEHandler(t *testing.T) {
	srv := httptest.NewServer(New(&config.Config{}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/replay/test", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/replay/test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
		t.Errorf("Content-Type = %q, want text/event-stream", got)
	}
	if got := resp.Header.Get("X-Accel-Buffering"); got != "no" {
		t.Errorf("X-Accel-Buffering = %q, want no", got)
	}

	scanner := bufio.NewScanner(resp.Body)
	sawTick := false
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "event: tick") {
			sawTick = true
			break
		}
	}
	if !sawTick {
		t.Fatalf("did not observe `event: tick` frame before abort (scanner err: %v)", scanner.Err())
	}
}

// TestConfigEnv verifies /api/config/env returns the active env + base URLs and
// never the flowd_token or operator_token values.
func TestConfigEnv(t *testing.T) {
	cfg := mockCfg()
	cfg.FlowdToken = "leak-me-flowd"
	cfg.OperatorToken = "leak-me-operator"
	h := New(cfg)

	// Operator auth is enabled (token set), so present the bearer to reach the
	// endpoint; the assertion below proves the response still never echoes the
	// token value back.
	req := httptest.NewRequest(http.MethodGet, "/api/config/env", nil)
	req.Header.Set("Authorization", "Bearer leak-me-operator")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v (body=%q)", err, rec.Body.String())
	}
	if _, ok := body["env"]; !ok {
		t.Errorf("response missing %q key; got %v", "env", body)
	}

	// Secrets must NEVER appear in the response, by key or by value.
	raw := rec.Body.String()
	for _, forbidden := range []string{"leak-me-flowd", "leak-me-operator", "flowd_token", "operator_token"} {
		if strings.Contains(raw, forbidden) {
			t.Errorf("/api/config/env response leaked %q: %s", forbidden, raw)
		}
	}
}
