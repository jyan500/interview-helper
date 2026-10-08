/**
 * The system-design workspace, shown beside the conversation while the question on the table
 * `has_diagram_canvas`: the question, and the canvas the candidate draws their design on.
 *
 * SessionPage lazy-loads this (React.lazy), so React Flow and its stylesheet only download when a
 * system-design question comes up. Like CodingPanel it's presentational: SessionPage owns the
 * DiagramDoc it attaches to the next answer; the board inside owns React Flow's own state.
 */
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DiagramDoc, PlanQuestion } from "../../api";
import FormattedText from "../FormattedText";
import LoadingDots from "../LoadingDots";
import DiagramBoard from "./DiagramBoard";

export default function DiagramPanel({
    question,
    initialDiagram,
    onChange,
    readOnly,
}: {
    question: PlanQuestion | null;
    initialDiagram: DiagramDoc;
    onChange: (doc: DiagramDoc) => void;
    readOnly: boolean;
}) {
    return (
        <div className="flex min-h-0 flex-col gap-4 border-t border-divider p-5 lg:border-l lg:border-t-0">
            {/* The question: its own scroll, so a long prompt never squeezes the canvas */}
            <div className="flex max-h-[22%] min-h-0 flex-col">
                <div className="kicker">Question</div>
                <div className="mt-2.5 min-h-0 overflow-y-auto pr-1">
                    {question ? (
                        <FormattedText text={question.text} className="text-[14.5px] leading-[1.55] text-neutral-200" />
                    ) : (
                        <LoadingDots />
                    )}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <div className="kicker">Your design</div>
                <ReactFlowProvider>
                    <DiagramBoard initialDiagram={initialDiagram} onChange={onChange} readOnly={readOnly} />
                </ReactFlowProvider>
                <p className="m-0 text-[12.5px] text-neutral-400">
                    Your diagram goes with your next answer, typed or spoken, whenever it has changed.
                </p>
            </div>
        </div>
    );
}
