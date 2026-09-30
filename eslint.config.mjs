// ESLint flat config — 只做正确性检查，不做任何风格/格式化（不引 stylistic / prettier）。
// 规则来源：typescript-eslint 的 recommended（本就不含风格子集）+ react-hooks 两条规则。
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    // 构建产物、依赖、原样拷贝的静态资源、以及自成一体的 e2e（独立 package.json）都不属于本轮源码
    ignores: ['node_modules/**', 'dist/**', 'public/**', 'e2e/**'],
  },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // react-hooks 只开两条：hooks 调用规则报错，依赖数组提示用 warn
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 未使用变量保持 warn，不升级为 error（既有代码不因清理提示而失败）
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
]
