package cmd

import (
	"net/http"
	"time"
)

func waitForHotkeyBridgeState(url string, wantHealthy bool, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 180 * time.Millisecond}

	for {
		healthy := false
		response, err := client.Get(url)
		if err == nil && response != nil {
			healthy = response.StatusCode >= 200 && response.StatusCode < 300
			if response.Body != nil {
				_ = response.Body.Close()
			}
		}

		if healthy == wantHealthy {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(40 * time.Millisecond)
	}
}
