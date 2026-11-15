package main

import (
	"bufio"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestCLIRealTLSLoginAndHealthcheck(t *testing.T) {
	root := t.TempDir()
	db := filepath.Join(root, "tls.sqlite3")
	var out, stderr bytes.Buffer
	if run([]string{"create-user", "--db", db, "--username", "TLSFixture", "--password-stdin"}, strings.NewReader("tls-fixture-password\n"), &out, &stderr) != 0 {
		t.Fatal(stderr.String())
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certPath, keyPath := filepath.Join(root, "cert.pem"), filepath.Join(root, "key.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(certPath, certPEM, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestServerSubprocess$", "--", "serve", "--port", "0", "--db", db, "--web-root", "../../apps/web", "--tls-cert", certPath, "--tls-key", keyPath)
	cmd.Env = append(os.Environ(), "DAYMARK_TEST_PROCESS=1")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var processErrors bytes.Buffer
	cmd.Stderr = &processErrors
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() { cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(8 * time.Second):
			cmd.Process.Kill()
			<-done
		}
	}()
	lines := make(chan string, 1)
	go func() {
		scan := bufio.NewScanner(stdout)
		if scan.Scan() {
			lines <- scan.Text()
		} else {
			lines <- ""
		}
	}()
	var line string
	select {
	case line = <-lines:
	case <-time.After(10 * time.Second):
		t.Fatal("TLS startup timeout")
	}
	origin := regexp.MustCompile(`https://127\.0\.0\.1:[0-9]+`).FindString(line)
	if origin == "" {
		t.Fatalf("bad startup: %s %s", line, processErrors.String())
	}
	if err := checkHealth(origin+"/health", certPath); err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(certPEM)
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	req, err := http.NewRequest("POST", origin+"/api/auth/login", strings.NewReader(`{"username":"TLSFixture","password":"tls-fixture-password"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var login map[string]any
	json.NewDecoder(response.Body).Decode(&login)
	response.Body.Close()
	if response.StatusCode != 200 || login["username"] != "TLSFixture" {
		t.Fatalf("TLS login status=%d", response.StatusCode)
	}
	if !strings.Contains(response.Header.Get("Set-Cookie"), "; Secure") {
		t.Fatal("TLS cookie is not secure")
	}
	// A peer that never completes TLS must not block the accept loop.
	address := strings.TrimPrefix(origin, "https://")
	stalled, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer stalled.Close()
	if err := checkHealth(origin+"/health", certPath); err != nil {
		t.Fatal(err)
	}
}
