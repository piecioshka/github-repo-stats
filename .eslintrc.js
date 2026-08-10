module.exports = {
  extends: [
    'piecioshka',
    'plugin:jsdoc/recommended',
    'plugin:prettier/recommended',
  ],

  plugins: ['smells', 'import', 'todo-with-label', 'jsdoc'],

  // https://eslint.org/docs/user-guide/configuring#specifying-environments
  env: {
    browser: true,
    node: true,
    commonjs: true,
    es6: true,
    // amd: true,
    // mocha: true,
    // jasmine: true,
    // jquery: true,
  },

  overrides: [
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['plugin:@typescript-eslint/recommended'],
    },
  ],

  // https://eslint.org/docs/rules/
  rules: {
    // Prettier owns formatting (enforced by format:check in CI).
    indent: 'off',
    'no-magic-numbers': 'off',
    'require-jsdoc': 'off',
    'default-case': 'off',
    'object-curly-newline': 'off',
    'no-console': 'off',
    'no-undefined': 'off',
    'id-blacklist': 'off',
    'valid-jsdoc': 'off',

    // The GitHub API responds with snake_case fields.
    camelcase: 'off',

    // Retry loops exit via return/throw.
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-continue': 'off',

    // Types live in TypeScript signatures, not in JSDoc.
    'jsdoc/require-jsdoc': 'off',
    'jsdoc/require-param': 'off',
    'jsdoc/require-param-type': 'off',
    'jsdoc/require-param-description': 'off',
    'jsdoc/require-returns': 'off',

    'smells/no-switch': 'off',
    'smells/no-complex-switch-case': 'error',
    'smells/no-setinterval': 'off',
    'smells/no-this-assign': 'error',

    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-duplicates': 'error',
    'import/no-extraneous-dependencies': 'error',

    'todo-with-label/has-valid-pattern': 'error',
  },

  // List of global variables.
  globals: {},

  parserOptions: {
    // Support syntax ES2018
    ecmaVersion: 2018,

    // Support syntax ES2015 Import/Export
    sourceType: 'module',
  },
};
