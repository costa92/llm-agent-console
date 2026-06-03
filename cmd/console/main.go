// Command console is the llm-agent-console BFF entry point.
//
// Phase 1 (BFF-03 keystone) starts a proxy-only HTTP server that mounts the
// synthetic SSE proof endpoint and a health check. It loads its configuration
// from a YAML file (fail-fast if missing, per CONTEXT.md D-02) and listens on
// the configured port (default :8090, behind the fronting nginx per D-05).
package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/costa92/llm-agent-console/internal/config"
	"github.com/costa92/llm-agent-console/internal/router"
)

func main() {
	configPath := flag.String("config", "config/config.dev.yaml",
		"path to the YAML config file (source of truth for upstreams + secrets)")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Printf("fatal: %v", err)
		os.Exit(1)
	}

	handler := router.New(cfg)
	addr := ":" + cfg.Server.Port

	log.Printf("llm-agent-console BFF starting: addr=%s config=%s", addr, *configPath)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Printf("fatal: server stopped: %v", err)
		os.Exit(1)
	}
}
