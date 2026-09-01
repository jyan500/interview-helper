/**
 * Sparkline — the dashboard's Readiness trend (Nocturne mock 1a).
 *
 * Built on visx's <LinePath> + scaleLinear (SVG, from @visx/shape and @visx/scale)
 * instead of a hand-written <polyline>. Data-driven: pass the score series and the line,
 * baseline, dashed mid-reference and the marker dot on the last point are derived.
 *
 * Kept faithful to the mock: a fixed 320×74 coordinate box scaled to 100% width with
 * preserveAspectRatio="none" (the horizontal stretch the original used). Interactivity
 * is intentionally omitted for now — @visx/tooltip can be layered on later if wanted.
 */
import { LinePath } from "@visx/shape";
import { scaleLinear } from "@visx/scale";

type Props = {
    data: number[];
    width?: number;
    height?: number;
};

export default function Sparkline({ data, width = 320, height = 74 }: Props) {
    const marginX = 4;
    const marginTop = 10;
    const marginBottom = 12;

    const min = Math.min(...data);
    const max = Math.max(...data);

    // xScale controls the placement of the data point horizontally
    const xScale = scaleLinear<number>({
        domain: [0, Math.max(1, data.length - 1)],
        range: [marginX, width - marginX],
    });

    // yScale controls the placement of the data point vertically
    // Inverted range (SVG y grows downward); 
    // i.e a y value of 10 appears higher on the chart, whereas a value of 50 appears lower on the chart
    // a flat pad above/below so the line never
    // touches the edges. If all values are equal, nudge the domain so it centres.
    const yScale = scaleLinear<number>({
        domain: min === max ? [min - 1, max + 1] : [min, max],
        range: [height - marginBottom, marginTop],
    });

    const lastX = xScale(data.length - 1);
    const lastY = yScale(data[data.length - 1]);

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[74px] w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label="Readiness trend"
        >
            {/* Baseline + dashed mid-reference, both in the divider tone */}
            <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke="var(--color-divider)" />
            <line
                x1={0}
                y1={height / 2}
                x2={width}
                y2={height / 2}
                stroke="var(--color-divider)"
                strokeDasharray="3 4"
            />

            {/* Linepath represents the actual trend line with all data points */}
            <LinePath
                data={data}
                x={(_, i) => xScale(i)}
                y={(d) => yScale(d)}
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                fill="none"
            />

            {/* Marker on the latest point */}
            <circle cx={lastX} cy={lastY} r={3} fill="var(--color-accent)" />
        </svg>
    );
}
