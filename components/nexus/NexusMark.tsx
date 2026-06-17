import type { SVGProps } from "react";

type NexusMarkProps = SVGProps<SVGSVGElement> & {
  variant?: "full" | "mark";
  inverse?: boolean;
};

export function NexusMark({
  variant = "mark",
  inverse = false,
  ...props
}: NexusMarkProps) {
  const graphite = inverse ? "#ffffff" : "#111820";
  const green = "#2fa36b";

  return (
    <svg
      viewBox={variant === "full" ? "0 0 320 116" : "0 0 120 120"}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {variant === "full" ? (
        <>
          <g transform="translate(2 1) scale(.94)">
            <path
              d="M18 24h45l31 34-15 17-32-35H18l17 18-17 20 61-1-15 18H18l46-52L47 42Z"
              fill={graphite}
            />
            <path
              d="m98 22-35 40 15 17 20-23 25 39h28l-39-56 15-17H98Z"
              fill={green}
            />
          </g>
          <text
            x="163"
            y="45"
            fill={graphite}
            fontFamily="Arial, sans-serif"
            fontSize="23"
            fontWeight="700"
            letterSpacing="7"
          >
            ZETA
          </text>
          <text
            x="163"
            y="76"
            fill={green}
            fontFamily="Arial, sans-serif"
            fontSize="25"
            fontWeight="800"
            letterSpacing="4"
          >
            NEXUS
          </text>
          <text
            x="164"
            y="99"
            fill={inverse ? "#b8cbc5" : "#687773"}
            fontFamily="Arial, sans-serif"
            fontSize="9"
            fontWeight="600"
            letterSpacing="2.3"
          >
            CONNECT EVERYTHING
          </text>
        </>
      ) : (
        <>
          <path
            d="M13 22h41l28 31-14 16-29-32H13l16 17-16 19 55-1-14 17H13l42-48-16-17Z"
            fill={graphite}
          />
          <path
            d="M86 20 54 57l14 16 18-21 23 36h25L99 37l14-17H86Z"
            fill={green}
          />
        </>
      )}
    </svg>
  );
}
