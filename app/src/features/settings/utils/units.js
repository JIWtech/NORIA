export function resolveUnits(rawUnits, rawLocations) {
  const locationsList = Array.isArray(rawLocations) ? rawLocations
    : rawLocations && typeof rawLocations === 'object'
      ? Object.entries(rawLocations).map(([k, v]) => ({ id: v?.id || k, ...v })) : [];
  if (!rawUnits) return [];
  let list = [];
  if (Array.isArray(rawUnits)) {
    list = rawUnits.map((u) => ({ id: u.id || u.slug || u.name, name: u.name || u.label || u.id, ...u }));
  } else if (typeof rawUnits === 'object') {
    list = Object.entries(rawUnits).map(([key, val]) => ({ id: val?.id || val?.slug || key, name: val?.name || val?.label || key, ...val }));
  }
  return list.map((unit) => {
    const matchedLoc = locationsList.find((loc) => String(loc?.id || '').toLowerCase() === String(unit?.id || '').toLowerCase());
    return { ...unit, displayName: matchedLoc?.name || unit?.name || unit?.id, address: matchedLoc?.address || unit?.address || null };
  });
}

export function resolveEnabledChannels(rawEnabledChannels) {
  return Array.isArray(rawEnabledChannels) ? rawEnabledChannels : [];
}
