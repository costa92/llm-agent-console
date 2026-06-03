package proxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/costa92/llm-agent-console/internal/config"
)

// TestErrorPassthrough verifies BFF-04: upstream error status codes and bodies
// pass through to the client verbatim. Error pass-through is director-agnostic;
// the memory director is used here.
func TestErrorPassthrough(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   map[string]string
		want   string
	}{
		{"422", http.StatusUnprocessableEntity, map[string]string{"error": "unprocessable"}, "unprocessable"},
		{"503", http.StatusServiceUnavailable, map[string]string{"error": "service unavailable"}, "service unavailable"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(tc.body)
			}))
			t.Cleanup(srv.Close)

			cfg := &config.Config{MemoryBase: srv.URL}
			p := NewMemoryProxy(cfg)

			req := httptest.NewRequest(http.MethodGet, "/items/1", nil)
			rec := httptest.NewRecorder()
			p.ServeHTTP(rec, req)

			if rec.Code != tc.status {
				t.Errorf("status = %d, want %d", rec.Code, tc.status)
			}
			if !strings.Contains(rec.Body.String(), tc.want) {
				t.Errorf("body = %q, want to contain %q", rec.Body.String(), tc.want)
			}
		})
	}
}

// TestFlowDirectorResponseNoToken verifies D-01: the flowd bearer token never
// reaches the client through any response header the BFF controls, even if a
// misconfigured upstream echoes the Authorization header it received back as
// response headers. The flow director's ModifyResponse must scrub any such echo.
//
// Note on scope: the BFF is a verbatim body pass-through (BFF-04). It cannot —
// and must not — content-scan/redact upstream response *bodies*, since that would
// corrupt legitimate payloads and break verbatim pass-through. The BFF's D-01
// guarantee is therefore: (1) the BFF never itself places the token in any
// response, and (2) the BFF scrubs token-bearing response *headers* (Authorization,
// X-Echo-Auth) that an upstream might echo. A correct flowd never writes its
// received bearer into its own response body; that would be a flowd-side bug
// outside the BFF trust boundary. This test asserts the header guarantee (the
// vector the BFF can control) plus that the BFF does not inject the token into a
// clean upstream's body.
func TestFlowDirectorResponseNoToken(t *testing.T) {
	const token = "supersecret-flowd-token"

	// Fake flowd echoes the Authorization it received from the BFF back via
	// response headers (the realistic, BFF-controllable leak vector), and
	// returns a clean JSON body.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth := r.Header.Get("Authorization")
		w.Header().Set("X-Echo-Auth", gotAuth)
		// Also re-echo via the Authorization response header to test scrubbing.
		w.Header().Set("Authorization", gotAuth)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
	t.Cleanup(srv.Close)

	cfg := &config.Config{FlowBase: srv.URL, FlowdToken: token}
	p := NewFlowProxy(cfg)

	req := httptest.NewRequest(http.MethodGet, "/flows", nil)
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)

	// The token MUST be absent from all client-facing response headers.
	if strings.Contains(rec.Header().Get("X-Echo-Auth"), token) {
		t.Errorf("X-Echo-Auth response header leaked flowd token: %q", rec.Header().Get("X-Echo-Auth"))
	}
	if strings.Contains(rec.Header().Get("Authorization"), token) {
		t.Errorf("Authorization response header leaked flowd token: %q", rec.Header().Get("Authorization"))
	}
	// The BFF must not inject the token into the (clean) response body.
	if strings.Contains(rec.Body.String(), token) {
		t.Errorf("response body leaked flowd token: %q", rec.Body.String())
	}
}
