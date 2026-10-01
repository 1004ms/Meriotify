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

	const SETTINGS_VERSION = 16;
	const DEFAULTS = {
		_schemaVersion: SETTINGS_VERSION,
		spotifyPlus: { enabled: false },
		adaptiveTheme: { enabled: false, intensity: 65 },
		background: { enabled: false, type: "", name: "", opacity: 0.78 },
		sleep: { enabled: false, minutes: 120, graceSeconds: 10 },
		fade: { enabled: false, seconds: 10 },
		volumeBoost: { enabled: false, value: 100 },
		shufflePlus: { enabled: false },
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
	let spotifyPlusVisualHistoryUnlisten = null;
	let spotifyPlusVisualRaf = 0;
	let spotifyPlusVisualTimers = [];
	let spotifyPlusPointerRaf = 0;
	let spotifyPlusPointerEvent = null;
	let spotifyPlusSpotlight = null;
	let spotifyPlusPageTimer = 0;
	let spotifyPlusWindowVisible = document.visibilityState !== "hidden";
	let spotifyPlusPointerLastFrame = 0;

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
			const schemaChanged = stored?._schemaVersion !== SETTINGS_VERSION;
			merged._schemaVersion = SETTINGS_VERSION;
			delete merged.fpsGuard;
			if (merged.shufflePlus) delete merged.shufflePlus.repeatPlaylist;
			if (merged.spotifyPlus) {
				delete merged.spotifyPlus.motion;
				delete merged.spotifyPlus.artworkLink;
				delete merged.spotifyPlus.artworkIntensity;
			}

			if (schemaChanged) {
				merged.spotifyPlus.enabled = false;
				merged.adaptiveTheme.enabled = false;
				merged.background.enabled = false;
				merged.sleep.enabled = false;
				merged.fade.enabled = false;
				merged.volumeBoost = { enabled: false, value: 100 };
				merged.shufflePlus.enabled = false;
				merged.keybinds.enabled = false;
			} else {
				merged.volumeBoost = { enabled: false, value: 100 };
			}

			if (schemaChanged || Object.prototype.hasOwnProperty.call(stored || {}, "fpsGuard") || stored?.shufflePlus?.repeatPlaylist !== undefined) {
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
		if (JSON.stringify(previous.spotifyPlus) !== JSON.stringify(settings.spotifyPlus)) {
			applySpotifyPlus();
			applyAdaptiveTheme();
		}
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
		if (settings.spotifyPlus.enabled) scheduleSpotifyPlusVisualBurst();
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
		document.body.classList.toggle("meriotify-spotify-plus", enabled);
		document.body.classList.toggle("meriotify-spotify-plus-motion", enabled);
		document.body.classList.toggle("meriotify-spotify-plus-artwork", enabled);
		configureSpotifyPlusMotion(enabled);
		configureSpotifyPlusVisuals(enabled);
		if (enabled) {
			triggerSpotifyPlusPageEntrance();
			scheduleSpotifyPlusVisualBurst();
		} else {
			clearSpotifyPlusPointerFx();
		}
		document.getElementById("meriotify-spotifyplus-ambient")?.remove();
		document.getElementById("meriotify-plus-home")?.remove();
		publishRuntime();
	}

	function spotifyPlusImageUrl(root) {
		if (!(root instanceof Element)) return "";
		const candidate = root.querySelector([
			'.main-entityHeader-imageContainer img[src]',
			'.main-entityHeader-image img[src]',
			'.main-nowPlayingView-coverArt img[src]',
			'[data-testid="cover-art-image"][src]',
			'[data-testid="cover-art-image"] img[src]',
			'img[src]'
		].join(','));
		if (candidate instanceof HTMLImageElement) return candidate.currentSrc || candidate.src || "";
		return "";
	}

	function spotifyPlusCssUrl(url) {
		return url ? `url(${JSON.stringify(url)})` : "none";
	}

	function syncSpotifyPlusVisuals() {
		spotifyPlusVisualRaf = 0;
		if (document.visibilityState === "hidden") return;
		if (!document.body.classList.contains("meriotify-spotify-plus")) return;

		const trackMeta = Spicetify.Player?.data?.item?.metadata || {};
		const currentArtwork = normalizeArtworkUrl(
			trackMeta.image_xlarge_url || trackMeta.image_large_url || trackMeta.image_url || ""
		);
		if (currentArtwork) {
			document.documentElement.style.setProperty("--meriotify-track-art-url", spotifyPlusCssUrl(currentArtwork));
		} else {
			document.documentElement.style.removeProperty("--meriotify-track-art-url");
		}

		for (const header of document.querySelectorAll('.main-entityHeader-container')) {
			const url = spotifyPlusImageUrl(header);
			const title = header.querySelector('h1');
			if (url && title) {
				header.classList.add('meriotify-plus-hero');
				header.style.setProperty('--meriotify-hero-url', spotifyPlusCssUrl(url));
			} else {
				header.classList.remove('meriotify-plus-hero');
				header.style.removeProperty('--meriotify-hero-url');
			}
		}

		const sidebar = document.querySelector('.Root__right-sidebar');
		if (sidebar instanceof HTMLElement) {
			const url = spotifyPlusImageUrl(sidebar);
			if (url) sidebar.style.setProperty('--meriotify-nowplaying-url', spotifyPlusCssUrl(url));
			else sidebar.style.removeProperty('--meriotify-nowplaying-url');
		}
	}

	function scheduleSpotifyPlusVisualSync() {
		if (spotifyPlusVisualRaf) return;
		spotifyPlusVisualRaf = requestAnimationFrame(syncSpotifyPlusVisuals);
	}

	function clearSpotifyPlusVisuals() {
		document.documentElement.style.removeProperty("--meriotify-track-art-url");
		if (spotifyPlusVisualRaf) cancelAnimationFrame(spotifyPlusVisualRaf);
		spotifyPlusVisualRaf = 0;
		for (const header of document.querySelectorAll('.meriotify-plus-hero')) {
			header.classList.remove('meriotify-plus-hero');
			header.style.removeProperty('--meriotify-hero-url');
		}
		document.querySelector('.Root__right-sidebar')?.style?.removeProperty('--meriotify-nowplaying-url');
	}

	function clearSpotifyPlusVisualTimers() {
		for (const timer of spotifyPlusVisualTimers) clearTimeout(timer);
		spotifyPlusVisualTimers = [];
	}

	function scheduleSpotifyPlusVisualBurst() {
		if (!settings.spotifyPlus.enabled || document.visibilityState === "hidden") return;
		clearSpotifyPlusVisualTimers();
		scheduleSpotifyPlusVisualSync();
		spotifyPlusVisualTimers.push(setTimeout(() => {
			if (settings.spotifyPlus.enabled && document.visibilityState !== "hidden") {
				scheduleSpotifyPlusVisualSync();
			}
		}, 220));
	}

	function configureSpotifyPlusVisuals(enabled) {
		clearSpotifyPlusVisualTimers();
		if (typeof spotifyPlusVisualHistoryUnlisten === "function") {
			try { spotifyPlusVisualHistoryUnlisten(); } catch {}
		}
		spotifyPlusVisualHistoryUnlisten = null;

		if (!enabled) {
			clearSpotifyPlusVisuals();
			return;
		}

		scheduleSpotifyPlusVisualBurst();
		if (typeof Spicetify.Platform?.History?.listen === "function") {
			spotifyPlusVisualHistoryUnlisten = Spicetify.Platform.History.listen(() => {
				scheduleSpotifyPlusVisualBurst();
				triggerSpotifyPlusPageEntrance();
				patchMeriotifyUpdateLogo();
			});
		}
	}


	function getSpotifyPlusMotionTarget(node) {
		if (!(node instanceof Element)) return null;

		const cover = node.closest([
			'.main-entityHeader-imageContainer',
			'.main-entityHeader-image',
			'.main-nowPlayingView-coverArt',
			'[data-testid="cover-art-image"]'
		].join(','));
		if (cover) return { element: cover, kind: "cover" };

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
		if (!target.element.classList.contains("meriotify-motion-hover") &&
			!target.element.classList.contains("meriotify-motion-press") &&
			!target.element.classList.contains("meriotify-motion-pop")) {
			target.element.removeAttribute("data-meriotify-motion-kind");
		}
	}

	function spawnSpotifyPlusHoverSweep(target) {
		const element = target?.element;
		if (!(element instanceof Element)) return;
		const rect = element.getBoundingClientRect();
		if (rect.width < 24 || rect.height < 18 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return;
		const sweep = document.createElement("span");
		sweep.className = `meriotify-motion-sweep meriotify-motion-sweep-${target.kind}`;
		const radius = getComputedStyle(element).borderRadius || "14px";
		Object.assign(sweep.style, {
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			borderRadius: radius,
		});
		document.body.appendChild(sweep);
		sweep.addEventListener("animationend", () => sweep.remove(), { once: true });
		setTimeout(() => sweep.remove(), 700);
	}

	function spawnSpotifyPlusPressBurst(event, target) {
		if (!(event instanceof PointerEvent) && !(event instanceof MouseEvent)) return;

		const burst = document.createElement("span");
		burst.className = `meriotify-motion-burst meriotify-motion-burst-${target?.kind || "button"}`;
		burst.style.left = `${event.clientX}px`;
		burst.style.top = `${event.clientY}px`;
		document.body.appendChild(burst);
		burst.addEventListener("animationend", () => burst.remove(), { once: true });
		setTimeout(() => burst.remove(), 950);

		const sparkCount = target?.kind === "card" || target?.kind === "cover" ? 8 : 5;
		for (let i = 0; i < sparkCount; i++) {
			const angle = (Math.PI * 2 * i) / sparkCount + (i % 2 ? 0.18 : -0.08);
			const distance = 22 + (i % 3) * 9;
			const spark = document.createElement("span");
			spark.className = "meriotify-motion-spark";
			spark.style.left = `${event.clientX}px`;
			spark.style.top = `${event.clientY}px`;
			spark.style.setProperty("--mplus-spark-x", `${Math.cos(angle) * distance}px`);
			spark.style.setProperty("--mplus-spark-y", `${Math.sin(angle) * distance}px`);
			spark.style.setProperty("--mplus-spark-delay", `${i * 12}ms`);
			document.body.appendChild(spark);
			setTimeout(() => spark.remove(), 760);
		}
	}

	function popSpotifyPlusMotionTarget(target) {
		if (!target?.element) return;
		const element = target.element;
		element.setAttribute("data-meriotify-motion-kind", target.kind);
		element.classList.remove("meriotify-motion-pop");
		void element.offsetWidth;
		element.classList.add("meriotify-motion-pop");
		setTimeout(() => {
			element.classList.remove("meriotify-motion-pop");
			if (!element.classList.contains("meriotify-motion-hover") && !element.classList.contains("meriotify-motion-press")) {
				element.removeAttribute("data-meriotify-motion-kind");
			}
		}, 460);
	}


	function ensureSpotifyPlusSpotlight() {
		if (spotifyPlusSpotlight?.isConnected) return spotifyPlusSpotlight;
		const layer = document.createElement("div");
		layer.className = "meriotify-motion-spotlight";
		document.body.appendChild(layer);
		spotifyPlusSpotlight = layer;
		return layer;
	}

	function clearSpotifyPlusPointerFx() {
		if (spotifyPlusPointerRaf) cancelAnimationFrame(spotifyPlusPointerRaf);
		spotifyPlusPointerRaf = 0;
		spotifyPlusPointerEvent = null;
		spotifyPlusSpotlight?.remove();
		spotifyPlusSpotlight = null;
		if (spotifyPlusHoverTarget?.element) {
			for (const prop of ["--mplus-rx", "--mplus-ry", "--mplus-mx", "--mplus-my"]) {
				spotifyPlusHoverTarget.element.style.removeProperty(prop);
			}
		}
	}

	function updateSpotifyPlusPointerFx() {
		spotifyPlusPointerRaf = 0;
		const event = spotifyPlusPointerEvent;
		const target = spotifyPlusHoverTarget;
		if (!event || !target?.element?.isConnected) return;

		const element = target.element;
		const rect = element.getBoundingClientRect();
		if (!rect.width || !rect.height) return;

		const px = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		const py = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
		const nx = px * 2 - 1;
		const ny = py * 2 - 1;

		element.style.setProperty("--mplus-rx", `${(-ny * (target.kind === "cover" ? 7 : 4.5)).toFixed(2)}deg`);
		element.style.setProperty("--mplus-ry", `${(nx * (target.kind === "cover" ? 8 : 5.5)).toFixed(2)}deg`);
		element.style.setProperty("--mplus-mx", `${(px * 100).toFixed(1)}%`);
		element.style.setProperty("--mplus-my", `${(py * 100).toFixed(1)}%`);

		const spotlight = ensureSpotifyPlusSpotlight();
		Object.assign(spotlight.style, {
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			borderRadius: getComputedStyle(element).borderRadius || "16px",
		});
		spotlight.style.setProperty("--mplus-mx", `${(px * 100).toFixed(1)}%`);
		spotlight.style.setProperty("--mplus-my", `${(py * 100).toFixed(1)}%`);
		spotlight.dataset.kind = target.kind;
	}

	function onSpotifyPlusPointerMove(event) {
		if (!spotifyPlusWindowVisible || !settings.spotifyPlus.enabled) return;
		if (!spotifyPlusHoverTarget?.element) return;
		if (!["card", "cover", "button"].includes(spotifyPlusHoverTarget.kind)) return;

		const now = performance.now();
		if (now - spotifyPlusPointerLastFrame < 32) return;
		spotifyPlusPointerLastFrame = now;

		spotifyPlusPointerEvent = event;
		if (!spotifyPlusPointerRaf) {
			spotifyPlusPointerRaf = requestAnimationFrame(updateSpotifyPlusPointerFx);
		}
	}

	function resetSpotifyPlusTargetFx(target) {
		if (!target?.element) return;
		for (const prop of ["--mplus-rx", "--mplus-ry", "--mplus-mx", "--mplus-my"]) {
			target.element.style.removeProperty(prop);
		}
		spotifyPlusSpotlight?.remove();
		spotifyPlusSpotlight = null;
	}

	function triggerSpotifyPlusPageEntrance() {
		if (!document.body.classList.contains("meriotify-spotify-plus")) return;
		const pane = document.querySelector(".Root__main-view, .main-view-container");
		if (!(pane instanceof HTMLElement)) return;
		pane.classList.remove("meriotify-plus-page-enter");
		void pane.offsetWidth;
		pane.classList.add("meriotify-plus-page-enter");
		if (spotifyPlusPageTimer) clearTimeout(spotifyPlusPageTimer);
		spotifyPlusPageTimer = setTimeout(() => {
			pane.classList.remove("meriotify-plus-page-enter");
			spotifyPlusPageTimer = 0;
		}, 760);
	}

	function onSpotifyPlusPointerOver(event) {
		if (!spotifyPlusWindowVisible || !settings.spotifyPlus.enabled) return;
		const next = getSpotifyPlusMotionTarget(event.target);
		if (!next) return;
		if (spotifyPlusHoverTarget?.element === next.element) return;
		resetSpotifyPlusTargetFx(spotifyPlusHoverTarget);
		clearSpotifyPlusMotionTarget(spotifyPlusHoverTarget, "meriotify-motion-hover");
		spotifyPlusHoverTarget = next;
		next.element.setAttribute("data-meriotify-motion-kind", next.kind);
		next.element.classList.add("meriotify-motion-hover");
		spawnSpotifyPlusHoverSweep(next);
	}

	function onSpotifyPlusPointerOut(event) {
		if (!spotifyPlusWindowVisible || !settings.spotifyPlus.enabled) return;
		if (!spotifyPlusHoverTarget?.element) return;
		if (event.relatedTarget instanceof Node && spotifyPlusHoverTarget.element.contains(event.relatedTarget)) return;
		resetSpotifyPlusTargetFx(spotifyPlusHoverTarget);
		clearSpotifyPlusMotionTarget(spotifyPlusHoverTarget, "meriotify-motion-hover");
		spotifyPlusHoverTarget = null;
	}

	function onSpotifyPlusPointerDown(event) {
		if (!spotifyPlusWindowVisible || !settings.spotifyPlus.enabled) return;
		const next = getSpotifyPlusMotionTarget(event.target);
		if (!next) return;
		clearSpotifyPlusMotionTarget(spotifyPlusPressTarget, "meriotify-motion-press");
		spotifyPlusPressTarget = next;
		next.element.setAttribute("data-meriotify-motion-kind", next.kind);
		next.element.classList.add("meriotify-motion-press");
		spawnSpotifyPlusPressBurst(event, next);
	}

	function clearSpotifyPlusPress() {
		clearSpotifyPlusMotionTarget(spotifyPlusPressTarget, "meriotify-motion-press");
		spotifyPlusPressTarget = null;
	}

	function onSpotifyPlusPointerUp() {
		if (!spotifyPlusWindowVisible || !settings.spotifyPlus.enabled) return;
		const released = spotifyPlusPressTarget;
		clearSpotifyPlusPress();
		popSpotifyPlusMotionTarget(released);
	}

	function onSpotifyPlusVisibilityChange() {
		spotifyPlusWindowVisible = document.visibilityState !== "hidden";
		if (!spotifyPlusWindowVisible) {
			clearSpotifyPlusPointerFx();
			document.querySelectorAll(
				".meriotify-motion-sweep, .meriotify-motion-burst, .meriotify-motion-spark, .meriotify-motion-spotlight"
			).forEach((node) => node.remove());
		}
	}

	function configureSpotifyPlusMotion(enabled) {
		if (enabled && !spotifyPlusMotionBound) {
			document.addEventListener("visibilitychange", onSpotifyPlusVisibilityChange);
			document.addEventListener("pointerover", onSpotifyPlusPointerOver, true);
			document.addEventListener("pointerout", onSpotifyPlusPointerOut, true);
			document.addEventListener("pointermove", onSpotifyPlusPointerMove, true);
			document.addEventListener("pointerdown", onSpotifyPlusPointerDown, true);
			document.addEventListener("pointerup", onSpotifyPlusPointerUp, true);
			document.addEventListener("pointercancel", clearSpotifyPlusPress, true);
			spotifyPlusMotionBound = true;
			return;
		}
		if (!enabled && spotifyPlusMotionBound) {
			document.removeEventListener("visibilitychange", onSpotifyPlusVisibilityChange);
			document.removeEventListener("pointerover", onSpotifyPlusPointerOver, true);
			document.removeEventListener("pointerout", onSpotifyPlusPointerOut, true);
			document.removeEventListener("pointermove", onSpotifyPlusPointerMove, true);
			document.removeEventListener("pointerdown", onSpotifyPlusPointerDown, true);
			document.removeEventListener("pointerup", onSpotifyPlusPointerUp, true);
			document.removeEventListener("pointercancel", clearSpotifyPlusPress, true);
			clearSpotifyPlusMotionTarget(spotifyPlusHoverTarget, "meriotify-motion-hover");
			clearSpotifyPlusMotionTarget(spotifyPlusPressTarget, "meriotify-motion-press");
			spotifyPlusHoverTarget = null;
			spotifyPlusPressTarget = null;
			clearSpotifyPlusPointerFx();
			document.querySelectorAll(".meriotify-motion-sweep, .meriotify-motion-burst, .meriotify-motion-spark, .meriotify-motion-spotlight").forEach((node) => node.remove());
			document.querySelectorAll(".meriotify-motion-pop").forEach((node) => node.classList.remove("meriotify-motion-pop"));
			spotifyPlusMotionBound = false;
		}
	}

	function getEffectiveAdaptiveTheme() {
		const spotifyLinked = Boolean(settings.spotifyPlus.enabled);
		return {
			enabled: Boolean(settings.adaptiveTheme.enabled || spotifyLinked),
			intensity: spotifyLinked ? 88 : Number(settings.adaptiveTheme.intensity || 65),
		};
	}

	async function applyAdaptiveTheme() {
		const generation = ++adaptiveGeneration;
		const effectiveTheme = getEffectiveAdaptiveTheme();
		if (!effectiveTheme.enabled) {
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

		if (generation !== adaptiveGeneration || !getEffectiveAdaptiveTheme().enabled) return;
		if (!colors.length) {
			clearAdaptiveTheme();
			return;
		}

		const intensity = clamp(Number(effectiveTheme.intensity || 65) / 100, 0.2, 1);
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

/* Spotify+ 3.0 — reference-driven dark graphite UI.
   Selector strategy is adapted from maintained Spicetify themes (Sleek / SharkBlue / Flow),
   while the visual design is Meriotify-specific. */
body.meriotify-spotify-plus {
	--mplus-accent: var(--meriotify-accent, #1ed760);
	--mplus-accent-rgb: var(--meriotify-primary-rgb, 30, 215, 96);
	--mplus-bg: #050708;
	--mplus-panel: #090d10;
	--mplus-panel-2: #0d1216;
	--mplus-panel-3: #11171b;
	--mplus-hover: #151c21;
	--mplus-line: rgba(255,255,255,.065);
	--mplus-line-strong: rgba(255,255,255,.115);
	--mplus-text: #f5f7f7;
	--mplus-subtext: #9aa4aa;
	--mplus-radius-shell: 18px;
	--mplus-radius-card: 12px;
	--mplus-shadow: 0 22px 58px rgba(0,0,0,.34);
	--mplus-shadow-soft: 0 12px 30px rgba(0,0,0,.22);
	--mplus-ease: cubic-bezier(.16,1,.3,1);

	/* Feed Spicetify-native controls the same palette so fewer brittle selectors are needed. */
	--spice-main: #050708;
	--spice-sidebar: #090d10;
	--spice-player: #090d10;
	--spice-card: #0d1216;
	--spice-text: #f5f7f7;
	--spice-subtext: #9aa4aa;
	--spice-button: var(--mplus-accent);
	--spice-button-active: var(--mplus-accent);
	--spice-button-disabled: #495159;
	--spice-main-secondary: #11171b;
	--spice-selected-row: #f5f7f7;
	--spice-shadow: #000000;
	--spice-rgb-main: 5,7,8;
	--spice-rgb-sidebar: 9,13,16;
	--spice-rgb-player: 9,13,16;
	--spice-rgb-main-secondary: 17,23,27;
	--spice-rgb-shadow: 0,0,0;
	--spice-rgb-selected-row: 245,247,247;

	background: var(--mplus-bg) !important;
	color-scheme: dark;
}
body.meriotify-spotify-plus *,
body.meriotify-spotify-plus *::before,
body.meriotify-spotify-plus *::after { box-sizing: border-box; }

/* App shell — one quiet canvas, four deliberate surfaces. */
body.meriotify-spotify-plus #main,
body.meriotify-spotify-plus .Root,
body.meriotify-spotify-plus .Root__top-container,
body.meriotify-spotify-plus .main-view-container,
body.meriotify-spotify-plus .main-view-container__scroll-node,
body.meriotify-spotify-plus .main-view-container__scroll-node-child,
body.meriotify-spotify-plus .main-view-container__scroll-node > [data-overlayscrollbars-viewport] {
	background: var(--mplus-bg) !important;
}
body.meriotify-spotify-plus .Root__top-container {
	gap: 10px !important;
	padding: 10px 10px 0 !important;
}
body.meriotify-spotify-plus .Root__main-view {
	border: 1px solid var(--mplus-line) !important;
	border-radius: var(--mplus-radius-shell) !important;
	background: linear-gradient(180deg, #080c0f 0%, #06090b 100%) !important;
	box-shadow: var(--mplus-shadow) !important;
	overflow: clip !important;
}
body.meriotify-spotify-plus .main-view-container__scroll-node,
body.meriotify-spotify-plus .main-view-container__scroll-node-child { border-radius: inherit !important; }

/* Top bar — visually belongs to the centre pane, not another giant card. */
body.meriotify-spotify-plus .Root__globalNav {
	min-height: 58px !important;
	padding: 6px 10px !important;
	margin: 0 0 4px !important;
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .main-topBar-background,
body.meriotify-spotify-plus .main-topBar-overlay,
body.meriotify-spotify-plus .main-topBar-container,
body.meriotify-spotify-plus .main-topBar-topbarContent,
body.meriotify-spotify-plus .main-topBar-topbarContentRight,
body.meriotify-spotify-plus [data-testid="topbar-content-right"] {
	background: transparent !important;
	background-image: none !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .main-globalNav-searchInputWrapper,
body.meriotify-spotify-plus .x-searchInput-searchInput,
body.meriotify-spotify-plus [data-testid="search-container"] {
	border: 1px solid rgba(255,255,255,.055) !important;
	border-radius: 999px !important;
	background: #1a2025 !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 8px 18px rgba(0,0,0,.14) !important;
	transition: border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease !important;
}
body.meriotify-spotify-plus .main-globalNav-searchInputWrapper:focus-within,
body.meriotify-spotify-plus .x-searchInput-searchInput:focus-within,
body.meriotify-spotify-plus [data-testid="search-container"]:focus-within {
	background: #20272d !important;
	border-color: rgba(var(--mplus-accent-rgb), .38) !important;
	box-shadow: 0 0 0 3px rgba(var(--mplus-accent-rgb), .09) !important;
}
body.meriotify-spotify-plus .x-searchInput-searchInputSearchIcon svg,
body.meriotify-spotify-plus .x-searchInput-searchInputClearButton svg { color: var(--mplus-text) !important; }
body.meriotify-spotify-plus .Root__globalNav button,
body.meriotify-spotify-plus .main-topBar-historyButtons .main-topBar-button {
	border-radius: 999px !important;
	background-color: transparent !important;
	border: 1px solid transparent !important;
}
body.meriotify-spotify-plus .Root__globalNav button:hover,
body.meriotify-spotify-plus .main-topBar-historyButtons .main-topBar-button:hover {
	background-color: rgba(255,255,255,.055) !important;
	border-color: rgba(255,255,255,.04) !important;
}
body.meriotify-spotify-plus .main-topBar-UpgradeButton { display: none !important; }

/* Left navigation — single slab with real hierarchy and brand, no card-inside-card look. */
body.meriotify-spotify-plus .Root__nav-bar {
	position: relative !important;
	padding-top: 58px !important;
	border: 1px solid var(--mplus-line) !important;
	border-radius: var(--mplus-radius-shell) !important;
	background: linear-gradient(180deg, #090d10 0%, #070a0c 100%) !important;
	box-shadow: var(--mplus-shadow-soft) !important;
	overflow: clip !important;
}
body.meriotify-spotify-plus .Root__nav-bar::before {
	content: "Spotify";
	position: absolute;
	top: 17px;
	left: 20px;
	z-index: 20;
	font: 800 23px/1.2 var(--encore-body-font-stack, CircularSp, sans-serif);
	letter-spacing: -.035em;
	color: var(--mplus-text);
	pointer-events: none;
}
body.meriotify-spotify-plus .Root__nav-bar::after {
	content: "+";
	position: absolute;
	top: 15px;
	left: 91px;
	z-index: 20;
	font: 800 26px/1.2 var(--encore-body-font-stack, CircularSp, sans-serif);
	color: var(--mplus-accent);
	text-shadow: 0 0 18px rgba(var(--mplus-accent-rgb),.28);
	pointer-events: none;
}
body.meriotify-spotify-plus .main-yourLibraryX-libraryContainer,
body.meriotify-spotify-plus .main-yourLibraryX-library,
body.meriotify-spotify-plus .main-yourLibraryX-entryPoints,
body.meriotify-spotify-plus .main-navBar-navBar {
	background: transparent !important;
	background-image: none !important;
	border: 0 !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .main-rootlist-rootlistDividerGradient { display: none !important; }
body.meriotify-spotify-plus .main-rootlist-rootlistDivider {
	background: rgba(255,255,255,.065) !important;
}
body.meriotify-spotify-plus .main-yourLibraryX-listItem,
body.meriotify-spotify-plus .main-yourLibraryX-navItem,
body.meriotify-spotify-plus .main-yourLibraryX-navLink,
body.meriotify-spotify-plus .main-navBar-navBarLink,
body.meriotify-spotify-plus .main-rootlist-rootlistItem,
body.meriotify-spotify-plus .Root__nav-bar [role="listitem"],
body.meriotify-spotify-plus .Root__nav-bar [role="treeitem"] {
	border-radius: 10px !important;
	border: 1px solid transparent !important;
	transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease !important;
}
body.meriotify-spotify-plus .main-yourLibraryX-listItem:hover,
body.meriotify-spotify-plus .main-yourLibraryX-navItem:hover,
body.meriotify-spotify-plus .main-yourLibraryX-navLink:hover,
body.meriotify-spotify-plus .main-navBar-navBarLink:hover,
body.meriotify-spotify-plus .main-rootlist-rootlistItem:hover,
body.meriotify-spotify-plus .Root__nav-bar [role="listitem"]:hover,
body.meriotify-spotify-plus .Root__nav-bar [role="treeitem"]:hover {
	background: rgba(255,255,255,.048) !important;
	border-color: rgba(255,255,255,.035) !important;
}
body.meriotify-spotify-plus .main-navBar-navBarLinkActive,
body.meriotify-spotify-plus .main-yourLibraryX-navLinkActive,
body.meriotify-spotify-plus .main-yourLibraryX-listItem[aria-selected="true"],
body.meriotify-spotify-plus .main-yourLibraryX-navItem[aria-current="page"],
body.meriotify-spotify-plus .Root__nav-bar [aria-current="page"] {
	color: var(--mplus-text) !important;
	background: linear-gradient(90deg, rgba(var(--mplus-accent-rgb),.19), rgba(var(--mplus-accent-rgb),.055)) !important;
	border-color: rgba(var(--mplus-accent-rgb),.14) !important;
	box-shadow: inset 3px 0 0 var(--mplus-accent) !important;
}
body.meriotify-spotify-plus .main-navBar-navBarLinkActive svg,
body.meriotify-spotify-plus .main-yourLibraryX-navLinkActive svg,
body.meriotify-spotify-plus .Root__nav-bar [aria-current="page"] svg { color: var(--mplus-accent) !important; }

/* Content rhythm. */
body.meriotify-spotify-plus .contentSpacing { padding-inline: clamp(18px, 2.25vw, 32px) !important; }
body.meriotify-spotify-plus .main-home-homeHeader,
body.meriotify-spotify-plus .main-actionBarBackground-background,
body.meriotify-spotify-plus .main-entityHeader-backgroundColor,
body.meriotify-spotify-plus .main-entityHeader-overlay,
body.meriotify-spotify-plus .x-entityHeader-overlay,
body.meriotify-spotify-plus .x-actionBarBackground-background {
	background: transparent !important;
	background-image: none !important;
}
body.meriotify-spotify-plus .main-home-content h2,
body.meriotify-spotify-plus .main-shelf-header h2,
body.meriotify-spotify-plus [class*="shelf"] h2 {
	font-family: Georgia, "Times New Roman", serif !important;
	font-size: clamp(24px, 2vw, 30px) !important;
	font-weight: 700 !important;
	letter-spacing: -.025em !important;
}

/* Real hero: use the entity artwork as a background instead of stretching the stock cover block. */
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero {
	position: relative !important;
	isolation: isolate !important;
	min-height: clamp(280px, 31vw, 390px) !important;
	margin: 10px 14px 18px !important;
	padding: clamp(26px, 3vw, 42px) !important;
	border: 1px solid var(--mplus-line) !important;
	border-radius: 16px !important;
	background-image:
		linear-gradient(90deg, rgba(4,7,8,.97) 0%, rgba(4,7,8,.91) 26%, rgba(4,7,8,.62) 51%, rgba(4,7,8,.18) 76%, rgba(4,7,8,.08) 100%),
		linear-gradient(0deg, rgba(4,7,8,.52), transparent 58%),
		var(--meriotify-hero-url) !important;
	background-position: center !important;
	background-size: cover !important;
	background-repeat: no-repeat !important;
	box-shadow: 0 18px 46px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.025) !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::before {
	content: "";
	position: absolute;
	inset: 0;
	z-index: -1;
	background: radial-gradient(90% 100% at 72% 45%, transparent 10%, rgba(0,0,0,.14) 72%);
	pointer-events: none;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero .main-entityHeader-imageContainer,
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero .main-entityHeader-shadow {
	display: none !important;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero .main-entityHeader-headerText,
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero [class*="entityHeader-headerText"] {
	position: relative !important;
	z-index: 2 !important;
	max-width: min(62%, 720px) !important;
	align-self: flex-end !important;
	margin: 0 !important;
	text-shadow: 0 3px 22px rgba(0,0,0,.52) !important;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero h1 {
	font-family: Georgia, "Times New Roman", serif !important;
	font-size: clamp(44px, 5.5vw, 82px) !important;
	font-weight: 700 !important;
	letter-spacing: -.045em !important;
	line-height: .95 !important;
	color: #fff !important;
}
body.meriotify-spotify-plus .main-entityHeader-subtitle.main-entityHeader-small.main-entityHeader-uppercase.main-entityHeader-bold {
	display: inline-flex !important;
	width: fit-content !important;
	padding: 5px 10px !important;
	border: 1px solid rgba(var(--mplus-accent-rgb),.32) !important;
	border-radius: 999px !important;
	background: rgba(var(--mplus-accent-rgb),.12) !important;
	color: var(--mplus-accent) !important;
	font-size: 11px !important;
	letter-spacing: .08em !important;
}

/* Quick access tiles — dense, horizontal and useful. */
body.meriotify-spotify-plus .view-homeShortcutsGrid-shortcut,
body.meriotify-spotify-plus [data-testid*="shortcut"],
body.meriotify-spotify-plus [class*="home"] [class*="shortcut"] {
	border: 1px solid rgba(255,255,255,.045) !important;
	border-radius: 10px !important;
	background: #10161a !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.018) !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .view-homeShortcutsGrid-shortcut:hover,
body.meriotify-spotify-plus [data-testid*="shortcut"]:hover,
body.meriotify-spotify-plus [class*="home"] [class*="shortcut"]:hover {
	background: #161d22 !important;
	border-color: rgba(255,255,255,.075) !important;
}

/* Cards — image-first, restrained chrome, no glowing sci-fi boxes. */
body.meriotify-spotify-plus .main-card-card,
body.meriotify-spotify-plus .main-card-cardContainer,
body.meriotify-spotify-plus [data-testid="card-container"],
body.meriotify-spotify-plus [data-encore-id="card"] {
	border: 1px solid rgba(255,255,255,.05) !important;
	border-radius: var(--mplus-radius-card) !important;
	background: #0d1216 !important;
	box-shadow: 0 9px 22px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.018) !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .main-card-card:hover,
body.meriotify-spotify-plus .main-card-cardContainer:hover,
body.meriotify-spotify-plus [data-testid="card-container"]:hover,
body.meriotify-spotify-plus [data-encore-id="card"]:hover {
	background: #141a1f !important;
	border-color: rgba(255,255,255,.085) !important;
}
body.meriotify-spotify-plus .main-cardImage-imageWrapper,
body.meriotify-spotify-plus .main-cardImage-image,
body.meriotify-spotify-plus .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus [data-testid="cover-art-image"] {
	border-radius: 9px !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .main-cardSubHeader-root { overflow: hidden !important; }
body.meriotify-spotify-plus [data-testid="artist-card"] img,
body.meriotify-spotify-plus a[href^="/artist/"] .main-cardImage-imageWrapper,
body.meriotify-spotify-plus a[href^="/artist/"] img { border-radius: 50% !important; }

/* Track list — compact, clean and readable. */
body.meriotify-spotify-plus .main-trackList-trackListHeaderStuck.main-trackList-trackListHeader {
	background: rgba(5,7,8,.94) !important;
	border-bottom: 1px solid rgba(255,255,255,.045) !important;
	box-shadow: 0 18px 26px rgba(5,7,8,.82) !important;
}
body.meriotify-spotify-plus .main-trackList-trackListRow,
body.meriotify-spotify-plus [role="row"][aria-rowindex] {
	border: 1px solid transparent !important;
	border-radius: 9px !important;
	transition: background-color 150ms ease, border-color 150ms ease !important;
}
body.meriotify-spotify-plus .main-trackList-trackListRow:hover,
body.meriotify-spotify-plus [role="row"][aria-rowindex]:hover {
	background: rgba(255,255,255,.042) !important;
	border-color: rgba(255,255,255,.03) !important;
}
body.meriotify-spotify-plus .main-trackList-trackListRow.main-trackList-selected,
body.meriotify-spotify-plus .main-trackList-trackListRow[aria-selected="true"],
body.meriotify-spotify-plus [role="row"][aria-rowindex][aria-selected="true"] {
	background: rgba(255,255,255,.065) !important;
	border-color: rgba(255,255,255,.055) !important;
}
body.meriotify-spotify-plus .main-trackList-active .main-trackList-rowTitle,
body.meriotify-spotify-plus .main-trackList-active .main-trackList-rowSubTitle,
body.meriotify-spotify-plus .main-trackList-active .main-trackList-rowDuration,
body.meriotify-spotify-plus .main-trackList-playingIcon {
	color: var(--mplus-accent) !important;
}
body.meriotify-spotify-plus .main-trackList-rowImage { border-radius: 5px !important; }

/* Tabs / chips / filter controls. */
body.meriotify-spotify-plus [data-encore-id="chip"],
body.meriotify-spotify-plus [role="tab"],
body.meriotify-spotify-plus .main-home-filterChipsSection button,
body.meriotify-spotify-plus .main-yourLibraryX-filterArea button,
body.meriotify-spotify-plus .x-sortBox-sortDropdown,
body.meriotify-spotify-plus .x-filterBox-expandButton {
	border: 1px solid rgba(255,255,255,.055) !important;
	border-radius: 999px !important;
	background: #11171b !important;
	color: var(--mplus-text) !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus [role="tab"][aria-selected="true"],
body.meriotify-spotify-plus [data-encore-id="chip"][aria-checked="true"] {
	background: var(--mplus-text) !important;
	color: #050708 !important;
	border-color: var(--mplus-text) !important;
}

/* Right Now Playing — quiet card stack with a subtle artwork wash behind it. */
body.meriotify-spotify-plus .Root__right-sidebar {
	position: relative !important;
	isolation: isolate !important;
	min-width: 0 !important;
	border: 1px solid var(--mplus-line) !important;
	border-radius: var(--mplus-radius-shell) !important;
	background: linear-gradient(180deg, #090d10, #070a0c) !important;
	box-shadow: var(--mplus-shadow-soft) !important;
	overflow: clip !important;
}
body.meriotify-spotify-plus .Root__right-sidebar::before {
	content: "";
	position: absolute;
	z-index: -1;
	inset: -80px -90px auto;
	height: 340px;
	background-image: linear-gradient(180deg, rgba(7,10,12,.18), #090d10 88%), var(--meriotify-nowplaying-url, none);
	background-size: cover;
	background-position: center;
	filter: blur(34px) saturate(.92);
	opacity: .18;
	transform: scale(1.12);
	pointer-events: none;
}
body.meriotify-spotify-plus .Root__right-sidebar [class*="nowPlayingView-"],
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="now-playing-view"],
body.meriotify-spotify-plus .Root__right-sidebar [data-testid="now-playing-view"] > div {
	background: transparent !important;
	background-image: none !important;
	box-shadow: none !important;
	min-width: 0 !important;
	max-width: 100% !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-section {
	margin: 8px !important;
	padding: 12px !important;
	border: 1px solid rgba(255,255,255,.05) !important;
	border-radius: 12px !important;
	background: rgba(13,18,22,.88) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.018) !important;
}
body.meriotify-spotify-plus .main-nowPlayingView-coverArtContainer,
body.meriotify-spotify-plus .main-nowPlayingView-coverArt,
body.meriotify-spotify-plus .main-nowPlayingView-coverArt img {
	max-width: 100% !important;
	border-radius: 12px !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .main-nowPlayingView-contextItemInfo,
body.meriotify-spotify-plus .main-nowPlayingView-headerTextWrapper,
body.meriotify-spotify-plus .main-nowPlayingView-headerTextWrapper *,
body.meriotify-spotify-plus .main-nowPlayingView-aboutArtistV2TextContent,
body.meriotify-spotify-plus .main-nowPlayingView-lyricsContent {
	min-width: 0 !important;
	max-width: 100% !important;
	width: auto !important;
	transform: none !important;
}
body.meriotify-spotify-plus .main-nowPlayingView-contextItemInfo a,
body.meriotify-spotify-plus .main-nowPlayingView-contextItemInfo span {
	max-width: 100% !important;
	white-space: normal !important;
	overflow: visible !important;
	text-overflow: clip !important;
}
body.meriotify-spotify-plus .Root__right-sidebar .main-nowPlayingView-section:has(.x-music-video),
body.meriotify-spotify-plus .Root__right-sidebar .x-music-video { display: none !important; }

/* Bottom player — one continuous bar, native controls preserved, subtle three-zone separation. */
body.meriotify-spotify-plus .Root__now-playing-bar {
	margin: 0 10px 10px !important;
	padding: 0 !important;
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
	overflow: visible !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-container,
body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	min-height: 78px !important;
	border: 1px solid var(--mplus-line) !important;
	border-radius: 18px !important;
	background: linear-gradient(180deg, #0c1114, #080c0f) !important;
	box-shadow: 0 18px 42px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.025) !important;
	backdrop-filter: none !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	padding: 8px 14px !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-left,
body.meriotify-spotify-plus .main-nowPlayingBar-center,
body.meriotify-spotify-plus .main-nowPlayingBar-right,
body.meriotify-spotify-plus [class*="nowPlayingBar-left"],
body.meriotify-spotify-plus [class*="nowPlayingBar-center"],
body.meriotify-spotify-plus [class*="nowPlayingBar-right"] {
	position: relative !important;
	min-width: 0 !important;
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-left { padding-right: 18px !important; }
body.meriotify-spotify-plus .main-nowPlayingBar-center { padding-inline: 18px !important; }
body.meriotify-spotify-plus .main-nowPlayingBar-right { padding-left: 18px !important; justify-content: flex-end !important; }
body.meriotify-spotify-plus .main-nowPlayingBar-left::after,
body.meriotify-spotify-plus .main-nowPlayingBar-center::after {
	content: "";
	position: absolute;
	top: 15%;
	bottom: 15%;
	right: 0;
	width: 1px;
	background: linear-gradient(180deg, transparent, rgba(255,255,255,.075), transparent);
	pointer-events: none;
}
body.meriotify-spotify-plus .main-coverSlotCollapsed-container .cover-art-image,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArtContainer,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArt,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArt img {
	border-radius: 8px !important;
}
body.meriotify-spotify-plus .main-nowPlayingWidget-trackInfo a,
body.meriotify-spotify-plus .main-nowPlayingWidget-trackInfo span {
	max-width: 100% !important;
	overflow: hidden !important;
	text-overflow: ellipsis !important;
	white-space: nowrap !important;
}
body.meriotify-spotify-plus .main-playPauseButton-button {
	background: #f5f7f7 !important;
	color: #050708 !important;
	border-radius: 50% !important;
	box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 7px 20px rgba(0,0,0,.30) !important;
}
body.meriotify-spotify-plus .main-playPauseButton-button svg { width: 22px !important; height: 22px !important; }
body.meriotify-spotify-plus .playback-bar .x-progressBar-fillColor,
body.meriotify-spotify-plus .progress-bar__fg,
body.meriotify-spotify-plus .volume-bar .progress-bar__fg {
	background-color: var(--mplus-accent) !important;
}
body.meriotify-spotify-plus .progress-bar__bg,
body.meriotify-spotify-plus .x-progressBar-progressBarBg {
	background-color: rgba(255,255,255,.12) !important;
	border-radius: 999px !important;
}
body.meriotify-spotify-plus .progress-bar__fg,
body.meriotify-spotify-plus .progress-bar__bg,
body.meriotify-spotify-plus .progress-bar__fg_wrapper { border-radius: 999px !important; }
body.meriotify-spotify-plus .playback-bar .x-progressBar-fillColor,
body.meriotify-spotify-plus .playback-bar .progress-bar__slider {
	transition: none !important;
}
body.meriotify-spotify-plus .progress-bar--isDragging .x-progressBar-fillColor,
body.meriotify-spotify-plus .progress-bar--isDragging .progress-bar__slider {
	transition: none !important;
}

/* Context menus, dropdowns and modals share the same material. */
body.meriotify-spotify-plus .main-contextMenu-menu,
body.meriotify-spotify-plus .main-userWidget-dropDownMenu,
body.meriotify-spotify-plus [role="menu"],
body.meriotify-spotify-plus [data-encore-id="popover"] {
	border: 1px solid var(--mplus-line-strong) !important;
	border-radius: 12px !important;
	background: #101519 !important;
	box-shadow: 0 20px 50px rgba(0,0,0,.42) !important;
}
body.meriotify-spotify-plus .main-contextMenu-menuItemButton:not(.main-contextMenu-disabled):hover,
body.meriotify-spotify-plus .main-contextMenu-menuItemButton[aria-expanded="true"] {
	background: rgba(255,255,255,.055) !important;
}
body.meriotify-spotify-plus .main-contextMenu-menuItem:not(:first-child) > .main-contextMenu-dividerBefore:before {
	border-bottom-color: rgba(255,255,255,.07) !important;
}

/* Scrollbars: thin and quiet; brighten on interaction. */
body.meriotify-spotify-plus ::-webkit-scrollbar { width: 8px; height: 8px; }
body.meriotify-spotify-plus ::-webkit-scrollbar-track { background: transparent; }
body.meriotify-spotify-plus ::-webkit-scrollbar-thumb {
	background: rgba(255,255,255,.13);
	border: 2px solid transparent;
	background-clip: padding-box;
	border-radius: 999px;
}
body.meriotify-spotify-plus ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.24); background-clip: padding-box; }
body.meriotify-spotify-plus .os-theme-spotify.os-host-transition > .os-scrollbar-vertical > .os-scrollbar-track > .os-scrollbar-handle {
	width: 5px !important;
	border-radius: 999px !important;
	background-color: rgba(255,255,255,.16) !important;
}
body.meriotify-spotify-plus .os-theme-spotify.os-host-transition > .os-scrollbar-vertical > .os-scrollbar-track { width: 5px !important; }

/* Keep backgrounds continuous when the optional user background module is enabled. */
body.meriotify-custom-background.meriotify-spotify-plus #main,
body.meriotify-custom-background.meriotify-spotify-plus .Root,
body.meriotify-custom-background.meriotify-spotify-plus .Root__top-container,
body.meriotify-custom-background.meriotify-spotify-plus .main-view-container,
body.meriotify-custom-background.meriotify-spotify-plus .main-view-container__scroll-node,
body.meriotify-custom-background.meriotify-spotify-plus .main-view-container__scroll-node-child,
body.meriotify-custom-background.meriotify-spotify-plus .main-topBar-background {
	background-color: transparent !important;
	background-image: none !important;
}
body.meriotify-custom-background.meriotify-spotify-plus .Root__main-view,
body.meriotify-custom-background.meriotify-spotify-plus .Root__nav-bar,
body.meriotify-custom-background.meriotify-spotify-plus .Root__right-sidebar,
body.meriotify-custom-background.meriotify-spotify-plus .main-nowPlayingBar-container,
body.meriotify-custom-background.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	background-color: rgba(6,9,11,.82) !important;
}

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
		transform 300ms cubic-bezier(.16,1,.3,1),
		background-color 220ms ease,
		border-color 220ms ease,
		box-shadow 300ms cubic-bezier(.16,1,.3,1),
		filter 240ms ease,
		opacity 200ms ease !important;
	transform-origin: center center;
	backface-visibility: hidden;
}

/* Cards: clearly lift, brighten and pull the artwork toward you. */
body.meriotify-spotify-plus-motion .main-card-card:hover,
body.meriotify-spotify-plus-motion .main-card-cardContainer:hover,
body.meriotify-spotify-plus-motion [data-testid="card-container"]:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="card"] {
	transform: translate3d(0,-9px,0) scale(1.026) !important;
	filter: brightness(1.085) saturate(1.06) !important;
	box-shadow: 0 26px 58px rgba(0,0,0,.36), 0 0 0 1px rgba(255,255,255,.08) !important;
	z-index: 4 !important;
}
body.meriotify-spotify-plus-motion .main-card-card:hover .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus-motion .main-card-cardContainer:hover .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus-motion [data-testid="card-container"]:hover .main-cardImage-imageWrapper img,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="card"] img {
	transform: scale(1.075) !important;
	filter: contrast(1.03) saturate(1.06) !important;
	transition: transform 380ms cubic-bezier(.16,1,.3,1), filter 260ms ease !important;
}

/* Rows and navigation get a visible directional glide instead of a tiny nudge. */
body.meriotify-spotify-plus-motion .main-trackList-trackListRow:hover,
body.meriotify-spotify-plus-motion [role="row"]:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="row"] {
	transform: translate3d(8px,0,0) scale(1.004) !important;
	filter: brightness(1.075) !important;
	box-shadow: -5px 0 18px rgba(255,255,255,.025), 0 8px 22px rgba(0,0,0,.16) !important;
}
body.meriotify-spotify-plus-motion .main-yourLibraryX-listItem:hover,
body.meriotify-spotify-plus-motion .main-yourLibraryX-navItem:hover,
body.meriotify-spotify-plus-motion .main-navBar-navBarLink:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="nav"] {
	transform: translate3d(8px,0,0) scale(1.018) !important;
	filter: brightness(1.10) !important;
}

/* Buttons have a much stronger magnetic hover and tactile press. */
body.meriotify-spotify-plus-motion button:hover,
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="button"] {
	transform: translate3d(0,-3px,0) scale(1.075) !important;
	filter: brightness(1.16) saturate(1.08) !important;
	box-shadow: 0 11px 24px rgba(0,0,0,.22), 0 0 0 1px rgba(255,255,255,.055) !important;
}
body.meriotify-spotify-plus-motion .meriotify-motion-press[data-meriotify-motion-kind="button"],
body.meriotify-spotify-plus-motion button:active {
	transform: translate3d(0,1px,0) scale(.90) !important;
	filter: brightness(.94) !important;
	transition-duration: 72ms !important;
}
body.meriotify-spotify-plus-motion .meriotify-motion-press[data-meriotify-motion-kind="card"] {
	transform: translate3d(0,-2px,0) scale(.975) !important;
	transition-duration: 86ms !important;
}
body.meriotify-spotify-plus-motion .meriotify-motion-press[data-meriotify-motion-kind="row"] {
	transform: translate3d(3px,0,0) scale(.985) !important;
	transition-duration: 76ms !important;
}
body.meriotify-spotify-plus-motion .meriotify-motion-press[data-meriotify-motion-kind="nav"] {
	transform: translate3d(3px,0,0) scale(.955) !important;
	transition-duration: 76ms !important;
}

/* Release overshoot: the control springs past rest and settles. */
body.meriotify-spotify-plus-motion .meriotify-motion-pop[data-meriotify-motion-kind="button"] { animation: meriotify-motion-pop-button 430ms cubic-bezier(.16,1,.3,1) both !important; }
body.meriotify-spotify-plus-motion .meriotify-motion-pop[data-meriotify-motion-kind="card"] { animation: meriotify-motion-pop-card 440ms cubic-bezier(.16,1,.3,1) both !important; }
body.meriotify-spotify-plus-motion .meriotify-motion-pop[data-meriotify-motion-kind="row"],
body.meriotify-spotify-plus-motion .meriotify-motion-pop[data-meriotify-motion-kind="nav"] { animation: meriotify-motion-pop-row 400ms cubic-bezier(.16,1,.3,1) both !important; }
@keyframes meriotify-motion-pop-button {
	0% { transform: scale(.90); }
	45% { transform: translate3d(0,-4px,0) scale(1.105); }
	72% { transform: translate3d(0,-2px,0) scale(1.045); }
	100% { transform: translate3d(0,-3px,0) scale(1.075); }
}
@keyframes meriotify-motion-pop-card {
	0% { transform: translate3d(0,-2px,0) scale(.975); }
	48% { transform: translate3d(0,-11px,0) scale(1.038); }
	100% { transform: translate3d(0,-9px,0) scale(1.026); }
}
@keyframes meriotify-motion-pop-row {
	0% { transform: translate3d(2px,0,0) scale(.98); }
	48% { transform: translate3d(10px,0,0) scale(1.012); }
	100% { transform: translate3d(8px,0,0) scale(1.004); }
}

/* One-shot hover sheen: fixed overlay, so it cannot disturb Spotify layout. */
.meriotify-motion-sweep {
	position: fixed;
	z-index: 2147483000;
	pointer-events: none;
	overflow: hidden;
	isolation: isolate;
	animation: meriotify-motion-sweep-shell 520ms ease-out both;
}
.meriotify-motion-sweep::before {
	content: "";
	position: absolute;
	top: -35%;
	bottom: -35%;
	left: -48%;
	width: 38%;
	transform: skewX(-18deg);
	background: linear-gradient(90deg, transparent, rgba(255,255,255,.20), rgba(255,255,255,.055), transparent);
	filter: blur(.2px);
	animation: meriotify-motion-sheen 520ms cubic-bezier(.2,.8,.2,1) both;
}
.meriotify-motion-sweep-button::before { background: linear-gradient(90deg, transparent, rgba(255,255,255,.30), rgba(255,255,255,.09), transparent); }
@keyframes meriotify-motion-sweep-shell {
	0% { opacity: 0; box-shadow: inset 0 0 0 1px rgba(255,255,255,0); }
	22% { opacity: 1; box-shadow: inset 0 0 0 1px rgba(255,255,255,.075); }
	100% { opacity: 0; box-shadow: inset 0 0 0 1px rgba(255,255,255,0); }
}
@keyframes meriotify-motion-sheen {
	0% { left: -48%; opacity: 0; }
	18% { opacity: 1; }
	100% { left: 118%; opacity: 0; }
}

/* Click burst: two expanding rings + central flash. */
.meriotify-motion-burst {
	position: fixed;
	z-index: 2147483001;
	width: 12px;
	height: 12px;
	margin: -6px 0 0 -6px;
	border-radius: 50%;
	pointer-events: none;
	background: rgba(255,255,255,.80);
	box-shadow: 0 0 0 0 rgba(255,255,255,.30), 0 0 22px rgba(255,255,255,.30);
	animation: meriotify-motion-burst-core 620ms cubic-bezier(.16,1,.3,1) both;
}
.meriotify-motion-burst::before,
.meriotify-motion-burst::after {
	content: "";
	position: absolute;
	inset: 50%;
	width: 10px;
	height: 10px;
	margin: -5px;
	border: 1.5px solid rgba(255,255,255,.72);
	border-radius: 50%;
	animation: meriotify-motion-ring 620ms cubic-bezier(.12,.75,.18,1) both;
}
.meriotify-motion-burst::after { animation-delay: 70ms; border-color: rgba(255,255,255,.34); }
.meriotify-motion-burst-card { width: 15px; height: 15px; margin: -7.5px 0 0 -7.5px; }
@keyframes meriotify-motion-burst-core {
	0% { transform: scale(.3); opacity: 0; }
	12% { opacity: 1; }
	42% { transform: scale(1.18); opacity: .86; }
	100% { transform: scale(2.2); opacity: 0; }
}
@keyframes meriotify-motion-ring {
	0% { transform: scale(.35); opacity: .95; }
	100% { transform: scale(7); opacity: 0; }
}


/* Spotify+ / Adaptive Album Theme compatibility.
   When both features are enabled, the cover-derived color layer remains visible through
   the graphite shell instead of being hidden by opaque Spotify+ surfaces. */
body.meriotify-spotify-plus.meriotify-adaptive-theme {
	--mplus-bg: rgba(5,7,8,.68);
	--mplus-panel: rgba(9,13,16,.72);
	--mplus-panel-2: rgba(13,18,22,.72);
	--mplus-panel-3: rgba(17,23,27,.74);
	--mplus-hover: rgba(var(--meriotify-primary-rgb), .14);
	--mplus-line: rgba(255,255,255,.075);
	--mplus-line-strong: rgba(255,255,255,.13);

	--spice-main: rgba(5,7,8,.68);
	--spice-sidebar: rgba(9,13,16,.74);
	--spice-player: rgba(9,13,16,.74);
	--spice-card: rgba(13,18,22,.70);
	--spice-main-secondary: rgba(17,23,27,.72);

	background: transparent !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme #main,
body.meriotify-spotify-plus.meriotify-adaptive-theme .Root,
body.meriotify-spotify-plus.meriotify-adaptive-theme .Root__top-container {
	background: transparent !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme .Root__main-view {
	background:
		linear-gradient(180deg, rgba(var(--meriotify-primary-rgb), .055), transparent 28%),
		rgba(5,7,8,.56) !important;
	backdrop-filter: blur(10px) saturate(1.04) !important;
	-webkit-backdrop-filter: blur(10px) saturate(1.04) !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme .Root__nav-bar,
body.meriotify-spotify-plus.meriotify-adaptive-theme .Root__right-sidebar {
	background:
		linear-gradient(180deg, rgba(var(--meriotify-primary-rgb), .075), rgba(var(--meriotify-secondary-rgb), .035) 42%, transparent 100%),
		rgba(7,10,12,.68) !important;
	backdrop-filter: blur(18px) saturate(1.08) !important;
	-webkit-backdrop-filter: blur(18px) saturate(1.08) !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-card-card,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-card-cardContainer,
body.meriotify-spotify-plus.meriotify-adaptive-theme [data-testid="card-container"],
body.meriotify-spotify-plus.meriotify-adaptive-theme .view-homeShortcutsGrid-shortcut {
	background:
		linear-gradient(145deg, rgba(var(--meriotify-primary-rgb), .085), rgba(var(--meriotify-secondary-rgb), .035)),
		rgba(12,17,20,.66) !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-card-card:hover,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-card-cardContainer:hover,
body.meriotify-spotify-plus.meriotify-adaptive-theme [data-testid="card-container"]:hover,
body.meriotify-spotify-plus.meriotify-adaptive-theme .view-homeShortcutsGrid-shortcut:hover {
	background:
		linear-gradient(145deg, rgba(var(--meriotify-primary-rgb), .15), rgba(var(--meriotify-secondary-rgb), .075)),
		rgba(16,22,26,.78) !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-trackList-trackListRow:hover,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-trackList-trackListRow.main-trackList-selected {
	background: rgba(var(--meriotify-primary-rgb), .10) !important;
}

/* Three distinct playback zones, preserving Spotify's native layout. */
body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	gap: 9px !important;
	padding: 6px !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-left,
body.meriotify-spotify-plus .main-nowPlayingBar-center,
body.meriotify-spotify-plus .main-nowPlayingBar-right,
body.meriotify-spotify-plus [class*="nowPlayingBar-left"],
body.meriotify-spotify-plus [class*="nowPlayingBar-center"],
body.meriotify-spotify-plus [class*="nowPlayingBar-right"] {
	min-height: 66px !important;
	margin: 0 !important;
	padding: 9px 14px !important;
	border: 1px solid rgba(255,255,255,.065) !important;
	border-radius: 13px !important;
	background: linear-gradient(180deg, rgba(255,255,255,.040), rgba(255,255,255,.018)) !important;
	box-shadow: inset 0 1px 0 rgba(255,255,255,.025), 0 6px 18px rgba(0,0,0,.10) !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-center,
body.meriotify-spotify-plus [class*="nowPlayingBar-center"] {
	padding-inline: 18px !important;
	background: linear-gradient(180deg, rgba(255,255,255,.052), rgba(255,255,255,.022)) !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-right,
body.meriotify-spotify-plus [class*="nowPlayingBar-right"] {
	justify-content: flex-end !important;
}
body.meriotify-spotify-plus .main-nowPlayingBar-left::after,
body.meriotify-spotify-plus .main-nowPlayingBar-center::after,
body.meriotify-spotify-plus [class*="nowPlayingBar-left"]::after,
body.meriotify-spotify-plus [class*="nowPlayingBar-center"]::after {
	display: none !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-container,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-nowPlayingBar {
	background:
		linear-gradient(180deg, rgba(var(--meriotify-primary-rgb), .055), rgba(var(--meriotify-secondary-rgb), .022)),
		rgba(7,11,13,.68) !important;
	backdrop-filter: blur(18px) saturate(1.08) !important;
	-webkit-backdrop-filter: blur(18px) saturate(1.08) !important;
}
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-left,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-center,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-right,
body.meriotify-spotify-plus.meriotify-adaptive-theme [class*="nowPlayingBar-left"],
body.meriotify-spotify-plus.meriotify-adaptive-theme [class*="nowPlayingBar-center"],
body.meriotify-spotify-plus.meriotify-adaptive-theme [class*="nowPlayingBar-right"] {
	border-color: rgba(var(--meriotify-primary-rgb), .14) !important;
	background:
		linear-gradient(145deg, rgba(var(--meriotify-primary-rgb), .09), rgba(var(--meriotify-secondary-rgb), .035)),
		rgba(11,16,19,.66) !important;
}


/* Spotify+ ULTRA — one-toggle premium visual system. */
body.meriotify-spotify-plus {
	--mplus-art: var(--meriotify-track-art-url, none);
	--mplus-glow: rgba(var(--mplus-accent-rgb), .30);
	--mplus-glow-soft: rgba(var(--mplus-accent-rgb), .12);
}

/* Live cover atmosphere across the center pane. */
body.meriotify-spotify-plus .Root__main-view {
	position: relative !important;
	isolation: isolate !important;
}
body.meriotify-spotify-plus .Root__main-view::before {
	content: "";
	position: absolute;
	z-index: -2;
	inset: -90px;
	pointer-events: none;
	background:
		radial-gradient(70% 54% at 74% 4%, rgba(var(--mplus-accent-rgb), .25), transparent 68%),
		linear-gradient(180deg, rgba(5,7,8,.20), rgba(5,7,8,.96) 54%),
		var(--mplus-art);
	background-size: cover;
	background-position: center;
	filter: blur(64px) saturate(1.45) contrast(1.05);
	opacity: .28;
	transform: scale(1.18);
	animation: meriotify-ultra-ambient 17s ease-in-out infinite alternate;
}
body.meriotify-spotify-plus .Root__main-view::after {
	content: "";
	position: absolute;
	z-index: -1;
	inset: 0;
	pointer-events: none;
	background:
		radial-gradient(52% 34% at 50% -8%, rgba(255,255,255,.055), transparent 72%),
		linear-gradient(180deg, rgba(4,7,9,.10), rgba(4,7,9,.55) 52%, rgba(4,7,9,.91));
}
@keyframes meriotify-ultra-ambient {
	0% { transform: scale(1.16) translate3d(-1.2%, -1%, 0); opacity: .22; }
	50% { opacity: .31; }
	100% { transform: scale(1.24) translate3d(1.7%, 1.3%, 0); opacity: .27; }
}

/* Hero becomes cinematic rather than a flat Spotify header. */
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero {
	position: relative !important;
	overflow: hidden !important;
	min-height: clamp(290px, 35vh, 430px) !important;
	border-radius: 0 0 26px 26px !important;
	box-shadow: inset 0 -1px 0 rgba(255,255,255,.05), 0 30px 70px rgba(0,0,0,.22) !important;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::before {
	content: "";
	position: absolute;
	inset: -54px;
	z-index: 0;
	background:
		linear-gradient(90deg, rgba(5,7,8,.98) 0%, rgba(5,7,8,.76) 39%, rgba(5,7,8,.18) 73%, rgba(5,7,8,.42) 100%),
		linear-gradient(0deg, rgba(5,7,8,.92) 0%, transparent 62%),
		var(--meriotify-hero-url);
	background-size: cover;
	background-position: center 38%;
	filter: saturate(1.28) contrast(1.06);
	transform: scale(1.065);
	animation: meriotify-ultra-hero-drift 14s ease-in-out infinite alternate;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::after {
	content: "";
	position: absolute;
	inset: 0;
	z-index: 1;
	pointer-events: none;
	background:
		radial-gradient(42% 62% at 83% 38%, rgba(var(--mplus-accent-rgb), .20), transparent 72%),
		linear-gradient(110deg, transparent 42%, rgba(255,255,255,.045) 50%, transparent 58%);
	background-size: 100% 100%, 230% 100%;
	animation: meriotify-ultra-hero-sheen 7.5s ease-in-out infinite;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero > * {
	position: relative;
	z-index: 2;
}
@keyframes meriotify-ultra-hero-drift {
	from { transform: scale(1.065) translate3d(-.7%, -.4%, 0); }
	to { transform: scale(1.105) translate3d(1.3%, .8%, 0); }
}
@keyframes meriotify-ultra-hero-sheen {
	0%, 28% { background-position: center, 155% 0; opacity: .55; }
	55% { background-position: center, -35% 0; opacity: 1; }
	100% { background-position: center, -35% 0; opacity: .55; }
}

/* Artwork itself floats with layered depth. */
body.meriotify-spotify-plus .main-entityHeader-imageContainer,
body.meriotify-spotify-plus .main-entityHeader-image,
body.meriotify-spotify-plus .main-nowPlayingView-coverArt,
body.meriotify-spotify-plus [data-testid="cover-art-image"] {
	transform-style: preserve-3d;
	will-change: transform, filter;
}
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="cover"] {
	transform:
		perspective(850px)
		rotateX(var(--mplus-rx, 0deg))
		rotateY(var(--mplus-ry, 0deg))
		translate3d(0,-8px,24px)
		scale(1.035) !important;
	filter: saturate(1.16) brightness(1.06) drop-shadow(0 24px 34px rgba(0,0,0,.42)) !important;
}

/* 3D card tilt driven by one throttled global pointer listener. */
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="card"] {
	transform:
		perspective(900px)
		rotateX(var(--mplus-rx, 0deg))
		rotateY(var(--mplus-ry, 0deg))
		translate3d(0,-10px,16px)
		scale(1.028) !important;
	box-shadow:
		0 30px 68px rgba(0,0,0,.44),
		0 0 0 1px rgba(255,255,255,.095),
		0 0 36px var(--mplus-glow-soft) !important;
}

/* Spotlight follows pointer but lives outside Spotify layout. */
.meriotify-motion-spotlight {
	position: fixed;
	z-index: 2147482998;
	pointer-events: none;
	overflow: hidden;
	opacity: 1;
	background:
		radial-gradient(
			190px circle at var(--mplus-mx, 50%) var(--mplus-my, 50%),
			rgba(255,255,255,.115),
			rgba(var(--mplus-accent-rgb), .055) 34%,
			transparent 70%
		);
	box-shadow:
		inset 0 0 0 1px rgba(255,255,255,.06),
		0 0 44px rgba(var(--mplus-accent-rgb), .055);
	mix-blend-mode: screen;
	transition: opacity 120ms ease;
}

/* Right Now Playing is an artwork-backed glass surface. */
body.meriotify-spotify-plus .Root__right-sidebar {
	position: relative !important;
	overflow: hidden !important;
}
body.meriotify-spotify-plus .Root__right-sidebar::before {
	content: "";
	position: absolute;
	inset: -36px;
	z-index: 0;
	pointer-events: none;
	background:
		linear-gradient(180deg, rgba(5,8,10,.30), rgba(5,8,10,.90) 62%, #06090b),
		var(--meriotify-nowplaying-url, var(--mplus-art));
	background-size: cover;
	background-position: center;
	filter: blur(30px) saturate(1.35);
	opacity: .32;
	transform: scale(1.15);
	animation: meriotify-ultra-nowplaying 12s ease-in-out infinite alternate;
}
body.meriotify-spotify-plus .Root__right-sidebar > * {
	position: relative;
	z-index: 1;
}
@keyframes meriotify-ultra-nowplaying {
	from { transform: scale(1.14) translate3d(-1%,0,0); }
	to { transform: scale(1.20) translate3d(1.5%,1%,0); }
}

/* Current-track row gets a subtle living accent instead of a flat selection. */
body.meriotify-spotify-plus .main-trackList-trackListRow[aria-selected="true"],
body.meriotify-spotify-plus .main-trackList-trackListRow:has(.main-trackList-playingIcon) {
	background:
		linear-gradient(90deg, rgba(var(--mplus-accent-rgb), .16), rgba(var(--mplus-accent-rgb), .035) 46%, transparent 78%) !important;
	box-shadow: inset 3px 0 0 var(--mplus-accent), 0 0 28px rgba(var(--mplus-accent-rgb), .055) !important;
	animation: meriotify-ultra-current-row 3.4s ease-in-out infinite;
}
@keyframes meriotify-ultra-current-row {
	0%, 100% { filter: brightness(1); }
	50% { filter: brightness(1.075); }
}

/* Bottom player feels like a floating control deck. */
body.meriotify-spotify-plus .main-nowPlayingBar-container,
body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	box-shadow:
		0 -1px 0 rgba(255,255,255,.045),
		0 -22px 60px rgba(0,0,0,.30),
		0 0 34px rgba(var(--mplus-accent-rgb), .035) !important;
	backdrop-filter: blur(18px) saturate(1.10) !important;
}
body.meriotify-spotify-plus .progress-bar__fg,
body.meriotify-spotify-plus .playback-progressbar .progress-bar__fg {
	box-shadow: 0 0 10px rgba(var(--mplus-accent-rgb), .52), 0 0 22px rgba(var(--mplus-accent-rgb), .22) !important;
}

/* Page change feels like a premium native transition. */
body.meriotify-spotify-plus-motion .meriotify-plus-page-enter {
	animation: meriotify-ultra-page-in 700ms cubic-bezier(.16,1,.3,1) both !important;
}
@keyframes meriotify-ultra-page-in {
	0% { opacity: .20; transform: translate3d(0,15px,0) scale(.992); }
	42% { opacity: 1; }
	100% { opacity: 1; transform: translate3d(0,0,0) scale(1); }
}

/* Hover sweep is brighter, wider and accent-tinted. */
.meriotify-motion-sweep::before {
	width: 48% !important;
	background:
		linear-gradient(
			90deg,
			transparent,
			rgba(var(--mplus-accent-rgb), .08),
			rgba(255,255,255,.30),
			rgba(var(--mplus-accent-rgb), .11),
			transparent
		) !important;
	filter: blur(.4px) saturate(1.35) !important;
}

/* Click = shockwave + accent flash + sparks. */
.meriotify-motion-burst {
	background: rgba(255,255,255,.94) !important;
	box-shadow:
		0 0 14px rgba(255,255,255,.72),
		0 0 32px rgba(var(--mplus-accent-rgb), .72),
		0 0 0 0 rgba(var(--mplus-accent-rgb), .34) !important;
}
.meriotify-motion-burst::before {
	border-color: rgba(255,255,255,.85) !important;
}
.meriotify-motion-burst::after {
	border-color: rgba(var(--mplus-accent-rgb), .72) !important;
}
.meriotify-motion-spark {
	position: fixed;
	z-index: 2147483002;
	width: 4px;
	height: 4px;
	margin: -2px 0 0 -2px;
	border-radius: 999px;
	pointer-events: none;
	background: rgba(255,255,255,.96);
	box-shadow: 0 0 8px rgba(255,255,255,.7), 0 0 14px rgba(var(--mplus-accent-rgb), .7);
	animation: meriotify-ultra-spark 650ms cubic-bezier(.12,.78,.18,1) var(--mplus-spark-delay, 0ms) both;
}
@keyframes meriotify-ultra-spark {
	0% { opacity: 0; transform: translate3d(0,0,0) scale(.5); }
	12% { opacity: 1; }
	72% { opacity: .72; }
	100% {
		opacity: 0;
		transform: translate3d(var(--mplus-spark-x), var(--mplus-spark-y), 0) scale(.1);
	}
}

/* Buttons get stronger premium glass/magnetic feedback. */
body.meriotify-spotify-plus-motion .meriotify-motion-hover[data-meriotify-motion-kind="button"] {
	transform:
		perspective(600px)
		rotateX(calc(var(--mplus-rx, 0deg) * .35))
		rotateY(calc(var(--mplus-ry, 0deg) * .35))
		translate3d(0,-4px,14px)
		scale(1.085) !important;
	box-shadow:
		0 14px 30px rgba(0,0,0,.27),
		0 0 0 1px rgba(255,255,255,.075),
		0 0 22px rgba(var(--mplus-accent-rgb), .09) !important;
}

/* Cover/player micro-motion, deliberately slow and GPU-only. */
body.meriotify-spotify-plus-motion .main-nowPlayingBar-left img,
body.meriotify-spotify-plus-motion .main-nowPlayingView-coverArt img {
	transition: transform 520ms cubic-bezier(.16,1,.3,1), filter 420ms ease !important;
}
body.meriotify-spotify-plus-motion .main-nowPlayingBar-left:hover img {
	transform: scale(1.045) rotate(-.6deg) !important;
	filter: saturate(1.12) brightness(1.04) !important;
}



/* Spotify+ Ultra Optimized: same premium look, no permanent full-surface animation. */
body.meriotify-spotify-plus .Root__main-view::before,
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::before,
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::after,
body.meriotify-spotify-plus .Root__right-sidebar::before,
body.meriotify-spotify-plus .main-trackList-trackListRow[aria-selected="true"],
body.meriotify-spotify-plus .main-trackList-trackListRow:has(.main-trackList-playingIcon) {
	animation: none !important;
}

/* Large background filters were the main idle repaint cost. */
body.meriotify-spotify-plus .Root__main-view::before {
	filter: blur(32px) saturate(1.24) contrast(1.02) !important;
	opacity: .20 !important;
	transform: scale(1.10) !important;
}
body.meriotify-spotify-plus .Root__right-sidebar::before {
	filter: blur(18px) saturate(1.20) !important;
	opacity: .25 !important;
	transform: scale(1.08) !important;
}
body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::before {
	filter: saturate(1.17) contrast(1.03) !important;
	transform: scale(1.035) !important;
}

/* Keep the floating deck look without continuously recompositing a huge backdrop blur. */
body.meriotify-spotify-plus .main-nowPlayingBar-container,
body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	backdrop-filter: none !important;
	background: linear-gradient(180deg, rgba(17,20,22,.96), rgba(7,9,10,.985)) !important;
}

/* Finite event-driven effects can still be fancy. */
body.meriotify-spotify-plus-motion .meriotify-plus-page-enter {
	animation-duration: 460ms !important;
}
.meriotify-motion-spark {
	animation-duration: 480ms !important;
}
.meriotify-motion-burst {
	animation-duration: 420ms !important;
}

/* Only active targets get compositor hints. */
body.meriotify-spotify-plus-motion .meriotify-motion-hover,
body.meriotify-spotify-plus-motion .meriotify-motion-press,
body.meriotify-spotify-plus-motion .meriotify-motion-pop {
	will-change: transform !important;
}


/* Meriotify 1.3 final polish — separated player zones + softer geometry. */
body.meriotify-spotify-plus {
	--mplus-radius-shell: 22px;
	--mplus-radius-card: 16px;
}

/* Make the bottom player genuinely three separate floating blocks. */
body.meriotify-spotify-plus .Root__now-playing-bar {
	margin: 0 10px 10px !important;
	padding: 0 !important;
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
	overflow: visible !important;
}

body.meriotify-spotify-plus .main-nowPlayingBar-container,
body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	background: transparent !important;
	background-image: none !important;
	border: 0 !important;
	border-radius: 0 !important;
	box-shadow: none !important;
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
	overflow: visible !important;
}

body.meriotify-spotify-plus .main-nowPlayingBar-nowPlayingBar {
	gap: 10px !important;
	padding: 0 !important;
	min-height: 78px !important;
}

body.meriotify-spotify-plus .main-nowPlayingBar-left,
body.meriotify-spotify-plus .main-nowPlayingBar-center,
body.meriotify-spotify-plus .main-nowPlayingBar-right,
body.meriotify-spotify-plus [class*="nowPlayingBar-left"],
body.meriotify-spotify-plus [class*="nowPlayingBar-center"],
body.meriotify-spotify-plus [class*="nowPlayingBar-right"] {
	position: relative !important;
	min-width: 0 !important;
	min-height: 74px !important;
	margin: 0 !important;
	padding: 9px 14px !important;
	border: 1px solid rgba(255,255,255,.075) !important;
	border-radius: 18px !important;
	background:
		linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.014)),
		#090d10 !important;
	box-shadow:
		inset 0 1px 0 rgba(255,255,255,.035),
		0 12px 30px rgba(0,0,0,.25) !important;
	overflow: visible !important;
}

body.meriotify-spotify-plus .main-nowPlayingBar-center,
body.meriotify-spotify-plus [class*="nowPlayingBar-center"] {
	padding-inline: 18px !important;
	border-color: rgba(255,255,255,.09) !important;
	background:
		linear-gradient(180deg, rgba(255,255,255,.058), rgba(255,255,255,.018)),
		#0a0f12 !important;
}

body.meriotify-spotify-plus .main-nowPlayingBar-right,
body.meriotify-spotify-plus [class*="nowPlayingBar-right"] {
	justify-content: flex-end !important;
}

body.meriotify-spotify-plus .main-nowPlayingBar-left::after,
body.meriotify-spotify-plus .main-nowPlayingBar-center::after,
body.meriotify-spotify-plus [class*="nowPlayingBar-left"]::after,
body.meriotify-spotify-plus [class*="nowPlayingBar-center"]::after {
	display: none !important;
}

/* Artwork colors tint each block without joining them into one slab. */
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-container,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-nowPlayingBar {
	background: transparent !important;
	background-image: none !important;
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
}

body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-left,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-center,
body.meriotify-spotify-plus.meriotify-adaptive-theme .main-nowPlayingBar-right,
body.meriotify-spotify-plus.meriotify-adaptive-theme [class*="nowPlayingBar-left"],
body.meriotify-spotify-plus.meriotify-adaptive-theme [class*="nowPlayingBar-center"],
body.meriotify-spotify-plus.meriotify-adaptive-theme [class*="nowPlayingBar-right"] {
	border-color: rgba(var(--meriotify-primary-rgb), .18) !important;
	background:
		linear-gradient(145deg, rgba(var(--meriotify-primary-rgb), .095), rgba(var(--meriotify-secondary-rgb), .035)),
		#090d10 !important;
}

/* A little more rounding throughout Spotify+, without making every element a pill. */
body.meriotify-spotify-plus .Root__main-view,
body.meriotify-spotify-plus .Root__nav-bar,
body.meriotify-spotify-plus .Root__right-sidebar {
	border-radius: 22px !important;
}

body.meriotify-spotify-plus .main-card-card,
body.meriotify-spotify-plus .main-card-cardContainer,
body.meriotify-spotify-plus [data-testid="card-container"],
body.meriotify-spotify-plus .view-homeShortcutsGrid-shortcut {
	border-radius: 16px !important;
}

body.meriotify-spotify-plus .main-trackList-trackListRow,
body.meriotify-spotify-plus .main-yourLibraryX-listItem,
body.meriotify-spotify-plus .main-yourLibraryX-navItem,
body.meriotify-spotify-plus .main-yourLibraryX-navLink,
body.meriotify-spotify-plus .main-navBar-navBarLink,
body.meriotify-spotify-plus .main-rootlist-rootlistItem,
body.meriotify-spotify-plus .Root__nav-bar [role="listitem"],
body.meriotify-spotify-plus .Root__nav-bar [role="treeitem"] {
	border-radius: 12px !important;
}

body.meriotify-spotify-plus .main-contextMenu-menu,
body.meriotify-spotify-plus .main-userWidget-dropDownMenu,
body.meriotify-spotify-plus [role="menu"],
body.meriotify-spotify-plus [data-encore-id="popover"],
body.meriotify-spotify-plus [role="dialog"] {
	border-radius: 16px !important;
}

body.meriotify-spotify-plus .main-coverSlotCollapsed-container .cover-art-image,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArtContainer,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArt,
body.meriotify-spotify-plus .main-nowPlayingWidget-coverArt img,
body.meriotify-spotify-plus .main-entityHeader-imageContainer,
body.meriotify-spotify-plus .main-entityHeader-image {
	border-radius: 12px !important;
}

/* Keep native circular/pill controls circular where that is intentional. */
body.meriotify-spotify-plus .main-playPauseButton-button {
	border-radius: 999px !important;
}

@media (prefers-reduced-motion: reduce) {
	body.meriotify-spotify-plus-motion .meriotify-motion-hover,
	body.meriotify-spotify-plus-motion .meriotify-motion-press,
	body.meriotify-spotify-plus-motion .meriotify-motion-pop {
		animation: none !important;
		transition-duration: 1ms !important;
		transform: none !important;
	}
	.meriotify-motion-sweep,
	.meriotify-motion-burst,
	.meriotify-motion-spark,
	.meriotify-motion-spotlight {
		display: none !important;
	}
	body.meriotify-spotify-plus .Root__main-view::before,
	body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::before,
	body.meriotify-spotify-plus .main-entityHeader-container.meriotify-plus-hero::after,
	body.meriotify-spotify-plus .Root__right-sidebar::before,
	body.meriotify-spotify-plus .main-trackList-trackListRow[aria-selected="true"],
	body.meriotify-spotify-plus .main-trackList-trackListRow:has(.main-trackList-playingIcon),
	body.meriotify-spotify-plus-motion .meriotify-plus-page-enter {
		animation: none !important;
	}
}

`;
		document.head.append(style);
	}
})();
