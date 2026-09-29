package utils

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/go-ini/ini"
)

// CheckExistAndCreate checks folder existence
// and makes that folder, recursively, if it does not exist
func CheckExistAndCreate(dir string) {
	if dir == "" {
		return
	}
	_ = os.MkdirAll(dir, 0700)
}

// CheckExistAndDelete deletes a path recursively. RemoveAll is already
// idempotent, so avoid an extra Stat syscall on the hot utility path.
func CheckExistAndDelete(dir string) {
	if dir == "" {
		return
	}
	_ = os.RemoveAll(dir)
}

// Unzip unzips zip while closing each file immediately instead of keeping
// every archive/file handle open until the whole archive is processed.
func Unzip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	cleanDest, err := filepath.Abs(dest)
	if err != nil {
		return err
	}

	for _, entry := range r.File {
		fpath := filepath.Join(dest, entry.Name)
		cleanPath, err := filepath.Abs(fpath)
		if err != nil {
			return err
		}
		if cleanPath != cleanDest && !strings.HasPrefix(cleanPath, cleanDest+string(os.PathSeparator)) {
			return fmt.Errorf("invalid archive path: %s", entry.Name)
		}

		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(cleanPath, 0700); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(cleanPath), 0700); err != nil {
			return err
		}

		rc, err := entry.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(cleanPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0700)
		if err != nil {
			rc.Close()
			return err
		}

		_, copyErr := io.Copy(out, rc)
		closeOutErr := out.Close()
		closeInErr := rc.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeOutErr != nil {
			return closeOutErr
		}
		if closeInErr != nil {
			return closeInErr
		}
	}
	return nil
}

// Copy recursively copies files without accumulating open file descriptors.
func Copy(src, dest string, recursive bool, filters []string) error {
	dir, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dest, 0700); err != nil {
		return err
	}

	for _, file := range dir {
		fileName := file.Name()
		fSrcPath := filepath.Join(src, fileName)
		fDestPath := filepath.Join(dest, fileName)

		if file.IsDir() {
			if recursive {
				if err := Copy(fSrcPath, fDestPath, true, filters); err != nil {
					return err
				}
			}
			continue
		}

		if len(filters) > 0 {
			isMatch := false
			for _, filter := range filters {
				if strings.Contains(fileName, filter) {
					isMatch = true
					break
				}
			}
			if !isMatch {
				continue
			}
		}

		if err := copyFilePath(fSrcPath, fDestPath); err != nil {
			return err
		}
	}
	return nil
}

func copyFilePath(srcPath, destPath string) error {
	fSrc, err := os.Open(srcPath)
	if err != nil {
		return err
	}

	fDest, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0700)
	if err != nil {
		fSrc.Close()
		return err
	}

	_, copyErr := io.Copy(fDest, fSrc)
	closeDestErr := fDest.Close()
	closeSrcErr := fSrc.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeDestErr != nil {
		return closeDestErr
	}
	return closeSrcErr
}

// CopyFile .
func CopyFile(srcPath, dest string) error {
	if err := os.MkdirAll(dest, 0700); err != nil {
		return err
	}
	return copyFilePath(srcPath, filepath.Join(dest, filepath.Base(srcPath)))
}

// Replace uses Regexp to find any matched from `input` with `regexpTerm`
// and replaces them with `replaceTerm` then returns new string.
func Replace(str *string, pattern string, repl func(submatches ...string) string) {
	re := regexp.MustCompile(pattern)
	*str = re.ReplaceAllStringFunc(*str, func(match string) string {
		submatches := re.FindStringSubmatch(match)
		return repl(submatches...)
	})
}

func ReplaceOnce(str *string, pattern string, repl func(submatches ...string) string) {
	re := regexp.MustCompile(pattern)
	firstMatch := true
	*str = re.ReplaceAllStringFunc(*str, func(match string) string {
		if firstMatch {
			firstMatch = false
			submatches := re.FindStringSubmatch(match)
			if submatches != nil {
				return repl(submatches...)
			}
		}
		return match
	})
}

func ReplaceOnceWithPriority(str *string, patterns []string, repl func(index int, submatches ...string) string) {
	for i, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		firstMatch := true
		*str = re.ReplaceAllStringFunc(*str, func(match string) string {
			if firstMatch {
				firstMatch = false
				submatches := re.FindStringSubmatch(match)
				if submatches != nil {
					return repl(i, submatches...)
				}
			}
			return match
		})
		if !firstMatch {
			break
		}
	}
}

func FindMatch(input string, regexpTerm string) [][]string {
	re := regexp.MustCompile(regexpTerm)
	matches := re.FindAllStringSubmatch(input, -1)
	return matches
}

func FindFirstMatch(input string, regexpTerm string) []string {
	matches := FindMatch(input, regexpTerm)
	if len(matches) > 0 {
		return matches[0]
	}
	return nil
}

func FindLastMatch(input string, regexpTerm string) []string {
	matches := FindMatch(input, regexpTerm)
	if len(matches) > 0 {
		return matches[len(matches)-1]
	}
	return nil
}

// ModifyFile opens file, changes file content by executing
// `repl` callback function and writes new content.
func ModifyFile(path string, repl func(string) string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		log.Print(err)
		return
	}

	content := repl(string(raw))

	if err := os.WriteFile(path, []byte(content), 0700); err != nil {
		log.Print(err)
	}
}

// CreateFile creates a file with given path and content.
func CreateFile(path string, content string) error {
	err := os.WriteFile(path, []byte(content), 0600)
	if err != nil {
		return err
	}
	return nil
}

// GetSpotifyVersion .
func GetSpotifyVersion(prefsPath string) string {
	pref, err := ini.Load(prefsPath)
	if err != nil {
		log.Fatal(err)
	}

	rootSection, err := pref.GetSection("")
	if err != nil {
		log.Fatal(err)
	}

	version := rootSection.Key("app.last-launched-version")
	return version.MustString("")
}

// GetExecutableDir returns directory of current process
func GetExecutableDir() string {
	exe, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}

	exeDir := filepath.Dir(exe)

	if link, err := filepath.EvalSymlinks(exe); err == nil {
		return filepath.Dir(link)
	}

	return exeDir
}

// GetJsHelperDir returns jsHelper directory in executable directory
func GetJsHelperDir() string {
	return filepath.Join(GetExecutableDir(), "jsHelper")
}

// PrependTime prepends current time string to text and returns new string
func PrependTime(text string) string {
	date := time.Now()
	return fmt.Sprintf("%02d:%02d:%02d ", date.Hour(), date.Minute(), date.Second()) + text
}

// FindSymbol uses regexp from one or multiple clues to find variable or
// function symbol in obfuscated code.
func FindSymbol(debugInfo, content string, clues []string) []string {
	for _, v := range clues {
		re := regexp.MustCompile(v)
		found := re.FindStringSubmatch(content)
		if found != nil {
			return found[1:]
		}
	}

	if len(debugInfo) > 0 {
		PrintError("Cannot find symbol for " + debugInfo)
	}

	return nil
}

// FindSymbolWithPattern uses regexp from one or multiple clues to find variable or
// function symbol in obfuscated code. Returns the matched symbols and the pattern that matched.
func FindSymbolWithPattern(debugInfo, content string, clues []string) ([]string, string) {
	for _, v := range clues {
		re := regexp.MustCompile(v)
		found := re.FindStringSubmatch(content)
		if found != nil {
			return found[1:], v
		}
	}

	if len(debugInfo) > 0 {
		PrintError("Cannot find symbol for " + debugInfo)
	}

	return nil, ""
}

// CreateJunction creates a junction in Windows or a symlink in Linux/Mac.
func CreateJunction(location, destination string) error {
	CheckExistAndDelete(destination)
	switch runtime.GOOS {
	case "windows":
		exec.Command("cmd", "/C", "rmdir", destination).Run()
		return exec.Command("cmd", "/C", "mklink", "/J", destination, location).Run()
	case "linux", "darwin":
		return exec.Command("ln", "-Fsf", location, destination).Run()
	}

	return nil
}

func SeekToCloseParen(content string, regexpTerm string, leftChar, rightChar byte) string {
	loc := regexp.MustCompile(regexpTerm).FindStringIndex(content)
	if len(loc) > 0 {
		start := loc[0]
		end := start
		count := 0
		init := false

		for {
			switch content[end] {
			case leftChar:
				count += 1
				init = true
			case rightChar:
				count -= 1
			}
			end += 1
			if count == 0 && init {
				break
			}
		}
		return content[start:end]
	}
	return ""
}

type AppManifest struct {
	Files          []string `json:"subfiles"`
	ExtensionFiles []string `json:"subfiles_extension"`
	Assets         []string `json:"assets"`
}

func GetAppManifest(app string) (AppManifest, string, error) {
	customAppPath, err := GetCustomAppPath(app)
	if err != nil {
		PrintError(`Custom app "` + app + `" not found.`)
		return AppManifest{}, customAppPath, err
	}
	manifestFileContent, err := os.ReadFile(filepath.Join(customAppPath, "manifest.json"))
	if err != nil {
		manifestFileContent = []byte{'{', '}'}
	}
	var manifestJson AppManifest
	if err = json.Unmarshal(manifestFileContent, &manifestJson); err == nil {
		return manifestJson, customAppPath, err
	}
	return manifestJson, customAppPath, err
}
