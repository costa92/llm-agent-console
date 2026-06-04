package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// okHandler is a trivial next-handler that records whether it was reached.
func okHandler(reached *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*reached = true
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

// TestOperatorAuthDisabled: empty token = disabled; all requests pass through.
func TestOperatorAuthDisabled(t *testing.T) {
	var reached bool
	h := MiddlewareOperatorAuth("", okHandler(&reached))

	req := httptest.NewRequest(http.MethodGet, "/api/memory/items", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !reached {
		t.Fatal("next handler not reached with empty token (auth should be disabled)")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

// TestOperatorAuthMissingToken: token configured, no Authorization header → 401
// with WWW-Authenticate.
func TestOperatorAuthMissingToken(t *testing.T) {
	var reached bool
	h := MiddlewareOperatorAuth("secret", okHandler(&reached))

	req := httptest.NewRequest(http.MethodGet, "/api/memory/items", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	if got := rec.Header().Get("WWW-Authenticate"); got != `Bearer realm="llm-console"` {
		t.Errorf("WWW-Authenticate = %q, want %q", got, `Bearer realm="llm-console"`)
	}
	if reached {
		t.Error("next handler reached despite missing token")
	}
}

// TestOperatorAuthWrongToken: token configured, wrong token → 403.
func TestOperatorAuthWrongToken(t *testing.T) {
	var reached bool
	h := MiddlewareOperatorAuth("secret", okHandler(&reached))

	for _, bad := range []string{"Bearer wrong", "Bearer secre", "Bearer secrets"} {
		req := httptest.NewRequest(http.MethodGet, "/api/memory/items", nil)
		req.Header.Set("Authorization", bad)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("token %q: status = %d, want 403", bad, rec.Code)
		}
	}
	if reached {
		t.Error("next handler reached with a wrong token")
	}
}

// TestOperatorAuthCorrectToken: token configured, correct token passes through.
func TestOperatorAuthCorrectToken(t *testing.T) {
	var reached bool
	h := MiddlewareOperatorAuth("secret", okHandler(&reached))

	req := httptest.NewRequest(http.MethodGet, "/api/memory/items", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !reached {
		t.Fatal("next handler not reached with correct token")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

// TestOperatorAuthHealthzBypass: /healthz bypasses auth even when configured.
func TestOperatorAuthHealthzBypass(t *testing.T) {
	var reached bool
	h := MiddlewareOperatorAuth("secret", okHandler(&reached))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !reached {
		t.Fatal("/healthz did not bypass auth")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}
