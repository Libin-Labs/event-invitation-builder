# @lp-labs/event-invitation-builder

Strict per-guest invitation binding, escaped HTML values, HTTPS links, bounded asynchronous batches,
cancellation, and an optional injected QR-code service. No QR generator or QR image is bundled.

## Install and quickstart

```sh
npm install @lp-labs/event-invitation-builder
```

```js
import { buildInvitations } from '@lp-labs/event-invitation-builder';

const batch = await buildInvitations(
  [
    {
      id: 'guest-1',
      name: 'Avery',
      email: 'avery@example.test',
      eventName: 'Studio opening',
      eventDate: '2026-12-01',
      url: 'https://example.test/invite/guest-1',
    },
  ],
  { template: '<h1>Hello {{name}}</h1><p>{{eventName}} · {{eventDate}}</p>' },
);
console.log(batch.results);
```

## API and types

- `buildInvitations(guests, options): Promise<InvitationBatch>` validates the complete input first,
  runs a bounded number of per-guest operations and returns results in input order.
- `InvitationGuest`: unique safe `id`, `name`, syntactically checked `email`, `eventName`,
  `eventDate`, and absolute credential-free `https:` `url`.
- `InvitationOptions`: caller-authored `template`, optional concurrency (default 4), optional
  `AbortSignal`, and optional `QrCodeAdapter`.
- Template placeholders are strictly limited to `{{name}}`, `{{email}}`, `{{eventName}}`,
  `{{eventDate}}`, and `{{url}}`; substituted values are HTML-escaped. The template is trusted
  application-authored HTML and is inserted as markup.
- `QrCodeAdapter.generate(url, {guestId, signal?})` is an injected asynchronous integration. It
  must create the actual QR image and return a bounded, structurally valid PNG data URL. The
  package validates PNG framing and never fabricates a QR code or falls back to one. PNG contents
  are opaque; use an adapter that truly encodes the supplied invitation URL as a QR code.
- Results are `ready` with HTML (and optional PNG data URL), `error` with a per-guest message, or
  `cancelled`. Batch `cancelled` reflects the supplied signal; adapters should observe its signal.
- `InvitationResult` is that ready/error/cancelled discriminated union; `InvitationBatch` contains
  the ordered result array and cancellation flag.

## Customization, errors, limits, and performance

Build templates in your own trusted application and generate QR codes with your chosen service.
Never pass untrusted template markup. The library does not send email, validate recipient ownership,
localize event text, or verify QR contents. Bounded limits: 2,000 guests, 500 characters per field,
10,000 template characters, 32 concurrent workers, 1 MB per QR data URL. Duplicate/unsafe guest
IDs, malformed HTTPS/email fields, unknown or malformed placeholders, and invalid adapters throw
synchronous `TypeError`; invalid concurrency/counts throw `RangeError`. Individual adapter errors
are recorded per result rather than aborting other guests. Work is O(guests + rendered output), with
at most the configured number of adapters active at a time.

## Modules and development

Independent NodeNext ESM and CommonJS builds with declarations; no runtime or peer dependencies.
CommonJS: `const { buildInvitations } = require('@lp-labs/event-invitation-builder')`.
TypeScript ^5.9.3 and Prettier ^3.6.2 are development-only.
Run `npm run build`, `npm run typecheck`, `npm test`, `npm run format`, and `npm run format:check`.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
