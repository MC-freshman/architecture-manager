import declarations from '../app/operations.json' with { type: 'json' };
export function operationRegistrar(ipcMain) {
  const channels = new Set(Object.values(declarations.operations).map(operation => operation.channel));
  const registered = new Set();
  return (channel, handler) => {
    if (!channels.has(channel) || registered.has(channel)) throw new Error('IPC_OPERATION_UNDECLARED:'+channel);
    registered.add(channel);
    return ipcMain.handle(channel,handler);
  };
}
