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

type GithubRelease struct {
	TagName string `json:"tag_name"`
	Message string `json:"message"`
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

func FetchLatestTag() (string, error) {
	url := "https://api.github.com/repos/" + GetMeriotifyRepository() + "/releases/latest"
	res, err := githubClient.Get(url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	var release GithubRelease
	if err = json.NewDecoder(res.Body).Decode(&release); err != nil {
		return "", err
	}

	if res.StatusCode != http.StatusOK {
		if release.Message != "" {
			return "", errors.New("GitHub response: " + release.Message)
		}
		return "", errors.New("GitHub returned " + res.Status)
	}

	if release.TagName == "" {
		return "", errors.New("GitHub response: " + release.Message)
	}

	return strings.TrimPrefix(release.TagName, "v"), nil
}
