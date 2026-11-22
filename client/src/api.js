// Small fetch helper for the Node API.
// Errors come back from the server as { errors: [...] }; they are thrown as one Error with the messages joined by newlines.
// If the server answers 401 (it has CIC_API_KEY set) we ask for the key once, remember it, and retry.
// The asking is done by the app's own dialog (registered with setKeyAsker), never by a browser prompt.
const KEY_NAME = 'cickey';

let askForKey = null;
/** App registers a function that shows the key dialog and resolves the typed key ('' if cancelled). */
export function setKeyAsker(fn) {
  askForKey = fn;
}

// Sends the request (with the API key if we have one) and retries once after asking for the key on a 401.
async function request(path, { method = 'GET', body } = {}) {
  const call = () => {
    const headers = { 'Content-Type': 'application/json' };
    const key = localStorage.getItem(KEY_NAME);
    if (key) headers['X-API-Key'] = key;
    return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };

  let res = await call();
  if (res.status === 401) {
    const key = askForKey ? await askForKey() : '';
    if (key) {
      localStorage.setItem(KEY_NAME, key);
      res = await call();
    }
  }
  return res;
}

// Turns a failed response into an Error with the server's messages.
async function failure(res) {
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return new Error(((json && json.errors) || [`Request failed (${res.status})`]).join('\n'));
}

export async function api(path, options) {
  const res = await request(path, options);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    throw new Error(((json && json.errors) || [`Request failed (${res.status})`]).join('\n'));
  }
  return json;
}

/** GET a file (the PDF reports). Resolves a Blob; throws the server's message when it fails. */
export async function apiBlob(path) {
  const res = await request(path);
  if (!res.ok) throw await failure(res);
  return res.blob();
}
