//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const hotkeyBridgeAddress = "127.0.0.1:19473"

const (
	wmHotkey      = 0x0312
	wmAppConfig   = 0x8001
	wmAppShutdown = 0x8002
	modAlt        = 0x0001
	modControl    = 0x0002
	modShift      = 0x0004
	modWin        = 0x0008
	modNoRepeat   = 0x4000
)

var (
	user32                = syscall.NewLazyDLL("user32.dll")
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	procRegisterHotKey    = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey  = user32.NewProc("UnregisterHotKey")
	procGetMessageW       = user32.NewProc("GetMessageW")
	procPeekMessageW      = user32.NewProc("PeekMessageW")
	procPostThreadMessage = user32.NewProc("PostThreadMessageW")
	procGetCurrentThread  = kernel32.NewProc("GetCurrentThreadId")
)

type bridgePoint struct {
	X int32
	Y int32
}

type bridgeMessage struct {
	HWnd     uintptr
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Pt       bridgePoint
	LPrivate uint32
}

type bridgeConfig struct {
	Enabled  bool              `json:"enabled"`
	Keybinds map[string]string `json:"keybinds"`
}

type hotkeyBridge struct {
	mu       sync.Mutex
	config   bridgeConfig
	clients  map[string]time.Time
	waiters  map[string]chan string
	pending  map[string][]string
	threadID uint32
	server   *http.Server
}

var bridgeActions = []string{
	"playPause",
	"next",
	"previous",
	"volumeUp",
	"volumeDown",
	"mute",
}

func newHotkeyBridge() *hotkeyBridge {
	return &hotkeyBridge{
		config:  bridgeConfig{Keybinds: map[string]string{}},
		clients: map[string]time.Time{},
		waiters: map[string]chan string{},
		pending: map[string][]string{},
	}
}

func (b *hotkeyBridge) wake(message uint32) {
	b.mu.Lock()
	threadID := b.threadID
	b.mu.Unlock()
	if threadID != 0 {
		procPostThreadMessage.Call(uintptr(threadID), uintptr(message), 0, 0)
	}
}

func (b *hotkeyBridge) setConfig(config bridgeConfig) {
	if config.Keybinds == nil {
		config.Keybinds = map[string]string{}
	}
	b.mu.Lock()
	b.config = config
	b.mu.Unlock()
	b.wake(wmAppConfig)
}

func (b *hotkeyBridge) addClient(id string, waiter chan string) (string, bool) {
	b.mu.Lock()
	_, existed := b.clients[id]
	b.clients[id] = time.Now()

	var pendingAction string
	if queued := b.pending[id]; len(queued) > 0 {
		pendingAction = queued[0]
		if len(queued) == 1 {
			delete(b.pending, id)
		} else {
			b.pending[id] = queued[1:]
		}
	} else {
		b.waiters[id] = waiter
	}
	b.mu.Unlock()
	b.wake(wmAppConfig)
	return pendingAction, !existed
}

func (b *hotkeyBridge) touchClient(id string) {
	b.mu.Lock()
	b.clients[id] = time.Now()
	b.mu.Unlock()
}

func (b *hotkeyBridge) removeWaiter(id string) {
	b.mu.Lock()
	delete(b.waiters, id)
	b.mu.Unlock()
}

func (b *hotkeyBridge) removeClient(id string) {
	b.mu.Lock()
	delete(b.waiters, id)
	delete(b.clients, id)
	delete(b.pending, id)
	b.mu.Unlock()
	b.wake(wmAppConfig)
}

func (b *hotkeyBridge) cleanupClients() {
	now := time.Now()
	changed := false

	b.mu.Lock()
	for id, seen := range b.clients {
		if hotkeyClientExpired(seen, now) {
			delete(b.clients, id)
			delete(b.waiters, id)
			delete(b.pending, id)
			changed = true
		}
	}
	b.mu.Unlock()

	if changed {
		b.wake(wmAppConfig)
	}
}

func (b *hotkeyBridge) snapshot() (bridgeConfig, int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	cfg := bridgeConfig{
		Enabled:  b.config.Enabled,
		Keybinds: map[string]string{},
	}
	for k, v := range b.config.Keybinds {
		cfg.Keybinds[k] = v
	}
	return cfg, len(b.clients)
}

func (b *hotkeyBridge) broadcast(action string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for id := range b.clients {
		if ch := b.waiters[id]; ch != nil {
			select {
			case ch <- action:
				continue
			default:
			}
		}

		queue := b.pending[id]
		if len(queue) >= hotkeyPendingLimit {
			queue = queue[len(queue)-hotkeyPendingLimit+1:]
		}
		b.pending[id] = append(queue, action)
	}
}

func unregisterAllHotkeys() {
	for id := 1; id <= len(bridgeActions); id++ {
		procUnregisterHotKey.Call(0, uintptr(id))
	}
}

func (b *hotkeyBridge) applyBindings() {
	unregisterAllHotkeys()

	cfg, clients := b.snapshot()
	if !cfg.Enabled || clients == 0 {
		return
	}

	for index, action := range bridgeActions {
		combo := strings.TrimSpace(cfg.Keybinds[action])
		if combo == "" {
			continue
		}
		modifiers, vk, ok := parseHotkey(combo)
		if !ok {
			continue
		}
		procRegisterHotKey.Call(0, uintptr(index+1), uintptr(modifiers|modNoRepeat), uintptr(vk))
	}
}

func (b *hotkeyBridge) messageLoop() error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer unregisterAllHotkeys()

	threadID, _, _ := procGetCurrentThread.Call()
	b.mu.Lock()
	b.threadID = uint32(threadID)
	b.mu.Unlock()

	var initMsg bridgeMessage
	procPeekMessageW.Call(uintptr(unsafe.Pointer(&initMsg)), 0, 0, 0, 0)

	b.applyBindings()

	for {
		var msg bridgeMessage
		ret, _, err := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) == -1 {
			return err
		}
		if ret == 0 {
			return nil
		}

		switch msg.Message {
		case wmHotkey:
			id := int(msg.WParam)
			if id >= 1 && id <= len(bridgeActions) {
				b.broadcast(bridgeActions[id-1])
			}
		case wmAppConfig:
			b.applyBindings()
		case wmAppShutdown:
			return nil
		}
	}
}

func (b *hotkeyBridge) handleConfig(w http.ResponseWriter, r *http.Request) {
	setBridgeHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defer r.Body.Close()
	var cfg bridgeConfig
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&cfg); err != nil {
		http.Error(w, "invalid config", http.StatusBadRequest)
		return
	}
	b.setConfig(cfg)
	writeBridgeJSON(w, map[string]any{"ok": true})
}

func (b *hotkeyBridge) handleNext(w http.ResponseWriter, r *http.Request) {
	setBridgeHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	client := strings.TrimSpace(r.URL.Query().Get("client"))
	if client == "" || len(client) > 160 {
		http.Error(w, "missing client", http.StatusBadRequest)
		return
	}

	waiter := make(chan string, 1)
	pendingAction, isNewClient := b.addClient(client, waiter)
	defer b.removeWaiter(client)

	if pendingAction != "" {
		b.touchClient(client)
		writeBridgeJSON(w, map[string]any{"action": pendingAction})
		return
	}
	if isNewClient {
		writeBridgeJSON(w, map[string]any{"ready": true})
		return
	}

	timer := time.NewTimer(hotkeyPollTimeout)
	defer timer.Stop()

	select {
	case action := <-waiter:
		b.touchClient(client)
		writeBridgeJSON(w, map[string]any{"action": action})
	case <-timer.C:
		b.touchClient(client)
		writeBridgeJSON(w, map[string]any{"ready": true})
	case <-r.Context().Done():
		return
	}
}

func (b *hotkeyBridge) handleHealth(w http.ResponseWriter, r *http.Request) {
	setBridgeHeaders(w)
	writeBridgeJSON(w, map[string]any{"name": "meriotify-global-hotkeys", "ok": true})
}

func (b *hotkeyBridge) handleShutdown(w http.ResponseWriter, r *http.Request) {
	setBridgeHeaders(w)
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeBridgeJSON(w, map[string]any{"ok": true})
	go b.wake(wmAppShutdown)
}

func setBridgeHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
}

func writeBridgeJSON(w http.ResponseWriter, value any) {
	_ = json.NewEncoder(w).Encode(value)
}

func runGlobalHotkeyBridge() error {
	listener, err := net.Listen("tcp", hotkeyBridgeAddress)
	if err != nil {
		client := &http.Client{Timeout: 400 * time.Millisecond}
		response, healthErr := client.Get("http://" + hotkeyBridgeAddress + "/health")
		if healthErr == nil {
			_ = response.Body.Close()
			return nil
		}
		return err
	}
	defer listener.Close()

	bridge := newHotkeyBridge()
	mux := http.NewServeMux()
	mux.HandleFunc("/config", bridge.handleConfig)
	mux.HandleFunc("/next", bridge.handleNext)
	mux.HandleFunc("/health", bridge.handleHealth)
	mux.HandleFunc("/shutdown", bridge.handleShutdown)

	bridge.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 2 * time.Second,
	}

	serverDone := make(chan struct{})
	go func() {
		_ = bridge.server.Serve(listener)
		close(serverDone)
	}()

	cleanupDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		defer close(cleanupDone)
		for {
			select {
			case <-ticker.C:
				bridge.cleanupClients()
			case <-serverDone:
				return
			}
		}
	}()

	loopErr := bridge.messageLoop()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	_ = bridge.server.Shutdown(ctx)
	cancel()

	<-serverDone
	<-cleanupDone

	if loopErr != nil {
		return fmt.Errorf("global hotkey message loop: %w", loopErr)
	}
	return nil
}

func parseHotkey(combo string) (uint32, uint32, bool) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(combo)), "+")
	if len(parts) == 0 {
		return 0, 0, false
	}

	var modifiers uint32
	key := ""

	for _, raw := range parts {
		part := strings.TrimSpace(raw)
		switch part {
		case "ctrl", "control":
			modifiers |= modControl
		case "alt", "option":
			modifiers |= modAlt
		case "shift":
			modifiers |= modShift
		case "win", "windows", "meta", "cmd", "command":
			modifiers |= modWin
		default:
			if key != "" {
				return 0, 0, false
			}
			key = part
		}
	}

	if key == "" {
		return 0, 0, false
	}

	vk, ok := virtualKey(key)
	if !ok {
		return 0, 0, false
	}

	// Avoid globally stealing ordinary typing keys without a modifier.
	if modifiers == 0 && !strings.HasPrefix(key, "f") {
		return 0, 0, false
	}

	return modifiers, vk, true
}

func virtualKey(key string) (uint32, bool) {
	if len(key) == 1 {
		ch := key[0]
		if ch >= 'a' && ch <= 'z' {
			return uint32(ch - 'a' + 'A'), true
		}
		if ch >= '0' && ch <= '9' {
			return uint32(ch), true
		}
		switch ch {
		case '-':
			return 0xBD, true
		case '=':
			return 0xBB, true
		case ',':
			return 0xBC, true
		case '.':
			return 0xBE, true
		case '/':
			return 0xBF, true
		case ';':
			return 0xBA, true
		case '\'':
			return 0xDE, true
		case '[':
			return 0xDB, true
		case ']':
			return 0xDD, true
		case '\\':
			return 0xDC, true
		case '`':
			return 0xC0, true
		}
	}

	keys := map[string]uint32{
		"space": 0x20, "tab": 0x09, "enter": 0x0D, "return": 0x0D,
		"escape": 0x1B, "esc": 0x1B, "backspace": 0x08,
		"left": 0x25, "arrowleft": 0x25,
		"up": 0x26, "arrowup": 0x26,
		"right": 0x27, "arrowright": 0x27,
		"down": 0x28, "arrowdown": 0x28,
		"home": 0x24, "end": 0x23,
		"pageup": 0x21, "pagedown": 0x22,
		"insert": 0x2D, "delete": 0x2E,
	}
	if vk, ok := keys[key]; ok {
		return vk, true
	}

	if strings.HasPrefix(key, "f") {
		n, err := strconv.Atoi(strings.TrimPrefix(key, "f"))
		if err == nil && n >= 1 && n <= 24 {
			return uint32(0x70 + n - 1), true
		}
	}

	return 0, false
}
