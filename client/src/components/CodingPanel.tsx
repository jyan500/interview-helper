/**
 * The coding round's workspace — shown beside the conversation when the round `has_code_editor`:
 * the problem statement on the table, a language picker and the CodeMirror editor.
 *
 * Purely presentational: SessionPage owns `code` / `language` because it attaches them to the next
 * answer (text AND voice turns), and it swaps `problem` when a turn advances to the next plan question.
 * Nothing here is executed — the code is read by the interviewer and the grader, like a whiteboard.
 */
import { useMemo } from "react";
import Select from "react-select";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import type { PlanQuestion } from "../api";
import { CODE_LANGUAGES, type CodeLanguage } from "../constants";
import { nocturneSelectStyles } from "../selectStyles";
import FormattedText from "./FormattedText";
import LoadingDots from "./LoadingDots";

type LanguageOption = (typeof CODE_LANGUAGES)[number];

// The CodeMirror syntax extension per language slug.
const LANGUAGE_EXTENSIONS: Record<CodeLanguage, () => Extension> = {
    python: () => python(),
    javascript: () => javascript(),
    typescript: () => javascript({ typescript: true }),
    java: () => java(),
    cpp: () => cpp(),
};

// Blend the stock dark theme into the Nocturne surface: the app's ground instead of the theme's grey,
// and a monospace font at the transcript's code size.
const NOCTURNE_EDITOR = EditorView.theme(
    {
        "&": { backgroundColor: "var(--color-canvas)", fontSize: "13.5px", height: "100%" },
        ".cm-gutters": { backgroundColor: "var(--color-canvas)", borderRight: "1px solid var(--color-divider)" },
        ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
    },
    { dark: true },
);

export default function CodingPanel({
    problem,
    code,
    onChangeCode,
    language,
    onChangeLanguage,
    readOnly,
}: {
    problem: PlanQuestion | null;
    code: string;
    onChangeCode: (code: string) => void;
    language: CodeLanguage;
    onChangeLanguage: (language: CodeLanguage) => void;
    readOnly: boolean;
}) {
    const extensions = useMemo(() => [LANGUAGE_EXTENSIONS[language](), NOCTURNE_EDITOR], [language]);

    return (
        <div className="flex min-h-0 flex-col gap-4 border-t border-divider p-5 lg:border-l lg:border-t-0">
            {/* Problem statement — its own scroll, so a long problem never pushes the editor off screen */}
            <div className="flex max-h-[38%] min-h-0 flex-col">
                <div className="kicker">Problem</div>
                <div className="mt-2.5 min-h-0 overflow-y-auto pr-1">
                    {problem ? (
                        <FormattedText text={problem.text} className="text-[14.5px] leading-[1.55] text-neutral-200" />
                    ) : (
                        <LoadingDots />
                    )}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                    <div className="kicker">Your code</div>
                    <div className="w-[160px]">
                        <Select<LanguageOption>
                            options={CODE_LANGUAGES}
                            value={CODE_LANGUAGES.find((o) => o.value === language)}
                            onChange={(opt) => opt && onChangeLanguage(opt.value)}
                            isSearchable={false}
                            isDisabled={readOnly}
                            styles={nocturneSelectStyles}
                        />
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-divider">
                    <CodeMirror
                        value={code}
                        onChange={onChangeCode}
                        extensions={extensions}
                        theme="dark"
                        height="100%"
                        style={{ height: "100%" }}
                        editable={!readOnly}
                        placeholder="Write your solution here. It's sent with your next answer."
                    />
                </div>
                <p className="m-0 text-[12.5px] text-neutral-400">
                    Your code goes with your next answer, typed or spoken, whenever it has changed. It isn't run.
                </p>
            </div>
        </div>
    );
}
