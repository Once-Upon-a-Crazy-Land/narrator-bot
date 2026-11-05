# Narrator dashboard

The dashboard runs with the bot on `PORT` (default 3000). Its shell, styles, server rail, profile rendering, and save notifications come directly from the All-Seeing dashboard. The root serves the landing page; `/dashboard.html` serves the authenticated dashboard. It provides a live server overview, searchable character list, roleplay channel configuration, and admin/dungeon master role settings. Character creation and editing remain available in Discord.

Like All-Seeing, the dashboard signs users in before loading servers, uses an avatar rail for switching servers, exposes Overview and configuration subtabs, and saves changes automatically after 650 ms. Switching servers flushes pending saves first. The profile button opens logout confirmation. Channel and role selections use the same tag picker markup and component styles. Narrator-specific adapters connect these controls to its existing data, without importing All-Seeing's leveling, economy, moderation, or billing features.

## Reusable multi-select component

Use `public/dashboard-picker.js` and `public/dashboard-picker.css` for all channel and role multi-selects. Do not implement selection handlers or selection styling separately on each page.

```js
const picker = createDashboardPicker({
  root: document.querySelector('#say-channels-picker'),
  storage: document.querySelector('#say-channels'),
  onChange: scheduleSave
});
// After populating the hidden select and setting option.selected:
picker.render();
```

The root uses the original `.tag-picker` markup with `.picker-control`, `.picker-tags`, `.picker-placeholder`, and `.picker-menu`. Options must remain adjacent button siblings without vertical gaps. Adjacent selected options join into a single pink block: only the first row's top corners and the last row's bottom corners are rounded. A single selected option retains all four corners; an unselected option splits selected runs. This reproduces All-Seeing's `.select-popup` adjacency rules. Updates keep the menu open and retain focus and scroll position. The hidden select remains the source of truth for saving.

## Connect narrator.crazyland.art

1. Set these values in the bot host's environment:

   ```dotenv
   DASHBOARD_URL=https://narrator.crazyland.art
   DISCORD_CLIENT_SECRET=your-discord-application-oauth-secret
   ```

   Keep the existing `CLIENT_ID` and `DISCORD_TOKEN`. The client secret comes from the Narrator application's OAuth2 page in the Discord Developer Portal.

2. Add this exact OAuth2 redirect to that Discord application:

   ```text
   https://narrator.crazyland.art/auth/callback
   ```

3. Route the subdomain to the existing bot host. On Railway, add `narrator.crazyland.art` as a custom domain for the bot service and use the DNS record Railway supplies. On a VM, point DNS at the VM and configure an HTTPS reverse proxy to `127.0.0.1:3000`. The compose file binds the dashboard to loopback for this arrangement. For example, Caddy:

   ```caddyfile
   narrator.crazyland.art {
       reverse_proxy 127.0.0.1:3000
   }
   ```

4. Deploy/restart the bot and open the domain. `/health` returns bot readiness for health checks. The root now serves the dashboard.

For local development, set `DASHBOARD_URL=http://localhost:3000` and add `http://localhost:3000/auth/callback` to the Discord application's redirects.

## Access

Discord login uses the `identify` and `guilds` scopes. Only servers with Narrator installed and where the signed-in member has Manage Server or Administrator appear. Every server request checks live Discord membership and permissions. Changes use origin and CSRF validation. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Sessions stay in memory for at most eight hours; restarting the bot signs users out. Run one dashboard/bot instance for these in-memory sessions and JSON settings.

The dashboard does not expose tokens, webhook credentials, chat logs, or member balances. Saving uses the bot's existing persistence functions. Font files retain their license in `public/fonts/Lato-OFL.txt`.

Domain routing and Discord OAuth settings must be configured on the hosting and Discord accounts before production login works.
