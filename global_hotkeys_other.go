//go:build !windows

package main

import "errors"

func runGlobalHotkeyBridge() error {
	return errors.New("global hotkeys are currently supported on Windows")
}
