package router

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/costa92/llm-agent-console/internal/config"
)

// newTestHandler builds the router with an empty (dev) config.
func newTestHandler() http.Handler {
	return New(&config.Config{})
}

// TestSyntheticSSE verifies the BFF-03 synthetic SSE proof endpoint:
//   - the response carries the SSE transport headers (Content-Type
//     text/event-stream, X-Accel-Buffering: no, Cache-Control no-cache,
//     no-transform), so the response is self-describing for any intermediate
//     proxy (D-06);
//   - at least one `event: tick` frame is delivered incrementally before the
//     client aborts (context cancel) — proving the handler flushes per event
//     rather than buffering all 30 ticks until the end.
//
// It uses httptest.NewServer (a real socket) rather than httptest.NewRecorder
// because the recorder does not stream — the handler would block for the full
// 30 ticks before the recorder observed any body.
func TestSyntheticSSE(t *testing.T) {
	srv := httptest.NewServer(newTestHandler())
	defer srv.Close()

	// Abort well before the 30-tick handler would naturally finish.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/stream/test", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/stream/test: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
		t.Errorf("Content-Type = %q, want text/event-stream", got)
	}
	if got := resp.Header.Get("X-Accel-Buffering"); got != "no" {
		t.Errorf("X-Accel-Buffering = %q, want no", got)
	}
	if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "no-cache") || !strings.Contains(got, "no-transform") {
		t.Errorf("Cache-Control = %q, want no-cache, no-transform", got)
	}

	// Read line-by-line until we see at least one tick frame, then stop. If the
	// stream were buffered, no tick would arrive within the context deadline and
	// the read would fail/time out before a tick is seen.
	scanner := bufio.NewScanner(resp.Body)
	sawTick := false
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "event: tick") {
			sawTick = true
			break
		}
	}
	if !sawTick {
		// scanner.Err() is non-nil on deadline/abort; surface it for diagnosis.
		t.Fatalf("did not observe an incremental `event: tick` frame before abort (scanner err: %v)", scanner.Err())
	}
}

// TestHealthz verifies GET /healthz returns 200 with a JSON body carrying a
// "status" field.
func TestHealthz(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	newTestHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("body is not JSON (%q): %v", string(body), err)
	}
	if _, ok := parsed["status"]; !ok {
		t.Errorf("JSON body %q missing \"status\" field", string(body))
	}
}

// TestUnknownRouteIs404 verifies a non-allowlisted route returns 404 (the
// ServeMux only mounts the explicitly allowlisted patterns).
func TestUnknownRouteIs404(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/unknown", nil)
	newTestHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status for /api/unknown = %d, want 404", rec.Code)
	}
}
