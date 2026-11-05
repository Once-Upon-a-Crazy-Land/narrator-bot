const $ = selector => document.querySelector(selector);
let state = { guildId: null, data: null };
let serverSwitchPending = false, saveTimer, toastTimer, csrf = '', revision = 0, savedRevision = 0, saveInFlight = null;
let section = 'roleplay', roleplayTab = 'overview', characterPage = 1;

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...options.headers } });
  if (response.status === 401) { location.href = '/auth/discord'; throw new Error('Sign in required'); }
  if (response.status === 204) return null;
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Could not complete the request.');
  return json;
}
function showSection(name) {
  section = name;
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.section === name));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.add('hidden'));
  $('#roleplay-tabs').classList.toggle('hidden', name !== 'roleplay' || !state.data);
  if (!state.data) return;
  const page = name === 'roleplay' ? roleplayTab : name;
  $('#' + page).classList.remove('hidden');
  const title = { overview: 'Community overview', roleplay: 'Roleplay', characters: 'Characters', permissions: 'Permissions' }[page];
  $('#title').textContent = title;
  $('#crumb').textContent = 'DASHBOARD / ' + name.toUpperCase() + (name === 'roleplay' ? ' / ' + page.toUpperCase() : '');
}
function renderModuleStatuses() {
  const badge = $('[data-module-status="roleplay"]');
  badge.textContent = state.data ? (state.data.settings.roleplayEnabled ? 'Enabled' : 'Disabled') : 'Loading';
  badge.classList.toggle('is-enabled', !!state.data?.settings.roleplayEnabled);
}
function renderCharacters() {
  const characters = state.data.characters.filter(character => character.name.toLowerCase().includes($('#character-search').value.toLowerCase()));
  const pages = Math.max(1, Math.ceil(characters.length / 10));
  characterPage = Math.min(characterPage, pages);
  $('#character-list').innerHTML = characters.length ? characters.slice((characterPage - 1) * 10, characterPage * 10).map((character, index) => `<div><b>${(characterPage - 1) * 10 + index + 1}</b><div class="leaderboard-user">${escapeHtml(character.name)}</div><strong aria-label="${character.assigned ? 'Assigned' : 'Available'}">${character.assigned ? 'Taken' : 'Free'}</strong><small>${escapeHtml(String(character.id))}</small></div>`).join('') : '<div class="empty compact">No characters found.</div>';
  $('#characters-page').textContent = `Page ${characterPage} of ${pages}`;
  $('#characters-prev').disabled = characterPage <= 1;
  $('#characters-next').disabled = characterPage >= pages;
}
function updateOverview() {
  const data = state.data;
  $('#member-count').textContent = data.memberCount.toLocaleString();
  $('#character-count').textContent = data.characters.length;
  $('#status').textContent = data.settings.roleplayEnabled ? 'Active' : 'Paused';
  $('#channel-count').textContent = data.settings.sayChannels.length + ' selected';
  $('#admin-count').textContent = data.settings.adminRoles.length + ' selected';
  $('#dm-count').textContent = data.settings.dungeonMasterRoles.length + ' selected';
  renderModuleStatuses();
}
const pickerKeys = { 'say-channels': 'sayChannels', 'admin-roles': 'adminRoles', 'dm-roles': 'dungeonMasterRoles' };
const pickers = Object.fromEntries(Object.keys(pickerKeys).map(id => [id, createDashboardPicker({
  root: $('#' + id + '-picker'),
  storage: $('#' + id),
  onChange: scheduleSave
})]));
function renderPicker(id) { pickers[id].render(); }
function collectSettings() {
  const settings = { roleplayEnabled: $('#roleplay-enabled').checked };
  for (const [id, key] of Object.entries(pickerKeys)) settings[key] = [...$('#' + id).selectedOptions].map(option => option.value);
  return settings;
}
function scheduleSave() {
  revision++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save().catch(error => showSaveToast(error.message, true)); }, 650);
}
async function save() {
  if (saveInFlight) { await saveInFlight; return save(); }
  if (!state.data || revision === savedRevision) return;
  const guildId = state.guildId, currentRevision = revision, settings = collectSettings();
  showSaveToast('Saving...');
  saveInFlight = request(`/api/guilds/${guildId}`, { method: 'PUT', body: JSON.stringify(settings) });
  try {
    await saveInFlight;
    savedRevision = currentRevision;
    if (state.guildId === guildId) { state.data.settings = settings; updateOverview(); }
    showSaveToast('All changes saved');
  } finally { saveInFlight = null; }
  if (revision !== savedRevision) await save();
}
async function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  await save();
}
async function loadGuild(id) {
  $('#loading').classList.remove('hidden');
  $('#loading').replaceChildren();
  const indicator = document.createElement('div'); indicator.className = 'loading-indicator'; indicator.setAttribute('role', 'status');
  indicator.innerHTML = '<img class="loading-spinner" src="/images/spinner.png" alt="" width="96" height="96"><span>Loading...</span>';
  $('#loading').append(indicator);
  document.querySelectorAll('.panel').forEach(panel => panel.classList.add('hidden'));
  $('#roleplay-tabs').classList.add('hidden');
  const data = await request(`/api/guilds/${id}`);
  state = { guildId: id, data }; revision = savedRevision = 0; syncServerRail();
  $('#roleplay-enabled').checked = data.settings.roleplayEnabled;
  for (const [pickerId, key] of Object.entries(pickerKeys)) {
    const channels = pickerId === 'say-channels';
    $('#' + pickerId).innerHTML = (channels ? data.channels : data.roles).map(item => `<option value="${escapeHtml(item.id)}">${channels ? '# ' : '@ '}${escapeHtml(item.name)}</option>`).join('');
    for (const option of $('#' + pickerId).options) option.selected = data.settings[key].includes(option.value);
    renderPicker(pickerId);
  }
  updateOverview(); $('#character-search').value = ''; characterPage = 1; renderCharacters();
  $('#loading').classList.add('hidden'); showSection(section);
  const url = new URL(location.href); url.searchParams.set('guild', id); history.replaceState({}, '', url);
}
async function switchServer(guildId) {
  if (serverSwitchPending || state.guildId === guildId) return;
  serverSwitchPending = true;
  try { await flushSave(); await loadGuild(guildId); }
  catch (error) { showSaveToast(error.message, true); if (state.data) { $('#loading').classList.add('hidden'); showSection(section); } else $('#loading').textContent = error.message; }
  finally { serverSwitchPending = false; }
}
async function confirmLogout() {
  if (!confirm('Log out of the dashboard?')) return;
  try { await flushSave(); await request('/auth/logout', { method: 'POST' }); location.href = '/'; }
  catch (error) { showSaveToast(error.message, true); }
}
$('#server-rail-profile').onclick = confirmLogout;
$('#roleplay-enabled').onchange = scheduleSave;
$('#character-search').oninput = () => { characterPage = 1; renderCharacters(); };
$('#characters-prev').onclick = () => { characterPage--; renderCharacters(); };
$('#characters-next').onclick = () => { characterPage++; renderCharacters(); };
document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => showSection(tab.dataset.section));
document.querySelectorAll('[data-tab]').forEach(tab => tab.onclick = () => {
  roleplayTab = tab.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button === tab));
  showSection('roleplay');
});
window.addEventListener('beforeunload', event => { if (revision !== savedRevision) { event.preventDefault(); event.returnValue = ''; } });
async function boot() {
  try {
    const meta = await request('/api/meta');
    if (!meta.configured) { $('#loading').textContent = 'Discord sign-in is not configured. Set the Narrator OAuth2 client secret on the bot host.'; return; }
    const [me, guilds] = await Promise.all([request('/api/me'), request('/api/guilds')]);
    csrf = me.csrf; renderRailProfile(me);
    const installed = guilds.filter(guild => guild.installed);
    renderServerRail(installed, meta.clientId);
    if (!installed.length) {
      $('#loading').innerHTML = `No manageable server has this bot installed yet.<br><a class="button" href="${escapeHtml($('#server-rail-invite').href)}">Add it to a server</a>`;
      return;
    }
    const returnGuild = new URLSearchParams(location.search).get('guild');
    await loadGuild(installed.some(guild => guild.id === returnGuild) ? returnGuild : installed[0].id);
  } catch (error) { $('#loading').textContent = error.message; }
}
boot();
