import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'eslint.config.mjs'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'scripts/*.ts',
            'migrations/*.ts',
            'test/*.ts',
            'vitest.config.ts',
            'vitest.eval.config.ts',
            'vitest.integration.config.ts',
          ],
          defaultProject: 'tsconfig.scripts.json',
          // Список миграций будет расти на каждом этапе roadmap — поднимаем лимит,
          // чтобы не приходилось трогать конфиг при каждой новой миграции.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 50,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.eval.ts', 'packages/shared/src/testing/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  eslintConfigPrettier,
);
