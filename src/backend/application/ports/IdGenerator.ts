// Application-level port for generating unique identifiers. Keeps use cases and
// application services free of a concrete id library (uuid) — Group 6 injects the
// concrete generator. Tests provide a deterministic sequential factory.

export type IdGenerator = () => string;
