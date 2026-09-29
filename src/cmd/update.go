package cmd

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/1004ms/Meriotify/src/utils"
)

const (
	releaseAssetWaitAttempts = 12
	releaseAssetWaitDelay    = 10 * time.Second
	downloadAttempts         = 6
	downloadRetryDelay       = 3 * time.Second
)

func Update(currentVersion string) bool {
	release, err := utils.FetchLatestRelease()
	if err != nil {
		utils.PrintError(utils.Tr("Update check failed", "Controllo aggiornamenti non riuscito"))
		return false
	}

	tagName := strings.TrimPrefix(release.TagName, "v")
	if !isVersionNewer(tagName, currentVersion) {
		utils.PrintSuccess(utils.Tr("Already up to date", "Gia aggiornato"))
		return false
	}

	assetName, archiveExtension := updateAssetName(tagName)
	location := filepath.Join(os.TempDir(), "meriotify-"+tagName+archiveExtension)
	utils.CheckExistAndDelete(location)

	spinner, _ := utils.Spinner.Start(utils.Tr("Updating Meriotify", "Aggiornamento Meriotify"))

	assetURL := utils.FindReleaseAssetURL(release, assetName)
	if assetURL == "" {
		assetURL, err = waitForReleaseAsset(tagName, assetName)
		if err != nil {
			spinner.Fail(utils.Tr("Update files are not ready yet", "I file dell'aggiornamento non sono ancora pronti"))
			utils.PrintError(err.Error())
			return false
		}
	}

	client := &http.Client{Timeout: 2 * time.Minute}
	if err = downloadUpdateAsset(client, assetURL, location); err != nil {
		utils.CheckExistAndDelete(location)
		spinner.Fail(utils.Tr("Update failed", "Aggiornamento non riuscito"))
		utils.PrintError(err.Error())
		return false
	}
	spinner.Success(utils.Tr("Download complete", "Download completato"))

	exe, err := os.Executable()
	if err != nil {
		utils.CheckExistAndDelete(location)
		utils.Fatal(err)
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		utils.CheckExistAndDelete(location)
		utils.Fatal(err)
	}

	exeOld := exe + ".old"
	utils.CheckExistAndDelete(exeOld)

	if err = os.Rename(exe, exeOld); err != nil {
		utils.CheckExistAndDelete(location)
		permissionError(err)
	}

	switch runtime.GOOS {
	case "windows":
		err = utils.Unzip(location, utils.GetExecutableDir())
	case "linux", "darwin":
		err = exec.Command("tar", "-xzf", location, "-C", utils.GetExecutableDir()).Run()
	default:
		err = fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
	if err != nil {
		_ = os.Rename(exeOld, exe)
		utils.CheckExistAndDelete(location)
		permissionError(err)
	}

	utils.CheckExistAndDelete(location)
	utils.CheckExistAndDelete(exeOld)
	utils.PrintSuccess(utils.Tr("Updated to v", "Aggiornato a v") + tagName)
	return true
}

func updateAssetName(tagName string) (string, string) {
	platform := runtime.GOOS + "-"

	if runtime.GOARCH == "386" && runtime.GOOS == "windows" {
		platform += "x32"
	} else if runtime.GOARCH == "arm64" {
		platform += "arm64"
	} else if runtime.GOOS == "windows" {
		platform += "x64"
	} else {
		platform += "amd64"
	}

	extension := ".tar.gz"
	if runtime.GOOS == "windows" {
		extension = ".zip"
	}

	return "meriotify-" + tagName + "-" + platform + extension, extension
}

func waitForReleaseAsset(tagName, assetName string) (string, error) {
	var lastErr error

	for attempt := 0; attempt < releaseAssetWaitAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(releaseAssetWaitDelay)
		}

		release, err := utils.FetchReleaseByTag(tagName)
		if err != nil {
			lastErr = err
			continue
		}

		if assetURL := utils.FindReleaseAssetURL(release, assetName); assetURL != "" {
			return assetURL, nil
		}
	}

	if lastErr != nil {
		return "", fmt.Errorf("%s: %w", utils.Tr("release asset lookup failed", "ricerca del file della release non riuscita"), lastErr)
	}

	return "", fmt.Errorf("%s: %s", utils.Tr("release asset is still being published", "il file della release e ancora in pubblicazione"), assetName)
}

func downloadUpdateAsset(client *http.Client, assetURL, location string) error {
	var lastStatus string
	var lastErr error

	for attempt := 0; attempt < downloadAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(downloadRetryDelay)
		}

		resp, err := client.Get(assetURL)
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode != http.StatusOK {
			lastStatus = resp.Status
			resp.Body.Close()
			if isRetryableDownloadStatus(resp.StatusCode) {
				continue
			}
			return fmt.Errorf("unexpected HTTP status: %s for %s", resp.Status, assetURL)
		}

		out, err := os.Create(location)
		if err != nil {
			resp.Body.Close()
			return err
		}

		buffer := make([]byte, 256*1024)
		_, copyErr := io.CopyBuffer(out, resp.Body, buffer)
		closeBodyErr := resp.Body.Close()
		closeFileErr := out.Close()

		if copyErr != nil {
			utils.CheckExistAndDelete(location)
			lastErr = copyErr
			continue
		}
		if closeBodyErr != nil {
			utils.CheckExistAndDelete(location)
			lastErr = closeBodyErr
			continue
		}
		if closeFileErr != nil {
			utils.CheckExistAndDelete(location)
			lastErr = closeFileErr
			continue
		}

		return nil
	}

	if lastErr != nil {
		return lastErr
	}
	if lastStatus != "" {
		return fmt.Errorf("unexpected HTTP status after retries: %s for %s", lastStatus, assetURL)
	}
	return fmt.Errorf("download failed for %s", assetURL)
}

func isRetryableDownloadStatus(statusCode int) bool {
	switch statusCode {
	case http.StatusNotFound,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func permissionError(err error) {
	utils.PrintError(utils.Tr("Update failed: ", "Aggiornamento non riuscito: ") + err.Error())
	os.Exit(1)
}
