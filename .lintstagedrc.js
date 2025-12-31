module.exports = {
  '*.{ts,tsx}': [
    (filenames) => `eslint --fix ${filenames.join(' ')}`,
    'prettier --write',
    () => 'pnpm type:check', // Run type:check on all files (not just staged)
    'pnpm test', // Run all tests to ensure changes don't break anything
  ],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
