/**
 * Edit the selected connection's label and direction. Plain controlled inputs (no validation, no
 * submit, so no react-hook-form): the values come from the live edge, and each change applies through
 * `onChange`.
 */
import { DIAGRAM_MAX_LABEL_CHARS } from "../../constants";
import type { DiagramEdgeData } from "../../helpers";
import DiagramInspector from "./DiagramInspector";

export default function EdgeInspector({
    data,
    onChange,
    onDelete,
}: {
    data: DiagramEdgeData;
    onChange: (patch: Partial<DiagramEdgeData>) => void;
    onDelete: () => void;
}) {
    return (
        <DiagramInspector title="Connection" onDelete={onDelete}>
            <div className="field">
                <label htmlFor="diagram-edge-label">Label</label>
                <input
                    id="diagram-edge-label"
                    className="input"
                    maxLength={DIAGRAM_MAX_LABEL_CHARS}
                    placeholder="HTTPS, reads, publishes..."
                    value={data.label}
                    onChange={(e) => onChange({ label: e.target.value })}
                />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-neutral-300">
                <input
                    type="checkbox"
                    className="accent-accent"
                    checked={data.bidirectional}
                    onChange={(e) => onChange({ bidirectional: e.target.checked })}
                />
                Two-way (arrows on both ends)
            </label>
        </DiagramInspector>
    );
}
