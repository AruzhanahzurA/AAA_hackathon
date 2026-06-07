import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const BASE_URL = 'https://staging-api.notarity.com';
const COMMON_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'cache-control': 'no-cache',
  origin: 'https://staging.notarity.com',
  referer: 'https://staging.notarity.com/',
};

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      ...COMMON_HEADERS,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(json?.message || json?.error || `Request failed: ${response.status}`);
  }

  return json;
}

export async function fetchBookingForm() {
  return fetchJson('/booking-form/slug?slug=start-vienna-hackathon');
}

export async function fetchProducts(tags) {
  const params = new URLSearchParams();
  for (const tag of tags) params.append('_tags', tag);
  return fetchJson(`/products/tags?${params.toString()}`);
}

export async function fetchTimeslots({ timeslotLabel, startDate, endDate }) {
  const params = new URLSearchParams({
    _timeslotLabel: timeslotLabel,
    startDate,
    endDate,
  });
  return fetchJson(`/appointment-requests/timeslots?${params.toString()}`);
}

export async function getPrice(payload) {
  return fetchJson('/appointment-requests/price', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function submitAppointment({ payload, files }) {
  const form = new FormData();

  for (const file of files || []) {
    form.append(
      'files',
      new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.filename, {
        type: 'application/pdf',
      }),
    );
  }

  form.append('payload', JSON.stringify(payload));

  const response = await fetch(`${BASE_URL}/appointment-requests`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'cache-control': 'no-cache',
      origin: 'https://staging.notarity.com',
      referer: 'https://staging.notarity.com/',
    },
    body: form,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) throw new Error(json?.message || json?.error || `Submit failed: ${response.status}`);
  return json;
}
