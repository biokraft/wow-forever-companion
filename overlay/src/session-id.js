// A backend session id ends up in the command line of the CLI that also carries the sandbox
// flags, and it can come from a chat file on disk or from process output. Only the UUID shape
// both backends really use is accepted, so no value can be read as another flag.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(id) {
  return typeof id === 'string' && UUID.test(id);
}
