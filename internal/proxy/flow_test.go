package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/costa92/llm-agent-console/internal/config"
)

// TestFlowDirector verifies the flow director strips any inbound Authorization
// (operator token) and injects the configured flowd bearer token instead, and
// that X-Console-* headers never reach the upstream.
func TestFlowDirector(t *testing.T) {
	srv, got := captureUpstream(t)
	cfg := &config.Config{FlowBase: srv.URL, FlowdToken: "flowd-secret-xyz"}

	p := NewFlowProxy(cfg)

	req := httptest.NewRequest(http.MethodGet, "/flows", nil)
	req.Header.Set("Authorization", "Bearer operator-token") // must be replaced
	req.Header.Set("X-Console-Tenant", "tenant-a")
	req.Header.Set("X-Console-User", "user-b")

	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)

	if v := got.Header.Get("Authorization"); v != "Bearer flowd-secret-xyz" {
		t.Errorf("Authorization = %q, want %q", v, "Bearer flowd-secret-xyz")
	}
	if got.Header.Get("Authorization") == "Bearer operator-token" {
		t.Error("inbound operator token was forwarded instead of being replaced")
	}
	for _, h := range []string{"X-Console-Tenant", "X-Console-User", "X-Console-Project", "X-Console-Session"} {
		if v := got.Header.Get(h); v != "" {
			t.Errorf("%s = %q leaked to upstream, want empty", h, v)
		}
	}
}
