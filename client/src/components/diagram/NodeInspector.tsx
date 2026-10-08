/**
 * Edit the selected component's name and notes. Plain controlled inputs (no validation, no submit, so
 * no react-hook-form): the values come from the live node, and every keystroke applies through
 * `onChange`, so an inline rename on the canvas shows here too. A note (text kind) is only its text.
 */
import { DIAGRAM_MAX_LABEL_CHARS, DIAGRAM_MAX_NOTES_CHARS } from "../../constants";
import { diagramKindInfo, type DiagramNodeData } from "../../helpers";
import DiagramInspector from "./DiagramInspector";

export default function NodeInspector({
    data,
    onChange,
    onDelete,
}: {
    data: DiagramNodeData;
    onChange: (patch: Partial<DiagramNodeData>) => void;
    onDelete: () => void;
}) {
    const isNote = data.kind === "text";
    const info = diagramKindInfo(data.kind);
    return (
        <DiagramInspector title={info.label} onDelete={onDelete}>
            <div className="field">
                <label htmlFor="diagram-node-label">{isNote ? "Text" : "Name"}</label>
                {isNote ? (
                    <textarea
                        id="diagram-node-label"
                        className="input"
                        maxLength={DIAGRAM_MAX_LABEL_CHARS}
                        value={data.label}
                        onChange={(e) => onChange({ label: e.target.value })}
                    />
                ) : (
                    <input
                        id="diagram-node-label"
                        className="input"
                        maxLength={DIAGRAM_MAX_LABEL_CHARS}
                        placeholder={info.label}
                        value={data.label}
                        onChange={(e) => onChange({ label: e.target.value })}
                    />
                )}
            </div>
            {!isNote && (
                <div className="field">
                    <label htmlFor="diagram-node-notes">Notes</label>
                    <textarea
                        id="diagram-node-notes"
                        className="input"
                        maxLength={DIAGRAM_MAX_NOTES_CHARS}
                        placeholder="Tech choice, sharding, scaling..."
                        value={data.notes}
                        onChange={(e) => onChange({ notes: e.target.value })}
                    />
                </div>
            )}
        </DiagramInspector>
    );
}
