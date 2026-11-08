const TOKEN = 'harborlight.token';
const USER = 'harborlight.user';
const CLINIC = 'harborlight.clinic';

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER) || 'null');
  } catch {
    return null;
  }
}

export function clinicInfo() {
  try {
    return JSON.parse(localStorage.getItem(CLINIC) || 'null') || {
      name: 'Harborlight Clinic',
      timezone: 'Africa/Kigali',
      currency: 'RWF',
    };
  } catch {
    return { name: 'Harborlight Clinic', timezone: 'Africa/Kigali', currency: 'RWF' };
  }
}

export function saveSession(payload) {
  localStorage.setItem(TOKEN, payload.token);
  localStorage.setItem(USER, JSON.stringify(payload.user));
  localStorage.setItem(CLINIC, JSON.stringify(payload.clinic));
}

export function clearSession() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(USER);
}

export async function api(path, options = {}) {
  const headers = {};
  if (options.body) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem(TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !options.allow401) {
    clearSession();
    window.dispatchEvent(new Event('auth:lost'));
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}
