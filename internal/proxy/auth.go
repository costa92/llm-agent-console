package proxy

import (
	"net/http"
	"strings"
)

// MiddlewareOperatorAuth gates all routes behind the optional app-layer operator
// token (CONTEXT D-01). The token is a shared static secret held server-side;
// the browser presents it as Authorization: Bearer <token>.
//
// Behavior:
//   - token == "" → auth disabled (dev): returns next unchanged.
//   - /healthz bypasses auth (consistent with the upstream healthz pattern) so
//     compose health checks work without a token.
//   - missing/!Bearer Authorization → 401 with WWW-Authenticate.
//   - present but wrong → 403.
//   - correct → passes through to next.
//
// The comparison is constant-time (byte-XOR) to avoid a timing side channel on
// the shared secret, modeled on flowd's BearerTokenAuthenticator. A length check
// precedes the XOR loop (a different-length token is rejected without leaking the
// secret length via the loop).
func MiddlewareOperatorAuth(token string, next http.Handler) http.Handler {
	if token == "" {
		return next // disabled in dev
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}

		const prefix = "Bearer "
		hdr := r.Header.Get("Authorization")
		if !strings.HasPrefix(hdr, prefix) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="llm-console"`)
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		got := strings.TrimPrefix(hdr, prefix)
		if len(got) != len(token) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		var diff byte
		for i := range got {
			diff |= got[i] ^ token[i]
		}
		if diff != 0 {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}
