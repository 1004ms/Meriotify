// NAME: Meriotify Core
// AUTHOR: Meriotify
// DESCRIPTION: Lightweight native modules for Meriotify Hub.

/// <reference path="../globals.d.ts" />

(function MeriotifyCore() {
	if (!window.Spicetify?.Player || !window.Spicetify?.Mousetrap || !window.Spicetify?.CosmosAsync) {
		setTimeout(MeriotifyCore, 500);
		return;
	}

	const SETTINGS_KEY = "meriotify:settings";
	const RUNTIME_KEY = "meriotify:runtime";
	const EVENT_SETTINGS = "meriotify:settings-changed";
	const EVENT_RUNTIME = "meriotify:runtime-changed";
	const ASSET_DB = "meriotify-assets";
	const ASSET_STORE = "assets";
	const BACKGROUND_ASSET = "background";

	const SETTINGS_VERSION = 12;
	const DEFAULTS = {
		_schemaVersion: SETTINGS_VERSION,
		spotifyPlus: { enabled: false, motion: false },
		adaptiveTheme: { enabled: false, intensity: 65 },
		background: { enabled: false, type: "", name: "", opacity: 0.78 },
		sleep: { enabled: false, minutes: 120, graceSeconds: 10 },
		fade: { enabled: false, seconds: 10 },
		volumeBoost: { enabled: false, value: 100 },
		keybinds: {
			enabled: false,
			playPause: "ctrl+space",
			next: "ctrl+right",
			previous: "ctrl+left",
			volumeUp: "ctrl+up",
			volumeDown: "ctrl+down",
			mute: "ctrl+m",
		},
	};

	let settings = loadSettings();
	let keyTrap = null;
	let mutedVolume = null;
	let backgroundObjectUrl = null;
	let backgroundPosterUrl = null;
	let backgroundBlobType = "";
	let adaptiveGeneration = 0;
	let adaptiveReady = false;
	let lastAccent = null;
	const adaptiveOriginalVars = new Map();

	const sleep = {
		inactiveSince: null,
		ticker: null,
		finishing: false,
	};

	const fade = {
		originalVolume: null,
		active: false,
		trackUri: null,
		frameId: null,
		ticker: null,
	};

	const audioEngine = {
		ctx: null,
		source: null,
		gain: null,
		element: null,
		ready: false,
		baseGain: 1,
		fadeGain: 1,
		initPromise: null,
	};

	let volumeTail = null;
	let volumeObserver = null;
	let volumeBoostSupported = null;
	let spotifyPlusMotionBound = false;
	let spotifyPlusHoverTarget = null;
	let spotifyPlusPressTarget = null;

	installCoreStyles();
	document.body.classList.remove("meriotify-fps-guard");
	localStorage.removeItem("meriotify:download-song-prepared");
	localStorage.removeItem("meriotify:offline-playlist-id");
	localStorage.removeItem("meriotify:offline-track-cache");
	applySpotifyPlus();
	bindKeybinds();
	configureSleepTimer();
	configureFade();
	configureVolumeBoost();
	configureBackground();
	applyAdaptiveTheme();

	Spicetify.Player.addEventListener("songchange", handleSongChange);
	Spicetify.Player.addEventListener("onplaypause", handlePlayPause);
	Spicetify.Player.addEventListener("onprogress", handleFadeProgress);
	window.addEventListener(EVENT_SETTINGS, reloadSettings);
	window.addEventListener("storage", (event) => {
		if (event.key === SETTINGS_KEY) reloadSettings();
	});
	window.addEventListener("blur", handleWindowBlur);
	window.addEventListener("focus", handleWindowFocus);
	document.addEventListener("visibilitychange", updateGifPauseState);

	function deepMerge(base, input) {
		const result = { ...base };
		for (const [key, value] of Object.entries(input || {})) {
			if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
				result[key] = deepMerge(base[key], value);
			} else {
				result[key] = value;
			}
		}
		return result;
	}

	function cloneDefaults() {
		return typeof structuredClone === "function" ? structuredClone(DEFAULTS) : JSON.parse(JSON.stringify(DEFAULTS));
	}

	function loadSettings() {
		try {
			const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
			const merged = deepMerge(DEFAULTS, stored);
			merged._schemaVersion = SETTINGS_VERSION;
			delete merged.fpsGuard;
			merged.volumeBoost = { enabled: false, value: 100 };
			if (stored?._schemaVersion !== SETTINGS_VERSION || Object.prototype.hasOwnProperty.call(stored || {}, "fpsGuard")) {
				localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
			}
			return merged;
		} catch {
			return cloneDefaults();
		}
	}

	function saveSettings() {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	}

	function reloadSettings() {
		const previous = settings;
		settings = loadSettings();

		if (JSON.stringify(previous.keybinds) !== JSON.stringify(settings.keybinds)) bindKeybinds();
		if (JSON.stringify(previous.spotifyPlus) !== JSON.stringify(settings.spotifyPlus)) applySpotifyPlus();
		if (JSON.stringify(previous.sleep) !== JSON.stringify(settings.sleep)) configureSleepTimer();
		if (JSON.stringify(previous.fade) !== JSON.stringify(settings.fade)) configureFade();
		if (JSON.stringify(previous.volumeBoost) !== JSON.stringify(settings.volumeBoost)) configureVolumeBoost();

		const backgroundIdentityChanged = previous.background.enabled !== settings.background.enabled ||
			previous.background.type !== settings.background.type ||
			previous.background.name !== settings.background.name;
		if (backgroundIdentityChanged) configureBackground();
		else if (previous.background.opacity !== settings.background.opacity) updateBackgroundOpacity();

		if (JSON.stringify(previous.adaptiveTheme) !== JSON.stringify(settings.adaptiveTheme)) applyAdaptiveTheme();
		publishRuntime();
	}

	function publishRuntime(extra = {}) {
		const state = {
			sleepRemainingMs: getSleepRemainingMs(),
			sleepActive: Boolean(settings.sleep.enabled),
			sleepCounting: Boolean(settings.sleep.enabled && !Spicetify.Player.isPlaying() && getSleepGraceRemainingMs() === 0),
			sleepGraceRemainingMs: getSleepGraceRemainingMs(),
			fadeActive: fade.active,
			accent: lastAccent,
			adaptiveReady,
			spotifyPlusActive: Boolean(settings.spotifyPlus.enabled),
			backgroundActive: Boolean(settings.background.enabled && backgroundObjectUrl),
			volumeBoostSupported,
			volumePercent: Math.round(getExtendedVolume() * 100),
			...extra,
		};
		localStorage.setItem(RUNTIME_KEY, JSON.stringify(state));
		window.dispatchEvent(new CustomEvent(EVENT_RUNTIME, { detail: state }));
	}

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	function mixRgb(base, overlay, weight) {
		const w = clamp(weight, 0, 1);
		return [0, 1, 2].map((index) => Math.round(base[index] * (1 - w) + overlay[index] * w));
	}

	function rgbCss(rgb) {
		return `rgb(${rgb.join(",")})`;
	}

	function rgbCsv(rgb) {
		return rgb.join(",");
	}

	function luminance(rgb) {
		return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
	}

	function normalizeAccent(rgb) {
		const lum = luminance(rgb);
		if (lum < 72) return mixRgb(rgb, [255, 255, 255], 0.34);
		if (lum > 220) return mixRgb(rgb, [0, 0, 0], 0.18);
		return rgb;
	}

	function bindKeybinds() {
		if (keyTrap) keyTrap.reset();
		keyTrap = new Spicetify.Mousetrap(document);
		if (!settings.keybinds.enabled) return;

		const actions = {
			playPause: () => Spicetify.Player.togglePlay(),
			next: () => Spicetify.Player.next(),
			previous: () => Spicetify.Player.back(),
			volumeUp: () => setExtendedVolume(clamp(getExtendedVolume() + 0.05, 0, settings.volumeBoost.enabled ? 2 : 1), true),
			volumeDown: () => setExtendedVolume(clamp(getExtendedVolume() - 0.05, 0, settings.volumeBoost.enabled ? 2 : 1), true),
			mute: () => {
				const current = getExtendedVolume();
				if (current > 0.001) {
					mutedVolume = current;
					setExtendedVolume(0, false);
				} else {
					setExtendedVolume(clamp(mutedVolume ?? 0.5, 0, settings.volumeBoost.enabled ? 2 : 1), false);
				}
			},
		};

		for (const [name, callback] of Object.entries(actions)) {
			const key = String(settings.keybinds[name] || "").trim().toLowerCase();
			if (!key) continue;
			keyTrap.bind(key, (event) => {
				event.preventDefault();
				callback();
				return false;
			});
		}
	}

	function handleSongChange() {
		restoreFadeVolume();
		if (settings.fade.enabled || settings.volumeBoost.enabled) {
			setTimeout(() => ensureAudioEngine().then((ready) => {
				if (ready && settings.volumeBoost.enabled) setAudioBaseGain(Math.max(1, clamp(Number(settings.volumeBoost.value || 100), 100, 200) / 100));
			}), 120);
		}
		applyAdaptiveTheme();
		if (settings.sleep.enabled && Spicetify.Player.isPlaying()) resetSleepIdle();
	}

	function handlePlayPause() {
		if (Spicetify.Player.isPlaying()) {
			resetSleepIdle();
			restoreFadeVolume();
		} else if (settings.sleep.enabled) {
			startSleepGrace();
		}
		publishRuntime();
	}

	function configureSleepTimer() {
		if (sleep.ticker) clearInterval(sleep.ticker);
		sleep.ticker = null;
		sleep.finishing = false;
		sleep.inactiveSince = null;

		if (!settings.sleep.enabled) {
			publishRuntime();
			return;
		}

		if (!Spicetify.Player.isPlaying()) sleep.inactiveSince = Date.now();
		sleep.ticker = setInterval(tickSleepTimer, 1000);
		tickSleepTimer();
	}

	function startSleepGrace() {
		if (!settings.sleep.enabled || Spicetify.Player.isPlaying()) return;
		if (sleep.inactiveSince === null) sleep.inactiveSince = Date.now();
	}

	function resetSleepIdle() {
		sleep.inactiveSince = null;
		sleep.finishing = false;
	}

	function getSleepGraceRemainingMs() {
		if (!settings.sleep.enabled || Spicetify.Player.isPlaying() || sleep.inactiveSince === null) return null;
		const graceMs = clamp(Number(settings.sleep.graceSeconds || 10), 1, 60) * 1000;
		return Math.max(0, graceMs - (Date.now() - sleep.inactiveSince));
	}

	function getSleepRemainingMs() {
		if (!settings.sleep.enabled) return null;
		const total = clamp(Number(settings.sleep.minutes || 120), 1, 1440) * 60 * 1000;
		if (Spicetify.Player.isPlaying() || sleep.inactiveSince === null) return total;
		const graceMs = clamp(Number(settings.sleep.graceSeconds || 10), 1, 60) * 1000;
		const elapsedIdle = Math.max(0, Date.now() - sleep.inactiveSince - graceMs);
		return Math.max(0, total - elapsedIdle);
	}

	function tickSleepTimer() {
		if (!settings.sleep.enabled || sleep.finishing) return;
		if (Spicetify.Player.isPlaying()) {
			resetSleepIdle();
			publishRuntime();
			return;
		}

		if (sleep.inactiveSince === null) sleep.inactiveSince = Date.now();
		const remaining = getSleepRemainingMs();
		publishRuntime();
		if (getSleepGraceRemainingMs() === 0 && remaining <= 0) finishSleepTimer();
	}

	async function finishSleepTimer() {
		if (sleep.finishing) return;
		sleep.finishing = true;
		if (sleep.ticker) clearInterval(sleep.ticker);
		sleep.ticker = null;
		settings.sleep.enabled = false;
		saveSettings();
		publishRuntime({ sleepRemainingMs: 0, sleepActive: false, sleepCounting: false });
		try { Spicetify.Player.pause(); } catch {}

		const shutdownEndpoints = [
			"sp://esperanto/spotify.desktop.lifecycle_esperanto.proto.DesktopLifecycle/Shutdown",
			"sp://desktop/v1/shutdown",
		];
		await Promise.allSettled(shutdownEndpoints.map((uri) => Spicetify.CosmosAsync.post(uri)));
	}

	function configureFade() {
		if (fade.ticker) clearInterval(fade.ticker);
		fade.ticker = null;
		restoreFadeVolume();
		if (!settings.fade.enabled) {
			publishRuntime();
			return;
		}
		ensureAudioEngine();
		fade.ticker = setInterval(checkFadeWindow, 250);
		checkFadeWindow();
	}

	function handleFadeProgress() {
		if (settings.fade.enabled) checkFadeWindow();
	}

	function normalizeTimeMs(value) {
		const n = Number(value || 0);
		if (!Number.isFinite(n) || n <= 0) return 0;
		return n < 10000 ? n * 1000 : n;
	}

	function getTrackDurationMs() {
		const meta = Spicetify.Player.data?.item?.metadata || {};
		const item = Spicetify.Player.data?.item || {};
		const candidates = [
			Spicetify.Player.getDuration?.(),
			Spicetify.Player.origin?._state?.duration,
			item.duration,
			meta.duration_ms,
			meta.duration,
		];
		for (const value of candidates) {
			const ms = normalizeTimeMs(value);
			if (ms > 1000) return ms;
		}
		return 0;
	}

	function getTrackProgressMs() {
		const candidates = [
			Spicetify.Player.getProgress?.(),
			Spicetify.Player.origin?._state?.positionAsOfTimestamp,
			Spicetify.Player.data?.position,
		];
		for (const value of candidates) {
			if (value === null || value === undefined || value === "") continue;
			const numeric = Number(value);
			if (!Number.isFinite(numeric) || numeric < 0) continue;
			return numeric > 0 && numeric < 10000 ? numeric * 1000 : numeric;
		}
		return 0;
	}

	function checkFadeWindow() {
		if (!settings.fade.enabled || !Spicetify.Player.isPlaying()) {
			if (fade.active) restoreFadeVolume();
			return;
		}
		const duration = getTrackDurationMs();
		const progress = getTrackProgressMs();
		if (!duration || progress < 0 || progress >= duration) return;
		const fadeMs = clamp(Number(settings.fade.seconds || 10), 1, 60) * 1000;
		const remaining = duration - progress;
		if (remaining > fadeMs + 350) {
			if (fade.active) restoreFadeVolume();
			return;
		}
		if (!fade.active) startFadeLoop(remaining, fadeMs);
	}

	async function startFadeLoop(remainingMs, fadeMs) {
		if (fade.active) return;
		fade.active = true;
		fade.trackUri = Spicetify.Player.data?.item?.uri || null;
		fade.originalVolume = Number(Spicetify.Player.getVolume?.() ?? 1);
		publishRuntime();

		const audioReady = await ensureAudioEngine();
		if (!fade.active) return;
		const durationSeconds = Math.max(0.05, Math.min(fadeMs, remainingMs) / 1000);
		if (audioReady && audioEngine.gain && audioEngine.ctx) {
			try { await audioEngine.ctx.resume(); } catch {}
			audioEngine.fadeGain = 1;
			const now = audioEngine.ctx.currentTime;
			const gain = audioEngine.gain.gain;
			const current = Math.max(0.0001, audioEngine.baseGain);
			gain.cancelScheduledValues(now);
			gain.setValueAtTime(current, now);
			gain.linearRampToValueAtTime(0.0001, now + durationSeconds);
			return;
		}

		const startedAt = performance.now();
		const original = clamp(fade.originalVolume ?? 1, 0, 1);
		const frame = (now) => {
			fade.frameId = null;
			if (!fade.active || !settings.fade.enabled || !Spicetify.Player.isPlaying()) { restoreFadeVolume(); return; }
			const ratio = clamp(1 - (now - startedAt) / (durationSeconds * 1000), 0, 1);
			try { Spicetify.Player.setVolume(original * ratio); } catch {}
			if (ratio > 0) fade.frameId = requestAnimationFrame(frame);
		};
		fade.frameId = requestAnimationFrame(frame);
	}

	function restoreFadeVolume() {
		if (fade.frameId !== null) cancelAnimationFrame(fade.frameId);
		fade.frameId = null;
		if (audioEngine.ready && audioEngine.gain && audioEngine.ctx) {
			const now = audioEngine.ctx.currentTime;
			audioEngine.fadeGain = 1;
			audioEngine.gain.gain.cancelScheduledValues(now);
			audioEngine.gain.gain.setValueAtTime(Math.max(0.0001, audioEngine.baseGain), now);
		} else if (fade.active && fade.originalVolume !== null) {
			try { Spicetify.Player.setVolume(clamp(fade.originalVolume, 0, 1)); } catch {}
		}
		fade.originalVolume = null;
		fade.active = false;
		fade.trackUri = null;
		publishRuntime();
	}

	function findAudioElement() {
		return Spicetify.Player?._htmlAudioElement || document.querySelector("audio") || document.querySelector("video");
	}

	async function ensureAudioEngine() {
		if (audioEngine.ready && audioEngine.gain && audioEngine.ctx) {
			try { if (audioEngine.ctx.state === "suspended") await audioEngine.ctx.resume(); } catch {}
			return true;
		}
		if (audioEngine.initPromise) return audioEngine.initPromise;
		audioEngine.initPromise = (async () => {
			const element = findAudioElement();
			if (!element) return false;
			try {
				const AudioCtx = window.AudioContext || window.webkitAudioContext;
				if (!AudioCtx) return false;
				const ctx = new AudioCtx();
				const source = ctx.createMediaElementSource(element);
				const gain = ctx.createGain();
				source.connect(gain);
				gain.connect(ctx.destination);
				audioEngine.ctx = ctx;
				audioEngine.source = source;
				audioEngine.gain = gain;
				audioEngine.element = element;
				audioEngine.ready = true;
				audioEngine.baseGain = 1;
				audioEngine.fadeGain = 1;
				gain.gain.value = 1;
				try { await ctx.resume(); } catch {}
				return true;
			} catch (error) {
				console.warn("[Meriotify] WebAudio gain unavailable", error);
				return false;
			}
		})();
		const result = await audioEngine.initPromise;
		audioEngine.initPromise = null;
		return result;
	}

	function setAudioBaseGain(value) {
		audioEngine.baseGain = clamp(Number(value) || 1, 0, 2);
		if (!audioEngine.ready || !audioEngine.gain || !audioEngine.ctx || fade.active) return;
		const now = audioEngine.ctx.currentTime;
		audioEngine.gain.gain.cancelScheduledValues(now);
		audioEngine.gain.gain.setValueAtTime(Math.max(0.0001, audioEngine.baseGain), now);
	}

	function getExtendedVolume() {
		if (settings.volumeBoost.enabled) return clamp(Number(settings.volumeBoost.value || 100), 0, 200) / 100;
		return clamp(Number(Spicetify.Player.getVolume?.() ?? 1), 0, 1);
	}

	function setExtendedVolume(level, persist = false, verify = true, emit = true) {
		const max = settings.volumeBoost.enabled ? 2 : 1;
		const next = clamp(Number(level) || 0, 0, max);
		if (!settings.volumeBoost.enabled || next <= 1) {
			try { Spicetify.Player.setVolume(next); } catch { try { Spicetify.Platform.PlaybackAPI.setVolume(next); } catch {} }
			setAudioBaseGain(1);
			volumeBoostSupported = settings.volumeBoost.enabled ? true : null;
		} else {
			try { Spicetify.Player.setVolume(1); } catch { try { Spicetify.Platform.PlaybackAPI.setVolume(1); } catch {} }
			ensureAudioEngine().then((ready) => {
				volumeBoostSupported = ready;
				if (ready) setAudioBaseGain(next);
				publishRuntime();
			});
		}
		if (settings.volumeBoost.enabled && persist) {
			settings.volumeBoost.value = Math.round(next * 100);
			saveSettings();
		}
		updateVolumeTail();
		if (emit) publishRuntime();
	}

	function configureVolumeBoost() {
		if (!settings.volumeBoost.enabled) {
			removeVolumeTail();
			volumeBoostSupported = null;
			setAudioBaseGain(1);
			publishRuntime();
			return;
		}
		settings.volumeBoost.value = clamp(Number(settings.volumeBoost.value || 100), 0, 200);
		saveSettings();
		installVolumeTail();
		ensureAudioEngine().then((ready) => { volumeBoostSupported = ready; publishRuntime(); });
		setExtendedVolume(settings.volumeBoost.value / 100, false, settings.volumeBoost.value > 100);
	}

	function installVolumeTail() {
		removeVolumeTail();
		const attach = () => {
			const host = document.querySelector(".main-nowPlayingBar-right .volume-bar") || document.querySelector(".volume-bar");
			if (!host || host.querySelector(".meriotify-volume-plus")) return false;
			const wrap = document.createElement("div");
			wrap.className = "meriotify-volume-plus";
			wrap.innerHTML = `<input aria-label="Meriotify Volume+ 100 to 200 percent" type="range" min="100" max="200" step="1"><span>200%</span>`;
			const input = wrap.querySelector("input");
			input.value = String(Math.max(100, settings.volumeBoost.value || 100));
			input.addEventListener("input", () => setExtendedVolume(Number(input.value) / 100, true));
			host.addEventListener("pointerdown", (event) => {
				if (event.target === input || wrap.contains(event.target)) return;
				if (settings.volumeBoost.enabled && settings.volumeBoost.value > 100) {
					settings.volumeBoost.value = 100;
					saveSettings();
					updateVolumeTail();
				}
			}, true);
			host.appendChild(wrap);
			volumeTail = wrap;
			return true;
		};
		if (!attach()) {
			volumeObserver = new MutationObserver(() => { if (attach()) { volumeObserver?.disconnect(); volumeObserver = null; } });
			volumeObserver.observe(document.body, { childList: true, subtree: true });
		}
	}

	function updateVolumeTail() {
		const input = volumeTail?.querySelector("input");
		if (input) input.value = String(Math.max(100, clamp(Number(settings.volumeBoost.value || 100), 100, 200)));
	}

	function removeVolumeTail() {
		volumeObserver?.disconnect();
		volumeObserver = null;
		volumeTail?.remove();
		volumeTail = null;
	}

	function handleWindowBlur() {
		updateGifPauseState();
	}

	function handleWindowFocus() {
		updateGifPauseState();
	}

	function applySpotifyPlus() {
		const enabled = Boolean(settings.spotifyPlus.enabled);
		const motionEnabled = enabled && Boolean(settings.spotifyPlus.motion);
		document.body.classList.toggle("meriotify-spotify-plus", enabled);
		document.body.classList.toggle("meriotify-spotify-plus-motion", motionEnabled);
		configureSpotifyPlusMotion(motionEnabled);
		document.getElementById("meriotify-spotifyplus-ambient")?.remove();
		document.getElementById("meriotify-plus-home")?.remove();
		publishRuntime();
	}

	function getSpotifyPlusMotionTarget(node) {
		if (!(node instanceof Element)) return null;
		const button = node.closest('button, [role="button"]');
		if (button) return { element: button, kind: "button" };

		const card = node.closest([
			'.main-card-card',
			'.main-card-cardContainer',
			'[data-testid="card-container"]',
			'[data-encore-id="card"]',
			'[data-testid$="-card"]',
			'[data-testid*="card-container"]'
		].join(','));
		if (card) return { element: card, kind: "card" };

		const row = node.closest([
			'.main-trackList-trackListRow',
			'[role="row"][aria-rowindex]',
			'[data-testid*="track-list-row"]',
			'[data-testid*="tracklist-row"]'
		].join(','));
		if (row) return { element: row, kind: "row" };

		const nav = node.closest([
			'.main-yourLibraryX-listItem',
			'.main-yourLibraryX-navItem',
			'.main-navBar-navBarLink',
			'.Root__nav-bar [role="listitem"]',
			'.Root__nav-bar [role="treeitem"]',
			'[data-testid*="library"] [role="listitem"]'
		].join(','));
		if (nav) return { element: nav, kind: "nav" };
		return null;
	}

	function clearSpotifyPlusMotionTarget(target, className) {
		if (!target?.element) return;
		target.element.classList.remove(className);
		if (!target.element.classList.contains("meriotify-motion-hover") && !target.element.classList.contains("meriotify-motion-press")) {
			target.element.removeAttribute("data-meriotify-motion-kind");
		}
	}

	function onSpotifyPlusPointerOver(event) {
		const next = getSpotifyPlusMotionTarget(event.target);
		if (!next) return;
		if (spotifyPlusHoverTarget?.element === next.element) return;
		clearSpotifyPlusMotionTarget(spotifyPlusHoverTarget, "meriotify-motion-hover");
		spotifyPlusHoverTarget = next;
		next.element.setAttribute("data-meriotify-motion-kind", next.kind);
		next.element.classList.add("meriotify-motion-hover");
	}

	function onSpotifyPlusPointerOut(event) {
		if (!spotifyPlusHoverTarget?.element) return;
		if (event.relatedTarget instanceof Node && spotifyPlusHoverTarget.element.contains(event.relatedTarget)) return;
		clearSpotifyPlusMotionTarget(spotifyPlusHoverTarget, "meriotify-motion-hover");
		spotifyPlusHoverTarget = null;
	}

	function onSpotifyPlusPointerDown(event) {
		const next = getSpotifyPlusMotionTarget(event.target);
		if (!next) return;
		clearSpotifyPlusMotionTarget(spotifyPlusPressTarget, "meriotify-motion-press");
		spotifyPlusPressTarget = next;
		next.element.setAttribute("data-meriotify-motion-kind", next.kind);
		next.element.classList.add("meriotify-motion-press");
	}

	function clearSpotifyPlusPress() {
		clearSpotifyPlusMotionTarget(spotifyPlusPressTarget, "meriotify-motion-press");
		spotifyPlusPressTarget = null;
	}

	function configureSpotifyPlusMotion(enabled) {
		if (enabled && !spotifyPlusMotionBound) {
		document.addEventListener("pointerover", onSpotifyPlusPointerOver, true);
		document.addEventListener("pointerout", onSpotifyPlusPointerOut, true);
		document.addEventListener("pointerdown", onSpotifyPlusPointerDown, true);
		document.addEventListener("pointerup", clearSpotifyPlusPress, true);
		document.addEventListener("pointercancel", clearSpotifyPlusPress, true);
		spotifyPlusMotionBound = true;
		return;
		}
		if (!enabled && spotifyPlusMotionBound) {
		document.removeEventListener("pointerover", onSpotifyPlusPointerOver, true);
		document.removeEventListener("pointerout", onSpotifyPlusPointerOut, true);
		document.removeEventListener("pointerdown", onSpotifyPlusPointerDown, true);
		document.removeEventListener("pointerup", clearSpotifyPlusPress, true);
		document.removeEventListener("pointercancel", clearSpotifyPlusPress, true);
		clearSpotifyPlusMotionTarget(spotifyPlusHoverTarget, "meriotify-motion-hover");
		clearSpotifyPlusMotionTarget(spotifyPlusPressTarget, "meriotify-motion-press");
		spotifyPlusHoverTarget = null;
		spotifyPlusPressTarget = null;
		spotifyPlusMotionBound = false;
		}
	}

	async function applyAdaptiveTheme() {
		const generation = ++adaptiveGeneration;
		if (!settings.adaptiveTheme.enabled) {
			clearAdaptiveTheme();
			return;
		}

		const meta = Spicetify.Player.data?.item?.metadata;
		const candidates = [meta?.image_xlarge_url, meta?.image_large_url, meta?.image_url]
			.map(normalizeArtworkUrl)
			.filter(Boolean);
		if (!candidates.length) {
			clearAdaptiveTheme();
			return;
		}

		let colors = [];
		for (const candidate of [...new Set(candidates)]) {
			try {
				colors = await extractMainColors(candidate);
				if (colors.length) break;
			} catch {}
		}

		if (generation !== adaptiveGeneration || !settings.adaptiveTheme.enabled) return;
		if (!colors.length) {
			clearAdaptiveTheme();
			return;
		}

		const intensity = clamp(Number(settings.adaptiveTheme.intensity || 65) / 100, 0.2, 1);
		const primary = normalizeAccent(colors[0]);
		const secondary = normalizeAccent(colors[1] || primary);
		const main = mixRgb([12, 12, 12], primary, 0.12 + 0.14 * intensity);
		const mainElevated = mixRgb([28, 28, 28], secondary, 0.10 + 0.12 * intensity);
		const sidebar = mixRgb([10, 10, 10], primary, 0.08 + 0.10 * intensity);
		const player = mixRgb([10, 10, 10], secondary, 0.08 + 0.10 * intensity);
		const card = mixRgb([35, 35, 35], primary, 0.13 + 0.16 * intensity);
		const highlight = mixRgb([42, 42, 42], secondary, 0.12 + 0.13 * intensity);
		const selected = mixRgb([100, 100, 100], primary, 0.24 * intensity);

		lastAccent = rgbCss(primary);
		adaptiveReady = true;

		const vars = {
			"--meriotify-accent": rgbCss(primary),
			"--meriotify-accent-2": rgbCss(secondary),
			"--meriotify-primary-rgb": rgbCsv(primary),
			"--meriotify-secondary-rgb": rgbCsv(secondary),
			"--meriotify-neon-a": rgbCss(primary),
			"--meriotify-neon-b": rgbCss(secondary),
			"--meriotify-adaptive-opacity": String(0.38 + 0.42 * intensity),
			"--spice-main": rgbCss(main),
			"--spice-main-elevated": rgbCss(mainElevated),
			"--spice-sidebar": rgbCss(sidebar),
			"--spice-player": rgbCss(player),
			"--spice-card": rgbCss(card),
			"--spice-highlight": rgbCss(highlight),
			"--spice-highlight-elevated": rgbCss(highlight),
			"--spice-selected-row": rgbCss(selected),
			"--spice-tab-active": rgbCss(card),
			"--spice-button": rgbCss(primary),
			"--spice-button-active": rgbCss(secondary),
			"--spice-rgb-main": rgbCsv(main),
			"--spice-rgb-main-elevated": rgbCsv(mainElevated),
			"--spice-rgb-sidebar": rgbCsv(sidebar),
			"--spice-rgb-player": rgbCsv(player),
			"--spice-rgb-card": rgbCsv(card),
			"--spice-rgb-highlight": rgbCsv(highlight),
			"--spice-rgb-selected-row": rgbCsv(selected),
			"--spice-rgb-button": rgbCsv(primary),
			"--spice-rgb-button-active": rgbCsv(secondary),
			"--essential-bright-accent": rgbCss(primary),
			"--essential-bright-accent-base": rgbCss(primary),
			"--text-bright-accent": rgbCss(primary),
		};

		for (const [name, value] of Object.entries(vars)) setAdaptiveVar(name, value);
		ensureAdaptiveLayer();
		document.body.classList.add("meriotify-adaptive-theme");
		publishRuntime();
	}

	function setAdaptiveVar(name, value) {
		const root = document.documentElement;
		if (!adaptiveOriginalVars.has(name)) {
			adaptiveOriginalVars.set(name, {
				value: root.style.getPropertyValue(name),
				priority: root.style.getPropertyPriority(name),
			});
		}
		root.style.setProperty(name, value, "important");
	}

	function normalizeArtworkUrl(value) {
		const src = String(value || "").trim();
		if (!src) return "";
		if (src.startsWith("spotify:image:")) return `https://i.scdn.co/image/${src.slice("spotify:image:".length)}`;
		return src;
	}

	function ensureAdaptiveLayer() {
		let layer = document.getElementById("meriotify-adaptive-layer");
		if (!layer) {
			layer = document.createElement("div");
			layer.id = "meriotify-adaptive-layer";
			document.body.prepend(layer);
		}
		return layer;
	}

	function clearAdaptiveTheme() {
		adaptiveReady = false;
		lastAccent = null;
		const root = document.documentElement;
		for (const [name, original] of adaptiveOriginalVars.entries()) {
			if (original.value) root.style.setProperty(name, original.value, original.priority || "");
			else root.style.removeProperty(name);
		}
		adaptiveOriginalVars.clear();
		document.getElementById("meriotify-adaptive-layer")?.remove();
		document.body.classList.remove("meriotify-adaptive-theme");
		publishRuntime();
	}

	async function extractMainColors(src) {
		let objectUrl = null;
		try {
			const response = await fetch(src, { cache: "force-cache" });
			if (!response.ok) throw new Error(`Artwork HTTP ${response.status}`);
			const blob = await response.blob();
			objectUrl = URL.createObjectURL(blob);
			return await extractColorsFromImage(objectUrl, false);
		} catch {
			return await extractColorsFromImage(src, true);
		} finally {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		}
	}

	function extractColorsFromImage(src, crossOrigin) {
		return new Promise((resolve, reject) => {
			const image = new Image();
			if (crossOrigin) image.crossOrigin = "anonymous";
			image.onload = () => {
				try {
					const canvas = document.createElement("canvas");
					canvas.width = 56;
					canvas.height = 56;
					const context = canvas.getContext("2d", { willReadFrequently: true });
					context.drawImage(image, 0, 0, 56, 56);
					const pixels = context.getImageData(0, 0, 56, 56).data;
					const buckets = new Map();
					let totalR = 0;
					let totalG = 0;
					let totalB = 0;
					let totalCount = 0;

					for (let index = 0; index < pixels.length; index += 16) {
						const r = pixels[index];
						const g = pixels[index + 1];
						const b = pixels[index + 2];
						const a = pixels[index + 3];
						if (a < 180) continue;
						totalR += r;
						totalG += g;
						totalB += b;
						totalCount++;

						const max = Math.max(r, g, b);
						const min = Math.min(r, g, b);
						const lum = luminance([r, g, b]);
						const saturation = max - min;
						if (lum < 20 || lum > 244 || saturation < 12) continue;

						const qr = Math.round(r / 20) * 20;
						const qg = Math.round(g / 20) * 20;
						const qb = Math.round(b / 20) * 20;
						const key = `${qr},${qg},${qb}`;
						const item = buckets.get(key) || {
							rgb: [clamp(qr, 0, 255), clamp(qg, 0, 255), clamp(qb, 0, 255)],
							score: 0,
						};
						item.score += 1 + saturation / 150;
						buckets.set(key, item);
					}

					const sorted = [...buckets.values()].sort((a, b) => b.score - a.score);
					if (!sorted.length) {
						if (!totalCount) {
							resolve([]);
							return;
						}
						const average = [
							Math.round(totalR / totalCount),
							Math.round(totalG / totalCount),
							Math.round(totalB / totalCount),
						];
						resolve([average, average]);
						return;
					}

					const primary = sorted[0].rgb;
					const secondary = sorted.find(({ rgb }) => colorDistance(primary, rgb) > 68)?.rgb || sorted[1]?.rgb || primary;
					resolve([primary, secondary]);
				} catch (error) {
					reject(error);
				}
			};
			image.onerror = reject;
			image.src = src;
		});
	}

	function colorDistance(a, b) {
		return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	}

	function openAssetDb() {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(ASSET_DB, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async function getBackgroundAsset() {
		const db = await openAssetDb();
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(ASSET_STORE, "readonly");
			const request = tx.objectStore(ASSET_STORE).get(BACKGROUND_ASSET);
			request.onsuccess = () => resolve(request.result || null);
			request.onerror = () => reject(request.error);
			tx.oncomplete = () => db.close();
		});
	}

	async function configureBackground() {
		if (!settings.background.enabled) {
			clearBackground();
			return;
		}
		try {
			const asset = await getBackgroundAsset();
			if (!asset?.blob) {
				clearBackground();
				return;
			}
			backgroundBlobType = asset.type || asset.blob.type || settings.background.type || "image";
			await applyBackgroundBlob(asset.blob);
			publishRuntime();
		} catch {
			clearBackground();
		}
	}

	async function applyBackgroundBlob(blob) {
		if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
		if (backgroundPosterUrl) URL.revokeObjectURL(backgroundPosterUrl);
		backgroundObjectUrl = URL.createObjectURL(blob);
		backgroundPosterUrl = null;

		const isGif = backgroundBlobType === "image/gif" || settings.background.type === "gif";
		if (isGif) backgroundPosterUrl = await createBackgroundPoster(backgroundObjectUrl).catch(() => null);

		ensureBackgroundLayer();
		updateBackgroundOpacity();
		document.body.classList.add("meriotify-custom-background");
		updateGifPauseState();
	}

	function updateBackgroundOpacity() {
		const layer = document.getElementById("meriotify-background-layer");
		if (!layer) return;
		layer.style.opacity = String(clamp(Number(settings.background.opacity ?? 0.38), 0.05, 1));
	}

	function createBackgroundPoster(src) {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => {
				try {
					const maxSize = 4096;
					const scale = Math.min(1, maxSize / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
					const canvas = document.createElement("canvas");
					canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
					canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
					const context = canvas.getContext("2d");
					context.imageSmoothingEnabled = true;
					context.imageSmoothingQuality = "high";
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					canvas.toBlob((poster) => {
						if (!poster) { reject(new Error("Could not create GIF poster")); return; }
						resolve(URL.createObjectURL(poster));
					}, "image/png");
				} catch (error) {
					reject(error);
				}
			};
			image.onerror = reject;
			image.src = src;
		});
	}

	function ensureBackgroundLayer() {
		let layer = document.getElementById("meriotify-background-layer");
		if (!layer) {
			layer = document.createElement("div");
			layer.id = "meriotify-background-layer";
			document.body.prepend(layer);
		}
		return layer;
	}

	function updateGifPauseState() {
		const layer = document.getElementById("meriotify-background-layer");
		if (!layer || !backgroundObjectUrl || !settings.background.enabled) return;
		const isGif = backgroundBlobType === "image/gif" || settings.background.type === "gif";
		const shouldPauseGif = isGif && (document.hidden || !document.hasFocus());
		const selectedUrl = shouldPauseGif ? backgroundPosterUrl : backgroundObjectUrl;
		layer.style.backgroundImage = selectedUrl ? `url("${selectedUrl}")` : "none";
	}

	function clearBackground() {
		document.getElementById("meriotify-background-layer")?.remove();
		if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
		if (backgroundPosterUrl) URL.revokeObjectURL(backgroundPosterUrl);
		backgroundObjectUrl = null;
		backgroundPosterUrl = null;
		backgroundBlobType = "";
		document.body.classList.remove("meriotify-custom-background");
		publishRuntime();
	}

	function installCoreStyles() {
		if (document.getElementById("meriotify-core-style")) return;
		const style = document.createElement("style");
		style.id = "meriotify-core-style";
		style.textContent = `
/* Shared background layers: no blur, no animated shader, no render loop. */
#meriotify-background-layer,
#meriotify-adaptive-layer {
	position: fixed;
	inset: 0;
	pointer-events: none;
}
#meriotify-background-layer {
	z-index: 0;
	background-position: center center;
	background-size: cover;
	background-repeat: no-repeat;
	background-color: #000;
	image-rendering: auto;
	transform: translateZ(0);
}
#meriotify-adaptive-layer {
	z-index: 1;
	opacity: var(--meriotify-adaptive-opacity, .72);
	background:
		radial-gradient(110% 90% at 88% 4%, rgba(var(--meriotify-secondary-rgb), .28), transparent 58%),
		linear-gradient(145deg, rgba(var(--meriotify-primary-rgb), .38), rgba(var(--meriotify-secondary-rgb), .18) 46%, rgba(5,5,5,.22) 82%);
}
body.meriotify-custom-background,
body.meriotify-adaptive-theme {
	background: #000 !important;
}
body.meriotify-custom-background #main,
body.meriotify-custom-background .Root,
body.meriotify-custom-background .Root__top-container,
body.meriotify-adaptive-theme #main,
body.meriotify-adaptive-theme .Root,
body.meriotify-adaptive-theme .Root__top-container {
	position: relative;
	z-index: 2;
	background: transparent !important;
}

/* Custom background must actually remain visible behind Spotify. */
body.meriotify-custom-background .Root__main-view,
body.meriotify-custom-background .main-view-container,
body.meriotify-custom-background .main-view-container__scroll-node,
body.meriotify-custom-background .main-view-container__scroll-node > [data-overlayscrollbars-viewport],
body.meriotify-custom-background .main-home-homeHeader,
body.meriotify-custom-background .main-home-content,
body.meriotify-custom-background .main-topBar-background,
body.meriotify-custom-background .main-entityHeader-backgroundColor,
body.meriotify-custom-background .main-entityHeader-overlay {
	background-color: transparent !important;
	background-image: none !important;
}
body.meriotify-custom-background .Root__nav-bar,
body.meriotify-custom-background .Root__right-sidebar,
body.meriotify-custom-background .Root__now-playing-bar {
	background-color: rgba(8,8,8,.72) !important;
}

/* Adaptive Album Theme affects the whole experience, not a preview square. */
body.meriotify-adaptive-theme .Root__main-view,
body.meriotify-adaptive-theme .main-view-container,
body.meriotify-adaptive-theme .main-view-container__scroll-node,
body.meriotify-adaptive-theme .main-home-homeHeader,
body.meriotify-adaptive-theme .main-home-content,
body.meriotify-adaptive-theme .main-topBar-background {
	background-color: transparent !important;
	background-image: none !important;
}
body.meriotify-adaptive-theme .Root__nav-bar,
body.meriotify-adaptive-theme .Root__right-sidebar,
body.meriotify-adaptive-theme .Root__now-playing-bar {
	background-color: rgba(var(--spice-rgb-sidebar, 12,12,12), .82) !important;
}
body.meriotify-adaptive-theme .main-card-card,
body.meriotify-adaptive-theme .main-card-cardContainer,
body.meriotify-adaptive-theme [data-testid="card-container"] {
	background-color: rgba(var(--meriotify-primary-rgb), .075) !important;
}
body.meriotify-adaptive-theme .main-card-card:hover,
body.meriotify-adaptive-theme .main-card-cardContainer:hover,
body.meriotify-adaptive-theme [data-testid="card-container"]:hover {
	background-color: rgba(var(--meriotify-secondary-rgb), .13) !important;
}
body.meriotify-adaptive-theme .main-playButton-PlayButton,
body.meriotify-adaptive-theme [data-encore-id="buttonPrimary"] {
	--background-base: var(--meriotify-accent) !important;
	--background-highlight: var(--meriotify-accent-2) !important;
}
body.meriotify-adaptive-theme .progress-bar__fg,
body.meriotify-adaptive-theme .playback-progressbar .progress-bar__fg,
body.meriotify-adaptive-theme .volume-bar .progress-bar__fg {
	background-color: var(--meriotify-accent) !important;
}
body.meriotify-adaptive-theme ::selection {
	background: rgba(var(--meriotify-primary-rgb), .45);
}

/* Spotify+ 1.2.0: desktop-shell redesign with current Now Playing wrapper coverage, runtime motion targeting and a 3-zone player shell. */
body.meriotify-spotify-plus {
	--mplus-glass: rgba(17,18,22,.72);
	--mplus-glass-strong: rgba(12,13,16,.88);
	--mplus-glass-soft: rgba(30,31,37,.56);
	--mplus-soft: rgba(255,255,255,.055);
	--mplus-soft-2: rgba(255,255,255,.085);
	--mplus-line: rgba(255,255,255,.12);
	--mplus-line-soft: rgba(255,255,255,.065);
	--mplus-panel-radius: 24px;
	--mplus-card-radius: 18px;
	--mplus-cover-radius: 14px;
	--mplus-shadow: 0 18px 55px rgba(0,0,0,.34);
	--mplus-shadow-soft: 0 10px 28px rgba(0,0,0,.20);
	--mplus-inner: inset 0 1px 0 rgba(255,255,255,.065);
	--mplus-ease: cubic-bezier(.18,.82,.2,1);
	background: #08090b !important;
}
body.meriotify-spotify-plus *,
body.meriotify-spotify-plus *::before,
body.meriotify-spotify-plus *::after { box-sizing: border-box; }

/* Desktop shell: each major Spotify surface feels like its own floating workspace. */
body.meriotify-spotify-plus #main,
body.meriotify-spotify-plus .Root,
body.meriotify-spotify-plus .Root__top-container,
body.meriotify-spotify-plus .Root__main-view,
body.meriotify-spotify-plus .main-view-container,
body.meriotify-spotify-plus .main-view-container__scroll-node {
	background-color: transparent !important;
}
body.meriotify-spotify-plus .Root__top-container {
	gap: 8px !important;
	padding: 8px 8px 0 !important;
}
body.meriotify-spotify-plus .Root__main-view,
body.meriotify-spotify-plus .main-view-container {
	border-radius: var(--mplus-panel-radius) !important;
	border: 1px solid var(--mplus-line-soft) !important;
	box-shadow: var(--mplus-inner), 0 18px 44px rgba(0,0,0,.20) !important;
	overflow: clip !important;
}

/* Top navigation becomes a compact floating control strip. */
body.meriotify-spotify-plus .Root__globalNav {
	margin: 0 2px 8px !important;
	padding: 5px 8px !important;
	min-height: 52px !important;
	background: linear-gradient(180deg, rgba(28,29,34,.86), rgba(14,15,18,.82)) !important;
	border: 1px solid var(--mplus-line) !important;
	border-radius: 20px !important;
	box-shadow: var(--mplus-inner), var(--mplus-shadow-soft) !important;
	backdrop-filter: blur(22px) saturate(118%);
	-webkit-backdrop-filter: blur(22px) saturate(118%);
}
body.meriotify-spotify-plus .main-globalNav-searchInputWrapper {
	background: rgba(255,255,255,.065) !important;
	border: 1px solid rgba(255,255,255,.09) !important;
	border-radius: 16px !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.035) !important;
}
body.meriotify-spotify-plus .main-globalNav-searchInputWrapper:focus-within {
	background: rgba(255,255,255,.09) !important;
	border-color: rgba(255,255,255,.18) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.055), 0 0 0 3px rgba(255,255,255,.035) !important;
}
body.meriotify-spotify-plus .main-globalNav-historyButtons button,
body.meriotify-spotify-plus .main-topBar-historyButtons button,
body.meriotify-spotify-plus .Root__globalNav button {
	border-radius: 14px !important;
}

/* Left library and right Now Playing read as detached docks, not stock sidebars. */
body.meriotify-spotify-plus .Root__nav-bar,
body.meriotify-spotify-plus .Root__right-sidebar {
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
	overflow: visible !important;
}
body.meriotify-spotify-plus .main-yourLibraryX-libraryContainer,
body.meriotify-spotify-plus .main-yourLibraryX-library,
body.meriotify-spotify-plus .main-nowPlayingView-nowPlayingGrid {
	border-radius: var(--mplus-panel-radius) !important;
	background: linear-gradient(180deg, rgba(24,25,30,.82), rgba(12,13,16,.88)) !important;
	border: 1px solid var(--mplus-line) !important;
	box-shadow: var(--mplus-inner), var(--mplus-shadow) !important;
	backdrop-filter: blur(22px) saturate(112%);
	-webkit-backdrop-filter: blur(22px) saturate(112%);
}
body.meriotify-spotify-plus .main-yourLibraryX-libraryContainer,
body.meriotify-spotify-plus .main-yourLibraryX-library {
	padding: 4px !important;
}
body.meriotify-spotify-plus .main-yourLibraryX-listItem,
body.meriotify-spotify-plus .main-yourLibraryX-navItem,
body.meriotify-spotify-plus .main-navBar-navBarLink {
	border-radius: 14px !important;
}
body.meriotify-spotify-plus .main-yourLibraryX-listItem:hover,
body.meriotify-spotify-plus .main-yourLibraryX-navItem:hover,
body.meriotify-spotify-plus .main-navBar-navBarLink:hover {
	background: rgba(255,255,255,.055) !important;
}
body.meriotify-spotify-plus .main-yourLibraryX-listItem[aria-selected="true"],
body.meriotify-spotify-plus .main-yourLibraryX-navItem[aria-current="page"],
body.meriotify-spotify-plus .main-navBar-navBarLinkActive {
	background: rgba(255,255,255,.085) !important;
	box-shadow: inset 3px 0 0 rgba(255,255,255,.72) !important;
}

/* Right rail: content remains native, but every section is visually separated and readable. */
body.meriotify-spotify-plus .main-nowPlayingView-nowPlayingGrid {
	overflow-x: clip !important;
	overflow-y: auto !important;
	padding: 8px !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-section {
	min-width: 0 !important;
	max-width: 100% !important;
	margin: 0 0 8px !important;
	padding: 14px !important;
	background: rgba(255,255,255,.032) !important;
	border: 1px solid var(--mplus-line-soft) !important;
	border-radius: 17px !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.028) !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-section:last-child { margin-bottom: 0 !important; }
body.meriotify-spotify-plus .main-nowPlayingView-contextItemInfo,
body.meriotify-spotify-plus .main-nowPlayingView-headerTextWrapper,
body.meriotify-spotify-plus .main-nowPlayingView-headerTextWrapper *,
body.meriotify-spotify-plus .main-nowPlayingView-aboutArtistV2TextContent,
body.meriotify-spotify-plus .main-nowPlayingView-lyricsContent {
	min-width: 0 !important;
	max-width: 100% !important;
	width: auto !important;
	transform: none !important;
	word-break: normal !important;
	overflow-wrap: anywhere !important;
}
body.meriotify-spotify-plus .main-nowPlayingView-contextItemInfo {
	overflow: visible !important;
	padding-inline: 0 !important;
}
body.meriotify-spotify-plus .main-nowPlayingView-contextItemInfo a,
body.meriotify-spotify-plus .main-nowPlayingView-contextItemInfo span {
	max-width: 100% !important;
	white-space: normal !important;
	overflow: visible !important;
	text-overflow: clip !important;
}
body.meriotify-spotify-plus .main-nowPlayingView-coverArtContainer,
body.meriotify-spotify-plus .main-nowPlayingView-coverArtContainer img,
body.meriotify-spotify-plus .main-nowPlayingView-coverArt {
	max-width: 100% !important;
	border-radius: 18px !important;
	overflow: hidden !important;
	box-shadow: 0 16px 36px rgba(0,0,0,.28) !important;
}
body.meriotify-spotify-plus .main-nowPlayingView-coverArtContainer img,
body.meriotify-spotify-plus .main-nowPlayingView-coverArt img {
	display: block !important;
	width: 100% !important;
	height: auto !important;
	object-fit: cover !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-section:has(.x-music-video),
body.meriotify-spotify-plus .Root__right-sidebar .x-music-video { display: none !important; }

/* 1.2.0: harden the entire top-right shell, including the current nowPlayingWidgets wrapper used by recent Spotify builds. */
body.meriotify-spotify-plus .Root__right-sidebar {
	position: relative !important;
	min-width: 0 !important;
	border-radius: var(--mplus-panel-radius) !important;
	background: linear-gradient(180deg, rgba(24,25,30,.86), rgba(12,13,16,.92)) !important;
	border: 1px solid var(--mplus-line) !important;
	box-shadow: var(--mplus-inner), var(--mplus-shadow) !important;
	backdrop-filter: blur(22px) saturate(112%);
	-webkit-backdrop-filter: blur(22px) saturate(112%);
	isolation: isolate !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-nowPlayingWidgets,
body.meriotify-spotify-plus .Root__right-sidebar [class*="nowPlayingView-nowPlayingWidgets"],
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="now-playing-view"],
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="now-playing-view"] > div {
	min-width: 0 !important;
	max-width: 100% !important;
	background-color: transparent !important;
	background-image: none !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-nowPlayingWidgets::before,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-nowPlayingWidgets::after,
body.meriotify-spotify-plus .Root__right-sidebar [class*="nowPlayingView-nowPlayingWidgets"]::before,
body.meriotify-spotify-plus .Root__right-sidebar [class*="nowPlayingView-nowPlayingWidgets"]::after {
	background: transparent !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-nowPlayingWidgets {
	border: 0 !important;
	border-radius: inherit !important;
	overflow-x: clip !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-nowPlayingGrid {
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
	border-radius: inherit !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-container,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-content,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-gradient,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-nowPlayingWidgets,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-header,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-headerContainer,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-contextItem,
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="now-playing-view"] {
	background-color: transparent !important;
	background-image: none !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-contextItem,
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-contextItemInfo,
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="context-item-info-title"],
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="context-item-info-subtitles"] {
	min-width: 0 !important;
	max-width: 100% !important;
	width: 100% !important;
}
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="context-item-info-title"],
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="context-item-info-title"] *,
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="context-item-info-subtitles"],
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="context-item-info-subtitles"] * {
	white-space: normal !important;
	overflow: visible !important;
	text-overflow: clip !important;
	overflow-wrap: anywhere !important;
}

/* The top-right account/control area must inherit the Spotify+ shell instead of keeping Spotify's stock topbar slab. */
body.meriotify-spotify-plus .main-topBar-container,
body.meriotify-spotify-plus .main-topBar-topbarContent,
body.meriotify-spotify-plus .main-topBar-topbarContentRight,
body.meriotify-spotify-plus [data-testid="topbar-content-right"] {
	background-color: transparent !important;
	background-image: none !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .main-topBar-container::before,
body.meriotify-spotify-plus .main-topBar-container::after,
body.meriotify-spotify-plus .main-topBar-topbarContentRight::before,
body.meriotify-spotify-plus .main-topBar-topbarContentRight::after {
	background: transparent !important;
	box-shadow: none !important;
}

/* Main canvas: less 'web page', more desktop workspace. */
body.meriotify-spotify-plus .main-home-homeHeader,
body.meriotify-spotify-plus .main-entityHeader-container,
body.meriotify-spotify-plus .main-actionBar-ActionBar,
body.meriotify-spotify-plus .main-topBar-background,
body.meriotify-spotify-plus .main-actionBarBackground-background {
	background: transparent !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .main-entityHeader-container {
	border-radius: 0 0 28px 28px !important;
}
body.meriotify-spotify-plus .main-trackList-trackListRow,
body.meriotify-spotify-plus [role="row"] {
	border-radius: 14px !important;
	border: 1px solid transparent !important;
	background-clip: padding-box !important;
}
body.meriotify-spotify-plus .main-trackList-trackListRow:hover,
body.meriotify-spotify-plus [role="row"]:hover {
	background: rgba(255,255,255,.055) !important;
	border-color: var(--mplus-line-soft) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.025) !important;
}
body.meriotify-spotify-plus .main-trackList-trackListRow[aria-selected="true"],
body.meriotify-spotify-plus [role="row"][aria-selected="true"] {
	background: rgba(255,255,255,.075) !important;
	border-color: rgba(255,255,255,.10) !important;
}

/* Cards are real objects now: raised surface, artwork depth, cleaner play action. */
body.meriotify-spotify-plus .main-card-card,
body.meriotify-spotify-plus .main-card-cardContainer,
body.meriotify-spotify-plus [data-testid="card-container"] {
	position: relative !important;
	border-radius: var(--mplus-card-radius) !important;
	border: 1px solid rgba(255,255,255,.055) !important;
	background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.018)) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.028), 0 9px 24px rgba(0,0,0,.08) !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .main-card-card:hover,
body.meriotify-spotify-plus .main-card-cardContainer:hover,
body.meriotify-spotify-plus [data-testid="card-container"]:hover {
	background: linear-gradient(180deg, rgba(255,255,255,.080), rgba(255,255,255,.032)) !important;
	border-color: rgba(255,255,255,.115) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 16px 34px rgba(0,0,0,.18) !important;
}
body.meriotify-spotify-plus .main-cardImage-imageWrapper,
body.meriotify-spotify-plus .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus .main-entityHeader-imageContainer,
body.meriotify-spotify-plus [data-testid="cover-art-image"] {
	border-radius: var(--mplus-cover-radius) !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .main-cardImage-imageWrapper {
	box-shadow: 0 10px 24px rgba(0,0,0,.20) !important;
}
body.meriotify-spotify-plus [data-testid="artist-card"] .main-cardImage-imageWrapper,
body.meriotify-spotify-plus [data-testid="artist-card"] img,
body.meriotify-spotify-plus a[href^="/artist/"] .main-cardImage-imageWrapper,
body.meriotify-spotify-plus a[href^="/artist/"] img { border-radius: 50% !important; }

/* Chips/tabs/navigation look like a coherent Linux-style control set. */
body.meriotify-spotify-plus .main-home-filterChipsSection button,
body.meriotify-spotify-plus .main-yourLibraryX-filterArea button,
body.meriotify-spotify-plus [data-encore-id="chip"],
body.meriotify-spotify-plus [role="tab"] {
	border-radius: 12px !important;
	border: 1px solid rgba(255,255,255,.055) !important;
	background: rgba(255,255,255,.045) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.025) !important;
}
body.meriotify-spotify-plus [role="tab"][aria-selected="true"],
body.meriotify-spotify-plus [data-encore-id="chip"][aria-checked="true"] {
	background: rgba(255,255,255,.12) !important;
	border-color: rgba(255,255,255,.14) !important;
}
body.meriotify-spotify-plus button,
body.meriotify-spotify-plus a { -webkit-tap-highlight-color: transparent; }

/* Bottom player becomes a deliberate floating dock. Geometry remains Spotify-native. */
body.meriotify-spotify-plus .Root__now-playing-bar {
	margin: 0 10px 10px !important;
	padding: 0 !important;
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
	overflow: visible !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	padding-inline: 14px !important;
	border-radius: 22px !important;
	background: linear-gradient(180deg, rgba(28,29,34,.90), rgba(12,13,16,.92)) !important;
	border: 1px solid var(--mplus-line) !important;
	box-shadow: var(--mplus-inner), 0 18px 48px rgba(0,0,0,.38) !important;
	backdrop-filter: blur(24px) saturate(116%);
	-webkit-backdrop-filter: blur(24px) saturate(116%);
}
body.meriotify-spotify-plus .main-nowPlayingBar-left,
body.meriotify-spotify-plus .main-nowPlayingBar-center,
body.meriotify-spotify-plus .main-nowPlayingBar-right,
body.meriotify-spotify-plus .main-nowPlayingWidget-nowPlaying,
body.meriotify-spotify-plus .main-nowPlayingWidget-trackInfo { min-width: 0 !important; }
body.meriotify-spotify-plus .main-nowPlayingBar-left,
body.meriotify-spotify-plus .main-nowPlayingBar-center,
body.meriotify-spotify-plus .main-nowPlayingBar-right {
	margin: 10px 0 !important;
	padding: 10px 14px !important;
	border-radius: 18px !important;
	background: linear-gradient(180deg, rgba(255,255,255,.052), rgba(255,255,255,.026)) !important;
	border: 1px solid rgba(255,255,255,.08) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.16) !important;
	min-height: 72px !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-left { margin-right: 8px !important; }
body.meriotify-spotify-plus .main-nowPlayingBar-center {
	margin-inline: 8px !important;
	padding-inline: 18px !important;
	background: linear-gradient(180deg, rgba(255,255,255,.068), rgba(255,255,255,.03)) !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-right {
	margin-left: 8px !important;
	padding-inline: 16px !important;
}
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArtContainer,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArt,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArt img,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArt .cover-art-image {
	border-radius: 11px !important;
	box-shadow: 0 8px 20px rgba(0,0,0,.26) !important;
}
body.meriotify-spotify-plus .main-nowPlayingWidget-trackInfo a,
body.meriotify-spotify-plus .main-nowPlayingWidget-trackInfo span {
	max-width: 100% !important;
	overflow: hidden !important;
	text-overflow: ellipsis !important;
	white-space: nowrap !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-right { justify-content: flex-end !important; }
body.meriotify-spotify-plus .main-nowPlayingBar-left::after,
body.meriotify-spotify-plus .main-nowPlayingBar-center::after {
	content: "";
	position: absolute;
	right: -9px;
	top: 12px;
	bottom: 12px;
	width: 1px;
	background: linear-gradient(180deg, transparent, rgba(255,255,255,.12), transparent);
	pointer-events: none;
}
body.meriotify-spotify-plus .main-nowPlayingBar-left,
body.meriotify-spotify-plus .main-nowPlayingBar-center { position: relative !important; }
body.meriotify-spotify-plus .progress-bar__bg {
	border-radius: 999px !important;
	background: rgba(255,255,255,.10) !important;
}
body.meriotify-spotify-plus .progress-bar__fg { border-radius: 999px !important; }

/* Cleaner scrollbars complete the desktop-theme feel. */
body.meriotify-spotify-plus ::-webkit-scrollbar { width: 10px; height: 10px; }
body.meriotify-spotify-plus ::-webkit-scrollbar-track { background: transparent; }
body.meriotify-spotify-plus ::-webkit-scrollbar-thumb {
	background: rgba(255,255,255,.12);
	border: 3px solid transparent;
	background-clip: padding-box;
	border-radius: 999px;
}
body.meriotify-spotify-plus ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.22); background-clip: padding-box; }

/* Custom backgrounds stay continuous behind every shell. */
body.meriotify-custom-background.meriotify-spotify-plus .Root__top-container,
body.meriotify-custom-background.meriotify-spotify-plus .Root__globalNav,
body.meriotify-custom-background.meriotify-spotify-plus .Root__main-view,
body.meriotify-custom-background.meriotify-spotify-plus .main-view-container,
body.meriotify-custom-background.meriotify-spotify-plus .main-view-container__scroll-node,
body.meriotify-custom-background.meriotify-spotify-plus .main-view-container__scroll-node-child,
body.meriotify-custom-background.meriotify-spotify-plus .main-topBar-container,
body.meriotify-custom-background.meriotify-spotify-plus .main-topBar-background,
body.meriotify-custom-background.meriotify-spotify-plus .Root__nav-bar,
body.meriotify-custom-background.meriotify-spotify-plus .Root__right-sidebar,
body.meriotify-custom-background.meriotify-spotify-plus .Root__now-playing-bar,
body.meriotify-custom-background.meriotify-spotify-plus .main-nowPlayingView-container,
body.meriotify-custom-background.meriotify-spotify-plus .main-nowPlayingView-content,
body.meriotify-custom-background.meriotify-spotify-plus .main-nowPlayingView-gradient,
body.meriotify-custom-background.meriotify-spotify-plus .main-nowPlayingView-nowPlayingWidgets,
body.meriotify-custom-background.meriotify-spotify-plus [class*="nowPlayingView-nowPlayingWidgets"] {
	background-color: transparent !important;
	background-image: none !important;
}

/* 1.2.0 motion: CSS selectors remain as fallback, while runtime classes make hover work across Spotify DOM changes. */
body.meriotify-spotify-plus-motion .main-card-card,
body.meriotify-spotify-plus-motion .main-card-cardContainer,
body.meriotify-spotify-plus-motion [data-testid="card-container"],
body.meriotify-spotify-plus-motion .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus-motion .main-trackList-trackListRow,
body.meriotify-spotify-plus-motion [role="row"],
body.meriotify-spotify-plus-motion .main-yourLibraryX-listItem,
body.meriotify-spotify-plus-motion .main-yourLibraryX-navItem,
body.meriotify-spotify-plus-motion .main-navBar-navBarLink,
body.meriotify-spotify-plus-motion button,
body.meriotify-spotify-plus-motion .meriotify-motion-hover,
body.meriotify-spotify-plus-motion .meriotify-motion-press {
	transition:
		transform 230ms var(--mplus-ease),
		background-color 180ms ease,
		border-color 180ms ease,
		box-shadow 230ms var(--mplus-ease),
		filter 230ms var(--mplus-ease),
		opacity 180ms ease !important;
	transform-origin: center center;
	will-change: transform;
}
body.meriotify-spotify-plus-motion .main-card-card:hover,
body.meriotify-spotify-plus-motion .main-card-cardContainer:hover,
body.meriotify-spotify-plus-motion [data-testid="card-container"]:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="card"] {
	transform: translate3d(0,-6px,0) scale(1.018) !important;
	filter: brightness(1.055) !important;
}
body.meriotify-spotify-plus-motion .main-card-card:hover .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus-motion .main-card-cardContainer:hover .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus-motion [data-testid="card-container"]:hover .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="card"] img {
	transform: scale(1.055) !important;
	transition: transform 260ms var(--mplus-ease) !important;
}
body.meriotify-spotify-plus-motion .main-trackList-trackListRow:hover,
body.meriotify-spotify-plus-motion [role="row"]:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="row"] {
	transform: translate3d(6px,0,0) !important;
}
body.meriotify-spotify-plus-motion .main-yourLibraryX-listItem:hover,
body.meriotify-spotify-plus-motion .main-yourLibraryX-navItem:hover,
body.meriotify-spotify-plus-motion .main-navBar-navBarLink:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="nav"] {
	transform: translate3d(5px,0,0) !important;
}
body.meriotify-spotify-plus-motion button:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="button"] {
	transform: translate3d(0,-2px,0) scale(1.045) !important;
	filter: brightness(1.10) !important;
}
body.meriotify-spotify-plus-motion .meriotify-motion-press,
body.meriotify-spotify-plus-motion button:active {
	transform: scale(.94) !important;
	transition-duration: 90ms !important;
}
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="card"],
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="row"],
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="nav"] {
	position: relative;
	z-index: 2;
}
`;
		document.head.append(style);
	}
})();
