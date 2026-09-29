package utils

import (
	"os"
	"path/filepath"
	"strings"
)

func MeriotifyLanguage() string {
	if lang := normalizeMeriotifyLanguage(os.Getenv("MERIOTIFY_LANG")); lang != "" {
		return lang
	}

	data, err := os.ReadFile(filepath.Join(GetMeriotifyFolder(), "language"))
	if err == nil {
		if lang := normalizeMeriotifyLanguage(string(data)); lang != "" {
			return lang
		}
	}

	return "en"
}

func normalizeMeriotifyLanguage(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "it", "italiano":
		return "it"
	case "en", "english":
		return "en"
	default:
		return ""
	}
}

func Tr(english, italian string) string {
	if MeriotifyLanguage() == "it" {
		return italian
	}
	return english
}
