/**
 * TimeLimitSelect — the kickoff's "Time limit" picker (No time limit / 15 / 30 / 45 / 60 minutes), shared
 * by the Practice kickoff (wired through a Controller in its form) and the Job round pickers (plain
 * state). The value is the limit in MINUTES, null for none: what POST /api/interview takes as
 * `time_limit_minutes`.
 */
import Select from "react-select";
import { nocturneSelectStyles } from "../selectStyles";
import { DEFAULT_TIME_LIMIT_OPTION, TIME_LIMIT_OPTIONS, type TimeLimitOption } from "../constants";

export default function TimeLimitSelect({
    value,
    onChange,
    onBlur,
}: {
    value: number | null;
    onChange: (minutes: number | null) => void;
    onBlur?: () => void;
}) {
    return (
        <Select<TimeLimitOption>
            aria-label="Time limit"
            options={TIME_LIMIT_OPTIONS}
            value={TIME_LIMIT_OPTIONS.find((o) => o.value === value) ?? DEFAULT_TIME_LIMIT_OPTION}
            onChange={(opt) => opt && onChange(opt.value)}
            onBlur={onBlur}
            isSearchable={false}
            styles={nocturneSelectStyles}
        />
    );
}
