package cmd

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/1004ms/Meriotify/src/utils"
)

func Update(currentVersion string) bool {
	tagName, err := utils.FetchLatestTag()
	if err != nil {
		utils.PrintError(utils.Tr("Update check failed", "Controllo aggiornamenti non riuscito"))
		return false
	}
	if !isVersionNewer(tagName, currentVersion) {
		utils.PrintSuccess(utils.Tr("Already up to date", "Gia aggiornato"))
		return false
	}

	repository := utils.GetMeriotifyRepository()
	assetURL := "https://github.com/" + repository + "/releases/download/v" + tagName + "/meriotify-" + tagName + "-" + runtime.GOOS + "-"
	location := filepath.Join(os.TempDir(), "meriotify-"+tagName)

	if runtime.GOARCH == "386" && runtime.GOOS == "windows" {
		assetURL += "x32"
	} else if runtime.GOARCH == "arm64" {
		assetURL += "arm64"
	} else if runtime.GOOS == "windows" {
		assetURL += "x64"
	} else {
		assetURL += "amd64"
	}

	if runtime.GOOS == "windows" {
		assetURL += ".zip"
		location += ".zip"
	} else {
		assetURL += ".tar.gz"
		location += ".tar.gz"
	}

	spinner, _ := utils.Spinner.Start(utils.Tr("Updating Meriotify", "Aggiornamento Meriotify"))

	out, err := os.Create(location)
	if err != nil {
		spinner.Fail(utils.Tr("Update failed", "Aggiornamento non riuscito"))
		utils.Fatal(err)
	}

	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Get(assetURL)
	if err != nil {
		out.Close()
		spinner.Fail(utils.Tr("Update failed", "Aggiornamento non riuscito"))
		utils.Fatal(err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		out.Close()
		spinner.Fail(utils.Tr("Update failed", "Aggiornamento non riuscito"))
		utils.Fatal(fmt.Errorf("unexpected HTTP status: %s for %s", resp.Status, assetURL))
	}

	buffer := make([]byte, 256*1024)
	_, copyErr := io.CopyBuffer(out, resp.Body, buffer)
	closeBodyErr := resp.Body.Close()
	closeFileErr := out.Close()
	if copyErr != nil {
		spinner.Fail(utils.Tr("Update failed", "Aggiornamento non riuscito"))
		utils.Fatal(copyErr)
	}
	if closeBodyErr != nil || closeFileErr != nil {
		spinner.Fail(utils.Tr("Update failed", "Aggiornamento non riuscito"))
		if closeFileErr != nil {
			utils.Fatal(closeFileErr)
		}
		utils.Fatal(closeBodyErr)
	}
	spinner.Success(utils.Tr("Download complete", "Download completato"))

	exe, err := os.Executable()
	if err != nil {
		utils.Fatal(err)
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		utils.Fatal(err)
	}

	exeOld := exe + ".old"
	utils.CheckExistAndDelete(exeOld)

	if err = os.Rename(exe, exeOld); err != nil {
		permissionError(err)
	}

	switch runtime.GOOS {
	case "windows":
		err = utils.Unzip(location, utils.GetExecutableDir())
	case "linux", "darwin":
		err = exec.Command("tar", "-xzf", location, "-C", utils.GetExecutableDir()).Run()
	}
	if err != nil {
		os.Rename(exeOld, exe)
		permissionError(err)
	}

	utils.CheckExistAndDelete(location)
	utils.CheckExistAndDelete(exeOld)
	utils.PrintSuccess(utils.Tr("Updated to v", "Aggiornato a v") + tagName)
	return true
}

func permissionError(err error) {
	utils.PrintError(utils.Tr("Update failed: ", "Aggiornamento non riuscito: ") + err.Error())
	os.Exit(1)
}
