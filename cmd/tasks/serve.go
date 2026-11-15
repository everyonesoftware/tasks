package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/everyonesoftware/tasks/services/server"
)

func serve(cfg options, out, stderr io.Writer) int {
	fail := func() int {
		fmt.Fprintln(stderr, "Unable to start Tasks; check transport settings, web root, bind address, port and database permissions.")
		return 1
	}
	config := server.Config{Host: cfg.host, Port: cfg.port, DB: cfg.db, WebRoot: cfg.webRoot, AllowedHosts: cfg.allowedHosts, PublicOrigin: cfg.publicOrigin, AllowInsecureHTTP: cfg.allowInsecureHTTP, TLSCert: cfg.tlsCert, TLSKey: cfg.tlsKey}
	if server.ValidateConfig(config) != nil {
		return fail()
	}
	store, err := server.Open(cfg.db)
	if err != nil {
		return fail()
	}
	defer store.Close()
	handler, err := server.NewHandler(store, config)
	if err != nil {
		return fail()
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(cfg.host, strconv.Itoa(cfg.port)))
	if err != nil {
		return fail()
	}
	defer listener.Close()
	scheme := "http"
	if cfg.tlsCert != "" {
		cert, err := tls.LoadX509KeyPair(cfg.tlsCert, cfg.tlsKey)
		if err != nil {
			return fail()
		}
		listener = tls.NewListener(listener, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12})
		scheme = "https"
	}
	httpServer := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32768, ErrorLog: log.New(io.Discard, "", 0)}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if httpServer.Shutdown(shutdownCtx) != nil {
			httpServer.Close()
		}
	}()
	fmt.Fprintf(out, "Tasks listening on %s://%s\n", scheme, listener.Addr().String())
	if cfg.allowInsecureHTTP {
		fmt.Fprintln(out, "WARNING: insecure HTTP development enabled; private encrypted tailnet only, never public Internet.")
	}
	err = httpServer.Serve(listener)
	stop()
	<-shutdownDone
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fail()
	}
	return 0
}

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }
