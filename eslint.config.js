import pluginImport from "eslint-plugin-import";

export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    plugins: {
      import: pluginImport,
    },
    rules: {
      "import/no-unresolved": ["error", { commonjs: false }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
