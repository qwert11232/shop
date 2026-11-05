import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Линт проекта: правила Next.js + осознанные исключения.
 * Отключён только `no-img-element`: фото товаров приходят с произвольных URL
 * (объектное хранилище), поэтому next/image с фиксированным domains не подходит.
 * Остальные правила Next действуют как есть — `eslint-disable` в коде не нужны.
 */
const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts"],
  },
  {
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
