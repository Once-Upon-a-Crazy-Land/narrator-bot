function showSaveToast(message,error=false){const toast=$('#save-state');clearTimeout(toastTimer);toast.textContent=message;toast.classList.toggle('error',error);toast.classList.remove('hidden');toastTimer=setTimeout(()=>toast.classList.add('hidden'),2200)}
function escapeHtml(value){const e=document.createElement('div');e.textContent=value;return e.innerHTML}
function syncServerRail(){
  document.querySelectorAll('[data-server-id]').forEach(button=>{
    const active=button.dataset.serverId===state.guildId;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
  });
}
function renderServerRail(guilds,clientId){
  const list=$('#server-rail-list');list.replaceChildren();
  for(const guild of guilds){
    const button=document.createElement('button');button.type='button';button.className='server-rail-button';button.dataset.serverId=guild.id;button.title=guild.name;button.setAttribute('aria-label',guild.name);
    if(guild.icon&&/^\d+$/.test(guild.id)&&/^[a-zA-Z0-9_]+$/.test(guild.icon)){
      const image=document.createElement('img');image.src='https://cdn.discordapp.com/icons/'+guild.id+'/'+guild.icon+'.png?size=80';image.alt='';image.addEventListener('error',()=>{button.textContent=guild.name.slice(0,1).toUpperCase();});button.append(image);
    }else button.textContent=guild.name.slice(0,1).toUpperCase();
    button.onclick=()=>switchServer(guild.id);list.append(button);
  }
  const invite=$('#server-rail-invite');invite.href='https://discord.com/oauth2/authorize?client_id='+encodeURIComponent(clientId)+'&permissions=268504064&scope=bot';invite.classList.remove('hidden');syncServerRail();
}

function renderRailProfile(user) {
  const profile = $('#server-rail-profile');
  profile.replaceChildren();
  profile.textContent = user.username[0].toUpperCase();
  profile.title = user.username + ' - Log out';
  profile.setAttribute('aria-label', user.username + ' profile - log out');
  if (user.avatar) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = 'https://cdn.discordapp.com/avatars/' + encodeURIComponent(user.id) + '/' + encodeURIComponent(user.avatar) + '.png?size=128';
    image.onerror = () => image.remove();
    profile.append(image);
  }
}
