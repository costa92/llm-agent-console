package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
