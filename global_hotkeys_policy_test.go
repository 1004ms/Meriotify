package main

import (
	"testing"
	"time"
)

func TestHotkeyClientLeaseSurvivesBackgroundThrottling(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	if hotkeyClientExpired(now.Add(-30*time.Second), now) {
		t.Fatal("client expired after 30s; background Spotify must keep global hotkeys registered")
	}
	if hotkeyClientExpired(now.Add(-2*time.Minute), now) {
		t.Fatal("client expired after 2m; lease must tolerate background throttling")
	}
}

func TestHotkeyClientLeaseEventuallyExpires(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	if !hotkeyClientExpired(now.Add(-hotkeyClientLease-time.Second), now) {
		t.Fatal("stale client never expires")
	}
}
