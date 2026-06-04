package proxy

import (
	"net/http"
	"net/http/httputil"

	"github.com/costa92/llm-agent-console/internal/config"
)

// NewFlowProxy builds the flowd director. It strips any inbound Authorization
// (the operator token must never reach flowd) and injects the configured flowd
// bearer token server-side. The flowd token lives only in cfg.FlowdToken and
// must never appear in any response forwarded to the browser (CONTEXT D-01); the
// ModifyResponse hook scrubs any echo of it that a misbehaving upstream might
// send back.
func NewFlowProxy(cfg *config.Config) *httputil.ReverseProxy {
	target := mustParseURL(cfg.FlowBase)
	bearer := "Bearer " + cfg.FlowdToken
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)

			// Strip any client Authorization FIRST, then inject the flowd token
			// from config (never from the browser).
			r.Out.Header.Del("Authorization")
			r.Out.Header.Set("Authorization", bearer)

			delConsoleHeaders(r.Out.Header)
		},
		ModifyResponse: func(resp *http.Response) error {
			// D-01 defense: scrub any echo of the upstream auth before the
			// response reaches the client. A correct flowd never echoes these,
			// but the BFF must guarantee the token can never leak.
			resp.Header.Del("Authorization")
			resp.Header.Del("X-Echo-Auth")
			return sseBufferingDefense(resp)
		},
	}
}
