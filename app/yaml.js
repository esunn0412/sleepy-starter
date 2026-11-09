// Minimal YAML printer for showing an attendee's Pod (objects, arrays, scalars).

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // Quote anything YAML could misread.
  // Leading digit/sign/dot is quoted too: ids like 1e10 would otherwise read as numbers.
  return /^[A-Za-z_/][A-Za-z0-9_ ./:-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|y|n|~)$/i.test(s) && !/: |:$|\s$/.test(s)
    ? s : JSON.stringify(s);
}

function toYaml(v, indent = '') {
  if (Array.isArray(v)) {
    if (!v.length) return ' []';
    return v.map((item) => {
      if (item && typeof item === 'object') {
        const body = toYaml(item, indent + '  ').replace(/^\n\s*/, '');
        return `\n${indent}- ${body}`;
      }
      return `\n${indent}- ${scalar(item)}`;
    }).join('');
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return ' {}';
    return keys.map((k) => {
      const val = v[k];
      if (val && typeof val === 'object') return `\n${indent}${scalar(k)}:${toYaml(val, indent + '  ')}`;
      return `\n${indent}${scalar(k)}: ${scalar(val)}`;
    }).join('');
  }
  return ` ${scalar(v)}`;
}

module.exports = { toYaml: (v) => toYaml(v).replace(/^\n/, '') + '\n' };
