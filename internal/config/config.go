// Package config loads the BFF configuration from a YAML file.
//
// Per CONTEXT.md D-02, the YAML config file is the source of truth for the
// upstream base URLs and secrets. Env vars may override secrets, but the file
// is primary (not env-var-first). Loading fails fast if the file is missing —
// the BFF never silently falls back to defaults for upstream targets.
package config

import (
	"bytes"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the BFF runtime configuration.
//
// YAML keys are snake_case (per D-02). Secret fields (flowd_token,
// operator_token) are empty in the committed dev sample (D-01: empty operator
// token = auth disabled in dev); production values are injected via a
// non-committed config file or env override.
type Config struct {
	Server struct {
		// Port is the TCP port the BFF HTTP server listens on. Defaults to
		// "8090" when omitted (nginx proxies to bff:8090 per D-05).
		Port string `yaml:"port"`
	} `yaml:"server"`

	// MemoryBase is the memory-gateway upstream base URL (D-03: :8080).
	MemoryBase string `yaml:"memory_base"`
	// FlowBase is the flowd upstream base URL (D-03: :7861).
	FlowBase string `yaml:"flow_base"`
	// ChatBase is the customer-support chat upstream base URL (D-03: :8081).
	ChatBase string `yaml:"chat_base"`

	// FlowdToken is the upstream bearer token injected server-side on the
	// flowd director. Empty in dev. Never exposed to the browser.
	FlowdToken string `yaml:"flowd_token"`
	// OperatorToken is the app-layer shared operator token (D-01). Empty
	// disables operator auth in dev.
	OperatorToken string `yaml:"operator_token"`
}

// Load reads and unmarshals the YAML config at path. It returns a descriptive
// error if the file cannot be opened or parsed — it never falls back silently
// (fail-fast per D-02). Server.Port defaults to "8090" when not set.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: cannot read config file %q: %w", path, err)
	}

	// Strict decode: reject unknown/typo'd keys (e.g. memory_url instead of
	// memory_base) so a silent empty base never slips through to the proxy.
	var cfg Config
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("config: cannot parse YAML config %q: %w", path, err)
	}

	if cfg.Server.Port == "" {
		cfg.Server.Port = "8090"
	}

	// Require all three upstream bases — an empty base breaks the proxy
	// silently, so fail fast at boot (D-02).
	switch {
	case cfg.MemoryBase == "":
		return nil, fmt.Errorf("config: %q missing required memory_base", path)
	case cfg.FlowBase == "":
		return nil, fmt.Errorf("config: %q missing required flow_base", path)
	case cfg.ChatBase == "":
		return nil, fmt.Errorf("config: %q missing required chat_base", path)
	}

	return &cfg, nil
}
