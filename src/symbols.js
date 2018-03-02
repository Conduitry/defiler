export default new Proxy({}, { get: (_, key) => Symbol(key) })
