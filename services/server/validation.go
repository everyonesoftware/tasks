package server

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type APIError struct {
	Message string
	Status  int
}

func (e *APIError) Error() string { return e.Message }
func apiError(message string, status ...int) error {
	code := 400
	if len(status) > 0 {
		code = status[0]
	}
	return &APIError{message, code}
}

var datePattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)
var integerPattern = regexp.MustCompile(`^-?(0|[1-9][0-9]*)$`)

func isoDate(value any, field string) (time.Time, error) {
	s, ok := value.(string)
	if !ok || !datePattern.MatchString(s) {
		return time.Time{}, apiError(field + " must be a YYYY-MM-DD date")
	}
	d, err := time.Parse("2006-01-02", s)
	if err != nil || d.Year() < 1 {
		return time.Time{}, apiError(field + " must be a valid calendar date")
	}
	return d, nil
}
func taskFields(data map[string]any) (map[string]any, error) {
	if data == nil {
		return nil, apiError("Expected a JSON object")
	}
	allowed := map[string]bool{"title": true, "notes": true, "category": true, "repeat": true, "interval": true, "startDate": true, "priority": true}
	for k := range data {
		if !allowed[k] {
			return nil, apiError("Unknown task field")
		}
	}
	result := map[string]any{}
	for _, f := range []struct {
		name     string
		max      int
		fallback any
	}{{"title", 200, nil}, {"notes", 2000, ""}, {"category", 60, "Personal"}} {
		value, ok := data[f.name]
		if !ok {
			value = f.fallback
		}
		s, ok := value.(string)
		if f.name == "title" {
			s = strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f) })
		}
		valid := ok && utf8.ValidString(s) && utf8.RuneCountInString(s) <= f.max
		for _, r := range s {
			if r < 32 && r != '\n' && r != '\r' && r != '\t' {
				valid = false
			}
		}
		if !valid {
			return nil, apiError(fmt.Sprintf("%s must be text of at most %d characters", f.name, f.max))
		}
		result[f.name] = s
	}
	if result["title"] == "" {
		return nil, apiError("title must not be empty")
	}
	repeat, exists := data["repeat"]
	if !exists {
		repeat = "once"
	}
	switch repeat {
	case "once", "daily", "weekly", "monthly", "yearly":
	default:
		return nil, apiError("Invalid repeat")
	}
	result["repeat"] = repeat
	for _, f := range []struct {
		name                string
		fallback, low, high int
	}{{"interval", 1, 1, 365}, {"priority", 0, 0, 2}} {
		value, ok := data[f.name]
		if !ok {
			value = f.fallback
		}
		n, valid := value.(int)
		if j, ok := value.(json.Number); ok && integerPattern.MatchString(string(j)) {
			i, err := strconv.Atoi(string(j))
			n = i
			valid = err == nil
		}
		if !valid || n < f.low || n > f.high {
			return nil, apiError(fmt.Sprintf("%s must be an integer from %d to %d", f.name, f.low, f.high))
		}
		result[f.name] = n
	}
	date, err := isoDate(data["startDate"], "startDate")
	if err != nil {
		return nil, err
	}
	result["startDate"] = date.Format("2006-01-02")
	return result, nil
}
