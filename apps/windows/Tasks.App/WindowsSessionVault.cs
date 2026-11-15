using System.Security.Cryptography;
using System.Text.Json;
using Tasks.Core;
using Windows.Security.Cryptography;
using Windows.Security.Cryptography.DataProtection;

namespace Tasks.App;

internal sealed class WindowsSessionVault : ISessionVault
{
    private readonly ProtectedSessionStore store = new(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EveryoneSoftware", "Tasks"),
        new UserEnvelopeProtector());

    public async Task<SessionProfile?> LoadAsync(CancellationToken cancellationToken = default)
    {
        var plaintext = await store.ReadAsync(cancellationToken);
        if (plaintext is null) return null;
        try
        {
            return JsonSerializer.Deserialize<SessionProfile>(plaintext)
                ?? throw new InvalidDataException("Invalid session envelope.");
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    public async Task SaveAsync(SessionProfile profile, CancellationToken cancellationToken = default)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(profile);
        try { await store.WriteAsync(plaintext, cancellationToken); }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    public Task ClearAsync(CancellationToken cancellationToken = default) => store.ClearAsync(cancellationToken);

    private sealed class UserEnvelopeProtector : IEnvelopeProtector
    {
        public async Task<byte[]> ProtectAsync(byte[] plaintext, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var provider = new DataProtectionProvider("LOCAL=user");
            var encrypted = await provider.ProtectAsync(CryptographicBuffer.CreateFromByteArray(plaintext));
            cancellationToken.ThrowIfCancellationRequested();
            CryptographicBuffer.CopyToByteArray(encrypted, out var ciphertext);
            return ciphertext;
        }

        public async Task<byte[]> UnprotectAsync(byte[] ciphertext, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var decrypted = await new DataProtectionProvider().UnprotectAsync(CryptographicBuffer.CreateFromByteArray(ciphertext));
            cancellationToken.ThrowIfCancellationRequested();
            CryptographicBuffer.CopyToByteArray(decrypted, out var plaintext);
            return plaintext;
        }
    }
}
