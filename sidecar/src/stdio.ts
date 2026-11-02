/**
 * stdout is reserved for the JSON-lines protocol with the desktop app. Everything that would normally go to the
 * console (including matter.js logging) is redirected to stderr. This module must be imported first.
 */
const toStderr = (...args: unknown[]) => {
    process.stderr.write(args.map(a => (typeof a === "string" ? a : safeJson(a))).join(" ") + "\n");
};

function safeJson(value: unknown) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.warn = toStderr;
console.error = toStderr;
console.trace = toStderr;

export function send(message: unknown) {
    process.stdout.write(JSON.stringify(message, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
}
