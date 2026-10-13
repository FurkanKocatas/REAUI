let token = '';
export const setToken = (value) => {
  token = value;
};
export const getToken = () => token;
export async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': token, ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export const title = (value) => value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const fileName = (value) => value?.split('/').filter(Boolean).at(-1) || 'No target';
export const shortTime = (value) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const pretty = (value) => JSON.stringify(value, null, 2);
export function unpack(result) {
  if (result?.structuredContent) return result.structuredContent;
  for (const c of result?.content || [])
    if (c.type === 'text') {
      try {
        return JSON.parse(c.text);
      } catch {}
    }
  return result;
}
export function category(tool) {
  const n = tool.name;
  if (/adb|android|apktool|flutter|dart|harmony|jeb/.test(n)) return 'Mobile';
  if (/firmware|signal|packet|pcap/.test(n)) return 'Hardware & firmware';
  if (/javascript|electron|application|web_|browser/.test(n)) return 'Web & applications';
  if (/managed|dotnet|wasm|evm|go_binary|sqlite/.test(n)) return 'Formats & data';
  if (/evidence|unknown|obligation|reference|analysis_view/.test(n)) return 'Evidence & research';
  if (/frida|process|scenario/.test(n)) return 'Runtime';
  if (/session|binary$|snapshot/.test(n)) return 'Sessions';
  return 'Native binaries';
}
export function resolveSchema(schema, root, depth = 0) {
  if (!schema || depth > 20) return schema || {};
  if (schema.$ref?.startsWith('#/')) {
    const target = schema.$ref
      .slice(2)
      .split('/')
      .reduce((o, k) => o?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], root);
    const { $ref, ...rest } = schema;
    return { ...resolveSchema(target, root, depth + 1), ...rest };
  }
  const branch = schema.anyOf?.find((x) => x.type !== 'null') || schema.oneOf?.[0];
  return branch ? { ...resolveSchema(branch, root, depth + 1), ...schema } : schema;
}
export function initialArgs(tool, target) {
  const schema = tool.inputSchema,
    result = {};
  for (const [name, raw] of Object.entries(schema.properties || {})) {
    const p = resolveSchema(raw, schema);
    if (p.default !== undefined) result[name] = p.default;
    if (
      target &&
      ['path', 'input_path', 'binary_path', 'target_path', 'capture_path'].includes(name)
    )
      result[name] = target;
  }
  return result;
}
export const toFormValues = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value === null ? null : typeof value === 'object' ? pretty(value) : String(value),
    ]),
  );
export function parseFormArgs(schema, values, validate = true) {
  const result = {};
  for (const [name, value] of Object.entries(values)) {
    if (value === '') continue;
    if (value === null) {
      result[name] = null;
      continue;
    }
    const field = resolveSchema(schema.properties[name], schema);
    result[name] = ['integer', 'number'].includes(field.type)
      ? Number(value)
      : field.type === 'boolean'
        ? value === 'true'
        : ['object', 'array'].includes(field.type) ||
            field.anyOf?.some((x) => ['object', 'array'].includes(x.type))
          ? JSON.parse(value)
          : value;
    if (['integer', 'number'].includes(field.type) && !Number.isFinite(result[name]))
      throw Error(name + ' must be a number');
    if (field.type === 'integer' && !Number.isInteger(result[name]))
      throw Error(name + ' must be an integer');
  }
  for (const name of schema.required || [])
    if (validate && result[name] === undefined) throw Error(name + ' is required');
  return result;
}
export function download(name, data) {
  const blob = new Blob([typeof data === 'string' ? data : pretty(data)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
