package proxy

import (
	"net/http/httputil"

	"github.com/costa92/llm-agent-console/internal/config"
)

// NewChatProxy builds the customer-support chat director. Chat has no upstream
// auth, so the director strips any inbound Authorization and forwards nothing in
// its place.
//
// Session continuity for chat works via the request body (session_id field), not
// via a request header — the chat service sets X-Session-Id in its RESPONSE only
// (RESEARCH Pitfall 7). So Phase 1's chat director forwards no session header.
//
// The chat upstream does NOT set X-Accel-Buffering: no on its SSE responses
// (RESEARCH Pattern 8), so the shared ModifyResponse hook injecting it is
// REQUIRED here (not merely defense-in-depth).
func NewChatProxy(cfg *config.Config) *httputil.ReverseProxy {
	target := mustParseURL(cfg.ChatBase)
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.Header.Del("Authorization") // chat has no upstream auth
			delConsoleHeaders(r.Out.Header)
		},
		ModifyResponse: sseBufferingDefense,
	}
}
