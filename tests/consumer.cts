import builder = require('@lp-labs/event-invitation-builder');
const batch = builder.buildInvitations([], { template: 'Join us' });
void batch;
