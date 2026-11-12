// Allow importing JSON files as typed modules without enabling `resolveJsonModule`
// project-wide. Vite resolves the JSON at build time; this declaration keeps the
// type checker happy.
declare module '*.json' {
  const value: { [key: string]: string };
  export default value;
}
