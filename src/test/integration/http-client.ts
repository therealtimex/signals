export function smokeBaseUrl(): string {
  const baseURL = process.env.SMOKE_BASE_URL;
  if (!baseURL) {
    throw new Error("SMOKE_BASE_URL is not set");
  }
  return baseURL.replace(/\/$/, "");
}

export async function smokeFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${smokeBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, init);
}

export async function smokeJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await smokeFetch(path, init);
  return response.json() as Promise<T>;
}
