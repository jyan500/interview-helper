import { SHIMMER } from "../constants";

// One shimmer placeholder row, matching the four columns. inline-block so the trailing bar honours
// the cell's text-align (right) the way a real button would.
export function SkeletonRow() {
    const bar = "inline-block h-3.5 " + SHIMMER;
    return (
        <tr>
            <td><span className={bar + " w-48"} /></td>
            <td><span className={bar + " w-20"} /></td>
            <td><span className={bar + " w-8"} /></td>
            <td className="text-right"><span className={bar + " w-14"} /></td>
        </tr>
    );
}
