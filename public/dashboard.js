const $ = id => document.getElementById(id);
let session, guildId, data, page = 'overview', dirty = false, selectionVersion = 0;
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf || '', ...options.headers } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Something went wrong.');
  return value;
}
function showPage(next) {
  page = next;
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== page; });
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  $('breadcrumb').textContent = page.toUpperCase();
  $('title').textContent = ({ overview: 'Community overview', characters: 'Every character has a story.', roleplay: 'Set the scene.', permissions: 'Your storytellers, trusted.' })[page];
  $('save-bar').hidden = !data || !['roleplay', 'permissions'].includes(page);
}
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { if (data) showPage(button.dataset.page); }));
function choices(id, items, selected, prefix = '') {
  $(id).replaceChildren();
  for (const item of items) {
    const label = document.createElement('label'); label.className = 'choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id; input.checked = selected.includes(item.id);
    label.append(input, document.createTextNode(prefix + item.name)); $(id).append(label);
  }
  if (!items.length) $(id).textContent = 'No available options in this server.';
}
function renderCharacters() {
  const query = $('search').value.toLowerCase();
  $('character-list').replaceChildren();
  const list = data.characters.filter(c => c.name.toLowerCase().includes(query));
  for (const character of list) {
    const row = document.createElement('div'); row.className = 'character';
    const name = document.createElement('b'); name.textContent = character.name;
    const owner = document.createElement('small'); owner.textContent = character.assigned ? 'Assigned' : 'Available';
    row.append(name, owner); $('character-list').append(row);
  }
  if (!list.length) $('character-list').textContent = query ? 'No characters match your search.' : 'No characters yet. Create your first character in Discord.';
}
async function selectGuild(id) {
  if (dirty && !confirm('Discard unsaved changes and switch servers?')) return;
  const version = ++selectionVersion;
  notice('Loading your server...'); $('workspace').hidden = true; data = null;
  $('save-bar').hidden = true;
  try {
    const next = await api(`/api/guilds/${id}`);
    if (version !== selectionVersion) return;
    data = next; guildId = id; dirty = false;
    $('dirty').textContent = 'Changes apply directly to your bot.';
    $('server-name').textContent = next.name; $('members').textContent = next.memberCount.toLocaleString();
    $('character-count').textContent = next.characters.length; $('rp-status').textContent = next.settings.roleplayEnabled ? 'Enabled' : 'Disabled';
    $('channel-count').textContent = `${next.settings.sayChannels.length} selected`; $('admin-count').textContent = `${next.settings.adminRoles.length} selected`; $('dm-count').textContent = `${next.settings.dungeonMasterRoles.length} selected`;
    $('enabled').checked = next.settings.roleplayEnabled;
    choices('channels', next.channels, next.settings.sayChannels, '# '); choices('admin-roles', next.roles, next.settings.adminRoles); choices('dm-roles', next.roles, next.settings.dungeonMasterRoles);
    $('search').value = ''; renderCharacters();
    document.querySelectorAll('.server-rail-button').forEach(el => el.classList.toggle('active', el.dataset.id === id));
    $('workspace').hidden = false; showPage(page); notice();
  } catch (error) { if (version === selectionVersion) notice(error.message, true); }
}
$('search').addEventListener('input', renderCharacters);
$('settings').addEventListener('change', () => { dirty = true; $('dirty').textContent = 'You have unsaved changes.'; });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
$('settings').addEventListener('submit', async event => {
  event.preventDefault(); $('save').disabled = true;
  const selected = id => [...$(id).querySelectorAll('input:checked')].map(el => el.value);
  try {
    await api(`/api/guilds/${guildId}`, { method: 'PUT', body: JSON.stringify({ roleplayEnabled: $('enabled').checked, sayChannels: selected('channels'), adminRoles: selected('admin-roles'), dungeonMasterRoles: selected('dm-roles') }) });
    dirty = false; await selectGuild(guildId); $('dirty').textContent = 'All changes saved.'; notice('Settings saved. Your bot is up to date.');
  } catch (error) { notice(error.message, true); } finally { $('save').disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST' }); dirty = false; location.reload(); } catch (error) { notice(error.message, true); } });
async function init() {
  try {
    session = await api('/api/session');
    if (!session.user) { $('welcome').hidden = false; notice(session.configured ? 'Sign in to manage your community.' : 'Discord login will be available once the dashboard is configured.'); if (!session.configured) $('login').hidden = true; return; }
    $('account').textContent = session.user.name; $('logout').hidden = false;
    const guilds = await api('/api/guilds');
    for (const guild of guilds) {
      const button = document.createElement('button'); button.className = 'server-rail-button'; button.dataset.id = guild.id; button.title = guild.name; button.setAttribute('aria-label', guild.name);
      if (guild.icon) { const img = document.createElement('img'); img.src = guild.icon; img.alt = ''; button.append(img); } else button.textContent = guild.name.slice(0, 2).toUpperCase();
      button.addEventListener('click', () => selectGuild(guild.id)); $('servers').append(button);
    }
    if (guilds.length) await selectGuild(guilds[0].id); else notice('No servers available. You need Manage Server permission in a server where Narrator is installed.');
  } catch (error) { notice(error.message, true); }
}
init();
