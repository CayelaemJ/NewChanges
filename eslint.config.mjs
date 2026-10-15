import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.vite/**', '**/public/**', '**/package-lock.json', '**/frontend/**'] },
  { files: ['src/**/*.{js,jsx,ts,tsx}', 'server/**/*.{js,jsx,ts,tsx}', 'tests/**/*.{js,jsx,ts,tsx}'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, ...globals.node } }, rules: { ...js.configs.recommended.rules, 'no-undef': 'off', 'no-unused-vars': 'off' } },
];
