let client;
const STORAGE_KEY = 'admin_enforcer_domains';

function loadDomainMap() {
  const raw = localStorage.getItem(STORAGE_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDomainMap(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

// ----- UI -----
async function renderDomains() {
  const list = document.getElementById('locks');
  const map = loadDomainMap();
  list.innerHTML = '';

  const domains = Object.keys(map).sort();
  if (!domains.length) {
    list.innerHTML = '<li style="opacity:.7">No domain rules set.</li>';
    return;
  }

  for (const d of domains) {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.gap = '8px';
    li.style.padding = '4px 0';

    const left = document.createElement('span');
    left.textContent = `@${d} → ${map[d]}`;

    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.className = 'secondary';
    btn.addEventListener('click', () => {
      const current = loadDomainMap();
      delete current[d];
      saveDomainMap(current);
      renderDomains();
    });

    li.appendChild(left);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function setupUI() {
  const domainInput = document.getElementById('domain');
  const emailInput = document.getElementById('admin-email');
  const addBtn = document.getElementById('add-btn');
  const resetBtn = document.getElementById('reset-btn');
  const status = document.getElementById('status');

  function setStatus(msg, ok = true) {
    status.textContent = msg;
    status.style.color = ok ? 'inherit' : '#b00020';
  }

  addBtn.addEventListener('click', () => {
    const domain = domainInput.value.trim().toLowerCase().replace(/^@/, '');
    const email = emailInput.value.trim().toLowerCase();

    if (!domain || !domain.includes('.')) {
      setStatus('Invalid domain.', false);
      return;
    }
    if (!email.includes('@')) {
      setStatus('Invalid email.', false);
      return;
    }

    const map = loadDomainMap();
    map[domain] = email;
    saveDomainMap(map);
    renderDomains();
    setStatus(`Locked @${domain} to ${email}`);
    domainInput.value = '';
    emailInput.value = '';
  });

  resetBtn.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    renderDomains();
    setStatus('Cleared all domain rules.');
  });

  renderDomains();
}

// ----- enforcement -----
async function onTicketSave() {
  const data = await client.get(['ticket.requester', 'ticket.collaborators']);
  const requester = data['ticket.requester'];
  const ccList = data['ticket.collaborators'] || [];

  const requesterEmail = requester?.email?.trim().toLowerCase();
  const domain = requesterEmail?.split('@')[1];
  const ccEmails = ccList.map(u => u.email?.trim().toLowerCase()).filter(Boolean);

  const map = loadDomainMap();
  const requiredAdmin = map[domain];

  console.log('--- Admin Enforcer Debug ---', {
    requesterEmail, domain, requiredAdmin, ccEmails, map
  });

  if (!requesterEmail || !domain || !requiredAdmin) return true;

  if (!ccEmails.includes(requiredAdmin)) {
    const msg = `Admin ${requiredAdmin} must be CC’d before saving (for @${domain}).`;
    await client.invoke('notify', msg, 'error');
    return Promise.reject(msg);
  }

  return true;
}

// ----- bootstrap -----
function init() {
  client = ZAFClient.init();
  client.on('app.registered', () => {
    console.log('✅ App registered');
    setupUI();
    client.on('ticket.save', () => onTicketSave());
  });
}

init();
