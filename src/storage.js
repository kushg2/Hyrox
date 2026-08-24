/* ============================================================
   Local-first storage with optional cross-device sync.

   How it works:
   - Every write lands in localStorage immediately. The app never
     waits on the network, so it works in a gym basement.
   - If Supabase credentials are present, writes are also pushed to
     a single row keyed by your sync ID, debounced to one request
     per 1.5 s.
   - On load, whichever copy has the newer updatedAt wins. You're
     one person on two or three devices, so last-write-wins is the
     right amount of machinery.
   ============================================================ */

const LOCAL_KEY = "splitsheet:state";
const ID_KEY = "splitsheet:sync-id";

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const syncEnabled = Boolean(URL_ && ANON);

/* ---- sync ID ----
   A long random string that acts as the key to your data. It's
   stored on the device and can be moved to another device via the
   ?id=... URL, or by typing it into the sync panel. */
export function getSyncId() {
  const fromUrl = new URLSearchParams(location.search).get("id");
  if (fromUrl) {
    localStorage.setItem(ID_KEY, fromUrl);
    history.replaceState({}, "", location.pathname);
    return fromUrl;
  }
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function setSyncId(id) {
  localStorage.setItem(ID_KEY, id.trim());
}

/* ---- local ---- */
function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(state) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

/* ---- remote ---- */
const headers = () => ({
  apikey: ANON,
  Authorization: `Bearer ${ANON}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
});

async function readRemote(id) {
  if (!syncEnabled) return null;
  const r = await fetch(
    `${URL_}/rest/v1/app_state?id=eq.${encodeURIComponent(id)}&select=data`,
    { headers: headers() }
  );
  if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
  const rows = await r.json();
  return rows[0]?.data ?? null;
}

async function writeRemote(id, state) {
  if (!syncEnabled) return;
  const r = await fetch(`${URL_}/rest/v1/app_state`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ id, data: state, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Save failed (${r.status})`);
}

/* ---- public API ---- */

/** Returns { state, source } where source is 'cloud' | 'device' | 'new'. */
export async function load(id) {
  const local = readLocal();
  if (!syncEnabled) return { state: local, source: local ? "device" : "new" };

  let remote = null;
  try {
    remote = await readRemote(id);
  } catch {
    return { state: local, source: local ? "device" : "new", offline: true };
  }

  if (remote && (!local || (remote.updatedAt || 0) > (local.updatedAt || 0))) {
    writeLocal(remote);
    return { state: remote, source: "cloud" };
  }
  if (local && !remote) {
    try { await writeRemote(id, local); } catch { /* retried on next save */ }
  }
  return { state: local, source: local ? "device" : "new" };
}

let timer = null;
let pending = null;

/** Writes locally at once, pushes to the cloud on a 1.5 s debounce. */
export function save(id, state, onStatus) {
  const stamped = { ...state, updatedAt: Date.now() };
  writeLocal(stamped);

  if (!syncEnabled) {
    onStatus?.("Saved on this device");
    return stamped;
  }

  pending = stamped;
  onStatus?.("Saving…");
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await writeRemote(id, pending);
      onStatus?.("Synced");
    } catch {
      onStatus?.("Offline — saved here, will sync when you're back");
    }
  }, 1500);

  return stamped;
}

/** Force a pull, e.g. when the app regains focus. */
export async function pull(id) {
  if (!syncEnabled) return null;
  const local = readLocal();
  const remote = await readRemote(id);
  if (remote && (!local || (remote.updatedAt || 0) > (local.updatedAt || 0))) {
    writeLocal(remote);
    return remote;
  }
  return null;
}
