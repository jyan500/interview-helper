/**
 * The graded-scorecard display, extracted from App.tsx so Phase C's History view can render a
 * REMEMBERED grade with the exact same component that renders a freshly-computed one.
 *
 * This is the frontend edge of the same idea save_scorecard/get_scorecard prove on the backend:
 * a live grade (POST /api/scorecard) and a persisted one (GET /api/interviews/{id}) arrive in
 * the IDENTICAL shape (api.ts `Scorecard`), so one component serves both. The only difference is
 * `note`: the live grader fills a sentence per dimension, the persisted read-back leaves it ""
 * (the schema stores only the score) — so a note simply renders as nothing on the History side,
 * no branching required.
 *
 * Pure DISPLAY: all judgement happened on the backend. Nothing here fetches or computes.
 */
import type { Scorecard } from "./api";

export default function ScorecardView({ card }: { card: Scorecard }) {
    return (
        <section className="mt-6 rounded-lg border border-slate-300 p-4">
            <h2 className="text-xl font-bold text-slate-800">
                Scorecard — {card.overall}/5 overall
            </h2>

            {/* per-dimension averages. Object.entries turns the {dimension: average} map into rows. */}
            <ul className="mt-3 space-y-1">
                {Object.entries(card.dimension_averages).map(([dim, avg]) => (
                    <li key={dim} className="flex justify-between text-sm">
                        <span className="text-slate-600">{dim}</span>
                        <span className="font-semibold text-slate-800">{avg}/5</span>
                    </li>
                ))}
            </ul>
            {
                card.answers.map((a, i) => (
                    <div key={i} className="mt-4">
                        <p className="font-semibold">{a.question_text}</p>
                        {
                            a?.dimension_scores?.map((score) => {
                                return (
                                    <div key={score.dimension} className="flex flex-col gap-y-2">
                                        <div className="flex flex-row gap-x-2">
                                            <p>{score.dimension}</p>
                                            <p>{score.score}</p>
                                        </div>
                                        <p>{score.note}</p>
                                    </div>
                                )
                            })
                        }
                        <p>💪 {a.strength}</p>
                        <p>🕳️ {a.gap}</p>
                        <p>🔧 {a.improvement}</p>
                    </div>
                ))
            }
        </section>
    );
}
