let client;

// In-memory store of locked domains and admin emails
const lockedAdmins = {};

function setupLockButton() {
  const lockBtn = document.getElementById('lock-btn');
  const input = document.getElementById('admin-email');
  const status = document.getElementById('status');

  lockBtn.addEventListener('click', () => {
    const email = input.value.trim().toLowerCase();

    if (!email.includes('@')) {
      status.textContent = 'Invalid email.';
      return;
    }

    const domain = email.split('@')[1];
    lockedAdmins[domain] = email;

    status.textContent = `Locked admin for @${domain}`;
  });
}

function init() {
  client = ZAFClient.init();
  client.on('app.registered', () => {
    client.on('ticket.save', onTicketSave);
  });
  setupLockButton();
}

function onTicketSave() {
  return client.get(['ticket.requester', 'ticket.email_ccs'])
    .then(data => {
      const requester = data['ticket.requester'];
      const ccList = data['ticket.email_ccs'] || [];

      const requesterEmail = requester.email;
      if (!requesterEmail || !requesterEmail.includes('@')) {
        return { valid: true }; // no requester email? bypass
      }

      const domain = requesterEmail.split('@')[1];
      const requiredAdmin = lockedAdmins[domain];

      if (!requiredAdmin) {
        return { valid: true }; // no lock set for this domain
      }

      const ccEmails = ccList.map(user => user.email.toLowerCase());
      const isAdminCCd = ccEmails.includes(requiredAdmin);

      if (!isAdminCCd) {
        return {
          valid: false,
          message: `Admin ${requiredAdmin} must be CC’d before saving.`
        };
      }

      return { valid: true };
    });
}


init();