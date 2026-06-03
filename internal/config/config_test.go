package config

import (
	"os"
	"path/filepath"
	"testing"
)

// writeFile is a small test helper that writes body to path.
func writeFile(t *testing.T, path, body string) error {
	t.Helper()
	return os.WriteFile(path, []byte(body), 0o600)
}

// TestLoadMissingFileFailsFast confirms Load returns a non-nil error when the
// config file is absent (D-02 fail-fast — no silent fallback).
func TestLoadMissingFileFailsFast(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "does-not-exist.yaml"))
	if err == nil {
		t.Fatal("expected error for missing config file, got nil")
	}
}

// TestLoadValid confirms a well-formed YAML file unmarshals into Config with
// the expected upstream URLs and a defaulted server port.
func TestLoadValid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	body := `
memory_base: http://localhost:8080
flow_base: http://localhost:7861
chat_base: http://localhost:8081
flowd_token: ""
operator_token: ""
`
	if err := writeFile(t, path, body); err != nil {
		t.Fatalf("write temp config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.MemoryBase != "http://localhost:8080" {
		t.Errorf("MemoryBase = %q, want http://localhost:8080", cfg.MemoryBase)
	}
	if cfg.FlowBase != "http://localhost:7861" {
		t.Errorf("FlowBase = %q, want http://localhost:7861", cfg.FlowBase)
	}
	if cfg.ChatBase != "http://localhost:8081" {
		t.Errorf("ChatBase = %q, want http://localhost:8081", cfg.ChatBase)
	}
	if cfg.Server.Port != "8090" {
		t.Errorf("Server.Port default = %q, want 8090", cfg.Server.Port)
	}
	if cfg.FlowdToken != "" || cfg.OperatorToken != "" {
		t.Errorf("expected empty tokens in dev config, got flowd=%q operator=%q",
			cfg.FlowdToken, cfg.OperatorToken)
	}
}

// TestLoadHonorsExplicitPort confirms an explicit server.port is preserved.
func TestLoadHonorsExplicitPort(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := writeFile(t, path, "server:\n  port: \"9999\"\n"); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Server.Port != "9999" {
		t.Errorf("Server.Port = %q, want 9999", cfg.Server.Port)
	}
}
