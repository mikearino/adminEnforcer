let client;

const STORAGE_KEY    = 'admin_enforcer_domains';     // team-wide key (Zendesk App Installation Storage)
const LOCAL_DEV_KEY  = 'admin_enforcer_domains_dev'; // fallback key when running locally (404)
const EDIT_KEY       = 'admin_enforcer_editmode';    // session-only toggle for edit UI

/* -----------------------------
 *  Storage helpers
 * --------------------------- */

/** Installation id is needed for the /apps/installations/* storage endpoints */
async function getInstallationId() {
  const meta = await client.metadata(); // { appId, installationId, ... }
  return meta.installationId;
}

/* Local dev fallback (used only when storage endpoints 404 under zcli) */
function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_DEV_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveLocal(map) {
  localStorage.setItem(LOCAL_DEV_KEY, JSON.stringify(map));
}

/* Load team-wide map; if 404 (not installed), silently fall back to local */
async function loadMap() {
  try {
    const installationId = await getInstallationId();
    const res = await client.request({
      url: `/api/v2/apps/installations/${installationId}/storage.json?key=${encodeURIComponent(STORAGE_KEY)}`,
      type: 'GET'
    });
    const raw = res?.value; // server returns { key, value }
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    const status = e?.status ?? e?.xhr?.status;
    if (status === 404) {
      console.warn('App Storage 404 in dev, using localStorage fallback');
      return loadLocal();
    }
    console.warn('loadMap failed, returning empty map', e);
    return {};
  }
}

/* Save team-wide map; if 404 (not installed), fall back to local */
async function saveMap(map) {
  try {
    const installationId = await getInstallationId();
    await client.request({
      url: `/api/v2/apps/installations/${installationId}/storage.json`,
      type: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({
        key: STORAGE_KEY,
        value: JSON.stringify(map)
      })
    });
  } catch (e) {
    const status = e?.status ?? e?.xhr?.status;
    if (status === 404) {
      console.warn('App Storage 404 in dev, saving to localStorage fallback');
      return saveLocal(map);
    }
    throw e;
  }
}

/* -----------------------------
 *  UI helpers
 * --------------------------- */
function normalizeDomain(v) {
  return (v || '').trim().toLowerCase().replace(/^@/, '');
}
function validate(domain, email) {
  if (!domain || !domain.includes('.')) return 'Enter a valid domain like "disney.com".';
  if (!email || !email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
    return 'Enter a valid admin email like "erin@disney.com".';
  }
  return null;
}
function setStatus(msg, kind = '') {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.className = `status ${kind}`;
}
function editMode() {
  return sessionStorage.getItem(EDIT_KEY) === '1';
}
function setInputsEnabled(enabled) {
  ['domain', 'admin-email', 'add-btn', 'clear-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
  document.querySelectorAll('.remove-btn').forEach(b => (b.disabled = !enabled));
}

/* -----------------------------
 *  Render rules list (with inline confirm remove)
 * --------------------------- */
async function renderDomains() {
  const wrap = document.getElementById('locks');
  const map = await loadMap();
  wrap.innerHTML = '';

  const domains = Object.keys(map).sort();
  if (!domains.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.opacity = '.75';
    empty.textContent = 'No domain rules set.';
    wrap.appendChild(empty);
    return;
  }

  function makeRow(domain, email) {
    const row = document.createElement('div');
    row.className = 'rule';

    const pillDomain = document.createElement('span');
    pillDomain.className = 'pill';
    pillDomain.title = '@' + domain;
    pillDomain.innerHTML = `<b>@${domain}</b>`;

    const pillEmail = document.createElement('span');
    pillEmail.className = 'pill email';
    pillEmail.title = email;
    pillEmail.textContent = email;

    const right = document.createElement('div');
    right.className = 'right';

    const del = document.createElement('button');
    del.className = 'btn remove-btn';
    del.textContent = 'Remove';
    del.disabled = !editMode();

    // Inline two-step confirm (no window.confirm)
    let arming = false;
    let timer = null;

    del.addEventListener('click', async () => {
      if (!editMode()) return;

      if (!arming) {
        arming = true;
        del.textContent = 'Confirm?';
        del.classList.add('danger');
        timer = setTimeout(() => {
          arming = false;
          del.textContent = 'Remove';
          del.classList.remove('danger');
        }, 5000);
        return;
      }

      // confirmed
      clearTimeout(timer);
      arming = false;
      del.textContent = 'Removing…';
      del.disabled = true;

      const cur = await loadMap();
      delete cur[domain];
      await saveMap(cur);
      await renderDomains();
      client.invoke('notify', `Removed rule for @${domain}`, 'notice');
    });

    right.appendChild(del);
    row.appendChild(pillDomain);
    row.appendChild(pillEmail);
    row.appendChild(right);
    return row;
  }

  for (const d of domains) {
    wrap.appendChild(makeRow(d, map[d]));
  }
}

/* -----------------------------
 *  UI wiring
 * --------------------------- */
function setupUI() {
  const domainInput = document.getElementById('domain');
  const emailInput  = document.getElementById('admin-email');
  const addBtn      = document.getElementById('add-btn');
  const clearBtn    = document.getElementById('clear-btn');
  const confirmBox  = document.getElementById('confirm');
  const yesBtn      = document.getElementById('confirm-yes');
  const noBtn       = document.getElementById('confirm-no');
  const toggle      = document.getElementById('edit-toggle');

  // seed edit mode from session
  toggle.checked = editMode();
  setInputsEnabled(editMode());

  toggle.addEventListener('change', () => {
    sessionStorage.setItem(EDIT_KEY, toggle.checked ? '1' : '0');
    setInputsEnabled(toggle.checked);
    setStatus(toggle.checked ? 'Edit enabled.' : 'Edit disabled.');
  });

  async function addRule() {
    if (!editMode()) return;
    const domain = normalizeDomain(domainInput.value);
    const email  = (emailInput.value || '').trim().toLowerCase();

    const err = validate(domain, email);
    if (err) { setStatus(err, 'bad'); return; }

    const map = await loadMap();
    map[domain] = email;
    await saveMap(map);
    await renderDomains();

    setStatus(`Added @${domain} → ${email}`, 'good');
    domainInput.value = '';
    emailInput.value  = '';
  }

  addBtn.addEventListener('click', addRule);
  domainInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addRule(); });
  emailInput.addEventListener('keydown',  (e) => { if (e.key === 'Enter') addRule(); });

  // Clear-all with inline confirmation
  clearBtn.addEventListener('click', () => {
    if (!editMode()) return;
    confirmBox.classList.add('show');
  });
  noBtn.addEventListener('click', () => confirmBox.classList.remove('show'));
  yesBtn.addEventListener('click', async () => {
    await saveMap({});
    await renderDomains();
    confirmBox.classList.remove('show');
    setStatus('Cleared all domain rules.');
  });

  // initial render
  renderDomains();
}

/* -----------------------------
 *  Enforcement on ticket save
 * --------------------------- */
async function onTicketSave() {
  const data = await client.get(['ticket.requester', 'ticket.collaborators']);
  const requester = data['ticket.requester'];
  const ccList    = data['ticket.collaborators'] || [];

  const requesterEmail = requester?.email?.trim().toLowerCase();
  const domain         = requesterEmail?.split('@')[1];
  const ccEmails       = ccList.map(u => u.email?.trim().toLowerCase()).filter(Boolean);

  const map = await loadMap();
  const requiredAdmin = domain ? map[domain] : null;

  console.log('--- Admin Enforcer Debug ---', { requesterEmail, domain, requiredAdmin, ccEmails, map });

  // allow save if no rule applies
  if (!requesterEmail || !domain || !requiredAdmin) return true;

  if (!ccEmails.includes(requiredAdmin)) {
    const msg = `Admin ${requiredAdmin} must be CC’d before saving (for @${domain}).`;
    await client.invoke('notify', msg, 'error');
    return Promise.reject(msg); // block the save
  }

  return true;
}

/* -----------------------------
 *  Bootstrap
 * --------------------------- */
function init() {
  client = ZAFClient.init();
  client.on('app.registered', async () => {
    setupUI();
    client.on('ticket.save', () => onTicketSave());
  });
}
init();
