import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**"] },
];
export default config;
