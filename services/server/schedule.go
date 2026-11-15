package server

import "time"

// noDate deliberately lies outside Python's date range. Go's zero time is the
// valid calendar date 0001-01-01 and cannot represent a missing occurrence.
var noDate = time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC)

// around uses year-zero dates for missing occurrences. Calendar arithmetic retains the
// original day anchor, not the previously clamped month's day.
func around(start time.Time, repeat string, interval int, on time.Time) (time.Time, time.Time) {
	if on.Before(start) {
		return noDate, start
	}
	if repeat == "once" {
		return start, noDate
	}
	if repeat == "monthly" || repeat == "yearly" {
		months := interval
		if repeat == "yearly" {
			months *= 12
		}
		distance := (on.Year()-start.Year())*12 + int(on.Month()) - int(start.Month())
		n := distance / months
		occurrence := func(index int) time.Time {
			absolute := start.Year()*12 + int(start.Month()) - 1 + index*months
			y, m := absolute/12, absolute%12+1
			if y > 9999 {
				return noDate
			}
			day := start.Day()
			last := time.Date(y, time.Month(m)+1, 0, 0, 0, 0, 0, time.UTC).Day()
			if day > last {
				day = last
			}
			return time.Date(y, time.Month(m), day, 0, 0, 0, 0, time.UTC)
		}
		latest := occurrence(n)
		if latest.After(on) {
			n--
			latest = occurrence(n)
		}
		return latest, occurrence(n + 1)
	}
	days := interval
	if repeat == "weekly" {
		days *= 7
	}
	// Sub overflows its Duration at 292 years; Unix seconds cover all 9999 years.
	distance := (on.Unix() - start.Unix()) / 86400
	n := distance / int64(days)
	latest := start.AddDate(0, 0, int(n)*days)
	next := latest.AddDate(0, 0, days)
	if next.Year() > 9999 {
		next = noDate
	}
	return latest, next
}
