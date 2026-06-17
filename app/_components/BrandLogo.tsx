"use client";

import type {
  CSSProperties,
  ElementType,
} from "react";

type BrandLogoProps = {
  subtitle: string;
  subtitleTag?: "div" | "h1";
  size?: "compact" | "default" | "large";
  containerStyle?: CSSProperties;
  imageStyle?: CSSProperties;
  subtitleStyle?: CSSProperties;
};

const SIZE_STYLE = {
  compact: {
    width: 74,
    subtitleSize: 16,
    gap: 4,
  },
  default: {
    width: 92,
    subtitleSize: 18,
    gap: 6,
  },
  large: {
    width: 118,
    subtitleSize: 22,
    gap: 8,
  },
};

export function BrandLogo({
  subtitle,
  subtitleTag = "div",
  size = "default",
  containerStyle,
  imageStyle,
  subtitleStyle,
}: BrandLogoProps) {
  const config = SIZE_STYLE[size];
  const Subtitle = subtitleTag as ElementType;

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: config.gap,
        ...containerStyle,
      }}
    >
      <img
        src="/brand/zeta-logo.png"
        alt="ZETA"
        style={{
          display: "block",
          width: config.width,
          height: "auto",
          objectFit: "contain",
          ...imageStyle,
        }}
      />

      <Subtitle
        style={{
          margin: 0,
          color: "#0f172a",
          fontSize: config.subtitleSize,
          fontWeight: 750,
          lineHeight: 1.2,
          ...subtitleStyle,
        }}
      >
        {subtitle}
      </Subtitle>
    </div>
  );
}
