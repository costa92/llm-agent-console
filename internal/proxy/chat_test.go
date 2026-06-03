package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/costa92/llm-agent-console/internal/config"
)

// TestChatDirector verifies the chat director strips Authorization (chat has no
// upstream auth) and removes X-Console-* before forwarding.
func TestChatDirector(t *testing.T) {
	srv, got := captureUpstream(t)
	cfg := &config.Config{ChatBase: srv.URL}

	p := NewChatProxy(cfg)

	req := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	req.Header.Set("Authorization", "Bearer operator-token")
	req.Header.Set("X-Console-Tenant", "tenant-a")
	req.Header.Set("X-Console-User", "user-b")

	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)

	if v := got.Header.Get("Authorization"); v != "" {
		t.Errorf("Authorization = %q, want empty (chat has no upstream auth)", v)
	}
	for _, h := range []string{"X-Console-Tenant", "X-Console-User", "X-Console-Project", "X-Console-Session"} {
		if v := got.Header.Get(h); v != "" {
			t.Errorf("%s = %q leaked to upstream, want empty", h, v)
		}
	}
}

// sseUpstream returns a fake upstream that replies with the given Content-Type
// and (optionally) pre-sets X-Accel-Buffering to simulate flowd's own header.
func sseUpstream(t *testing.T, contentType string, presetAccel bool) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", contentType)
		if presetAccel {
			w.Header().Set("X-Accel-Buffering", "no")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("event: tick\ndata: {}\n\n"))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// TestSSEModifyResponse verifies every director injects X-Accel-Buffering: no on
// text/event-stream responses. Chat is the critical case (chat upstream does NOT
// set it itself), but all three directors must apply the defense.
func TestSSEModifyResponse(t *testing.T) {
	t.Run("chat", func(t *testing.T) {
		srv := sseUpstream(t, "text/event-stream", false) // chat does NOT set it
		cfg := &config.Config{ChatBase: srv.URL}
		p := NewChatProxy(cfg)
		req := httptest.NewRequest(http.MethodGet, "/stream", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if v := rec.Header().Get("X-Accel-Buffering"); v != "no" {
			t.Errorf("chat SSE X-Accel-Buffering = %q, want %q", v, "no")
		}
		if v := rec.Header().Get("Cache-Control"); v != "no-cache, no-transform" {
			t.Errorf("chat SSE Cache-Control = %q, want %q", v, "no-cache, no-transform")
		}
	})

	t.Run("memory", func(t *testing.T) {
		srv := sseUpstream(t, "text/event-stream; charset=utf-8", false)
		cfg := &config.Config{MemoryBase: srv.URL}
		p := NewMemoryProxy(cfg)
		req := httptest.NewRequest(http.MethodGet, "/stream", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if v := rec.Header().Get("X-Accel-Buffering"); v != "no" {
			t.Errorf("memory SSE X-Accel-Buffering = %q, want %q", v, "no")
		}
	})

	t.Run("flow", func(t *testing.T) {
		srv := sseUpstream(t, "text/event-stream", true) // flowd sets it itself
		cfg := &config.Config{FlowBase: srv.URL, FlowdToken: "t"}
		p := NewFlowProxy(cfg)
		req := httptest.NewRequest(http.MethodGet, "/run/stream", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if v := rec.Header().Get("X-Accel-Buffering"); v != "no" {
			t.Errorf("flow SSE X-Accel-Buffering = %q, want %q", v, "no")
		}
	})

	t.Run("non-sse-untouched", func(t *testing.T) {
		srv := sseUpstream(t, "application/json", false)
		cfg := &config.Config{ChatBase: srv.URL}
		p := NewChatProxy(cfg)
		req := httptest.NewRequest(http.MethodGet, "/items", nil)
		rec := httptest.NewRecorder()
		p.ServeHTTP(rec, req)
		if v := rec.Header().Get("X-Accel-Buffering"); v != "" {
			t.Errorf("non-SSE response got X-Accel-Buffering = %q, want empty", v)
		}
	})
}
