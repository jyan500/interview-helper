/**
 * Donut gauge — the scorecard's overall-score ring (Nocturne mock 3b).
 *
 * Built on visx's <Arc> (SVG, from @visx/shape) rather than a hand-computed
 * stroke-dasharray: a full track ring plus a value arc with rounded ends. Kept
 * presentational — the score number is rendered beside it by the caller, not inside.
 *
 * d3/visx arc angles start at 12 o'clock and sweep clockwise for a positive endAngle,
 * so no −90° rotation is needed (unlike the raw-SVG version).
 */
import { Arc } from "@visx/shape";
import { Group } from "@visx/group";

type Props = {
    value: number; // e.g. 4.25
    max?: number; // e.g. 5
    size?: number; // px, square
    thickness?: number; // ring stroke width
    trackColor?: string;
    valueColor?: string;
};

// TAU (2 * pi) represents one full circle
// so a fraction of the circle would be fraction * TAU
const TAU = Math.PI * 2;

export default function Donut({
    value,
    max = 5,
    size = 66,
    thickness = 5,
    trackColor = "var(--color-neutral-800)",
    valueColor = "var(--color-accent)",
}: Props) {
    const fraction = Math.max(0, Math.min(1, value / max));
    const outer = size / 2 - 2.5; // small inset so rounded caps don't clip the edge
    const inner = outer - thickness;

    return (
        <svg width={size} height={size} role="img" aria-label={`${value} out of ${max}`}>
            <Group top={size / 2} left={size / 2}>
                {/* Track — full ring */}
                <Arc innerRadius={inner} outerRadius={outer} startAngle={0} endAngle={TAU} fill={trackColor} />
                {/* Value — arc with rounded ends */}
                <Arc
                    innerRadius={inner}
                    outerRadius={outer}
                    startAngle={0}
                    endAngle={TAU * fraction}
                    cornerRadius={thickness / 2}
                    fill={valueColor}
                />
            </Group>
        </svg>
    );
}
