package utils

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
)

func MigrateConfigFolder() {
	destination := GetMeriotifyFolder()
	configPath := filepath.Join(destination, "config-xpui.ini")
	if _, err := os.Stat(configPath); err == nil {
		return
	}

	var candidates []string
	if runtime.GOOS == "windows" {
		candidates = append(candidates,
			filepath.Join(os.Getenv("APPDATA"), "spicetify"),
			filepath.Join(os.Getenv("USERPROFILE"), ".spicetify"),
		)
	} else {
		candidates = append(candidates,
			filepath.Join(os.Getenv("HOME"), ".config", "spicetify"),
			filepath.Join(os.Getenv("HOME"), ".spicetify"),
		)
	}

	for _, source := range candidates {
		if source == destination {
			continue
		}
		if _, err := os.Stat(filepath.Join(source, "config-xpui.ini")); err != nil {
			continue
		}

		spinner, _ := Spinner.Start("Importing existing Spicetify configuration")
		if err := Copy(source, destination, true, nil); err != nil {
			spinner.Fail("Failed to import Spicetify configuration")
			Fatal(err)
		}
		spinner.Success("Imported existing configuration into Meriotify")
		return
	}
}

func MigrateFolders() {
	backupPath := filepath.Join(GetMeriotifyFolder(), "Backup")
	extractedPath := filepath.Join(GetMeriotifyFolder(), "Extracted")

	if _, err := os.Stat(backupPath); err == nil {
		newBackupPath := GetStateFolder("Backup")
		oldAbs, err := filepath.Abs(backupPath)
		if err != nil {
			Fatal(err)
		}
		newAbs, err := filepath.Abs(newBackupPath)
		if err != nil {
			Fatal(err)
		}

		if oldAbs != newAbs {
			spinner, _ := Spinner.Start("Migrating backup folder")
			err := Copy(backupPath, newBackupPath, true, nil)
			if err != nil {
				spinner.Fail("Failed to migrate backup folder")
				Fatal(err)
			}
			os.RemoveAll(backupPath)
			spinner.Success("Migrated backup folder")
		}
	}

	if _, err := os.Stat(extractedPath); err == nil {
		newExtractedPath := GetStateFolder("Extracted")
		oldAbs, err := filepath.Abs(extractedPath)
		if err != nil {
			Fatal(err)
		}
		newAbs, err := filepath.Abs(newExtractedPath)
		if err != nil {
			Fatal(err)
		}
		if oldAbs != newAbs {
			spinner, _ := Spinner.Start("Migrating extracted folder")
			err := Copy(extractedPath, newExtractedPath, true, nil)
			if err != nil {
				spinner.Fail("Failed to migrate extracted folder")
				Fatal(err)
			}
			os.RemoveAll(extractedPath)
			spinner.Success("Migrated extracted folder")
		}
	}
}

func ReplaceEnvVarsInString(input string) string {
	return os.ExpandEnv(input)
}

func GetMeriotifyFolder() string {
	result, isAvailable := os.LookupEnv("MERIOTIFY_CONFIG")
	defer func() { CheckExistAndCreate(result) }()

	if isAvailable && len(result) > 0 {
		return result
	}

	if runtime.GOOS == "windows" {
		result = filepath.Join(os.Getenv("APPDATA"), "meriotify")
	} else if runtime.GOOS == "linux" {
		parent, ok := os.LookupEnv("XDG_CONFIG_HOME")
		if !ok || len(parent) == 0 {
			parent = filepath.Join(os.Getenv("HOME"), ".config")
			CheckExistAndCreate(parent)
		}
		result = filepath.Join(parent, "meriotify")
	} else if runtime.GOOS == "darwin" {
		parent := filepath.Join(os.Getenv("HOME"), ".config")
		CheckExistAndCreate(parent)
		result = filepath.Join(parent, "meriotify")
	}

	return result
}

func GetStateFolder(name string) string {
	result, isAvailable := os.LookupEnv("MERIOTIFY_STATE")
	defer func() { CheckExistAndCreate(result) }()

	if isAvailable && len(result) > 0 {
		return GetSubFolder(result, name)
	}

	if runtime.GOOS == "windows" {
		result = filepath.Join(os.Getenv("APPDATA"), "meriotify")
	} else if runtime.GOOS == "linux" {
		parent, ok := os.LookupEnv("XDG_STATE_HOME")
		if !ok || len(parent) == 0 {
			parent = filepath.Join(os.Getenv("HOME"), ".local", "state")
			CheckExistAndCreate(parent)
		}
		result = filepath.Join(parent, "meriotify")
	} else if runtime.GOOS == "darwin" {
		parent := filepath.Join(os.Getenv("HOME"), ".local", "state")
		CheckExistAndCreate(parent)
		result = filepath.Join(parent, "meriotify")
	}

	return GetSubFolder(result, name)
}

// GetSubFolder checks if folder `name` is available in specified folder,
// else creates then returns the path.
func GetSubFolder(folder string, name string) string {
	dir := filepath.Join(folder, name)
	CheckExistAndCreate(dir)

	return dir
}

var userAppsFolder = GetSubFolder(GetMeriotifyFolder(), "CustomApps")
var userExtensionsFolder = GetSubFolder(GetMeriotifyFolder(), "Extensions")

func GetCustomAppSubfolderPath(folderPath string) string {
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return ""
	}

	for _, entry := range entries {
		if entry.IsDir() {
			subfolderPath := filepath.Join(folderPath, entry.Name())
			indexPath := filepath.Join(subfolderPath, "index.js")

			if _, err := os.Stat(indexPath); err == nil {
				return subfolderPath
			}

			if subfolderPath := GetCustomAppSubfolderPath(subfolderPath); subfolderPath != "" {
				return subfolderPath
			}
		}
	}

	return ""
}

func GetCustomAppPath(name string) (string, error) {
	customAppFolderPath := filepath.Join(userAppsFolder, name)

	if _, err := os.Stat(customAppFolderPath); err == nil {
		customAppActualFolderPath := GetCustomAppSubfolderPath(customAppFolderPath)
		if customAppActualFolderPath != "" {
			return customAppActualFolderPath, nil
		}
		return customAppFolderPath, nil
	}

	customAppFolderPath = filepath.Join(GetExecutableDir(), "CustomApps", name)

	if _, err := os.Stat(customAppFolderPath); err == nil {
		customAppActualFolderPath := GetCustomAppSubfolderPath(customAppFolderPath)
		if customAppActualFolderPath != "" {
			return customAppActualFolderPath, nil
		}
		return customAppFolderPath, nil
	}

	return "", errors.New("custom app not found")
}

func GetExtensionPath(name string) (string, error) {
	extFilePath := filepath.Join(userExtensionsFolder, name)

	if _, err := os.Stat(extFilePath); err == nil {
		return extFilePath, nil
	}

	extFilePath = filepath.Join(GetExecutableDir(), "Extensions", name)

	if _, err := os.Stat(extFilePath); err == nil {
		return extFilePath, nil
	}

	return "", errors.New("extension not found")
}
