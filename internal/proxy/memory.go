// Package proxy implements the BFF auth boundary: one httputil.ReverseProxy
// director per upstream service (memory-gateway, flowd, customer-support chat),
// plus the app-layer operator-token middleware.
//
// The directors are the heart of the single-origin security model (BFF-01/02,
// CONTEXT D-01). Each director, in its Rewrite hook:
//   - strips ALL client-set scope headers (X-*-Id) and the inbound Authorization
//     (the operator token is app-layer only — never forwarded to upstreams);
//   - re-materializes the gateway scope server-side from the non-secret
//     X-Console-* headers the browser sent (anti confused-deputy);
//   - injects the per-service upstream auth (flowd bearer from config; chat none);
//   - removes the X-Console-* headers so they never leak upstream.
//
// Path stripping is handled by http.StripPrefix at the router (see router.go), so
// the directors receive an already-stripped path and must not strip again.
package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/costa92/llm-agent-console/internal/config"
)

// consoleScopeHeaders are the non-secret context headers the browser sends. They
// are read to re-materialize upstream scope and then removed from every outbound
// request so they never leak to an upstream.
var consoleScopeHeaders = []string{
	"X-Console-Tenant",
	"X-Console-User",
	"X-Console-Project",
	"X-Console-Session",
}

// inboundScopeHeaders are the upstream scope headers a client must never be able
// to set directly. They are stripped before re-materialization (anti confused-
// deputy: Del MUST precede Set).
var inboundScopeHeaders = []string{
	"X-Tenant-Id",
	"X-User-Id",
	"X-Project-Id",
	"X-Session-Id",
}

// mustParseURL parses a config-pinned upstream base URL. A malformed base URL is
// an operator config error surfaced at startup, so a parse failure here is fatal
// by design (the BFF must never proxy to an unparseable/empty host).
func mustParseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic("proxy: invalid upstream base URL " + raw + ": " + err.Error())
	}
	return u
}

// delConsoleHeaders removes all X-Console-* headers from the outbound request so
// they never reach an upstream.
func delConsoleHeaders(out http.Header) {
	for _, h := range consoleScopeHeaders {
		out.Del(h)
	}
}

// sseBufferingDefense is the shared ModifyResponse hook: on text/event-stream
// responses it sets X-Accel-Buffering: no and Cache-Control: no-cache,
// no-transform so the stream is self-describing for any intermediate proxy
// (defense-in-depth; D-06). The chat upstream does NOT set X-Accel-Buffering
// itself, so this is required (not merely defensive) for the chat director.
func sseBufferingDefense(resp *http.Response) error {
	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		resp.Header.Set("X-Accel-Buffering", "no")
		resp.Header.Set("Cache-Control", "no-cache, no-transform")
	}
	return nil
}

// NewMemoryProxy builds the memory-gateway director. It strips inbound auth/scope
// headers and re-materializes X-Tenant-Id/X-User-Id (and optionally
// X-Project-Id/X-Session-Id) from the browser's X-Console-* headers.
func NewMemoryProxy(cfg *config.Config) *httputil.ReverseProxy {
	target := mustParseURL(cfg.MemoryBase)
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)

			// Strip everything the browser must not control. Del MUST run
			// before the re-materializing Set below (anti confused-deputy).
			r.Out.Header.Del("Authorization")
			for _, h := range inboundScopeHeaders {
				r.Out.Header.Del(h)
			}

			// Re-materialize gateway scope from the non-secret X-Console-*.
			r.Out.Header.Set("X-Tenant-Id", r.In.Header.Get("X-Console-Tenant"))
			r.Out.Header.Set("X-User-Id", r.In.Header.Get("X-Console-User"))
			if p := r.In.Header.Get("X-Console-Project"); p != "" {
				r.Out.Header.Set("X-Project-Id", p)
			}
			if s := r.In.Header.Get("X-Console-Session"); s != "" {
				r.Out.Header.Set("X-Session-Id", s)
			}

			delConsoleHeaders(r.Out.Header)
		},
		ModifyResponse: sseBufferingDefense,
	}
}
