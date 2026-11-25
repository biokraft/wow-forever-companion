// Narrow bridge between the overlay page and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('fc', {
  setup: () => ipcRenderer.invoke('setup'),
  status: () => ipcRenderer.invoke('status'),
  hints: () => ipcRenderer.invoke('hints'),
  send: (text, look) => ipcRenderer.invoke('send', { text, look }),
  abort: () => ipcRenderer.invoke('abort'),
  chats: () => ipcRenderer.invoke('chats'),
  openChat: (id) => ipcRenderer.invoke('chat-open', id),
  newChat: () => ipcRenderer.invoke('chat-new'),
  deleteChat: (id) => ipcRenderer.invoke('chat-delete', id),
  currentChat: () => ipcRenderer.invoke('chat-current'),
  gamePlan: () => ipcRenderer.invoke('gameplan'),
  planPage: (open) => ipcRenderer.invoke('plan-page', open),
  planFold: (id, open) => ipcRenderer.invoke('plan-fold', { id, open }),
  planIntroSeen: () => ipcRenderer.invoke('plan-intro-seen'),
  models: () => ipcRenderer.invoke('models'),
  setModel: (provider, id) => ipcRenderer.invoke('set-model', { provider, id }),
  opacity: () => ipcRenderer.invoke('opacity'),
  setOpacity: (value, save) => ipcRenderer.invoke('set-opacity', { value, save }),
  reportProblem: () => ipcRenderer.invoke('report-problem'),
  hide: () => ipcRenderer.invoke('hide'),
  toggle: () => ipcRenderer.invoke('toggle'),
  moveButton: (dx, dy) => ipcRenderer.invoke('button-move', { dx, dy }),
  saveButton: () => ipcRenderer.invoke('button-save'),
  collapse: (collapsed) => ipcRenderer.invoke('collapse', collapsed),
  onDelta: on('delta'),
  onTool: on('tool'),
  onUsage: on('usage'),
  onShown: on('shown'),
  onHidden: on('hidden'),
});
