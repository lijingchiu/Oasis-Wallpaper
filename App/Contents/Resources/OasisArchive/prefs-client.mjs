// A loopback port and access path are regenerated whenever the app restarts.
// Save only the authored controls for this imported project, on its own host.
const endpoint = '_oasis/controls';
export async function readPreferences() {
  try {
    const r = await fetch(endpoint);
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}
let pending = null,
  writing = false;
export async function savePreferences(value) {
  pending = JSON.stringify(value);
  if (writing) return;
  writing = true;
  try {
    while (pending !== null) {
      const body = pending;
      pending = null;
      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body,
          keepalive: true
        });
      } catch {}
    }
  } finally {
    writing = false;
  }
}
