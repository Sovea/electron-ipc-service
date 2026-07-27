/** ipc channel type */
export const IpcChannelType = {
  Internal: 'internal',
  Request: 'external:request',
  Event: 'external:event',
} as const;
