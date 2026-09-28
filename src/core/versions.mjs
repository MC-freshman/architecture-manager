const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

export function compareStableVersions(left, right) {
  const a = STABLE.exec(left);
  const b = STABLE.exec(right);
  if (!a || !b) throw new Error('STABLE_VERSION_REQUIRED');
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return difference;
  }
  return 0;
}

export function latestStableVersion(versions) {
  return [...versions].filter((version) => STABLE.test(version)).sort(compareStableVersions).at(-1) || null;
}
