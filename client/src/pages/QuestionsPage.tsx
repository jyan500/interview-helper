/**
 * Questions — bank practice: start a bank interview (BankKickoffCard, role + level), and browse the
 * bank to curate the saved "My questions" set that interview asks. The dashboard is simulation-first,
 * so this page is where bank interviews start.
 *
 * TWO TABLES so the current selection is obvious at a glance instead of hunting through pages:
 *   Saved            — the questions already in the set (server `saved=true`).
 *   Other questions  — everything else for the role (server `saved=false`).
 * A checkbox only means "selected for this table's action", never "saved": which table a row sits in
 * says that. The tables share ONE useQuestionSelection + one sticky SelectionBar, and only one table
 * has a selection at a time: checking a row in the other table unchecks the first and switches the
 * bar's action ("Remove from saved" / "Add to saved"), which applies right away. The "Questions" tag
 * then invalidates and BOTH tables refetch, so the rows move across. A selection survives paging, but
 * clears when its table's filters change, so nothing a new filter hides gets acted on.
 *
 * FILTERS: each table has its OWN filter set (a QuestionFilters row) — a keyword search on the question
 * text, plus role / level / question-type pickers, applied on Search. The two sets are independent and
 * both live in the URL (prefixed `s_*` for Saved, `o_*` for Other, via useSectionFilters), so a deep
 * link reproduces both views and Back/Forward work. Level is matched EXACTLY here (exact_level), unlike
 * the interview-plan's at-or-below rule — a browse filter reads more intuitively that way.
 *
 * ROLE is a required scope (the bank is per-role), so with no role filter a section falls back to the
 * profile's default role (else backend-engineer). The "Saved (N)" heading is the UNFILTERED saved total
 * for the Saved section's role, so narrowing the Saved filters never skews it.
 *
 * YOUR OWN QUESTIONS: "Create question" opens QuestionModal; a new question lands in Saved. Your own rows
 * carry a "Custom" tag plus Edit / Delete. Delete archives it server-side, so past interviews that asked
 * it still show it. One saved from a job interview is read-only: View (QuestionViewModal) / Delete.
 * Bank questions get View only.
 */
import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { useGetProfileQuery, useGetQuestionsQuery, type QuestionItem } from "../api";
import { useClampPage, useQuestionSelection, useSectionFilters } from "../hooks";
import { PAGE_SIZE } from "../constants";
import AppNav from "../components/AppNav";
import BankKickoffCard from "../components/BankKickoffCard";
import Button from "../components/Button";
import QuestionFilters from "../components/QuestionFilters";
import QuestionsTable from "../components/QuestionsTable";
import DeleteQuestionModal from "../components/questions/DeleteQuestionModal";
import QuestionModal from "../components/questions/QuestionModal";
import QuestionViewModal from "../components/questions/QuestionViewModal";
import SelectionBar from "../components/SelectionBar";
import Pagination from "../components/Pagination";

export default function QuestionsPage() {
    const { data: profile } = useGetProfileQuery();
    // The question modal: "new" opens an empty Create form, a slug opens Edit, null closes it.
    const [editing, setEditing] = useState<string | "new" | null>(null);
    // the read-only view of a question you can't edit (a bank one, or one saved from a job interview)
    const [viewing, setViewing] = useState<QuestionItem | null>(null);
    const [pendingDelete, setPendingDelete] = useState<QuestionItem | null>(null);
    // The fallback role when a section has no role filter — the profile default, else backend-engineer.
    const defaultRoleSlug = profile?.role?.slug ?? "backend-engineer";
    const defaultRoleName = profile?.role?.name ?? "Backend Engineer";
    const defaultRole = { value: defaultRoleSlug, label: defaultRoleName };

    // Each table's filter set + page, backed by its own slice of the URL.
    const saved = useSectionFilters("s_");
    const other = useSectionFilters("o_");

    // Effective role per section: the filter's role, else the default.
    const savedRoleSlug = saved.role ?? defaultRoleSlug;
    const otherRoleSlug = other.role ?? defaultRoleSlug;

    // exact_level: on the browse page a level filter means ONLY that level (not the plan's at-or-below).
    const { data: savedData, isFetching: savedFetching } = useGetQuestionsQuery({
        role: savedRoleSlug,
        saved: true,
        q: saved.q,
        level: saved.level,
        type: saved.questionType,
        authored: saved.authored || undefined,
        exact_level: true,
        page: saved.page,
        size: PAGE_SIZE,
    });
    const { data: restData, isFetching: restFetching } = useGetQuestionsQuery({
        role: otherRoleSlug,
        saved: false,
        q: other.q,
        level: other.level,
        type: other.questionType,
        authored: other.authored || undefined,
        exact_level: true,
        page: other.page,
        size: PAGE_SIZE,
    });

    // A bulk action can empty a table's last page, so step back to the new last page.
    useClampPage(saved.page, savedData?.pages, saved.goToPage);
    useClampPage(other.page, restData?.pages, other.goToPage);

    // The heading's count = the user's TOTAL saved questions for the Saved section's role,
    // UNAFFECTED by the finer filters (a size-1 query just for `total`). Filtering the Saved table
    // narrows the rows shown, not how many the user has saved, so this stays the honest count.
    const { data: savedTotalData } = useGetQuestionsQuery({
        role: savedRoleSlug,
        saved: true,
        page: 1,
        size: 1,
    });
    const savedTotal = savedTotalData?.total ?? 0;
    const selection = useQuestionSelection();

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                <div className="flex items-start justify-between gap-4 px-7 pb-3 pt-[26px]">
                    <div>
                        <h1 className="font-heading text-[30px] font-medium leading-[1.1] tracking-[-0.02em]">
                            Questions
                        </h1>
                        <p className="mt-2 text-[13.5px] text-neutral-400">
                            Select questions below to add them to your saved questions or remove them. Your next practice interview
                            asks your saved questions. If you don't save any, the interview will ask three questions of increasing difficulty instead.
                            You can also write your own questions using the "Create Question" button.
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={() => setEditing("new")}
                        className="flex shrink-0 items-center gap-1.5 text-[13.5px]"
                    >
                        <Plus size={15} weight="regular" />
                        Create question
                    </Button>
                </div>

                <div className="px-7 pb-[26px] pt-2">
                    <div className="mb-8">
                        <BankKickoffCard />
                    </div>

                    {/* Saved — the current set (server truth). Selected rows can be removed, which drops
                        them into "Other questions" below. */}
                    <h2 className="mb-4 font-heading text-[19px] font-medium">
                        Saved <span className="text-neutral-400">{savedTotal > 0 ? `(${savedTotal})` : ""}</span>
                    </h2>
                    <QuestionFilters
                        roleSlug={savedRoleSlug}
                        levelSlug={saved.level}
                        questionTypeSlug={saved.questionType}
                        q={saved.q}
                        authored={saved.authored}
                        defaultRole={defaultRole}
                        showClear={saved.hasFilters}
                        onApply={(values) => {
                            saved.apply(values);
                            selection.clearFor("remove");
                        }}
                        onClear={() => {
                            saved.clear();
                            selection.clearFor("remove");
                        }}
                    />
                    <QuestionsTable
                        questions={savedData?.items ?? []}
                        isChecked={selection.isChecked}
                        onToggle={(slug) => selection.toggle("remove", slug)}
                        onTogglePage={(slugs) => selection.togglePage("remove", slugs)}
                        onEdit={(q) => setEditing(q.slug)}
                        onView={setViewing}
                        onDelete={setPendingDelete}
                        loading={savedFetching}
                        skeletonRows={3}
                        emptyMessage={
                            saved.hasFilters
                                ? "No saved questions match these filters."
                                : "No saved questions yet. Add some from below, or start and we'll pick 3 for you."
                        }
                    />
                    <Pagination
                        page={savedData?.page ?? saved.page}
                        totalPages={savedData?.pages ?? 0}
                        onPageChange={saved.goToPage}
                    />

                    {/* Everything else for this role. Selected rows can be added, which moves them up. */}
                    <h2 className="mb-4 mt-8 font-heading text-[19px] font-medium">Other questions</h2>
                    <QuestionFilters
                        roleSlug={otherRoleSlug}
                        levelSlug={other.level}
                        questionTypeSlug={other.questionType}
                        q={other.q}
                        authored={other.authored}
                        defaultRole={defaultRole}
                        showClear={other.hasFilters}
                        onApply={(values) => {
                            other.apply(values);
                            selection.clearFor("add");
                        }}
                        onClear={() => {
                            other.clear();
                            selection.clearFor("add");
                        }}
                    />
                    <QuestionsTable
                        questions={restData?.items ?? []}
                        isChecked={selection.isChecked}
                        onToggle={(slug) => selection.toggle("add", slug)}
                        onTogglePage={(slugs) => selection.togglePage("add", slugs)}
                        onEdit={(q) => setEditing(q.slug)}
                        onView={setViewing}
                        onDelete={setPendingDelete}
                        loading={restFetching}
                        skeletonRows={PAGE_SIZE}
                        emptyMessage={
                            other.hasFilters
                                ? "No questions match these filters."
                                : "Nothing left. You've saved every question for this role."
                        }
                    />
                    <Pagination
                        page={restData?.page ?? other.page}
                        totalPages={restData?.pages ?? 0}
                        onPageChange={other.goToPage}
                    />

                    <SelectionBar
                        count={selection.count}
                        actionLabel={selection.action === "add" ? "Add to saved" : "Remove from saved"}
                        busyLabel={selection.action === "add" ? "Adding…" : "Removing…"}
                        busy={selection.applying}
                        onAction={selection.apply}
                        onClear={selection.clear}
                    />

                    {editing && (
                        <QuestionModal
                            slug={editing === "new" ? undefined : editing}
                            defaultRole={defaultRole}
                            onClose={() => setEditing(null)}
                        />
                    )}

                    {viewing && <QuestionViewModal question={viewing} onClose={() => setViewing(null)} />}

                    <DeleteQuestionModal
                        question={pendingDelete}
                        onClose={() => setPendingDelete(null)}
                        onDeleted={selection.deselect}
                    />
                </div>
            </div>
        </div>
    );
}
