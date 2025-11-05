let client;

const STORAGE_KEY    = 'admin_enforcer_domains';     // team-wide key (App Storage)
const LOCAL_DEV_KEY  = 'admin_enforcer_domains_dev'; // fallback key in zcli
const EDIT_KEY       = 'admin_enforcer_editmode';    // session-only toggle for editing rules

/* ================== Storage Helpers ================== */
async function getInstallationId() {
  const meta = await client.metadata();
  return meta.installationId;
}
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_DEV_KEY) || '{}'); }
  catch { return {}; }
}
function saveLocal(map) {
  localStorage.setItem(LOCAL_DEV_KEY, JSON.stringify(map));
}

async function loadMap() {
  try {
    const installationId = await getInstallationId();
    const res = await client.request({
      url: `/api/v2/apps/installations/${installationId}/storage.json?key=${STORAGE_KEY}`,
      type: 'GET'
    });
    return res?.value ? JSON.parse(res.value) : {};
  } catch (e) {
    if ((e?.status ?? e?.xhr?.status) === 404) {
      console.warn('[AdminEnforcer] Using local fallback storage');
      return loadLocal();
    }
    console.warn('[AdminEnforcer] loadMap failed', e);
    return {};
  }
}
async function saveMap(map) {
  try {
    const installationId = await getInstallationId();
    await client.request({
      url: `/api/v2/apps/installations/${installationId}/storage.json`,
      type: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ key: STORAGE_KEY, value: JSON.stringify(map) })
    });
  } catch (e) {
    if ((e?.status ?? e?.xhr?.status) === 404) {
      console.warn('[AdminEnforcer] Saving to local fallback storage');
      return saveLocal(map);
    }
    throw e;
  }
}

/* ================== UI Helpers ================== */
function normalizeDomain(v) { return (v || '').trim().toLowerCase().replace(/^@/, ''); }
function validate(domain, email) {
  if (!domain || !domain.includes('.')) return 'Enter a valid domain like "disney.com".';
  if (!email || !email.includes('@')) return 'Enter a valid admin email.';
  return null;
}
function setInputsEnabled(enabled) {
  ['domain','admin-email','add-btn','clear-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
  document.querySelectorAll('.remove-btn').forEach(b => (b.disabled = !enabled));
}
function editMode() { return sessionStorage.getItem(EDIT_KEY) === '1'; }

/* ================== Render Rules ================== */
async function renderDomains() {
  const wrap = document.getElementById('locks');
  const map = await loadMap();
  wrap.innerHTML = '';

  const domains = Object.keys(map).sort();
  if (!domains.length) {
    wrap.innerHTML = `<div class="muted" style="opacity:.75;">No domain rules set.</div>`;
    return;
  }

  for (const domain of domains) {
    const email = map[domain];
    const row = document.createElement('div');
    row.className = 'rule';
    row.innerHTML = `
      <span class="pill"><b>@${domain}</b></span>
      <span class="pill email">${email}</span>
      <button class="btn remove-btn" ${!editMode() ? 'disabled' : ''}>Remove</button>
    `;

    const del = row.querySelector('.remove-btn');
    let confirm = false;
    let timer;

    del.addEventListener('click', async () => {
      if (!editMode()) return;

      if (!confirm) {
        confirm = true;
        del.textContent = 'Confirm?';
        del.classList.add('danger');
        timer = setTimeout(() => {
          confirm = false;
          del.textContent = 'Remove';
          del.classList.remove('danger');
        }, 4000);
        return;
      }

      clearTimeout(timer);
      const map = await loadMap();
      delete map[domain];
      await saveMap(map);
      await renderDomains();
    });

    wrap.appendChild(row);
  }
}

/* ================== Setup UI ================== */
function setupUI() {
  const toggle = document.getElementById('edit-toggle');
  toggle.checked = editMode();
  setInputsEnabled(editMode());

  toggle.addEventListener('change', () => {
    sessionStorage.setItem(EDIT_KEY, toggle.checked ? '1' : '0');
    setInputsEnabled(toggle.checked);
  });

  const domainInput = document.getElementById('domain');
  const emailInput  = document.getElementById('admin-email');
  const addBtn      = document.getElementById('add-btn');

  async function addRule() {
    if (!editMode()) return;
    const domain = normalizeDomain(domainInput.value);
    const email  = emailInput.value.trim().toLowerCase();
    const err = validate(domain, email);
    if (err) return;

    const map = await loadMap();
    map[domain] = email;
    await saveMap(map);
    await renderDomains();
    domainInput.value = '';
    emailInput.value = '';
  }

  addBtn.addEventListener('click', addRule);

  renderDomains();
}

/* ================== Enforcement (BLOCK) ================== */
async function onTicketSave() {
  const data = await client.get(['ticket.requester', 'ticket.collaborators']);
  const requesterEmail = data['ticket.requester']?.email?.toLowerCase();
  const domain = requesterEmail?.split('@')[1];
  const ccEmails = (data['ticket.collaborators'] || []).map(u => u.email?.toLowerCase());

  const map = await loadMap();
  const requiredAdmin = map[domain];

  // No rule for this domain → allow save
  if (!requiredAdmin) return true;

  // ✅ NEW RULE: If the requester *is* the required admin → allow save, no enforcement
  if (requesterEmail === requiredAdmin) {
    console.log(`[AdminEnforcer] Admin (${requiredAdmin}) is requester → skipping enforcement.`);
    return true;
  }

  // Normal enforcement: required admin must be CC'd
  if (ccEmails.includes(requiredAdmin)) return true;

  const msg = `Admin ${requiredAdmin} must be CC'd before saving (for @${domain}).`;
  await client.invoke('notify', msg, 'error');
  return Promise.reject(msg);
}


/* ================== Bootstrap ================== */
function init() {
  client = ZAFClient.init();
  client.on('app.registered', () => {
    setupUI();
    client.on('ticket.save', () => onTicketSave());
  });
}

init();
