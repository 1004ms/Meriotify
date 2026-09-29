package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/1004ms/Meriotify/src/utils"
)

func ApplyMarketplaceBranding() {
	source := filepath.Join(utils.GetExecutableDir(), "MarketplaceBranding")
	destination := filepath.Join(utils.GetMeriotifyFolder(), "CustomApps", "marketplace")
	if _, err := os.Stat(source); err != nil {
		return
	}
	if _, err := os.Stat(destination); err != nil {
		return
	}

	icon, iconErr := os.ReadFile(filepath.Join(source, "icon.svg"))
	activeIcon, activeIconErr := os.ReadFile(filepath.Join(source, "icon-filled.svg"))
	manifestPath := filepath.Join(destination, "manifest.json")
	manifestData, manifestErr := os.ReadFile(manifestPath)

	if iconErr == nil && activeIconErr == nil && manifestErr == nil {
		manifest := map[string]any{}
		if json.Unmarshal(manifestData, &manifest) == nil {
			manifest["name"] = "Meriotify"
			manifest["icon"] = strings.TrimSpace(string(icon))
			manifest["active-icon"] = strings.TrimSpace(string(activeIcon))
			if encoded, err := json.MarshalIndent(manifest, "", "  "); err == nil {
				_ = os.WriteFile(manifestPath, encoded, 0600)
			}
		}
	}

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
