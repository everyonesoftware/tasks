// Disposable real API fixture. Never accepts a database path or live credentials.
package main

import (
    "bufio"
    "fmt"
    "net/http/httptest"
    "os"
    "path/filepath"
    server "github.com/everyonesoftware/tasks/services/server"
)

func run() error {
    dir, err := os.MkdirTemp("", "tasks-windows-api-")
    if err != nil { return err }; defer os.RemoveAll(dir)
    store, err := server.Open(filepath.Join(dir, "fixture.db"))
    if err != nil { return err }; defer store.Close()
    if _, err = store.CreateUser("windows-fixture", "fixture-password-only"); err != nil { return err }
    if _, err = store.CreateUser("other-fixture", "fixture-password-only"); err != nil { return err }
    handler, err := server.NewHandler(store, server.Config{Host: "127.0.0.1", Port: 8787, WebRoot: dir})
    if err != nil { return err }
    api := httptest.NewServer(handler); defer api.Close()
    fmt.Println(api.URL)
    // Parent closes stdin; all sessions, tasks, and the disposable database are removed.
    bufio.NewReader(os.Stdin).ReadString('\n')
    return nil
}
func main() { if err := run(); err != nil { fmt.Fprintln(os.Stderr, "fixture startup failed"); os.Exit(1) } }
