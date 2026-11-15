package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"github.com/everyonesoftware/tasks/services/server"
	"golang.org/x/term"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

type options struct {
	action, host, db, username, publicOrigin, tlsCert, tlsKey, webRoot, url, ca, connectAddress string
	port                                                                                        int
	allowedHosts                                                                                []string
	passwordStdin, allowInsecureHTTP                                                            bool
}

type hosts []string

func (h *hosts) String() string         { return strings.Join(*h, ",") }
func (h *hosts) Set(value string) error { *h = append(*h, value); return nil }

func parseArgs(args []string) (options, error) {
	cfg := options{action: "serve"}
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cfg.action, args = args[0], args[1:]
	}
	switch cfg.action {
	case "serve", "create-user", "reset-password", "adopt-legacy", "healthcheck":
	default:
		return cfg, errors.New("unknown action")
	}
	flags := flag.NewFlagSet("tasks", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&cfg.host, "host", "127.0.0.1", "Bind address")
	flags.IntVar(&cfg.port, "port", 8787, "TCP port (0 selects an ephemeral port)")
	flags.StringVar(&cfg.db, "db", ".data/daymark.sqlite3", "SQLite database")
	flags.StringVar(&cfg.username, "username", "", "Administrator account name")
	flags.BoolVar(&cfg.passwordStdin, "password-stdin", false, "Read exactly one password line from standard input")
	flags.BoolVar(&cfg.allowInsecureHTTP, "allow-insecure-http", false, "DEVELOPMENT ONLY: private encrypted tailnet HTTP")
	flags.StringVar(&cfg.publicOrigin, "public-origin", "", "Explicit HTTPS reverse proxy origin")
	flags.StringVar(&cfg.tlsCert, "tls-cert", "", "TLS certificate PEM")
	flags.StringVar(&cfg.tlsKey, "tls-key", "", "TLS private key PEM")
	flags.StringVar(&cfg.webRoot, "web-root", "apps/web", "Public web assets directory")
	flags.StringVar(&cfg.ca, "ca", "", "Healthcheck trusted certificate PEM")
	flags.StringVar(&cfg.connectAddress, "connect-address", "", "Healthcheck dial host:port override (preserves URL hostname for TLS verification)")
	flags.StringVar(&cfg.url, "url", "https://"+net.JoinHostPort(os.Getenv("TASKS_HOST"), "8787")+"/health", "Healthcheck URL")
	var allowed hosts
	flags.Var(&allowed, "allowed-host", "Additional trusted hostname (repeatable)")
	if err := flags.Parse(args); err != nil {
		return cfg, err
	}
	cfg.allowedHosts = allowed
	if flags.NArg() != 0 || cfg.port < 0 || cfg.port > 65535 {
		return cfg, errors.New("invalid arguments or port")
	}
	admin := cfg.action == "create-user" || cfg.action == "reset-password" || cfg.action == "adopt-legacy"
	if admin && cfg.username == "" {
		return cfg, errors.New("--username is required for account administration")
	}
	if !admin && (cfg.username != "" || cfg.passwordStdin) {
		return cfg, errors.New("account flags require an administrator action")
	}
	if cfg.action == "adopt-legacy" && cfg.passwordStdin {
		return cfg, errors.New("adopt-legacy does not take a password")
	}
	return cfg, nil
}

func readPassword(in io.Reader) (string, error) {
	body, err := io.ReadAll(io.LimitReader(in, 4098))
	if err != nil {
		return "", err
	}
	password := strings.TrimSuffix(string(body), "\n")
	if len(body) > 4097 || strings.Contains(password, "\n") || !utf8.ValidString(password) || utf8.RuneCountInString(password) < 8 || utf8.RuneCountInString(password) > 1024 {
		return "", errors.New("provide exactly one password line of 8..1024 characters")
	}
	return password, nil
}

func checkHealth(url, ca string, connectAddress ...string) error {
	transport := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	defer transport.CloseIdleConnections()
	if len(connectAddress) > 0 && connectAddress[0] != "" {
		dialer := &net.Dialer{}
		transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, connectAddress[0])
		}
	}
	if ca != "" {
		pem, err := os.ReadFile(ca)
		if err != nil {
			return errors.New("unable to read healthcheck CA")
		}
		roots, err := x509.SystemCertPool()
		if err != nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM(pem) {
			return errors.New("invalid healthcheck CA")
		}
		transport.TLSClientConfig.RootCAs = roots
	}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(url)
	if err != nil {
		return errors.New("healthcheck connection failed")
	}
	defer response.Body.Close()
	var body struct {
		Status string `json:"status"`
	}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&body) != nil || body.Status != "ok" {
		return errors.New("unhealthy server response")
	}
	return nil
}

func run(args []string, in io.Reader, out, stderr io.Writer) int {
	cfg, err := parseArgs(args)
	if errors.Is(err, flag.ErrHelp) {
		fmt.Fprintln(out, "Tasks private Go server\nUsage: tasks [serve|create-user|reset-password|adopt-legacy|healthcheck] [flags]\n--host --port --db --web-root --allowed-host --public-origin --tls-cert --tls-key\n--username --password-stdin --allow-insecure-http\nHealthcheck: --url --ca --connect-address")
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if cfg.action == "healthcheck" {
		if err := checkHealth(cfg.url, cfg.ca, cfg.connectAddress); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	if cfg.action == "serve" {
		return serve(cfg, out, stderr)
	}
	var password string
	if cfg.action != "adopt-legacy" {
		if cfg.passwordStdin {
			password, err = readPassword(in)
		} else {
			password, err = promptPassword(in, stderr)
		}
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	store, err := server.Open(cfg.db)
	if err != nil {
		fmt.Fprintln(stderr, "Unable to open Tasks database; check permissions.")
		return 1
	}
	defer store.Close()
	switch cfg.action {
	case "create-user":
		_, err = store.CreateUser(cfg.username, password)
	case "reset-password":
		err = store.ResetPassword(cfg.username, password)
	case "adopt-legacy":
		var count int64
		count, err = store.AdoptLegacy(cfg.username)
		if err == nil {
			fmt.Fprintf(out, "Adopted %d unassigned legacy tasks.\n", count)
			return 0
		}
	}
	if err != nil {
		var apiError *server.APIError
		if errors.As(err, &apiError) {
			fmt.Fprintln(stderr, apiError.Message)
		} else {
			fmt.Fprintln(stderr, "Account operation failed; check database permissions.")
		}
		return 1
	}
	if cfg.action == "create-user" {
		fmt.Fprintln(out, "User created.")
	} else {
		fmt.Fprintln(out, "Password reset; all account sessions revoked.")
	}
	return 0
}

func promptPassword(in io.Reader, out io.Writer) (string, error) {
	file, ok := in.(*os.File)
	if !ok || !term.IsTerminal(int(file.Fd())) {
		return "", errors.New("a terminal is required; use --password-stdin for automation")
	}
	fmt.Fprint(out, "Password: ")
	password, err := term.ReadPassword(int(file.Fd()))
	fmt.Fprintln(out)
	if err != nil {
		return "", errors.New("unable to read password")
	}
	fmt.Fprint(out, "Confirm password: ")
	confirm, err := term.ReadPassword(int(file.Fd()))
	fmt.Fprintln(out)
	if err != nil || string(password) != string(confirm) {
		return "", errors.New("passwords do not match")
	}
	return string(password), nil
}
