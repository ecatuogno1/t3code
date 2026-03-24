export function isSupportedBrowserTabUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function toBrowserAddressDisplayValue(url: string): string {
  return isSupportedBrowserTabUrl(url) ? url : "";
}

export function normalizeBrowserUrlInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#].*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}
