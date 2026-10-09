package cmd

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWaitForHotkeyBridgeStateHealthy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if !waitForHotkeyBridgeState(server.URL, true, 250*time.Millisecond) {
		t.Fatal("healthy bridge was not detected")
	}
}

func TestWaitForHotkeyBridgeStateStopped(t *testing.T) {
	if !waitForHotkeyBridgeState("http://127.0.0.1:1/health", false, 250*time.Millisecond) {
		t.Fatal("stopped bridge was not detected")
	}
}
