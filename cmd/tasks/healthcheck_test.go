package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func healthcheckCertificate(t *testing.T, hostname string) (tls.Certificate, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: hostname},
		DNSNames: []string{hostname}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPath := filepath.Join(t.TempDir(), "cert.pem")
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, certPath
}

func TestHealthcheckConnectAddressPreservesTLSHostname(t *testing.T) {
	const hostname = "daymark-healthcheck.invalid"
	certificate, ca := healthcheckCertificate(t, hostname)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS.ServerName != hostname || r.Host != hostname+":8787" || r.URL.Path != "/health" {
			t.Errorf("request SNI=%q Host=%q path=%q", r.TLS.ServerName, r.Host, r.URL.Path)
		}
		w.Write([]byte(`{"status":"ok"}`))
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12}
	srv.StartTLS()
	defer srv.Close()
	t.Setenv("DAYMARK_HOST", "legacy.invalid")
	t.Setenv("TASKS_HOST", hostname)
	t.Setenv("DAYMARK_PORT", "9443")
	var out, stderr bytes.Buffer
	code := run([]string{"healthcheck", "--ca", ca, "--connect-address", srv.Listener.Addr().String()}, strings.NewReader(""), &out, &stderr)
	if code != 0 {
		t.Fatalf("healthcheck exit=%d: %s", code, stderr.String())
	}
}

func TestHealthcheckConnectAddressVerifiesCAAndURLHostname(t *testing.T) {
	const hostname = "daymark-healthcheck.invalid"
	certificate, ca := healthcheckCertificate(t, hostname)
	_, wrongCA := healthcheckCertificate(t, hostname)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS.ServerName != hostname || r.Host != hostname+":9443" {
			t.Errorf("explicit URL lost: SNI=%q Host=%q", r.TLS.ServerName, r.Host)
		}
		w.Write([]byte(`{"status":"ok"}`))
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12}
	srv.StartTLS()
	defer srv.Close()
	t.Setenv("TASKS_HOST", "unused.invalid")
	for _, tc := range []struct {
		name, hostname, ca string
		override           bool
		wantExit           int
	}{
		{"explicit URL", hostname, ca, true, 0},
		{"wrong CA", hostname, wrongCA, true, 1},
		{"wrong hostname", "wrong-healthcheck.invalid", ca, true, 1},
		{"no override uses URL DNS", hostname, ca, false, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			args := []string{"healthcheck", "--url", "https://" + tc.hostname + ":9443/health", "--ca", tc.ca}
			if tc.override {
				args = append(args, "--connect-address", srv.Listener.Addr().String())
			}
			var out, stderr bytes.Buffer
			if code := run(args, strings.NewReader(""), &out, &stderr); code != tc.wantExit {
				t.Fatalf("healthcheck exit=%d want=%d: %s", code, tc.wantExit, stderr.String())
			}
		})
	}
}
