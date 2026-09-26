/**
 * The coding panel's editor preferences — font size, key bindings, tab size and autocomplete — behind
 * the gear next to the language picker, in the shared <Modal> shell. Every change applies to the editor
 * immediately (there's nothing to "save": each is a live, reversible preference), and CodingPanel
 * persists it.
 *
 * Presentational: renders the current settings and hands back a patch.
 */
import Select from "react-select";
import Modal from "./Modal";
import SegmentedControl from "./SegmentedControl";
import { nocturneSelectStyles } from "../selectStyles";
import { EDITOR_FONT_SIZES, EDITOR_KEYMAPS, type EditorSettings } from "../constants";

type FontSizeOption = (typeof EDITOR_FONT_SIZES)[number];

const TAB_SIZES: { value: EditorSettings["tabSize"]; label: string }[] = [
    { value: 2, label: "2 spaces" },
    { value: 4, label: "4 spaces" },
];
const AUTOCOMPLETE: { value: boolean; label: string }[] = [
    { value: false, label: "Off" },
    { value: true, label: "On" },
];

export default function EditorSettingsModal({
    open,
    onClose,
    settings,
    onChange,
}: {
    open: boolean;
    onClose: () => void;
    settings: EditorSettings;
    onChange: (patch: Partial<EditorSettings>) => void;
}) {
    return (
        <Modal open={open} onClose={onClose} title="Editor settings">
            <div className="flex flex-col gap-5">
                <div>
                    <div className="kicker">Font size</div>
                    <div className="mt-2">
                        <Select<FontSizeOption>
                            aria-label="Font size"
                            options={EDITOR_FONT_SIZES}
                            value={EDITOR_FONT_SIZES.find((o) => o.value === settings.fontSize)}
                            onChange={(opt) => opt && onChange({ fontSize: opt.value })}
                            isSearchable={false}
                            styles={nocturneSelectStyles}
                        />
                    </div>
                </div>

                <div>
                    <div className="kicker">Key bindings</div>
                    <div className="mt-2">
                        <SegmentedControl
                            label="Key bindings"
                            options={EDITOR_KEYMAPS}
                            value={settings.keymap}
                            onChange={(keymap) => onChange({ keymap })}
                        />
                    </div>
                </div>

                <div>
                    <div className="kicker">Indentation</div>
                    <div className="mt-2">
                        <SegmentedControl
                            label="Indentation"
                            options={TAB_SIZES}
                            value={settings.tabSize}
                            onChange={(tabSize) => onChange({ tabSize })}
                        />
                    </div>
                </div>

                <div>
                    <div className="kicker">Autocomplete</div>
                    <div className="mt-2">
                        <SegmentedControl
                            label="Autocomplete"
                            options={AUTOCOMPLETE}
                            value={settings.autocomplete}
                            onChange={(autocomplete) => onChange({ autocomplete })}
                        />
                    </div>
                    <p className="mt-2 text-[12.5px] text-neutral-400">
                        Most real coding interviews give you a plain editor, so it's off by default.
                    </p>
                </div>
            </div>
        </Modal>
    );
}
