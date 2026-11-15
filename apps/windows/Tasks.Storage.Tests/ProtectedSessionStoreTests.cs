using System.Security.Cryptography;
using System.Text;
using Tasks.App;
using Xunit;

namespace Tasks.Storage.Tests;

public sealed class ProtectedSessionStoreTests : IDisposable
{
    private readonly string directory = Path.Combine(Environment.GetEnvironmentVariable("TMPDIR") ?? Path.GetTempPath(), "tasks-storage-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task RoundTripPersistsOnlyEncryptedEnvelope()
    {
        var protector = new TestProtector();
        var store = new ProtectedSessionStore(directory, protector);
        var envelope = Encoding.UTF8.GetBytes("{\"token\":\"fixture-session-secret\",\"username\":\"fixture\"}");
        await store.WriteAsync(envelope);
        var raw = await File.ReadAllBytesAsync(Path.Combine(directory, "session.dat"));
        Assert.DoesNotContain("fixture-session-secret", Encoding.UTF8.GetString(raw));
        Assert.Equal(envelope, await new ProtectedSessionStore(directory, protector).ReadAsync());
    }

    [Fact]
    public async Task EncryptionFailureDoesNotReplaceWorkingSession()
    {
        var protector = new TestProtector();
        var store = new ProtectedSessionStore(directory, protector);
        await store.WriteAsync([1, 2, 3]);
        protector.Fail = true;
        await Assert.ThrowsAsync<CryptographicException>(() => store.WriteAsync([4, 5, 6]));
        protector.Fail = false;
        Assert.Equal(new byte[] { 1, 2, 3 }, await store.ReadAsync());
        Assert.Single(Directory.EnumerateFiles(directory));
    }

    [Fact]
    public async Task TamperedEnvelopeFailsClosed()
    {
        var store = new ProtectedSessionStore(directory, new TestProtector());
        await store.WriteAsync([1, 2, 3]);
        var path = Path.Combine(directory, "session.dat");
        var raw = await File.ReadAllBytesAsync(path);
        raw[^1] ^= 1;
        await File.WriteAllBytesAsync(path, raw);
        await Assert.ThrowsAnyAsync<CryptographicException>(() => store.ReadAsync());
    }

    [Fact]
    public async Task CancelledReplacementKeepsOldEnvelopeAndCleansTemporaryFile()
    {
        var store = new ProtectedSessionStore(directory, new TestProtector());
        await store.WriteAsync([1, 2, 3]);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.WriteAsync([4, 5, 6], cancellation.Token));
        Assert.Equal(new byte[] { 1, 2, 3 }, await store.ReadAsync());
        Assert.Single(Directory.EnumerateFiles(directory));
    }

    [Fact]
    public async Task CancellationAfterProtectionKeepsOldEnvelopeAndCleansStagedFile()
    {
        var protector = new TestProtector();
        var store = new ProtectedSessionStore(directory, protector);
        await store.WriteAsync([1, 2, 3]);
        using var cancellation = new CancellationTokenSource();
        var protectedReplacement = false;
        protector.AfterProtection = () => { protectedReplacement = true; cancellation.Cancel(); };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.WriteAsync([4, 5, 6], cancellation.Token));
        Assert.True(protectedReplacement);
        Assert.Equal(new byte[] { 1, 2, 3 }, await store.ReadAsync());
        Assert.Equal(new[] { Path.Combine(directory, "session.dat") }, Directory.EnumerateFiles(directory).ToArray());
    }

    [Fact]
    public async Task ClearRemovesOnlyThisSessionAndMissingSessionIsNull()
    {
        var store = new ProtectedSessionStore(directory, new TestProtector());
        Assert.Null(await store.ReadAsync());
        await store.WriteAsync([1, 2, 3]);
        var unrelated = Path.Combine(directory, "unrelated.txt");
        await File.WriteAllTextAsync(unrelated, "keep");
        await store.ClearAsync();
        Assert.Null(await store.ReadAsync());
        Assert.True(File.Exists(unrelated));
        await store.ClearAsync();
    }

    [Fact]
    public async Task OversizedEncryptedEnvelopeIsRejected()
    {
        var store = new ProtectedSessionStore(directory, new TestProtector());
        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(Path.Combine(directory, "session.dat"), new byte[65537]);
        await Assert.ThrowsAsync<InvalidDataException>(() => store.ReadAsync());
    }

    public void Dispose()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    // Cryptography is injected at the OS boundary. Windows LOCAL=user protection
    // still needs native acceptance; these tests exercise the real atomic files.
    private sealed class TestProtector : IEnvelopeProtector
    {
        private readonly byte[] key = RandomNumberGenerator.GetBytes(32);
        public bool Fail { get; set; }
        public Action? AfterProtection { get; set; }
        public Task<byte[]> ProtectAsync(byte[] plaintext, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (Fail) throw new CryptographicException("Fixture protection failure");
            var nonce = RandomNumberGenerator.GetBytes(12);
            var tag = new byte[16];
            var ciphertext = new byte[plaintext.Length];
            using var aes = new AesGcm(key, 16);
            aes.Encrypt(nonce, plaintext, ciphertext, tag);
            AfterProtection?.Invoke();
            return Task.FromResult(nonce.Concat(tag).Concat(ciphertext).ToArray());
        }
        public Task<byte[]> UnprotectAsync(byte[] ciphertext, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var plaintext = new byte[ciphertext.Length - 28];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(ciphertext.AsSpan(0, 12), ciphertext.AsSpan(28), ciphertext.AsSpan(12, 16), plaintext);
            return Task.FromResult(plaintext);
        }
    }
}
