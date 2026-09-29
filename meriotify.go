package main

import (
	"errors"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"sync"

	"github.com/1004ms/Meriotify/src/cmd"
	"github.com/1004ms/Meriotify/src/utils"
	"github.com/1004ms/Meriotify/src/utils/isAdmin"
	colorable "github.com/mattn/go-colorable"
	"github.com/pterm/pterm"
)

var (
	version         string
	upstreamVersion string
)

var (
	flags            = []string{}
	commands         = []string{}
	quiet            = false
	extensionFocus   = false
	appFocus         = false
	styleFocus       = false
	noRestart        = false
	liveRefresh      = false
	bypassAdminCheck = false
)

func init() {
	if runtime.GOOS != "windows" &&
		runtime.GOOS != "darwin" &&
		runtime.GOOS != "linux" {
		utils.PrintError("Unsupported OS.")
		os.Exit(1)
	}
	if version == "" {
		version = "Dev"
	}
	if upstreamVersion == "" {
		upstreamVersion = "Dev"
	}

	log.SetFlags(0)
	// Supports print color output for Windows
	log.SetOutput(colorable.NewColorableStdout())

	// Separates flags and commands
	parseFlags := true
	for _, v := range os.Args[1:] {
		if parseFlags && v == "--" {
			parseFlags = false
			continue
		}

		if parseFlags && len(v) > 0 && v[0] == '-' {
			if len(v) > 2 && v[1] != '-' {
				for _, char := range v[1:] {
					flags = append(flags, "-"+string(char))
				}
			} else {
				flags = append(flags, v)
			}
		} else {
			commands = append(commands, v)
		}
	}

	for _, v := range flags {
		switch v {
		case "--bypass-admin":
			bypassAdminCheck = true
		case "-c", "--config":
			log.Println(cmd.GetConfigPath())
			os.Exit(0)
		case "-h", "--help":
			kind := ""
			if len(commands) > 0 {
				kind = commands[0]
			}
			if kind == "config" {
				helpConfig()
			} else {
				help()
			}

			os.Exit(0)
		case "-v", "--version":
			log.Println(version)
			os.Exit(0)
		case "--compat-version":
			log.Println(upstreamVersion)
			os.Exit(0)
		case "-e", "--extension":
			extensionFocus = true
			liveRefresh = true
		case "-a", "--app":
			appFocus = true
			liveRefresh = true
		case "-q", "--quiet":
			quiet = true
		case "-n", "--no-restart":
			noRestart = true
		case "-s", "--style":
			styleFocus = true
			liveRefresh = true
		case "-l", "--live-refresh":
			extensionFocus = true
			appFocus = true
			styleFocus = true
			liveRefresh = true
		}
	}

	if quiet {
		log.SetOutput(io.Discard)
		os.Stdout = nil
		pterm.DisableOutput()
	}

	if isAdmin.Check(bypassAdminCheck) {
		utils.PrintError("Meriotify should NOT be run with administrator or root privileges")
		utils.PrintError("Doing so can cause Spotify to show a black/blank window after applying!")
		utils.PrintError("This happens because Spotify (running as a normal user) can't access files modified with admin privileges")
		utils.PrintInfo("If you understand the risks and need to continue, you can use the '--bypass-admin' flag.")
		os.Exit(1)
	}

	for i, flag := range flags {
		if flag == "--bypass-admin" {
			flags = append(flags[:i], flags[i+1:]...)
			break
		}
	}

	utils.MigrateConfigFolder()
	utils.MigrateFolders()
	cmd.InitConfig(quiet)

	if len(commands) < 1 {
		help()
		cmd.CheckUpdate(version)
		os.Exit(0)
	}
}

func main() {
	if slices.Contains(commands, "config-dir") {
		cmd.ShowConfigDirectory()
		return
	}

	// Unchainable commands
	switch commands[0] {
	case "config":
		commands = commands[1:]
		if len(commands) == 0 {
			cmd.DisplayAllConfig()
		} else if len(commands) == 1 {
			cmd.DisplayConfig(commands[0])
		} else {
			cmd.EditConfig(commands)
		}
		return

	case "color":
		commands = commands[1:]
		if len(commands) == 0 {
			cmd.DisplayColors()
		} else {
			cmd.EditColor(commands)
		}
		return

	case "spotify-updates":
		cmd.InitPaths()
		commands = commands[1:]
		if len(commands) == 0 {
			utils.PrintError("No parameter given. It has to be \"block\" or \"unblock\".")
			return
		}
		param := commands[0]
		switch param {
		case "block":
			cmd.BlockSpotifyUpdates(true)
		case "unblock":
			cmd.BlockSpotifyUpdates(false)
		default:
			utils.PrintError("Invalid parameter. It has to be \"block\" or \"unblock\".")
		}
		return

	case "path":
		cmd.InitPaths()
		commands = commands[1:]
		path, err := (func() (string, error) {
			if styleFocus {
				if len(commands) == 0 {
					return cmd.ThemeAllAssetsPath()
				}
				return cmd.ThemeAssetPath(commands[0])
			} else if extensionFocus {
				if len(commands) == 0 {
					return cmd.ExtensionAllPath()
				}
				return cmd.ExtensionPath(commands[0])
			} else if appFocus {
				if len(commands) == 0 {
					return cmd.AppAllPath()
				}
				return cmd.AppPath(commands[0])
			} else {
				for _, v := range flags {
					if v != "-e" && v != "-c" && v != "-a" && v != "-s" {
						return "", errors.New("invalid option\navailable options: -e, -c, -a, -s")
					}
				}

				if len(commands) == 0 && len(flags) == 0 {
					return utils.GetExecutableDir(), nil
				} else if commands[0] == "all" {
					return cmd.AllPaths()
				} else if commands[0] == "userdata" {
					return utils.GetMeriotifyFolder(), nil
				}
				return "", errors.New("invalid option\navailable options: all, userdata")
			}
		})()

		if err != nil {
			utils.Fatal(err)
		}

		log.Println(path)
		return

	case "watch":
		cmd.InitPaths()

		var name []string
		if len(commands) > 1 {
			name = commands[1:]
		}

		var watchGroup sync.WaitGroup

		if extensionFocus {
			watchGroup.Add(1)
			go func(name []string, liveUpdate bool) {
				defer watchGroup.Done()
				cmd.WatchExtensions(name, liveUpdate)
			}(name, liveRefresh)
		}

		if appFocus {
			watchGroup.Add(1)
			go func(name []string, liveUpdate bool) {
				defer watchGroup.Done()
				cmd.WatchCustomApp(name, liveUpdate)
			}(name, liveRefresh)
		}

		if styleFocus {
			watchGroup.Add(1)
			go func(liveUpdate bool) {
				defer watchGroup.Done()
				cmd.Watch(liveUpdate)
			}(liveRefresh)
		}

		watchGroup.Wait()
		return
	}

	cmd.InitPaths()

	utils.PrintBrand(version)
	if slices.Contains(commands, "upgrade") || slices.Contains(commands, "update") {
		if cmd.Update(version) {
			ex, err := os.Executable()
			if err == nil {
				refresh := exec.Command(ex, "-q", "setup")
				refresh.Stdout = io.Discard
				refresh.Stderr = io.Discard
				if refresh.Run() != nil {
					utils.PrintWarning("Updated, but Spotify refresh failed")
				}
			}
		}
		return
	}
	cmd.CheckUpdate(version)

	var shouldRestart bool = false
	// Chainable commands
	for _, v := range commands {
		switch v {
		case "setup", "init":
			cmd.ApplyMarketplaceBranding()
			cmd.Backup(version, upstreamVersion, true)
			cmd.CheckStates()
			cmd.InitSetting()
			cmd.Apply(version)
			shouldRestart = true

		case "backup":
			cmd.Backup(version, upstreamVersion, slices.Contains(commands, "apply"))

		case "clear":
			cmd.Clear()

		case "apply":
			cmd.CheckStates()
			cmd.InitSetting()
			cmd.Apply(version)
			shouldRestart = true

		case "refresh":
			cmd.CheckStates()
			cmd.InitSetting()
			if extensionFocus {
				cmd.RefreshExtensions()
			} else if appFocus {
				cmd.RefreshApps()
			} else {
				cmd.RefreshTheme()
			}

		case "restore":
			cmd.Restore()
			shouldRestart = true

		case "enable-devtools":
			cmd.EnableDevTools()
			shouldRestart = true

		case "restart":
			cmd.SpotifyRestart()

		case "auto":
			cmd.Auto(version, upstreamVersion)
			shouldRestart = true

		default:
			utils.Fatal(errors.New(`Command "` + v + `" not found.
Run "meriotify -h" for a list of valid commands.`))
		}
	}

	if !noRestart && !slices.Contains(commands, "restart") && shouldRestart {
		cmd.SpotifyRestart()
	}
}

func help() {
	utils.PrintBrand(version)
	log.Println(`
COMMANDS
  meriotify update      Update Meriotify
  meriotify --version   Show installed version

Install and uninstall are handled by the official PowerShell commands on GitHub.
Project: https://github.com/1004ms/Meriotify`)
}

func helpConfig() {
	utils.PrintBold("CONFIG MEANING")
	log.Println(utils.Bold("[Setting]") + `
spotify_path
    Path to Spotify directory

prefs_path
    Path to Spotify's "prefs" file

current_theme
    Name of folder of your theme

color_scheme
    Color config section name in color.ini file.
    If color_scheme is blank, first section in color.ini file would be used.

inject_css <0 | 1>
    Whether custom css from user.css in theme folder is applied

inject_theme_js <0 | 1>
    Whether custom js from theme.js in theme folder is applied

replace_colors <0 | 1>
    Whether custom colors is applied

spotify_launch_flags <string>
    Command-line flags used when launching/restarting Spotify.
    Separate each flag with "|".
    To set flags from the CLI, place "--" before the value.
    Example: meriotify config spotify_launch_flags -- "--flag-1|--flag-2"

always_enable_devtools <0 | 1>
    Whether Chrome DevTools is enabled when launching/restarting Spotify.

check_meriotify_update <0 | 1>
    Whether to always check for Meriotify updates.

` + utils.Bold("[Preprocesses]") + `
disable_sentry <0 | 1>
    Prevents Sentry and Amazon Qualaroo to send console log/error/warning to Spotify developers.
    Enable if you don't want to catch their attention when developing extension or app.

disable_ui_logging <0 | 1>
    Various elements logs every user clicks, scrolls.
    Enable to stop logging and improve user experience.

remove_rtl_rule <0 | 1>
    To support Arabic and other Right-To-Left language, Spotify added a lot of
    CSS rules that are obsoleted to Left-To-Right users.
    Enable to remove all of them and improve render speed.

expose_apis <0 | 1>
    Exposes Spotify APIs to themes and extensions through the compatibility API.
    The same API is also available as Meriotify.

` + utils.Bold("[AdditionalOptions]") + `
custom_apps <string>
    List of custom apps. Separate each app with "|".

extensions <string>
    List of Javascript files to be executed along with Spotify main script.
    Separate each extension with "|".

experimental_features <0 | 1>
    Enable ability to activate unfinished or work-in-progress features that would eventually be released in future Spotify updates.
    Open "Experimental features" popup in Profile menu.

home_config <0 | 1>
    Enable ability to re-arrange sections in Home page.
    Navigate to Home page, turn "Home config" mode on in Profile menu and hover on sections to show customization buttons.

sidebar_config <0 | 1>
    Enable ability to stick, hide, re-arrange sidebar items.
    Turn "Sidebar config" mode on in Profile menu and hover on sidebar items to show customization buttons.

` + utils.Bold("[Patch]") + `
Allows you to apply custom patches to Spotify.`)
}
