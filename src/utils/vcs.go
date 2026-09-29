package utils

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultMeriotifyRepository = "1004ms/Meriotify"

var githubClient = &http.Client{Timeout: 8 * time.Second}

type GithubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type GithubRelease struct {
	TagName string               `json:"tag_name"`
	Message string               `json:"message"`
	Assets  []GithubReleaseAsset `json:"assets"`
}

// GetMeriotifyRepository returns the GitHub repository used for updates.
// Set MERIOTIFY_REPOSITORY (for example "yourname/meriotify") for private forks
// or before the public Meriotify repository is published.
func GetMeriotifyRepository() string {
	if repo := strings.TrimSpace(os.Getenv("MERIOTIFY_REPOSITORY")); repo != "" {
		return repo
	}
	return defaultMeriotifyRepository
}

func fetchGithubRelease(url string) (GithubRelease, error) {
	res, err := githubClient.Get(url)
	if err != nil {
		return GithubRelease{}, err
	}
	defer res.Body.Close()

	var release GithubRelease
	if err = json.NewDecoder(res.Body).Decode(&release); err != nil {
		return GithubRelease{}, err
	}

	if res.StatusCode != http.StatusOK {
		if release.Message != "" {
			return GithubRelease{}, errors.New("GitHub response: " + release.Message)
		}
		return GithubRelease{}, errors.New("GitHub returned " + res.Status)
	}

	if strings.TrimSpace(release.TagName) == "" {
		return GithubRelease{}, errors.New("GitHub release has no tag")
	}

	return release, nil
}

func FetchLatestRelease() (GithubRelease, error) {
	url := "https://api.github.com/repos/" + GetMeriotifyRepository() + "/releases/latest"
	return fetchGithubRelease(url)
}

func FetchReleaseByTag(tagName string) (GithubRelease, error) {
	tagName = strings.TrimSpace(tagName)
	if !strings.HasPrefix(tagName, "v") {
		tagName = "v" + tagName
	}
	url := "https://api.github.com/repos/" + GetMeriotifyRepository() + "/releases/tags/" + tagName
	return fetchGithubRelease(url)
}

func FindReleaseAssetURL(release GithubRelease, assetName string) string {
	for _, asset := range release.Assets {
		if asset.Name == assetName && strings.TrimSpace(asset.BrowserDownloadURL) != "" {
			return asset.BrowserDownloadURL
		}
	}
	return ""
}

func FetchLatestTag() (string, error) {
	release, err := FetchLatestRelease()
	if err != nil {
		return "", err
	}
	return strings.TrimPrefix(release.TagName, "v"), nil
}
