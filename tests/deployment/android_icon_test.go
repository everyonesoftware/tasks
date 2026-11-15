package deployment

import (
	"encoding/xml"
	"strings"
	"testing"
)

func TestAndroidLauncherUsesAdaptiveRoundIcon(t *testing.T) {

	var manifest struct {
		Application struct {
			Icon      string `xml:"http://schemas.android.com/apk/res/android icon,attr"`
			RoundIcon string `xml:"http://schemas.android.com/apk/res/android roundIcon,attr"`
		} `xml:"application"`
	}
	if err := xml.Unmarshal([]byte(rootFile(t, "apps/android/app/src/main/AndroidManifest.xml")), &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Application.Icon != "@mipmap/ic_tasks" || manifest.Application.RoundIcon != "@mipmap/ic_tasks" {
		t.Fatalf("launcher must use adaptive Tasks artwork for normal and round icons, got %q / %q", manifest.Application.Icon, manifest.Application.RoundIcon)
	}
	var adaptive struct {
		XMLName    xml.Name
		Background struct {
			Drawable string `xml:"http://schemas.android.com/apk/res/android drawable,attr"`
		} `xml:"background"`
		Foreground struct {
			Drawable string `xml:"http://schemas.android.com/apk/res/android drawable,attr"`
		} `xml:"foreground"`
	}
	if err := xml.Unmarshal([]byte(rootFile(t, "apps/android/app/src/main/res/mipmap-anydpi-v26/ic_tasks.xml")), &adaptive); err != nil {
		t.Fatal(err)
	}
	if adaptive.XMLName.Local != "adaptive-icon" || adaptive.Background.Drawable != "@color/ic_tasks_background" || adaptive.Foreground.Drawable != "@drawable/ic_tasks_foreground" {
		t.Fatalf("launcher must mask separate background/foreground layers, got %+v", adaptive)
	}
	foreground := rootFile(t, "apps/android/app/src/main/res/drawable/ic_tasks_foreground.xml")
	var vector struct {
		Width  string `xml:"http://schemas.android.com/apk/res/android width,attr"`
		Height string `xml:"http://schemas.android.com/apk/res/android height,attr"`
		Paths  []struct {
			Fill string `xml:"http://schemas.android.com/apk/res/android fillColor,attr"`
		} `xml:"path"`
	}
	if err := xml.Unmarshal([]byte(foreground), &vector); err != nil {
		t.Fatal(err)
	}
	if vector.Width != "108dp" || vector.Height != "108dp" || len(vector.Paths) != 2 {
		t.Fatalf("adaptive foreground must contain only the two Tasks symbol paths on a 108dp canvas: %+v", vector)
	}
	for _, path := range vector.Paths {
		if path.Fill != "#BEDFC7" {
			t.Errorf("foreground must not bake in a square background: %q", path.Fill)
		}
	}
	colors := rootFile(t, "apps/android/app/src/main/res/values/icon_colors.xml")
	if !strings.Contains(colors, `<color name="ic_tasks_background">#202B30</color>`) {
		t.Error("adaptive background must retain Tasks slate branding")
	}

}
