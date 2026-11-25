export function charSlug(snapshot) {
  const part = (s) => String(s ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${part(snapshot.realm)}-${part(snapshot.name)}`;
}

export function firstName(snapshot) {
  return String(snapshot.name ?? '?').split(/\s+/)[0];
}
