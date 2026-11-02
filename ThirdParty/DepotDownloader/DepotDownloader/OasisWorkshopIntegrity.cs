// This file is subject to the terms and conditions defined
// in file 'LICENSE', which is part of this source code package.

using System;
using System.IO;
using System.Security.Cryptography;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DepotDownloader
{
    internal static class OasisWorkshopIntegrity
    {
        // Steam may preallocate a full-sized file before all chunks arrive.
        // Length alone is insufficient: verify the manifest hash before import.
        internal static void Verify(string root, string name, ulong size, byte[] expected)
        {
            if (!OasisWorkshopPaths.IsSafeContentPath(name)) throw new IOException("Workshop integrity verification failed");
            var path = root;
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Workshop integrity verification failed");
            foreach (var part in name.Split('/'))
            {
                path = Path.Combine(path, part);
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Workshop integrity verification failed");
            }
            using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if ((ulong)input.Length == 0 && size == 0 && (expected == null || expected.Length == 0 || expected.All(value => value == 0))) return;
            if ((ulong)input.Length != size || expected == null || expected.Length != 20 || !CryptographicOperations.FixedTimeEquals(SHA1.HashData(input), expected))
                throw new IOException("Workshop integrity verification failed");
        }

        // A data-only recovery command. It never initializes Steam, accepts a
        // session, reads Keychain, or makes a network request.
        internal static int VerifyPackage(string root, string manifestID)
        {
            string phase = "manifest", asset = null;
            try
            {
                if (!Regex.IsMatch(manifestID ?? "", @"^[1-9][0-9]{0,19}$") || !ulong.TryParse(manifestID, out var expectedID)) throw new InvalidDataException();
                var cache = Path.Combine(root, ".DepotDownloader");
                if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0 || (File.GetAttributes(cache) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException();
                var manifests = Directory.GetFiles(cache, "*_" + manifestID + ".manifest");
                if (manifests.Length != 1 || (File.GetAttributes(manifests[0]) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException();
                var data = SteamKit2.DepotManifest.LoadFromFile(manifests[0]);
                if (data == null || data.ManifestGID != expectedID) throw new InvalidDataException();
                var files = data.Files.Where(file => !file.Flags.HasFlag(SteamKit2.EDepotFileFlag.Directory)).ToArray();
                if (files.Length == 0 || !files.Any(file => file.FileName == "project.json")) throw new InvalidDataException();
                ulong bytes = 0;
                foreach (var file in files) { phase = "asset"; asset = file.FileName; Verify(root, file.FileName, file.TotalSize, file.FileHash); bytes = checked(bytes + file.TotalSize); }
                Console.WriteLine(JsonSerializer.Serialize(new { verified = true, manifest = manifestID, files = files.Length, bytes }));
                return 0;
            }
            catch (Exception error) { Console.WriteLine(JsonSerializer.Serialize(new { verified = false, phase, asset, type = error.GetType().Name })); return 1; }
        }
    }
}
