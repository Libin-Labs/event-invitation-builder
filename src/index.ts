export interface InvitationGuest {
  id: string;
  name: string;
  email: string;
  eventName: string;
  eventDate: string;
  url: string;
}

export interface QrCodeAdapter {
  /** Return a PNG data URL. Adapters should observe the signal to cancel expensive work. */
  generate(
    url: string,
    context: Readonly<{ guestId: string; signal?: AbortSignal }>,
  ): Promise<string>;
}

export interface InvitationOptions {
  template: string;
  concurrency?: number;
  signal?: AbortSignal;
  qrCode?: QrCodeAdapter;
}

export type InvitationResult =
  | { guestId: string; status: 'ready'; html: string; qrDataUrl?: string }
  | { guestId: string; status: 'error'; error: string }
  | { guestId: string; status: 'cancelled' };

export interface InvitationBatch {
  results: InvitationResult[];
  cancelled: boolean;
}

const MAX_GUESTS = 2_000;
const MAX_TEMPLATE = 10_000;
const MAX_FIELD = 500;
const TOKENS = new Set(['name', 'email', 'eventName', 'eventDate', 'url']);
const SAFE_ID = /^[\w.-]{1,80}$/;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

function safeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Invitation URL must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2_048)
    throw new TypeError('Invitation URL must be a credential-free HTTPS URL');
  return url.href;
}

function validateGuest(guest: InvitationGuest, ids: Set<string>): void {
  if (!guest || typeof guest.id !== 'string' || !SAFE_ID.test(guest.id) || ids.has(guest.id))
    throw new TypeError('Guest IDs must be unique safe identifiers');
  ids.add(guest.id);
  for (const key of ['name', 'email', 'eventName', 'eventDate'] as const) {
    const value = guest[key];
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_FIELD)
      throw new TypeError(`Invalid guest ${key}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) throw new TypeError('Invalid guest email');
  safeUrl(guest.url);
}

function templateTokens(template: string): string[] {
  const tokens: string[] = [];
  for (const match of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const token = match[1]!;
    if (!TOKENS.has(token)) throw new TypeError(`Unknown invitation placeholder: ${token}`);
    tokens.push(token);
  }
  if (/\{\{|\}\}/.test(template.replace(/\{\{\s*[^{}]+\s*\}\}/g, '')))
    throw new TypeError('Malformed invitation placeholder');
  return tokens;
}

function render(template: string, guest: InvitationGuest): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token: string) =>
    escapeHtml(
      token === 'url' ? safeUrl(guest.url) : (guest[token as keyof InvitationGuest] as string),
    ),
  );
}

function abortError(signal: AbortSignal): boolean {
  return signal.aborted;
}

function validPngDataUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 1_000_000 ||
    !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    return false;
  try {
    const bytes = atob(value.slice('data:image/png;base64,'.length));
    if (
      bytes.length < 45 ||
      bytes.charCodeAt(0) !== 137 ||
      bytes.slice(1, 4) !== 'PNG' ||
      bytes.charCodeAt(4) !== 13 ||
      bytes.charCodeAt(5) !== 10 ||
      bytes.charCodeAt(6) !== 26 ||
      bytes.charCodeAt(7) !== 10
    )
      return false;
    let offset = 8;
    let hasHeader = false;
    let hasData = false;
    while (offset + 12 <= bytes.length) {
      const length =
        bytes.charCodeAt(offset) * 0x1000000 +
        (bytes.charCodeAt(offset + 1) << 16) +
        (bytes.charCodeAt(offset + 2) << 8) +
        bytes.charCodeAt(offset + 3);
      if (length > bytes.length - offset - 12) return false;
      const type = bytes.slice(offset + 4, offset + 8);
      if (!hasHeader) {
        if (type !== 'IHDR' || length !== 13) return false;
        const width =
          bytes.charCodeAt(offset + 8) * 0x1000000 +
          (bytes.charCodeAt(offset + 9) << 16) +
          (bytes.charCodeAt(offset + 10) << 8) +
          bytes.charCodeAt(offset + 11);
        const height =
          bytes.charCodeAt(offset + 12) * 0x1000000 +
          (bytes.charCodeAt(offset + 13) << 16) +
          (bytes.charCodeAt(offset + 14) << 8) +
          bytes.charCodeAt(offset + 15);
        if (width < 1 || height < 1 || width > 4_096 || height > 4_096) return false;
        hasHeader = true;
      }
      if (type === 'IDAT') hasData = true;
      offset += length + 12;
      if (type === 'IEND') return hasHeader && hasData && length === 0 && offset === bytes.length;
    }
    return false;
  } catch {
    return false;
  }
}

/** Build personalized invitations; QR generation is always an explicit injected service. */
export async function buildInvitations(
  guests: readonly InvitationGuest[],
  options: InvitationOptions,
): Promise<InvitationBatch> {
  if (!Array.isArray(guests) || guests.length > MAX_GUESTS)
    throw new RangeError('Invalid guest count');
  if (typeof options.template !== 'string' || options.template.length > MAX_TEMPLATE)
    throw new TypeError('Invalid invitation template');
  templateTokens(options.template);
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new RangeError('concurrency must be between 1 and 32');
  if (options.qrCode && typeof options.qrCode.generate !== 'function')
    throw new TypeError('Invalid QR adapter');
  const ids = new Set<string>();
  for (const guest of guests) validateGuest(guest, ids);
  const results: InvitationResult[] = new Array(guests.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= guests.length) return;
      const guest = guests[index]!;
      if (options.signal && abortError(options.signal)) {
        results[index] = { guestId: guest.id, status: 'cancelled' };
        continue;
      }
      try {
        let qrDataUrl: string | undefined;
        if (options.qrCode) {
          qrDataUrl = await options.qrCode.generate(safeUrl(guest.url), {
            guestId: guest.id,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          if (options.signal?.aborted) {
            results[index] = { guestId: guest.id, status: 'cancelled' };
            continue;
          }
          if (!validPngDataUrl(qrDataUrl))
            throw new TypeError(
              'QR adapter must return a bounded, structurally valid PNG data URL',
            );
        }
        const html = `<article class="invitation"><div>${render(options.template, guest)}</div><a href="${escapeHtml(safeUrl(guest.url))}">Open invitation</a>${qrDataUrl ? `<img alt="Invitation QR code" src="${qrDataUrl}">` : ''}</article>`;
        results[index] = {
          guestId: guest.id,
          status: 'ready',
          html,
          ...(qrDataUrl === undefined ? {} : { qrDataUrl }),
        };
      } catch (error) {
        results[index] = options.signal?.aborted
          ? { guestId: guest.id, status: 'cancelled' }
          : {
              guestId: guest.id,
              status: 'error',
              error: error instanceof Error ? error.message : 'Invitation generation failed',
            };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, guests.length) }, worker));
  return {
    results,
    cancelled: options.signal?.aborted ?? false,
  };
}
