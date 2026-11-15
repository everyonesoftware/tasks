package server

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTaskValidation(t *testing.T) {
	got, err := taskFields(map[string]any{"title": "  Buy milk  ", "startDate": "2026-11-14"})
	if err != nil || got["title"] != "Buy milk" || got["interval"] != 1 || got["category"] != "Personal" {
		t.Fatalf("defaults: %v %v", got, err)
	}
	for _, value := range []any{true, 1.0, json.Number("1.0"), json.Number("1e0"), json.Number("+1"), json.Number("01"), 0, 366, nil} {
		_, err = taskFields(map[string]any{"title": "ok", "startDate": "2026-11-14", "interval": value})
		if err == nil {
			t.Errorf("accepted interval %#v", value)
		}
	}
	for _, value := range []any{1, json.Number("2")} {
		if _, err = taskFields(map[string]any{"title": "ok", "startDate": "2026-11-14", "interval": value}); err != nil {
			t.Error(err)
		}
	}
	for _, fields := range []map[string]any{nil, {"title": ""}, {"title": " \t "}, {"notes": nil}, {"title": "x\x00"}, {"title": strings.Repeat("x", 201)}, {"category": strings.Repeat("x", 61)}, {"repeat": "bad"}, {"unknown": 1}, {"notes": string([]byte{0xed, 0xa0, 0x80})}} {
		data := map[string]any{"title": "ok", "startDate": "2026-11-14"}
		if fields == nil {
			data = nil
		} else {
			for k, v := range fields {
				data[k] = v
			}
		}
		if _, err = taskFields(data); err == nil {
			t.Errorf("accepted %v", fields)
		}
	}
	if _, err = taskFields(map[string]any{"title": " " + strings.Repeat("😀", 200) + " ", "startDate": "0001-01-01"}); err != nil {
		t.Error(err)
	}
	for _, date := range []string{"2026-02-29", "2026-1-01", "0000-01-01", "10000-01-01", "20261114"} {
		if _, err = isoDate(date, "date"); err == nil {
			t.Errorf("accepted %s", date)
		}
	}
}
