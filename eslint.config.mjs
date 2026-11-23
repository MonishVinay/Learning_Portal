import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([...nextVitals, ...nextTs, globalIgnores(['.next/**', 'next-env.d.ts']), { rules: {
  'react-hooks/set-state-in-effect': 'off',
  // Authentication transitions intentionally reload all user-scoped server/client state.
  '@next/next/no-location-assign-relative-destination': 'off',
} }]);
