// This file is subject to the terms and conditions defined
// in file 'LICENSE', which is part of this source code package.

using System;
using System.IO;
using System.Linq;

namespace DepotDownloader
{
    // Hidden files can be authored assets (for example image/.config.json).
    // Reject traversal and the helper's reserved cache, not ordinary dotfiles.
    internal static class OasisWorkshopPaths
    {
        internal static bool IsSafeContentPath(string name)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Length > 600 || Path.IsPathRooted(name)
                || name.Contains('\\') || name.Contains(':') || name.Any(char.IsControl))
                return false;
            return name.Split('/').All(part => part.Length > 0 && part != "." && part != ".."
                && !part.Equals(".DepotDownloader", StringComparison.OrdinalIgnoreCase));
        }
    }
}
