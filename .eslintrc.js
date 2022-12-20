module.exports = {
    env: {
      browser: true,
      es2021: true,
    },
    extends: [
      'airbnb-base',
    ],
    parserOptions: {
      ecmaVersion: 13,
      sourceType: 'module',
    },
    rules: {
     "no-await-in-loop": "off",
     "no-console": "off",
     "guard-for-in": "off",
     "no-param-reassign": "off",
     "no-restricted-syntax": "off",
     "no-promise-executor-return": "off",
     "func-names": "off",
     "import/no-unresolved": "off",
     "no-case-declarations": "off"
  
    },
  };
  