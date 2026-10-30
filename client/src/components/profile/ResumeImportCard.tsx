/**
 * Import from resume: upload a PDF or Word resume and get its roles, projects and skills pre-filled for
 * review (ResumeReviewModal). Nothing is saved until the candidate adds it there.
 *
 *   pick a file ─► validateResumeFile ─► POST /api/profile/resume/parse (FormData "file")
 *              ─► found anything? open the review modal : toast that nothing was found
 *
 * THE FILE IS NEVER STORED, and the card says so: the server reads it once (a PDF goes to Gemini and is
 * deleted right after; a .docx is turned into text in memory) and keeps nothing.
 *
 * The parse mutation's own isLoading is the one flow flag: the button locks for the whole upload + read,
 * so a second, overlapping (paid) parse can't start.
 */
import { useRef, useState } from "react";
import { CircleNotch, FileArrowUp } from "@phosphor-icons/react";
import { useParseResumeFileMutation, type ResumeParseResponse } from "../../api";
import { RESUME_ACCEPTED_EXTENSIONS, RESUME_ACCEPTED_TYPES } from "../../constants";
import { errorDetail, validateResumeFile } from "../../helpers";
import { useToast } from "../../toast/ToastProvider";
import Button from "../Button";
import SettingsCard from "../settings/SettingsCard";
import ResumeReviewModal from "./ResumeReviewModal";

export default function ResumeImportCard() {
    const { toast } = useToast();
    const [parseResumeFile, { isLoading: reading }] = useParseResumeFileMutation();
    // what the last parse found, while the review modal is open
    const [parsed, setParsed] = useState<ResumeParseResponse | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        // let the same file be picked again later (an input won't fire onChange for an unchanged value)
        e.target.value = "";
        if (!file) return;

        // 1. the courtesy check, before a paid upload
        const error = validateResumeFile(file);
        if (error) {
            toast(error, { variant: "error" });
            return;
        }

        // 2. parse
        const body = new FormData();
        body.append("file", file);
        try {
            const result = await parseResumeFile(body).unwrap();
            // 3. review what was found, or say nothing was
            if (result.experiences.length === 0 && result.projects.length === 0 && result.skills.length === 0) {
                toast("We couldn't find any experience, projects or skills in that file.", { variant: "error" });
                return;
            }
            setParsed(result);
        } catch (e) {
            toast(errorDetail(e) ?? "Couldn't read your resume. Try again.", { variant: "error" });
        }
    }

    return (
        <SettingsCard
            title="Import from resume"
            description="Fill in your experience, projects and skills from your resume."
        >
            <div className="mt-5 flex flex-wrap items-center gap-4">
                {/* Hidden native input, driven by the visible button (the AvatarCard pattern). */}
                <input
                    ref={inputRef}
                    type="file"
                    accept={[...RESUME_ACCEPTED_EXTENSIONS, ...RESUME_ACCEPTED_TYPES].join(",")}
                    onChange={onPick}
                    className="hidden"
                />
                <Button
                    variant="secondary"
                    onClick={() => inputRef.current?.click()}
                    disabled={reading}
                    className="flex items-center gap-2 text-[14px]"
                >
                    {reading ? (
                        <CircleNotch size={16} className="animate-spin" />
                    ) : (
                        <FileArrowUp size={16} weight="regular" />
                    )}
                    {reading ? "Reading your resume…" : "Upload resume"}
                </Button>
                <p className="text-[12px] text-neutral-500">PDF or Word (.docx), up to 5 pages and 5 MB.</p>
            </div>
            <p className="mt-4 text-[12.5px] leading-[1.5] text-neutral-400">
                Your resume is not saved after it is uploaded.
            </p>

            {parsed && <ResumeReviewModal parsed={parsed} onClose={() => setParsed(null)} />}
        </SettingsCard>
    );
}
