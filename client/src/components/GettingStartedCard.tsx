/**
 * GettingStartedCard — the dashboard's "Getting started" checklist for a new user: what the app does,
 * and the four steps from an empty account to a graded interview (fill in the profile, add a job or
 * save practice questions, run an interview). Each step ticks itself off from real data
 * (useOnboardingSteps), so there's nothing to check by hand.
 *
 * Shown while the profile's `onboarding_dismissed` is false; the dashboard owns that check. Finishing
 * every step doesn't hide it: it reads "You're all set." and Hide is the way out. Hide is a PATCH of
 * the profile flag, so it holds on every device, and the nav's "Getting started" button brings it back.
 *
 * Self-contained like QuestionBankCard: it reads its own data and owns the Hide call.
 */
import { useUpdateProfileMutation } from "../api";
import { useOnboardingSteps } from "../hooks";
import { useToast } from "../toast/ToastProvider";
import Button from "./Button";
import OnboardingStepRow, { OnboardingStepRowSkeleton, type OnboardingStep } from "./OnboardingStepRow";
import { Skeleton } from "./Skeleton";

const STEPS: OnboardingStep[] = [
    {
        id: "defaults",
        title: "Set your default role and level",
        description: "Practice interviews start from it, and the dashboard opens scoped to it.",
        links: [{ to: "/settings/profile", label: "Go to Profile" }],
    },
    {
        id: "background",
        title: "Add your background",
        description:
            "Import your resume, or add your experience, projects and skills. Behavioral interviews ask about them.",
        links: [{ to: "/settings/profile", label: "Go to Profile" }],
    },
    {
        id: "practice",
        title: "Add a job or save practice questions",
        description:
            "Paste a job posting and we'll write interview rounds for it, or pick the questions a practice interview asks.",
        links: [
            { to: "/jobs", label: "Add a job" },
            { to: "/questions", label: "Browse questions" },
        ],
    },
    {
        id: "interview",
        title: "Run your first interview",
        description:
            "Answer by voice or by typing. The interviewer asks follow-ups, then grades every answer on a scorecard.",
        links: [
            { to: "/jobs", label: "Start from a job" },
            { to: "/questions", label: "Start a practice interview" },
        ],
    },
];

export default function GettingStartedCard() {
    const { toast } = useToast();
    const { done, doneCount, allDone, loading } = useOnboardingSteps();
    const [updateProfile, { isLoading: hiding }] = useUpdateProfileMutation();

    async function onHide() {
        try {
            await updateProfile({ onboarding_dismissed: true }).unwrap();
        } catch {
            toast("Couldn't hide the checklist. Try again.", { variant: "error" });
        }
    }

    return (
        <section className="rounded-md border border-divider px-[22px] pb-3 pt-[18px]">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-[23px] font-medium">Getting started</h2>
                <Button
                    variant="ghost"
                    className="text-[13px]"
                    onClick={onHide}
                    disabled={hiding}
                    title="You can bring this back from Getting started in the top bar"
                >
                    Hide
                </Button>
            </div>
            <p className="mt-1 text-[13.5px] leading-[1.5] text-neutral-400">
                Interview Helper runs mock interviews for a job you're applying to or a role you're practicing
                for, then grades your answers so you can see what to work on.
            </p>
            {loading ? (
                <Skeleton className="mt-2 h-3 w-40" />
            ) : (
                <p className="mt-2 text-[13px] text-neutral-500">
                    {allDone ? "You're all set." : `${doneCount} of ${STEPS.length} done`}
                    {" · "}You can bring this back from Getting started in the top bar.
                </p>
            )}

            <ul className="mt-2 divide-y divide-divider">
                {loading
                    ? STEPS.map((step) => <OnboardingStepRowSkeleton key={step.id} />)
                    : STEPS.map((step) => <OnboardingStepRow key={step.id} step={step} done={done[step.id]} />)}
            </ul>
        </section>
    );
}
