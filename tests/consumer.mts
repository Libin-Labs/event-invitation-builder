import {
  buildInvitations,
  type InvitationGuest,
  type InvitationOptions,
  type InvitationBatch,
  type QrCodeAdapter,
} from '@lp-labs/event-invitation-builder';

const guests: InvitationGuest[] = [
  {
    id: 'guest-1',
    name: 'Avery',
    email: 'avery@example.test',
    eventName: 'Launch',
    eventDate: 'Friday',
    url: 'https://example.test/invite/1',
  },
];
const qr: QrCodeAdapter = {
  async generate() {
    return 'data:image/png;base64,';
  },
};
const options: InvitationOptions = { template: 'Hello {{name}}', qrCode: qr };
const batch: Promise<InvitationBatch> = buildInvitations(guests, options);
void batch;
const unsafe: InvitationGuest = { ...guests[0]!, url: 'javascript:alert(1)' };
void unsafe;
