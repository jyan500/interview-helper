/**
 * Message text that keeps its shape: prose keeps its line breaks (pre-wrap), and a ``` fenced block
 * renders as a monospace <pre> that keeps its indentation. Used by the transcript bubbles (MessageRow),
 * the coding panel's problem statement and the detail page's per-question cards — anywhere a coding
 * answer or a generated problem can show up.
 */
import { splitFencedCode } from "../helpers";

export default function FormattedText({ text, className = "" }: { text: string; className?: string }) {
    return (
        <div className="flex flex-col gap-2.5">
            {splitFencedCode(text).map((part, i) =>
                part.kind === "code" ? (
                    <pre
                        key={i}
                        className="m-0 overflow-x-auto rounded-md border border-divider bg-canvas px-3.5 py-3 font-mono text-[13px] leading-[1.55] text-neutral-200"
                    >
                        <code>{part.code}</code>
                    </pre>
                ) : (
                    <p key={i} className={"m-0 whitespace-pre-wrap [text-wrap:pretty] " + className}>
                        {part.text}
                    </p>
                ),
            )}
        </div>
    );
}
