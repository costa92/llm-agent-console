package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/costa92/llm-agent-console/internal/config"
)

// captureUpstream stands up a fake upstream that records the request headers it
// received and returns 200. The recorded request is exposed via the returned
// pointer (populated on each hit; tests send exactly one request).
func captureUpstream(t *testing.T) (*httptest.Server, *http.Request) {
	t.Helper()
	var got http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = *r // shallow copy is enough; we only inspect headers + URL
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

// TestMemoryDirector verifies the memory director's auth boundary: inbound scope
// headers and Authorization are stripped, gateway scope is re-materialized from
// X-Console-*, and X-Console-* never reaches the upstream.
func TestMemoryDirector(t *testing.T) {
	srv, got := captureUpstream(t)
	cfg := &config.Config{MemoryBase: srv.URL}

	p := NewMemoryProxy(cfg)

	req := httptest.NewRequest(http.MethodGet, "/items/123", nil)
	// Spoofed client-set scope + auth that must be stripped:
	req.Header.Set("X-Tenant-Id", "spoofed-tenant")
	req.Header.Set("X-User-Id", "spoofed-user")
	req.Header.Set("X-Project-Id", "spoofed-project")
	req.Header.Set("X-Session-Id", "spoofed-session")
	req.Header.Set("Authorization", "Bearer operator-token")
	// Authoritative non-secret console context:
	req.Header.Set("X-Console-Tenant", "tenant-a")
	req.Header.Set("X-Console-User", "user-b")
	req.Header.Set("X-Console-Project", "project-c")
	req.Header.Set("X-Console-Session", "session-d")

	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)

	if v := got.Header.Get("X-Tenant-Id"); v != "tenant-a" {
		t.Errorf("X-Tenant-Id = %q, want re-materialized %q", v, "tenant-a")
	}
	if v := got.Header.Get("X-User-Id"); v != "user-b" {
		t.Errorf("X-User-Id = %q, want re-materialized %q", v, "user-b")
	}
	if v := got.Header.Get("X-Project-Id"); v != "project-c" {
		t.Errorf("X-Project-Id = %q, want re-materialized %q", v, "project-c")
	}
	if v := got.Header.Get("X-Session-Id"); v != "session-d" {
		t.Errorf("X-Session-Id = %q, want re-materialized %q", v, "session-d")
	}
	// Spoofed values must NOT survive (Del must run before Set).
	if v := got.Header.Get("X-Tenant-Id"); v == "spoofed-tenant" {
		t.Error("spoofed X-Tenant-Id leaked to upstream")
	}
	// Operator Authorization must not be forwarded.
	if v := got.Header.Get("Authorization"); v != "" {
		t.Errorf("Authorization = %q, want empty (stripped)", v)
	}
	// X-Console-* must not leak upstream.
	for _, h := range []string{"X-Console-Tenant", "X-Console-User", "X-Console-Project", "X-Console-Session"} {
		if v := got.Header.Get(h); v != "" {
			t.Errorf("%s = %q leaked to upstream, want empty", h, v)
		}
	}
}

// TestMemoryDirectorOptionalScopeAbsent verifies that absent optional scope
// (project/session) does not produce empty re-materialized headers.
func TestMemoryDirectorOptionalScopeAbsent(t *testing.T) {
	srv, got := captureUpstream(t)
	cfg := &config.Config{MemoryBase: srv.URL}
	p := NewMemoryProxy(cfg)

	req := httptest.NewRequest(http.MethodGet, "/items/1", nil)
	req.Header.Set("X-Console-Tenant", "t")
	req.Header.Set("X-Console-User", "u")
	// no project/session

	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)

	if _, ok := got.Header["X-Project-Id"]; ok {
		t.Error("X-Project-Id should be absent when X-Console-Project is empty")
	}
	if _, ok := got.Header["X-Session-Id"]; ok {
		t.Error("X-Session-Id should be absent when X-Console-Session is empty")
	}
}
