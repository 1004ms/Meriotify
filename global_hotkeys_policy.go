package main

import "time"

const (
	hotkeyPollTimeout  = 45 * time.Second
	hotkeyClientLease  = 3 * time.Minute
	hotkeyPendingLimit = 8
)

func hotkeyClientExpired(lastSeen, now time.Time) bool {
	return now.Sub(lastSeen) > hotkeyClientLease
}
