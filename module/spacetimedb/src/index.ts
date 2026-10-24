// Both kinds of export are required. SpacetimeDB registers reducers and
// lifecycle hooks from the NAMED EXPORTS of this entry file: a bare
// `import './flight'` evaluates the file but publishes nothing, and the
// reducers vanish with no build or publish error. Every reducer file goes here.
export * from './rooms';
export * from './run';
export * from './flight';

// The entry file must expose the schema as its default export.
export { default } from './schema';
