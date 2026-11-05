import type { SVGProps } from "react";

/**
 * Иконки ТЕХНОЛАБ: один набор, одна толщина штриха (1.75), монохром.
 * Размер по умолчанию — 20px (UI-диапазон 16–24). Цвет наследуется (`currentColor`),
 * поэтому иконка всегда совпадает с цветом текста и не вводит четвёртый цвет.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props,
  };
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function IconCart(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 4h2.2l2.3 10.4a1.6 1.6 0 001.6 1.3h8.5a1.6 1.6 0 001.6-1.3L21 7H6" />
      <circle cx="9.5" cy="19.5" r="1.25" />
      <circle cx="17.5" cy="19.5" r="1.25" />
    </svg>
  );
}

export function IconBox(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 8.5v7a1.8 1.8 0 01-.95 1.58l-7 3.9a1.8 1.8 0 01-1.8 0l-7-3.9A1.8 1.8 0 003.3 15.5v-7a1.8 1.8 0 01.95-1.58l7-3.9a1.8 1.8 0 011.8 0l7 3.9A1.8 1.8 0 0121 8.5z" />
      <path d="M3.6 8.2L12 12.7l8.4-4.5M12 12.7V21" />
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

export function IconReceipt(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h12v17l-2.4-1.6-1.8 1.6-1.8-1.6L10.2 20.5 8.4 18.9 6 20.5V3.5z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20.5a7.5 7.5 0 0115 0" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

export function IconTag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.5 12.8l-7.7 7.7a1.8 1.8 0 01-2.5 0l-6.8-6.8a1.8 1.8 0 01-.5-1.3V4.8A1.3 1.3 0 014.3 3.5h7.6a1.8 1.8 0 011.3.5l7.3 7.3a1.8 1.8 0 010 2.5z" />
      <circle cx="8" cy="8" r="1.35" />
    </svg>
  );
}

export function IconMessage(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4a10 10 0 01-2.6-.34L4.5 20.5l1.1-3.6A7 7 0 013.5 12c0-4.1 3.8-7.4 8.5-7.4s8.5 3.3 8.5 7.4z" />
    </svg>
  );
}
