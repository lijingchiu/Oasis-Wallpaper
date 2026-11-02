// This file is subject to the terms and conditions defined
// in file 'LICENSE', which is part of this source code package.

// Derived from SteamRE/DepotDownloader 3.4.0, GPL-2.0. See ../LICENSE.
// Oasis modification, 2026-10-29: every account/session field is memory-only.
// No isolated-storage account.config, refresh token or Steam Guard data is read or written.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
namespace DepotDownloader {
 class AccountSettingsStore {
  public ConcurrentDictionary<string,int> ContentServerPenalty {get;} = new();
  public Dictionary<string,string> LoginTokens {get;} = new(StringComparer.OrdinalIgnoreCase);
  public Dictionary<string,string> GuardData {get;} = new(StringComparer.OrdinalIgnoreCase);
  public static AccountSettingsStore Instance;
  public static void LoadFromFile(string filename) {Instance = new AccountSettingsStore();}
  public static void Save() { /* Explicitly ephemeral: never persist Steam credentials. */ }
 }
}
