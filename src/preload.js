'use strict';
// The only bridge between Pip's pages and the main process: a fixed list of calls, nothing generic.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const on = channel => fn => { const h = (_e, payload) => fn(payload); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); };

contextBridge.exposeInMainWorld('pip', {
  init: call('app:init'), hubError: call('hub:error'), strings: call('app:strings'),
  setSettings: call('settings:set'), openSettings: call('settings:open'), setAutostart: call('autostart:set'),
  connectAgent: call('agents:connect'), decide: call('ai:decide'), reply: call('ai:reply'), setRadio: call('radio:set'),
  spotifyLogin: call('spotify:login'), spotifyLogout: call('spotify:logout'), spotifyDevices: call('spotify:devices'), spotifyTransfer: call('spotify:transfer'),
  googleLogin: call('google:login'), googleLogout: call('google:logout'), googleEvents: call('google:events'), googleUnread: call('google:unread'), openInbox: call('google:openInbox'), agentOpen: call('agent:open'), lastClip: () => ipcRenderer.invoke('clips:last'),
  checkUpdate: call('app:update'), openRelease: call('app:release'),
  media: call('media:cmd'), seek: call('media:seek'), setVolume: call('volume:set'), lyrics: call('lyrics:get'), songInfo: call('song:info'),
  weather: call('weather:get'), calendar: call('calendar:get'), stats: call('stats:get'),
  trayAdd: call('tray:add'), trayRemove: call('tray:remove'), trayOpen: call('tray:open'), copyClip: call('clips:copy'), clearClips: call('clips:clear'), quit: call('app:quit'),
  shareStart: call('share:start'), shareStop: call('share:stop'), shareFirewall: call('share:firewall'),
  ask: call('buddy:ask'), windows: call('buddy:windows'), guardChoice: call('guard:choice'),
  mouse: inside => ipcRenderer.send('island:mouse', Boolean(inside)), focus: onOff => ipcRenderer.send('island:focus', Boolean(onOff)),
  dragOut: file => ipcRenderer.send('tray:drag', String(file)),
  pathFor: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  onAi: on('ai:state'), onFinish: on('ai:finish'), onWin: on('win:state'), onTray: on('tray:changed'), onClips: on('clips:changed'),
  onToggle: on('island:toggle'), onArt: on('win:art'), onCursor: on('cursor'), onChanged: on('app:changed')
});
