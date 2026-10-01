//go:build windows

package cmd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

const (
	meriotifyHotkeyRunKey   = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	meriotifyHotkeyRunValue = `MeriotifyGlobalHotkeys`
)

func EnsureMeriotifyHotkeyBridge() {
	exe, err := os.Executable()
	if err != nil || exe == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 350*time.Millisecond)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "http://127.0.0.1:19473/shutdown", nil)
	if req != nil {
		response, _ := http.DefaultClient.Do(req)
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
	}
	cancel()
	time.Sleep(80 * time.Millisecond)

	escapedExe := strings.ReplaceAll(exe, `'`, `''`)
	runCommand := fmt.Sprintf(
		`powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "& '%s' -q hotkeys-bridge"`,
		escapedExe,
	)
	_ = exec.Command(
		"reg.exe", "add", meriotifyHotkeyRunKey,
		"/v", meriotifyHotkeyRunValue,
		"/t", "REG_SZ",
		"/d", runCommand,
		"/f",
	).Run()

	command := exec.Command(exe, "-q", "hotkeys-bridge")
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	command.Stdin = nil
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	if command.Start() == nil && command.Process != nil {
		_ = command.Process.Release()
	}
}
