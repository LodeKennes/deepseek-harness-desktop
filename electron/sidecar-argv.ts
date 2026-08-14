export function sidecarArgv(entry: string, opts: {
  port: number
  patchPath?: string
  patchPaths?: readonly string[]
}): string[] {
  const patches = [...(opts.patchPaths ?? []), ...(opts.patchPath ? [opts.patchPath] : [])]
  return [
    entry,
    'web',
    ...patches.flatMap((path) => ['--patch', path]),
    '--host',
    '127.0.0.1',
    '--port',
    String(opts.port),
  ]
}
