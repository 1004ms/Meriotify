package cmd

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/1004ms/Meriotify/src/utils"
	"github.com/go-ini/ini"
)

var (
	meriotifyFolder         = utils.GetMeriotifyFolder()
	rawFolder, themedFolder = getExtractFolder()
	backupFolder            = utils.GetStateFolder("Backup")
	userThemesFolder        = utils.GetSubFolder(meriotifyFolder, "Themes")
	quiet                   bool
	isAppX                  = false
	spotifyPath             string
	prefsPath               string
	appPath                 string
	appDestPath             string
	cfg                     utils.Config
	settingSection          *ini.Section
	backupSection           *ini.Section
	preprocSection          *ini.Section
	featureSection          *ini.Section
	patchSection            *ini.Section
	themeFolder             string
	colorCfg                *ini.File
	colorSection            *ini.Section
	injectCSS               bool
	injectJS                bool
	replaceColors           bool
	overwriteAssets         bool
)

// InitConfig gets and parses config file.
func InitConfig(isQuiet bool) {
	quiet = isQuiet

	cfg = utils.ParseConfig(GetConfigPath())
	settingSection = cfg.GetSection("Setting")
	backupSection = cfg.GetSection("Backup")
	preprocSection = cfg.GetSection("Preprocesses")
	featureSection = cfg.GetSection("AdditionalOptions")
	patchSection = cfg.GetSection("Patch")
}

// InitPaths checks various essential paths' availabilities,
// tries to auto-detect them and stops Meriotify when any one
// of them is invalid.
func InitPaths() {
	spotifyPath = settingSection.Key("spotify_path").String()
	prefsPath = settingSection.Key("prefs_path").String()

	spotifyPath = utils.ReplaceEnvVarsInString(spotifyPath)
	prefsPath = utils.ReplaceEnvVarsInString(prefsPath)
	testPath := filepath.Join(spotifyPath, "Apps")

	if _, err := os.Stat(testPath); err != nil {
		actualSpotifyPath := utils.FindAppPath()

		if len(actualSpotifyPath) == 0 {
			if len(spotifyPath) != 0 {
				utils.PrintError(spotifyPath + ` is not a valid path. Please manually set "spotify_path" in config-xpui.ini to correct directory of Spotify.`)
				os.Exit(1)
			}
			utils.PrintError(`Cannot detect Spotify location. Please manually set "spotify_path" in config-xpui.ini`)
			if runtime.GOOS == "windows" {
				utils.PrintInfo("Please make sure Spotify is not installed via Microsoft Store. If it is, please uninstall it and install Spotify with their web installer.")
			}
			os.Exit(1)
		}

		spotifyPath = actualSpotifyPath
		settingSection.Key("spotify_path").SetValue(spotifyPath)
		if err := cfg.Write(); err != nil {
			utils.PrintWarning(fmt.Sprintf("Failed to save config: %s", err.Error()))
		}
	}

	if _, err := os.Stat(prefsPath); err != nil {
		actualPrefsPath := utils.FindPrefFilePath()

		if len(actualPrefsPath) == 0 {
			if len(prefsPath) != 0 {
				utils.PrintError(prefsPath + ` does not exist or is not a valid path. Please manually set "prefs_path" in config-xpui.ini to correct path of "prefs" file.`)
				os.Exit(1)
			}
			utils.PrintError(`Cannot detect Spotify "prefs" file location. Please manually set "prefs_path" in config-xpui.ini`)
			os.Exit(1)
		}

		prefsPath = actualPrefsPath
		settingSection.Key("prefs_path").SetValue(prefsPath)
		if err := cfg.Write(); err != nil {
			utils.PrintWarning(fmt.Sprintf("Failed to save config: %s", err.Error()))
		}
	}

	if runtime.GOOS == "windows" {
		if strings.Contains(spotifyPath, "SpotifyAB.SpotifyMusic") || strings.Contains(prefsPath, "SpotifyAB.SpotifyMusic") {
			isAppX = true
		}
	}

	appPath = filepath.Join(spotifyPath, "Apps")

	if isAppX {
		appDestPath = filepath.Join(meriotifyFolder, "AppX")
	} else {
		appDestPath = appPath
	}

	utils.CheckExistAndCreate(appDestPath)
}

// InitSetting parses theme settings and gets color section.
func InitSetting() {
	replaceColors = settingSection.Key("replace_colors").MustBool(false)
	injectCSS = settingSection.Key("inject_css").MustBool(false)
	injectJS = settingSection.Key("inject_theme_js").MustBool(false)
	overwriteAssets = settingSection.Key("overwrite_assets").MustBool(false)

	themeName := settingSection.Key("current_theme").String()

	if len(themeName) == 0 {
		injectCSS = false
		injectJS = false
		replaceColors = false
		overwriteAssets = false
		return
	}

	themeFolder = getThemeFolder(themeName)

	colorPath := filepath.Join(themeFolder, "color.ini")
	cssPath := filepath.Join(themeFolder, "user.css")
	assetsPath := filepath.Join(themeFolder, "assets")
	jsPath := filepath.Join(themeFolder, "theme.js")

	if replaceColors {
		_, err := os.Stat(colorPath)
		replaceColors = err == nil
	}

	if injectCSS {
		_, err := os.Stat(cssPath)
		injectCSS = err == nil
	}

	if injectJS {
		_, err := os.Stat(jsPath)
		injectJS = err == nil
		if err != nil {
			utils.CheckExistAndDelete(filepath.Join(appDestPath, "xpui", "extensions/theme.js"))
		}
	}

	if overwriteAssets {
		_, err := os.Stat(assetsPath)
		overwriteAssets = err == nil
	}

	var err error
	colorCfg, err = ini.InsensitiveLoad(colorPath)
	if err != nil {
		utils.PrintError("Cannot open file " + colorPath)
		replaceColors = false
	}

	if !replaceColors {
		return
	}

	sections := colorCfg.Sections()

	if len(sections) < 2 {
		utils.PrintError("No section found in " + colorPath)
		replaceColors = false
		return
	}

	schemeName := settingSection.Key("color_scheme").String()
	if len(schemeName) == 0 {
		colorSection = sections[1]
		return
	}

	schemeSection, err := colorCfg.GetSection(schemeName)
	if err != nil {
		utils.PrintWarning("Color scheme '" + schemeName + "' not found; using first scheme")
		colorSection = sections[1]
		return
	}

	colorSection = schemeSection
}

// GetConfigPath returns location of config file
func GetConfigPath() string {
	return filepath.Join(meriotifyFolder, "config-xpui.ini")
}

// GetSpotifyPath returns location of Spotify client
func GetSpotifyPath() string {
	return spotifyPath
}

func getExtractFolder() (string, string) {
	dir := utils.GetStateFolder("Extracted")

	raw := filepath.Join(dir, "Raw")
	utils.CheckExistAndCreate(raw)

	themed := filepath.Join(dir, "Themed")
	utils.CheckExistAndCreate(themed)

	return raw, themed
}

func getThemeFolder(themeName string) string {
	folder := filepath.Join(userThemesFolder, themeName)
	_, err := os.Stat(folder)
	if err == nil {
		return folder
	}

	folder = filepath.Join(utils.GetExecutableDir(), "Themes", themeName)
	_, err = os.Stat(folder)
	if err == nil {
		return folder
	}

	utils.PrintError(`Theme "` + themeName + `" not found`)
	os.Exit(1)
	return ""
}

// ReadAnswer prints out a yes/no form with string from `info`
// and returns boolean value based on user input (y/Y or n/N) or
// return `defaultAnswer` if input is omitted.
// If input is neither of them, print form again.
// If app is in quiet mode, returns quietModeAnswer without prompting.
func ReadAnswer(info string, defaultAnswer bool, quietModeAnswer bool) bool {
	if quiet {
		return quietModeAnswer
	}

	prompt := info
	if defaultAnswer {
		prompt += " [Y/n]: "
	} else {
		prompt += " [y/N]: "
	}

	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Print(prompt)
		text, _ := reader.ReadString('\n')
		text = strings.TrimSpace(text)
		switch strings.ToLower(text) {
		case "":
			return defaultAnswer
		case "y":
			return true
		case "n":
			return false
		}
	}
}

// CheckUpdate checks GitHub at most once every 12 hours and reuses the cached
// latest tag between checks. Failed network attempts are throttled for one hour.
// Explicit `meriotify update` always bypasses this cache.
func CheckUpdate(version string) {
	if !settingSection.Key("check_meriotify_update").MustBool() || version == "Dev" {
		return
	}

	cacheDir := utils.GetStateFolder("Cache")
	cachePath := filepath.Join(cacheDir, "latest-release.txt")
	attemptPath := filepath.Join(cacheDir, "update-check-attempt")

	readCached := func() string {
		cached, err := os.ReadFile(cachePath)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(cached))
	}

	if info, err := os.Stat(cachePath); err == nil && time.Since(info.ModTime()) < 12*time.Hour {
		notifyUpdate(readCached(), version)
		return
	}
	if info, err := os.Stat(attemptPath); err == nil && time.Since(info.ModTime()) < time.Hour {
		notifyUpdate(readCached(), version)
		return
	}

	latestTag, err := utils.FetchLatestTag()
	_ = os.WriteFile(attemptPath, []byte(time.Now().UTC().Format(time.RFC3339)), 0600)
	if err != nil {
		utils.PrintWarning("Cannot fetch latest Meriotify release info: " + err.Error())
		notifyUpdate(readCached(), version)
		return
	}

	_ = os.WriteFile(cachePath, []byte(latestTag), 0600)
	notifyUpdate(latestTag, version)
}

func notifyUpdate(latestTag, currentVersion string) {
	if !isVersionNewer(latestTag, currentVersion) {
		return
	}
	utils.PrintInfo("Update available: v" + latestTag)
}

func isVersionNewer(latest, current string) bool {
	parse := func(v string) ([3]int, bool) {
		var out [3]int
		v = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(v), "v"), "V")
		v = strings.SplitN(v, "-", 2)[0]
		parts := strings.Split(v, ".")
		if len(parts) != 3 {
			return out, false
		}
		for i, part := range parts {
			n, err := strconv.Atoi(part)
			if err != nil {
				return out, false
			}
			out[i] = n
		}
		return out, true
	}

	l, okL := parse(latest)
	c, okC := parse(current)
	if !okL || !okC {
		return false
	}
	for i := 0; i < len(l); i++ {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}
