/**
 * The coding round's workspace — shown beside the conversation when the round `has_code_editor`:
 * the problem statement on the table, a language picker and the CodeMirror editor.
 *
 * Purely presentational: SessionPage owns `code` / `language` because it attaches them to the next
 * answer (text AND voice turns), and it swaps `problem` when a turn advances to the next plan question.
 * Nothing here is executed — the code is read by the interviewer and the grader, like a whiteboard.
 */
import { useMemo, useState } from "react";
import Select from "react-select";
import { Gear } from "@phosphor-icons/react";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { indentUnit } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { vim } from "@replit/codemirror-vim";
import { emacs } from "@replit/codemirror-emacs";
import type { PlanQuestion } from "../api";
import { CODE_LANGUAGES, type CodeLanguage, type EditorKeymap, type EditorSettings } from "../constants";
import { loadStoredEditorSettings, saveStoredEditorSettings } from "../helpers";
import { nocturneSelectStyles } from "../selectStyles";
import Button from "./Button";
import EditorSettingsModal from "./EditorSettingsModal";
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

// Extra key bindings on top of CodeMirror's defaults (none for "default").
const KEYMAP_EXTENSIONS: Record<EditorKeymap, () => Extension[]> = {
    default: () => [],
    vim: () => [vim()],
    emacs: () => [emacs()],
};

// Blend the stock dark theme into the Nocturne surface: the app's ground instead of the theme's grey,
// and a monospace font at the chosen size. (CodeMirror has no font-size option; it's theme CSS.)
function nocturneEditorTheme(fontSize: number): Extension {
    return EditorView.theme(
        {
            "&": { backgroundColor: "var(--color-canvas)", fontSize: `${fontSize}px`, height: "100%" },
            ".cm-gutters": { backgroundColor: "var(--color-canvas)", borderRight: "1px solid var(--color-divider)" },
            ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
        },
        { dark: true },
    );
}

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
    // The editor preferences (the gear). Editor-only, so they live here rather than in SessionPage —
    // unlike `code`/`language`, nothing about them is sent with an answer. Persisted on every change.
    const [settings, setSettings] = useState<EditorSettings>(loadStoredEditorSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    function handleChangeSettings(patch: Partial<EditorSettings>) {
        const next = { ...settings, ...patch };
        setSettings(next);
        saveStoredEditorSettings(next);
    }

    // The keymap goes FIRST: @replit/codemirror-vim must precede other keymaps to take priority.
    // indentUnit makes one indent insert `tabSize` spaces (tabSize alone only sets a tab's width).
    const extensions = useMemo(
        () => [
            ...KEYMAP_EXTENSIONS[settings.keymap](),
            LANGUAGE_EXTENSIONS[language](),
            indentUnit.of(" ".repeat(settings.tabSize)),
            nocturneEditorTheme(settings.fontSize),
        ],
        [language, settings.keymap, settings.tabSize, settings.fontSize],
    );
    // basicSetup's own toggles; memoized so an unrelated re-render doesn't reconfigure the editor.
    const basicSetup = useMemo(
        () => ({ tabSize: settings.tabSize, autocompletion: settings.autocomplete }),
        [settings.tabSize, settings.autocomplete],
    );

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
                    <div className="flex items-center gap-2">
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
                        <Button variant="ghost" icon aria-label="Editor settings" onClick={() => setSettingsOpen(true)}>
                            <Gear size={17} weight="regular" />
                        </Button>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-divider">
                    <CodeMirror
                        value={code}
                        onChange={onChangeCode}
                        extensions={extensions}
                        basicSetup={basicSetup}
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

            <EditorSettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                settings={settings}
                onChange={handleChangeSettings}
            />
        </div>
    );
}
