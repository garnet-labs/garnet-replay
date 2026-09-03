function joinPath(path, key) {
  return path === "$" ? `${path}.${key}` : `${path}.${key}`
}

function typeMatches(type, value) {
  if (type === "null") return value === null
  if (type === "array") return Array.isArray(value)
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value)
  if (type === "integer") return typeof value === "number" && Number.isInteger(value)
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  return typeof value === type
}

function validateValue(schema, value, root, path) {
  const errors = []
  if (schema.$ref !== undefined) {
    const prefix = "#/$defs/"
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith(prefix)) {
      return [`${path} ($ref)`]
    }
    const definition = root.$defs?.[schema.$ref.slice(prefix.length)]
    return definition === undefined ? [`${path} ($ref)`] : validateValue(definition, value, root, path)
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(path)
  if (schema.enum !== undefined && !schema.enum.includes(value)) errors.push(path)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => typeMatches(type, value))) errors.push(path)
  }
  if (errors.length > 0) return errors
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(path)
  }
  if (typeof value === "string" && schema.pattern !== undefined) {
    if (!new RegExp(schema.pattern).test(value)) errors.push(path)
  }
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) errors.push(path)
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => errors.push(...validateValue(schema.items, item, root, `${path}[${index}]`)))
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {}
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(joinPath(path, required))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(joinPath(path, key))
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) errors.push(...validateValue(childSchema, value[key], root, joinPath(path, key)))
    }
  }
  return errors
}

/**
 * Validate a JSON value against the supported subset of JSON Schema.
 * @param {Record<string, any>} schema
 * @param {unknown} value
 * @returns {string[]}
 */
export function validate(schema, value) {
  if (schema === null || typeof schema !== "object") return ["$"]
  return validateValue(schema, value, schema, "$")
}
