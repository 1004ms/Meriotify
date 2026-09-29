package cmd

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/1004ms/Meriotify/src/utils"
)

// ApplyMarketplaceBranding keeps the upstream Marketplace runtime intact while
// replacing only its visible Meriotify branding.
func ApplyMarketplaceBranding() {
	source := filepath.Join(utils.GetExecutableDir(), "MarketplaceBranding")
	destination := filepath.Join(utils.GetMeriotifyFolder(), "CustomApps", "marketplace")
	if _, err := os.Stat(source); err != nil {
		return
	}
	if _, err := os.Stat(destination); err != nil {
		return
	}

	assets := filepath.Join(destination, "assets")
	if err := os.MkdirAll(assets, 0700); err != nil {
		return
	}

	_ = utils.CopyFile(filepath.Join(source, "icon.svg"), assets)
	_ = utils.CopyFile(filepath.Join(source, "icon-filled.svg"), assets)

	settingsSource := filepath.Join(source, "settings.json")
	_ = utils.CopyFile(settingsSource, destination)

	// Change only the visible product label. Never rename the Spicetify API or
	// other compatibility identifiers used by Marketplace internally.
	_ = filepath.WalkDir(destination, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".js" && ext != ".json" && ext != ".html" {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		text := string(data)
		changed := strings.ReplaceAll(text, "Spicetify Marketplace", "Meriotify Marketplace")
		if changed != text {
			_ = os.WriteFile(path, []byte(changed), 0600)
		}
		return nil
	})
}
