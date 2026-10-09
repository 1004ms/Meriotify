/// <reference types="react" />

const { React } = Spicetify;
const { useEffect, useRef, useState } = React;

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

function deepMerge(base, input) {
	const result = { ...base };
	for (const [key, value] of Object.entries(input || {})) {
		if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
			result[key] = deepMerge(base[key], value);
		} else result[key] = value;
	}
	return result;
}

function readSettings() {
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

		// Meriotify 1.3 baseline: every optional module starts OFF on schema migration.
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
	}
	catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function readRuntime() {
	try { return JSON.parse(localStorage.getItem(RUNTIME_KEY) || "{}"); }
	catch { return {}; }
}

function getLanguage() {
	const installerLanguage = String(window.MeriotifyLocale || "").trim().toLowerCase();
	if (installerLanguage === "it" || installerLanguage === "en") return installerLanguage;
	const stored = String(localStorage.getItem("meriotify:language") || "").trim().toLowerCase();
	if (stored === "it" || stored === "en") return stored;
	return "en";
}

function writeSettings(next) {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
	window.dispatchEvent(new CustomEvent(EVENT_SETTINGS));
}

function setAtPath(source, path, value) {
	const clone = JSON.parse(JSON.stringify(source));
	let cursor = clone;
	for (let i = 0; i < path.length - 1; i++) cursor = cursor[path[i]];
	cursor[path[path.length - 1]] = value;
	return clone;
}

function formatRemaining(ms, italian) {
	if (ms === null || ms === undefined) return italian ? "Non attivo" : "Not active";
	const total = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min ${String(seconds).padStart(2, "0")} s`;
	return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

function formatMinutes(value, italian) {
	const minutes = Math.max(1, Number(value) || 1);
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (!hours) return `${minutes} min`;
	if (!rest) return italian ? `${hours} ${hours === 1 ? "ora" : "ore"}` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
	return `${hours} h ${rest} min`;
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

async function saveBackgroundFile(file) {
	const db = await openAssetDb();
	await new Promise((resolve, reject) => {
		const tx = db.transaction(ASSET_STORE, "readwrite");
		tx.objectStore(ASSET_STORE).put({ blob: file, type: file.type, name: file.name, updatedAt: Date.now() }, BACKGROUND_ASSET);
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
	});
	db.close();
}

async function deleteBackgroundFile() {
	const db = await openAssetDb();
	await new Promise((resolve, reject) => {
		const tx = db.transaction(ASSET_STORE, "readwrite");
		tx.objectStore(ASSET_STORE).delete(BACKGROUND_ASSET);
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
	});
	db.close();
}

function Toggle({ checked, onChange }) {
	return React.createElement(
		"button",
		{
			type: "button",
			role: "switch",
			"aria-checked": checked,
			className: `meriotify-toggle ${checked ? "on" : "off"}`,
			onClick: () => onChange(!checked),
		},
		React.createElement("span", { className: "meriotify-toggle-dot" }),
		React.createElement("span", null, checked ? "ON" : "OFF")
	);
}

function Status({ on }) {
	return React.createElement("span", { className: `meriotify-status ${on ? "on" : "off"}` }, on ? "ON" : "OFF");
}

function NumberInput({ value, min, max, onChange }) {
	return React.createElement("input", {
		className: "meriotify-input meriotify-number",
		type: "number",
		min,
		max,
		value,
		onChange: (event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min))),
	});
}

function TextInput({ value, onChange }) {
	return React.createElement("input", {
		className: "meriotify-input",
		type: "text",
		value,
		onChange: (event) => onChange(event.target.value),
	});
}

function Slider({ value, min, max, suffix, onChange }) {
	return React.createElement(
		"div",
		{ className: "meriotify-range-wrap" },
		React.createElement("input", {
			className: "meriotify-range",
			type: "range",
			min,
			max,
			value,
			onChange: (event) => onChange(Number(event.target.value)),
		}),
		React.createElement("span", null, `${value}${suffix || ""}`)
	);
}

function Row({ label, children, hint, compact = false }) {
	return React.createElement(
		"div",
		{ className: `meriotify-row ${compact ? "compact" : ""}` },
		React.createElement(
			"div",
			{ className: "meriotify-row-copy" },
			React.createElement("span", { className: "meriotify-row-label" }, label),
			hint ? React.createElement("small", null, hint) : null
		),
		React.createElement("div", { className: "meriotify-row-control" }, children)
	);
}

function Card({ title, description, enabled, children, wide = false }) {
	return React.createElement(
		"section",
		{ className: `meriotify-card ${wide ? "wide" : ""}` },
		React.createElement(
			"div",
			{ className: "meriotify-card-head" },
			React.createElement("h2", null, title),
			React.createElement(Status, { on: Boolean(enabled) })
		),
		description ? React.createElement("p", { className: "meriotify-description" }, description) : null,
		children
	);
}

function SectionTitle({ children }) {
	return React.createElement("h3", { className: "meriotify-section-title" }, children);
}

function App() {
	const [settings, setSettings] = useState(readSettings);
	const [runtime, setRuntime] = useState(readRuntime);
	const fileInputRef = useRef(null);
	const language = getLanguage();
	const italian = language === "it";
	const T = (it, en) => italian ? it : en;

	useEffect(() => {
		localStorage.setItem("meriotify:language", language);
		const syncRuntime = (event) => setRuntime(event.detail || readRuntime());
		window.addEventListener(EVENT_RUNTIME, syncRuntime);
		const id = setInterval(() => setRuntime(readRuntime()), 1000);
		return () => {
			window.removeEventListener(EVENT_RUNTIME, syncRuntime);
			clearInterval(id);
		};
	}, [language]);

	function update(path, value) {
		setSettings((current) => {
			const next = setAtPath(current, path, value);
			writeSettings(next);
			return next;
		});
	}

	function setSleepEnabled(enabled) {
		update(["sleep", "enabled"], enabled);
	}

	async function setBackgroundEnabled(enabled) {
		if (enabled) {
			const asset = await getBackgroundAsset().catch(() => null);
			if (!asset?.blob) {
				Spicetify.showNotification(T("Scegli prima un'immagine o una GIF.", "Choose an image or GIF first."), true);
				return;
			}
		}
		update(["background", "enabled"], enabled);
	}

	async function onBackgroundFile(event) {
		const file = event.target.files?.[0];
		if (!file) return;
		if (file.size > 100 * 1024 * 1024) {
			Spicetify.showNotification(T("File troppo grande: massimo 100 MB.", "File too large: 100 MB maximum."), true);
			return;
		}
		if (!/^image\/(png|gif|jpeg|webp)$/i.test(file.type)) {
			Spicetify.showNotification(T("Formato non supportato. Usa PNG, JPG, WebP o GIF.", "Unsupported format. Use PNG, JPG, WebP or GIF."), true);
			return;
		}
		await saveBackgroundFile(file);
		setSettings((current) => {
			const next = JSON.parse(JSON.stringify(current));
			next.background.enabled = true;
			next.background.type = file.type === "image/gif" ? "gif" : "image";
			next.background.name = file.name;
			writeSettings(next);
			return next;
		});
		event.target.value = "";
		Spicetify.showNotification(T("Background applicato.", "Background applied."));
	}

	async function removeBackground() {
		await deleteBackgroundFile();
		setSettings((current) => {
			const next = JSON.parse(JSON.stringify(current));
			next.background.enabled = false;
			next.background.type = "";
			next.background.name = "";
			writeSettings(next);
			return next;
		});
		Spicetify.showNotification(T("Background rimosso.", "Background removed."));
	}

	const keybindRows = [
		["playPause", T("Play / Pausa", "Play / Pause")],
		["next", T("Brano successivo", "Next track")],
		["previous", T("Brano precedente", "Previous track")],
		["volumeUp", T("Alza volume", "Volume up")],
		["volumeDown", T("Abbassa volume", "Volume down")],
		["mute", T("Muto", "Mute")],
	];


	const sleepStatus = !settings.sleep.enabled
		? "OFF"
		: runtime.sleepCounting
			? `Idle · ${formatRemaining(runtime.sleepRemainingMs, false)}`
			: runtime.sleepGraceRemainingMs !== null && runtime.sleepGraceRemainingMs !== undefined
				? "Idle"
				: "Music Active";

	return React.createElement(
		"main",
		{ className: "meriotify-hub" },
		React.createElement(
			"header",
			{ className: "meriotify-header" },
			React.createElement("div", null,
				React.createElement("h1", { className: "meriotify-title" }, "Meriotify"),
				React.createElement("p", { className: "meriotify-subtitle" }, T("Impostazioni", "Settings"))
			),
			React.createElement("span", { className: "meriotify-core-state" }, "1.3.4")
		),

		React.createElement(SectionTitle, null, T("Aspetto", "Appearance")),
		React.createElement("div", { className: "meriotify-grid" },
			React.createElement(Card, {
				title: "Spotify+",
				enabled: settings.spotifyPlus.enabled,
			},
				React.createElement(Row, {
					label: "Spotify+"
				}, React.createElement(Toggle, {
					checked: settings.spotifyPlus.enabled,
					onChange: (v) => update(["spotifyPlus", "enabled"], v)
				}))
			),

			React.createElement(Card, {
				title: T("Tema dalla cover", "Artwork Theme"),
				enabled: settings.adaptiveTheme.enabled,
			},
				React.createElement(Row, {
					label: T("Colori dalla cover", "Artwork colors")
				}, React.createElement(Toggle, {
					checked: settings.adaptiveTheme.enabled,
					onChange: (v) => update(["adaptiveTheme", "enabled"], v)
				})),
				React.createElement(Row, {
					label: T("Intensità", "Intensity")
				}, React.createElement(Slider, {
					value: settings.adaptiveTheme.intensity,
					min: 20,
					max: 100,
					suffix: "%",
					onChange: (v) => update(["adaptiveTheme", "intensity"], v)
				}))
			),

			React.createElement(Card, {
				title: T("Background", "Background"),
				description: T(
					"Metti una tua immagine o GIF dietro Spotify. Il file resta sul PC; le GIF si fermano automaticamente quando Spotify non è in primo piano, così non lavorano a vuoto.",
					"Put your own image or GIF behind Spotify. The file stays on your PC; GIFs pause automatically when Spotify is not focused so they do not keep rendering for nothing."
				),
				enabled: settings.background.enabled,
			},
				React.createElement(Row, { label: T("Usa questo background", "Use this background") }, React.createElement(Toggle, { checked: settings.background.enabled, onChange: setBackgroundEnabled })),
				React.createElement(Row, { label: T("Opacità", "Opacity") }, React.createElement(Slider, { value: Math.round(settings.background.opacity * 100), min: 5, max: 100, suffix: "%", onChange: (v) => update(["background", "opacity"], v / 100) })),
				React.createElement(Row, { label: T("Immagine", "Image"), hint: settings.background.name || T("PNG, JPG, WebP o GIF · massimo 100 MB", "PNG, JPG, WebP or GIF · 100 MB maximum") }, React.createElement(React.Fragment, null,
					React.createElement("input", { ref: fileInputRef, className: "meriotify-file-hidden", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", onChange: onBackgroundFile }),
					React.createElement("button", { className: "meriotify-button secondary", type: "button", onClick: () => fileInputRef.current?.click() }, T("Scegli immagine/GIF", "Choose image/GIF"))
				)),
				settings.background.name ? React.createElement("button", { className: "meriotify-text-action danger", type: "button", onClick: removeBackground }, T("Togli background", "Remove background")) : null
			)
		),

		React.createElement(SectionTitle, null, T("Riproduzione", "Playback")),
		React.createElement("div", { className: "meriotify-grid" },

			React.createElement(Card, {
				title: "Shuffle+",
				description: T(
					"Usa il vero Shuffle+ di Spicetify sul normale tasto Shuffle di Spotify. Nessun pulsante extra: quando è attivo, premi una sola volta Shuffle e Meriotify rimescola davvero la playlist.",
					"Uses the real Spicetify Shuffle+ engine on Spotify's normal Shuffle button. No extra buttons: when enabled, press Shuffle once and Meriotify truly reshuffles the playlist."
				),
				enabled: settings.shufflePlus.enabled,
				wide: true,
			},
				React.createElement(Row, {
					label: "Shuffle+",
					hint: T(
						"OFF = Shuffle Spotify normale · ON = il tasto Shuffle usa Shuffle+",
						"OFF = normal Spotify Shuffle · ON = the Shuffle button uses Shuffle+"
					)
				}, React.createElement(Toggle, {
					checked: settings.shufflePlus.enabled,
					onChange: (v) => update(["shufflePlus", "enabled"], v)
				})),


				React.createElement("div", { className: "meriotify-note" },
					React.createElement("strong", null, T("Prima di usarlo, in Spotify disattiva:", "Before using it, disable these in Spotify:")),
					React.createElement("br"),
					React.createElement("span", null, "1. ", React.createElement("strong", null, T("Riproduzione automatica brani simili", "Autoplay"))),
					React.createElement("br"),
					React.createElement("span", null, "2. ", React.createElement("strong", null, T("Includi Smart Shuffle nelle modalità di riproduzione", "Include Smart Shuffle in play modes")))
				),

				React.createElement("div", { className: "meriotify-note" },
					React.createElement("strong", null, T("Come si usa:", "How to use it:")),
					React.createElement("br"),
					React.createElement("span", null, T(
						"Apri o avvia una playlist e premi UNA SOLA VOLTA il normale tasto Shuffle di Spotify. Vedrai “Shuffled X Songs”. Non c’è più alcun loop automatico della playlist.",
						"Open or start a playlist and press Spotify's normal Shuffle button ONCE. You will see “Shuffled X Songs”. There is no automatic playlist loop anymore."
					))
				),
			),

			React.createElement(Card, {
				title: "Sleep Timer",
				description: T(
					"Se Spotify resta fermo abbastanza a lungo, lo chiude da solo. Appena riparte una canzone il conto si azzera, quindi una pausa normale non ti spegne niente.",
					"If Spotify stays idle long enough, it closes itself. As soon as music starts again the countdown resets, so a normal pause will not shut anything down."
				),
				enabled: settings.sleep.enabled,
			},
				React.createElement(Row, { label: T("Sleep Timer", "Sleep Timer") }, React.createElement(Toggle, { checked: settings.sleep.enabled, onChange: setSleepEnabled })),
				React.createElement("div", { className: `meriotify-timer-box ${runtime.sleepCounting ? "active" : ""}` },
					React.createElement("strong", null, sleepStatus)
				),
				React.createElement(Row, { label: T("Chiudi dopo", "Close after"), hint: `${formatMinutes(settings.sleep.minutes, italian)} · ${T("predefinito: 2 ore", "default: 2 hours")}` }, React.createElement(NumberInput, { value: settings.sleep.minutes, min: 1, max: 1440, onChange: (v) => update(["sleep", "minutes"], v) })),
				React.createElement("div", { className: "meriotify-note" }, T("Parte una canzone? Il timer torna subito da capo.", "Music starts again? The timer immediately resets."))
			),

			React.createElement(Card, {
				title: "Fade Out",
				description: T(
					"Fa scendere il volume negli ultimi secondi del brano e lo rimette normale appena cambia traccia. Il volume salvato di Spotify non viene toccato.",
					"Drops the volume during the final seconds of a track and restores it as soon as the next one starts. Your saved Spotify volume is left alone."
				),
				enabled: settings.fade.enabled,
			},
				React.createElement(Row, { label: T("Fade Out", "Fade Out") }, React.createElement(Toggle, { checked: settings.fade.enabled, onChange: (v) => update(["fade", "enabled"], v) })),
				React.createElement(Row, { label: T("Ultimi secondi", "Final seconds"), hint: T("quanto prima della fine deve iniziare a sfumare", "how early the fade should start before the track ends") }, React.createElement(NumberInput, { value: settings.fade.seconds, min: 1, max: 60, onChange: (v) => update(["fade", "seconds"], v) })),
				runtime.fadeActive ? React.createElement("div", { className: "meriotify-inline-state ready" }, T("Fade Out in corso sul brano corrente", "Fade Out is active on the current track")) : null
			),

		),

		React.createElement(SectionTitle, null, T("Controlli", "Controls")),
		React.createElement("div", { className: "meriotify-grid" },

			React.createElement(Card, {
				title: T("Scorciatoie globali", "Global keybinds"),
				enabled: settings.keybinds.enabled,
				wide: true,
			},
				React.createElement(Row, { label: T("Usa scorciatoie", "Use keybinds") }, React.createElement(Toggle, { checked: settings.keybinds.enabled, onChange: (v) => update(["keybinds", "enabled"], v) })),
				React.createElement("div", { className: "meriotify-keygrid" }, ...keybindRows.flatMap(([key, label]) => [
					React.createElement("span", { key: `${key}-label` }, label),
					React.createElement(TextInput, { key, value: settings.keybinds[key], onChange: (v) => update(["keybinds", key], v) }),
				]))
			)
		)
	);

}

function render() {
	return React.createElement(App);
}
