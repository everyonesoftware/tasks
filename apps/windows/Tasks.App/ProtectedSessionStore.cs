namespace Tasks.App;

public interface IEnvelopeProtector
{
    Task<byte[]> ProtectAsync(byte[] plaintext, CancellationToken cancellationToken);
    Task<byte[]> UnprotectAsync(byte[] ciphertext, CancellationToken cancellationToken);
}

/// <summary>One encrypted connection envelope; never a task cache.</summary>
public sealed class ProtectedSessionStore(string directory, IEnvelopeProtector protector)
{
    private const int MaximumEnvelopeBytes = 65536;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly string path = Path.Combine(directory, "session.dat");

    public async Task<byte[]?> ReadAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(path)) return null;
            if (new FileInfo(path).Length > MaximumEnvelopeBytes)
                throw new InvalidDataException("Session envelope is too large.");
            var ciphertext = await File.ReadAllBytesAsync(path, cancellationToken);
            if (ciphertext.Length > MaximumEnvelopeBytes)
                throw new InvalidDataException("Session envelope is too large.");
            return await protector.UnprotectAsync(ciphertext, cancellationToken);
        }
        finally { gate.Release(); }
    }

    public async Task WriteAsync(byte[] plaintext, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        string? temporary = null;
        try
        {
            if (plaintext.Length > MaximumEnvelopeBytes)
                throw new InvalidDataException("Session envelope is too large.");
            // Protection must succeed before touching the previously committed envelope.
            var ciphertext = await protector.ProtectAsync(plaintext, cancellationToken);
            if (ciphertext.Length > MaximumEnvelopeBytes)
                throw new InvalidDataException("Session envelope is too large.");
            Directory.CreateDirectory(directory);
            temporary = Path.Combine(directory, ".session-" + Guid.NewGuid().ToString("N") + ".tmp");
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                             4096, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(ciphertext, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            cancellationToken.ThrowIfCancellationRequested();
            // Same-directory atomic replacement commits endpoint/account/token together.
            File.Move(temporary, path, overwrite: true);
            temporary = null;
        }
        finally
        {
            try { if (temporary is not null) File.Delete(temporary); }
            finally { gate.Release(); }
        }
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try { File.Delete(path); }
        finally { gate.Release(); }
    }
}
